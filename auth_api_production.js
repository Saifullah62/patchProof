const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const axios = require('axios');
const Joi = require('joi');
const winston = require('winston');
const {
  deriveKeyFromMessage,
  deriveEphemeralSessionKey,
  computeMerkleRoot,
  signHash,
  verifyHashSignature,
  computeSha256,
  deriveKeyTree
} = require('./keyUtils');
const { getSecret } = require('./secrets');
// DB_TYPE controls which SQL backend is used: 'sqlite' (default), 'postgres', or 'mysql'.
// See db.js for details. Set DB_TYPE and DB_FILE/DB_URL in your environment.
const { initDb, saveRecord, getRecord } = require('./db');

/*
 * Authentication Record API (Production)
 *
 * This implementation demonstrates how to manage SmartLedger PatchProof™
 * authentication records using the official BSV library while adhering to
 * production concerns such as durable storage, deterministic key derivation
 * and minimal user friction.  Each claimant’s key pair is derived on the
 * fly from a master secret and a user identifier, optionally combined with a
 * second factor and derivation index.  Records are persisted to a SQL
 * database (SQLite by default, PostgreSQL/MySQL stubs included) and a stubbed
 * broadcast helper illustrates how OP_RETURN anchoring might be integrated.
 */

// ---------------------------------------------------------------------------
// Deterministic key derivation now handled by keyUtils.js
// Use deriveKeyFromMessage or deriveEphemeralSessionKey as needed.

// ---------------------------------------------------------------------------
// SQL persistence (multi-database via db.js)
//
// Records are persisted to a SQL database.  Each row stores the txid and a JSON
// string representation of the record.  By default, uses SQLite. PostgreSQL and
// MySQL stubs are included for future support. See db.js for details.
//
// Use saveRecord(txid, record) and getRecord(txid) for all persistence.
// Call initDb() before starting the server.

// ---------------------------------------------------------------------------
// Logging configuration
//
// Use local logger.js (Winston with aggregation support)
const logger = require('./logger'); // See logger.js for log aggregation setup
// To extend logging, add transports to logger.js. For example, to write logs to a file:
// const fileTransport = new winston.transports.File({ filename: 'logs/combined.log' });
// logger.add(fileTransport);

// ---------------------------------------------------------------------------
// Configuration and environment variables
//
// The API key protects non‑public endpoints.  Merchant API and UTXO
// configuration are used by the broadcast helper to anchor records on
// chain.  When unset, broadcasting is skipped.
const API_KEY = getSecret('API_KEY') || 'demo-secret';
const MERCHANT_API_URL = getSecret('MERCHANT_API_URL') || null;
const UTXO_TXID = getSecret('UTXO_TXID') || null;
const UTXO_OUTPUT_INDEX = getSecret('UTXO_OUTPUT_INDEX') ? parseInt(getSecret('UTXO_OUTPUT_INDEX'), 10) : null;
const UTXO_SATOSHIS = getSecret('UTXO_SATOSHIS') ? parseInt(getSecret('UTXO_SATOSHIS'), 10) : null;
const UTXO_SCRIPT_HEX = getSecret('UTXO_SCRIPT_HEX') || null;

// --- SmartLedger dynamic funding config ---
const SMARTLEDGER_API_BASE_URL = process.env.SMARTLEDGER_API_BASE_URL || null;
const SMARTLEDGER_API_KEY = process.env.SMARTLEDGER_API_KEY || null;
const FUNDING_ADDRESS = process.env.FUNDING_ADDRESS || null;
const FUNDING_WIF = process.env.FUNDING_WIF || null;


// ---------------------------------------------------------------------------
// Joi schema definition for AUTHENTICATION_RECORD
//
// Validates incoming records to ensure required fields are present and
// correctly formatted.
const authRecordSchema = Joi.object({
  type: Joi.string().valid('AUTHENTICATION_RECORD').required(),
  version: Joi.string().required(),
  issuer: Joi.string().required(),
  product: Joi.object({
    category: Joi.string().required(),
    id: Joi.string().required(),
    serial_number: Joi.string().required(),
    patch_type: Joi.string().required(),
    material: Joi.string().required(),
    rfid_tag_id: Joi.string().required(),
    date_embedded: Joi.string().isoDate().required(),
  }).required(),
  owner: Joi.object({
    claimed: Joi.boolean().required(),
    current_holder: Joi.string().allow(null).required(),
    last_verified: Joi.any().allow(null),
  }).required(),
  metadata: Joi.object({
    image: Joi.string().uri().required(),
    patch_location: Joi.string().required(),
    notes: Joi.string().required(),
  }).required(),
}).unknown(false);

// ---------------------------------------------------------------------------
// Cryptographic helpers now handled by keyUtils.js
// Use computeSha256, signHash, verifyHashSignature from keyUtils.js

function computeTxid(buf) {
  const txHash = bsv.Hash.sha256Sha256(buf);
  return Buffer.from(txHash).reverse().toString('hex');
}

// ---------------------------------------------------------------------------
// Broadcast helper (production: full BSV transaction)
//
// Builds and signs a real BSV transaction with OP_RETURN and change output.
// Loads UTXO and key from utxoConfig.js. For production, replace with wallet/UTXO provider.
const utxoConfig = require('./utxoConfig');

async function broadcastRecord(hashBuf) {
  // Prefer SmartLedger dynamic wallet if configured
  if (SMARTLEDGER_API_BASE_URL && SMARTLEDGER_API_KEY && FUNDING_ADDRESS && FUNDING_WIF) {
    return await broadcastRecordViaSmartLedger(hashBuf);
  }
  // Fallback: legacy static/manual mode
  if (!MERCHANT_API_URL || !UTXO_TXID || UTXO_OUTPUT_INDEX === null || !UTXO_SATOSHIS || !UTXO_SCRIPT_HEX) {
    return { broadcasted: false, reason: 'Broadcast disabled or incomplete configuration' };
  }
  try {
    // 1. Build OP_RETURN output
    const namespace = Buffer.from('smartledger-auth');
    const chunks = [];
    chunks.push({ opCodeNum: bsv.OpCode.OP_FALSE });
    chunks.push({ opCodeNum: bsv.OpCode.OP_RETURN });
    chunks.push(namespace);
    chunks.push(hashBuf);
    const opReturnScript = bsv.Script.fromChunks(chunks);

    // 2. Build transaction
    const tx = new bsv.Tx();
    tx.addInput(new bsv.TxIn({
      txid: utxoConfig.utxo.txid,
      vout: utxoConfig.utxo.vout,
      script: bsv.Script.fromHex(utxoConfig.utxo.scriptPubKey),
    }));
    tx.addOutput(new bsv.TxOut({
      script: opReturnScript,
      satoshis: 0,
    }));

    // 3. Calculate fee and add change output
    const FEE_PER_BYTE = 0.5; // satoshis/byte (adjust as needed)
    const DUST_LIMIT = 546;
    const estimatedSize = 180 + 34 + 34 + 10;
    const fee = Math.ceil(estimatedSize * FEE_PER_BYTE);
    const change = utxoConfig.utxo.satoshis - fee;
    if (change < DUST_LIMIT) {
      return { broadcasted: false, reason: 'Insufficient funds for fee/dust' };
    }
    let changeAddr = utxoConfig.changeAddress;
    if (!changeAddr) {
      const key = bsv.PrivKey.fromWif(utxoConfig.privKeyWIF);
      changeAddr = bsv.Address.fromPrivKey(key).toString();
    }
    tx.addOutput(new bsv.TxOut({
      script: bsv.Script.fromAddress(changeAddr),
      satoshis: change,
    }));

    // 4. Sign input
    const key = bsv.PrivKey.fromWif(utxoConfig.privKeyWIF);
    tx.sign(key);

    // 5. Serialize and broadcast
    const rawTx = tx.toHex();
    const payload = { rawTx };
    const response = await axios.post(MERCHANT_API_URL, payload, { timeout: 5000 });
    return { broadcasted: true, txid: tx.getId(), mapiResponse: response.data };
  } catch (err) {
    logger.error({ message: 'Broadcast error', error: err.message, stack: err.stack });
    return { broadcasted: false, error: err.message };
  }
}

// --- SmartLedger dynamic funding helpers ---
async function fetchUtxos(address) {
  const url = `${SMARTLEDGER_API_BASE_URL}/api/address/${address}/utxos`;
  const response = await axios.get(url, {
    headers: { 'X-API-Key': SMARTLEDGER_API_KEY },
    timeout: 5000,
  });
  return response.data; // [{ txid, vout, satoshis, scriptPubKey }, ...]
}

function selectUtxos(utxos, target) {
  const selected = [];
  let total = 0;
  for (const utxo of utxos) {
    selected.push(utxo);
    total += utxo.satoshis;
    if (total >= target) break;
  }
  if (total < target) throw new Error('Insufficient funds');
  return { selected, total };
}

async function broadcastRecordViaSmartLedger(hashBuf) {
  try {
    // 1. Fetch UTXOs
    const utxos = await fetchUtxos(FUNDING_ADDRESS);
    if (!Array.isArray(utxos) || utxos.length === 0) {
      return { broadcasted: false, error: 'No UTXOs available for funding address' };
    }
    // 2. Determine how much we need (dust + flat fee)
    const required = 546 + 500; // 546 sats dust + 500 sats fee
    let selected, total;
    try {
      ({ selected, total } = selectUtxos(utxos, required));
    } catch (err) {
      return { broadcasted: false, error: err.message };
    }
    // 3. Construct the transaction
    const tx = new bsv.Transaction();
    tx.from(selected.map((u) => ({
      txId: u.txid || u.txId || u.tx_id,
      outputIndex: u.vout || u.outputIndex || u.n,
      satoshis: u.satoshis,
      script: u.scriptPubKey || u.script,
    })));
    const namespaceBuf = Buffer.from('smartledger-auth');
    const opReturnScript = bsv.Script.buildSafeDataOut([namespaceBuf, hashBuf]);
    tx.addOutput(new bsv.Transaction.Output({ script: opReturnScript, satoshis: 0 }));
    const change = total - 500;
    if (change < 546) {
      return { broadcasted: false, error: 'Insufficient change after fee' };
    }
    tx.to(FUNDING_ADDRESS, change);
    // 4. Sign with the funding private key
    const privateKey = new bsv.PrivateKey(FUNDING_WIF);
    tx.sign(privateKey);
    const rawTx = tx.toString();
    // 5. Broadcast via SmartLedger
    const broadcastUrl = `${SMARTLEDGER_API_BASE_URL}/api/tx/broadcast`;
    let mapiResponse;
    try {
      const { data } = await axios.post(
        broadcastUrl,
        { rawtx: rawTx },
        { headers: { 'X-API-Key': SMARTLEDGER_API_KEY }, timeout: 10000 }
      );
      mapiResponse = data;
    } catch (err) {
      logger.error({ message: 'SmartLedger broadcast error', error: err.message });
      return { broadcasted: false, error: err.message };
    }
    // Optional: fetch a merkle proof
    let merkleProof = null;
    try {
      const proofUrl = `${SMARTLEDGER_API_BASE_URL}/api/tx/${tx.hash}/merkle-proof`;
      const { data } = await axios.get(
        proofUrl,
        { headers: { 'X-API-Key': SMARTLEDGER_API_KEY }, timeout: 10000 }
      );
      merkleProof = data;
    } catch (err) {}
    return {
      broadcasted: true,
      txid: tx.hash,
      mapiResponse,
      merkleProof,
    };
  } catch (err) {
    logger.error({ message: 'SmartLedger dynamic funding error', error: err.message });
    return { broadcasted: false, error: err.message };
  }
}

// Document required env vars:
// SMARTLEDGER_API_BASE_URL – e.g. https://smartledger.dev
// SMARTLEDGER_API_KEY – your SmartLedger API key
// FUNDING_ADDRESS – BSV address used to fund anchoring transactions
// FUNDING_WIF – corresponding private key in WIF format

// ---------------------------------------------------------------------------
// Express application setup
//
const requestIdMiddleware = require('./requestId');
const app = express();
app.use(requestIdMiddleware);
// --- CORS configuration ---
const allowedOrigins = [
  'https://yourdomain.com',
  'https://admin.yourdomain.com',
];
app.use(cors({
  origin: (origin, cb) => {
    if (process.env.NODE_ENV === 'development' || !origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info({ message: msg.trim() }) } }));

// Swagger UI (OpenAPI docs)
const setupSwagger = require('./swagger');
setupSwagger(app);
// --- Rate limiting configuration ---
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 100, // higher for dev, 100 for prod
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json({ error: { message: 'Too many requests, please try again later.', requestId: req.requestId || null } });
  },
});
app.use(limiter);

function requireAuth(req, res, next) {
  const publicPaths = ['/', '/health'];
  if (publicPaths.includes(req.path)) return next();
  const authHeader = req.get('authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (!token || token !== API_KEY) {
    return res.status(401).json({ error: { message: 'Unauthorized', requestId: req.requestId || null } });
  }
  next();
}
app.use(requireAuth);

// Root endpoint provides basic service information and signals the key strategy
app.get('/', (req, res) => {
  res.json({
    service: 'SmartLedger PatchProof™ Authentication API',
    status: 'ok',
    network: 'mock',
    pubKeyStrategy: 'deterministic per user (derived on demand)',
  });
});

// Email/SMS verification endpoints
const { sendVerificationEmail } = require('./emailStub');
const { saveCode, verifyCode } = require('./verificationStore');
const { signJWT } = require('./jwt');

// POST /verify-request
// { email: string } or { phone: string } (phone stubbed)
app.post('/verify-request', async (req, res) => {
  const { email, phone } = req.body;
  if (!email && !phone) {
    return res.status(400).json({ error: { message: 'Must provide email or phone', requestId: req.requestId || null } });
  }
  const identifier = email || phone;
  // Generate a 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await saveCode(identifier, code);
  if (email) {
    await sendVerificationEmail(email, code);
  } else {
    // SMS stub
    console.log(`[SMS STUB] To: ${phone} | Code: ${code}`);
  }
  res.json({ ok: true });
});

// POST /verify-submit
// { email: string, code: string } or { phone: string, code: string }
app.post('/verify-submit', async (req, res) => {
  const { email, phone, code } = req.body;
  if ((!email && !phone) || !code) {
    return res.status(400).json({ error: { message: 'Must provide identifier and code', requestId: req.requestId || null } });
  }
  const identifier = email || phone;
  const valid = await verifyCode(identifier, code);
  if (!valid) {
    return res.status(401).json({ error: { message: 'Invalid or expired code', requestId: req.requestId || null } });
  }
  // Issue JWT (10 min expiry)
  const jwt = signJWT({ identifier, method: email ? 'email' : 'phone' }, 600);
  res.json({ token: jwt, expiresIn: 600 });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// POST /authRecord
//
// Accepts an authentication record, computes its canonical hash,
// derives a key for the identified user, signs the hash, stores the full
// record and optionally broadcasts a proof to the blockchain.
app.post('/authRecord', async (req, res) => {
  const record = req.body;
  const { error: validationError } = authRecordSchema.validate(record, { abortEarly: false });
  if (validationError) {
    return res.status(400).json({ error: { message: 'Validation failed', details: validationError.details.map((d) => d.message), requestId: req.requestId || null } });
  }
  // Require JWT in Authorization: Bearer <token>
  const authHeader = req.get('authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) {
    return res.status(401).json({ error: { message: 'Missing or invalid Authorization: Bearer <token> header' } });
  }
  const token = match[1];
  const jwtPayload = verifyJWT(token);
  if (!jwtPayload || !jwtPayload.identifier) {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
  // Use identifier from JWT
  const userId = jwtPayload.identifier;
  let secondFactor = req.get('x-passphrase') || '';
  let keyIndex = req.get('x-key-index') || req.get('key-index');
  keyIndex = keyIndex ? parseInt(keyIndex, 10) : 0;
  if (Number.isNaN(keyIndex) || keyIndex < 0) keyIndex = 0;
  try {
    const clone = JSON.parse(JSON.stringify(record));
    if (clone.auth) delete clone.auth;
    const hashBuf = computeSha256(clone);
    const txid = computeTxid(Buffer.from(JSON.stringify(record)));
    const userKeyPair = deriveKeyPair(userId, secondFactor, keyIndex);
    const signature = signHashWithKey(hashBuf, userKeyPair);
    const userPubKey = userKeyPair.pubKey;
    const auth = {
      blockchain: 'SmartLedger',
      txid: txid,
      sha256_hash: hashBuf.toString('hex'),
      signature: signature,
      pubKey: userPubKey.toString(),
    };
    record.auth = auth;
    try {
      await saveRecord(txid, record);
    } catch (dbErr) {
      logger.error({ message: 'Database write error', error: dbErr.message });
      return res.status(500).json({ error: { message: 'Failed to persist record' } });
    }
    let broadcastResult;
    try {
      broadcastResult = await broadcastRecord(hashBuf);
    } catch (broadcastErr) {
      broadcastResult = { broadcasted: false, error: broadcastErr.message };
    }
    return res.json({ txid, signature, pubKey: auth.pubKey, broadcast: broadcastResult });
  } catch (err) {
    logger.error({ message: 'Error creating record', error: err.message });
    return res.status(500).json({ error: { message: 'Failed to create authentication record', requestId: req.requestId || null } });
  }
});

// GET /authRecord/:txid
//
// Returns the stored record for a given txid.  404 if not found.
app.get('/authRecord/:txid', async (req, res) => {
  const { txid } = req.params;
  try {
    const record = await getRecord(txid);
    if (!record) {
      return res.status(404).json({ error: { message: 'Record not found' } });
    }
    return res.json(record);
  } catch (err) {
    logger.error({ message: 'Database read error', error: err.message });
    return res.status(500).json({ error: { message: 'Failed to retrieve record', requestId: req.requestId || null } });
  }
});

// ---------------------------------------------------------------------------
// Chain of custody transfer endpoints
const { saveTransferRequest, getTransferRequest, deleteTransferRequest } = require('./transferStore');
const { verifyJWT } = require('./jwt');

// POST /transfer/request
// Body: { txid, newHolder }
// Auth: current holder JWT, optional X-Passphrase
app.post('/transfer/request', async (req, res) => {
  const { txid, newHolder } = req.body;
  const authHeader = req.get('authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) {
    return res.status(401).json({ error: { message: 'Missing or invalid Authorization: Bearer <token> header' } });
  }
  const token = match[1];
  const jwtPayload = verifyJWT(token);
  if (!jwtPayload || !jwtPayload.identifier) {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
  const currentHolder = jwtPayload.identifier;
  let passphrase = req.get('x-passphrase') || '';
  // Load record and check ownership
  const record = await getRecord(txid);
  if (!record || !record.owner || record.owner.current_holder !== currentHolder) {
    return res.status(403).json({ error: { message: 'Not current holder or record not found', requestId: req.requestId || null } });
  }
  // Prepare transfer intent
  const transferIntent = {
    txid,
    from: currentHolder,
    to: newHolder,
    timestamp: new Date().toISOString(),
  };
  const intentHash = computeSha256(transferIntent);
  const userKeyPair = deriveKeyPair(currentHolder, passphrase, 0);
  const fromSig = signHashWithKey(intentHash, userKeyPair);
  const transferRequest = {
    ...transferIntent,
    intentHash: intentHash.toString('hex'),
    fromSig,
  };
  await saveTransferRequest(txid, transferRequest);
  res.json({ transferRequest });
});

// POST /transfer/accept
// Body: { txid, transferRequest }
// Auth: new holder JWT, optional X-Passphrase
app.post('/transfer/accept', async (req, res) => {
  const { txid, transferRequest } = req.body;
  const authHeader = req.get('authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) {
    return res.status(401).json({ error: { message: 'Missing or invalid Authorization: Bearer <token> header' } });
  }
  const token = match[1];
  const jwtPayload = verifyJWT(token);
  if (!jwtPayload || !jwtPayload.identifier) {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
  const newHolder = jwtPayload.identifier;
  let passphrase = req.get('x-passphrase') || '';
  // Validate transfer request
  const pending = await getTransferRequest(txid);
  if (!pending || !transferRequest ||
      pending.intentHash !== transferRequest.intentHash ||
      pending.fromSig !== transferRequest.fromSig ||
      pending.to !== newHolder) {
    return res.status(400).json({ error: { message: 'Invalid or expired transfer request', requestId: req.requestId || null } });
  }
  // Verify current holder's signature
  const intentHashBuf = Buffer.from(transferRequest.intentHash, 'hex');
  const fromKeyPair = deriveKeyFromMessage(`${transferRequest.from}/ownership`);
  const fromPubKey = fromKeyPair.pubKey.toString();
  if (!verifyHashSignature(intentHashBuf, transferRequest.fromSig, fromPubKey)) {
    return res.status(400).json({ error: { message: 'Invalid signature from current holder', requestId: req.requestId || null } });
  }
  // New holder signs acceptance
  const acceptance = {
    ...transferRequest,
    acceptanceTimestamp: new Date().toISOString(),
  };
  const acceptanceHash = computeSha256(acceptance);
  const newKeyPair = deriveKeyFromMessage(`${newHolder}/ownership` + (passphrase || ''));
  const toSig = signHash(acceptanceHash, newKeyPair);
  // Update record
  const record = await getRecord(txid);
  if (!record) {
    return res.status(404).json({ error: { message: 'Record not found' } });
  }
  // Append to chain of custody
  if (!record.owner.history) record.owner.history = [];
  record.owner.history.push({
    from: transferRequest.from,
    to: newHolder,
    fromSig: transferRequest.fromSig,
    toSig,
    intentHash: transferRequest.intentHash,
    acceptanceHash: acceptanceHash.toString('hex'),
    requestedAt: transferRequest.timestamp,
    acceptedAt: acceptance.acceptanceTimestamp,
  });
  record.owner.current_holder = newHolder;
  record.owner.last_verified = acceptance.acceptanceTimestamp;
  try {
    await saveRecord(txid, record);
  } catch (dbErr) {
    logger.error({ message: 'Database write error', error: dbErr.message });
    return res.status(500).json({ error: { message: 'Failed to persist record' } });
  }
  // Anchor updated record on chain
  let broadcastResult;
  try {
    const hashBuf = computeSha256(record);
    broadcastResult = await broadcastRecord(hashBuf);
  } catch (broadcastErr) {
    broadcastResult = { broadcasted: false, error: broadcastErr.message };
  }
  await deleteTransferRequest(txid);
  res.json({ txid, newHolder, toSig, broadcast: broadcastResult, record });
});

// GET /verify/:txid
//
// Recomputes the hash of the stored record and verifies the signature
// against the stored public key.  Returns flags indicating validity of
// both the hash and signature.
app.get('/verify/:txid', async (req, res) => {
  const { txid } = req.params;
  try {
    const record = await getRecord(txid);
    if (!record) {
      return res.status(404).json({ error: { message: 'Record not found' } });
    }
    const clone = JSON.parse(JSON.stringify(record));
    if (clone.auth) delete clone.auth;
    const hashBuf = computeSha256(clone);
    const expectedHash = record.auth.sha256_hash;
    const signature = record.auth.signature;
    const pubKeyStr = record.auth.pubKey;
    const validHash = hashBuf.toString('hex') === expectedHash;
    const validSig = verifyHashSignature(hashBuf, signature, pubKeyStr);
    // Merkle proof validation
    let merkleProofValid = null;
    if (record.auth && record.auth.merkleRoot && record.auth.merklePath) {
      try {
        const leaf = hashBuf;
        const root = Buffer.from(record.auth.merkleRoot, 'hex');
        const path = record.auth.merklePath.map(p => Buffer.from(p, 'hex'));
        merkleProofValid = require('./keyUtils').verifyMerkleProof(leaf, path, root);
      } catch (e) {
        merkleProofValid = false;
      }
    }
    return res.json({ txid, validHash, validSig, merkleProofValid });
  } catch (err) {
    logger.error({ message: 'Verification error', error: err.message });
    return res.status(500).json({ error: { message: 'Verification failed', requestId: req.requestId || null } });
  }
});

// Global error handler for uncaught errors
app.use((err, req, res, next) => {
  const requestId = req.requestId || null;
  logger.error({
    message: 'Unhandled error',
    error: err.message,
    stack: err.stack,
    requestId,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: { message: 'Internal server error', requestId } });
});

// Start server
if (require.main === module) {
  initDb();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Auth API listening on port ${PORT}`);
  });
}

module.exports = app;