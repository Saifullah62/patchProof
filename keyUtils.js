// -- Enhanced Derivation & Crypto Utilities for PatchProof --
// These functions upgrade the authentication API to follow the WP0042 / EP3268914B1 strategy,
// including hierarchical key derivation, ephemeral key usage, Merkle batching, and advanced verification.

const crypto = require('crypto');
const bsv = require('bsv');

// Load secret from secure store
const { getSecret } = require('./secrets');
const MASTER_SECRET = getSecret('MASTER_SECRET') || 'demo-master-secret';

/**
 * Create a deterministic, structured message for traceable key derivation
 * @param {string} userId
 * @param {string} type - e.g., 'claim', 'transfer', 'session'
 * @param {number|string} index - optional unique value (timestamp or nonce)
 * @returns {string} JSON-stringified metadata
 */
function buildDeterministicMessage(userId, type = 'session', index = Date.now()) {
  return JSON.stringify({ user: userId, type, index });
}

/**
 * Hierarchical deterministic key derivation using message input
 * @param {string} message - Deterministic JSON message
 * @param {number} depth - Optional hash depth for hierarchy
 * @returns {bsv.KeyPair}
 */
function deriveKeyFromMessage(message, depth = 0) {
  let hash = crypto.createHash('sha256').update(message).digest();
  for (let i = 1; i < depth; i++) {
    hash = crypto.createHash('sha256').update(hash).digest();
  }
  const seed = crypto.createHmac('sha256', Buffer.from(MASTER_SECRET)).update(hash).digest();
  const bip32 = new bsv.Bip32().fromSeed(seed);
  return new bsv.KeyPair().fromPrivKey(bip32.privKey);
}

/**
 * Derive ephemeral key for session-level signing with timestamp entropy
 * @param {string} userId
 * @param {string} label - e.g., 'login', 'claim', 'ownership'
 * @returns {bsv.KeyPair}
 */
function deriveEphemeralSessionKey(userId, label = '') {
  const now = new Date().toISOString();
  const base = buildDeterministicMessage(userId, label, now);
  return deriveKeyFromMessage(base, 1);
}

/**
 * Build a Merkle Root from a list of SHA256 hashes
 * @param {Buffer[]} hashes - array of hash buffers
 * @returns {Buffer} - Merkle root
 */
/**
 * Compute the Merkle root of an array of SHA256 hashes
 * @param {Buffer[]} hashes
 * @returns {Buffer} Merkle root
 */
function computeMerkleRoot(hashes) {
  if (hashes.length === 0) return Buffer.alloc(32, 0);
  while (hashes.length > 1) {
    let temp = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = (i + 1 < hashes.length) ? hashes[i + 1] : left;
      const combined = Buffer.concat([left, right]);
      temp.push(crypto.createHash('sha256').update(combined).digest());
    }
    hashes = temp;
  }
  return hashes[0];
}

/**
 * Compute the Merkle path (proof) for a specific leaf index
 * @param {number} index - index of the leaf
 * @param {Buffer[]} hashes - array of all leaf hashes
 * @returns {Buffer[]} Merkle path (siblings needed to prove inclusion)
 */
/**
 * Compute the Merkle path (proof) for a specific leaf index
 * @param {number} index - index of the leaf
 * @param {Buffer[]} hashes - array of all leaf hashes
 * @returns {Buffer[]} Merkle path (siblings needed to prove inclusion)
 */
function computeMerklePath(index, hashes) {
  let path = [];
  let currentIndex = index;
  while (hashes.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = (i + 1 < hashes.length) ? hashes[i + 1] : left;
      const combined = Buffer.concat([left, right]);
      nextLevel.push(crypto.createHash('sha256').update(combined).digest());
      // Sibling selection logic: push the sibling of the current node
      if (i === currentIndex || i + 1 === currentIndex) {
        const sibling = i === currentIndex ? right : left;
        path.push(sibling);
      }
    }
    currentIndex = Math.floor(currentIndex / 2);
    hashes = nextLevel;
  }
  return path;
}

/**
 * Cron-compatible batch anchoring runner
 * @param {Object} param0
 * @param {Function} param0.getUnanchored - returns [{ id, record }]
 * @param {Function} param0.saveRecord - (id, record) => Promise
 * @param {Function} param0.markAnchored - (id) => Promise
 * @param {Function} param0.broadcaster - (merkleRoot) => Promise<{ broadcasted, txid }>
 */
async function runBatchAnchor({ getUnanchored, saveRecord, markAnchored, broadcaster }) {
  const unanchored = await getUnanchored();
  if (!unanchored.length) return;
  const hashes = unanchored.map(r => computeSha256(r.record));
  const merkleRoot = computeMerkleRoot([...hashes]);
  const result = await broadcaster(merkleRoot);
  if (!result.broadcasted) return;

  for (let i = 0; i < unanchored.length; i++) {
    const path = computeMerklePath(i, [...hashes]);
    const record = unanchored[i].record;
    record.auth = Object.assign({}, record.auth, {
      anchorTxid: result.txid,
      merkleRoot: merkleRoot.toString('hex'),
      merklePath: path.map(b => b.toString('hex'))
    });
    await saveRecord(unanchored[i].id, record);
    await markAnchored(unanchored[i].id);
  }
}


/**
 * Verify a Merkle proof for a leaf and path against a root
 * @param {Buffer} leaf
 * @param {Buffer[]} path
 * @param {Buffer} root
 * @returns {boolean}
 */
function verifyMerkleProof(leaf, path, root) {
  let computed = leaf;
  for (const sibling of path) {
    const combined = Buffer.concat([computed, sibling]);
    computed = crypto.createHash('sha256').update(combined).digest();
  }
  return computed.equals(root);
}

/**
 * Generate a digital signature over a hash using a BSV KeyPair
 * @param {Buffer} hash
 * @param {bsv.KeyPair} keyPair
 * @returns {string} - base64 signature
 */
function signHash(hash, keyPair) {
  return bsv.Ecdsa.sign(hash, keyPair).toString();
}

/**
 * Verify a digital signature against a hash and public key
 * @param {Buffer} hash
 * @param {string} signature
 * @param {string} pubKeyStr
 * @returns {boolean}
 */
function verifyHashSignature(hash, signature, pubKeyStr) {
  try {
    const sig = bsv.Sig.fromString(signature);
    const pubKey = bsv.PubKey.fromString(pubKeyStr);
    return bsv.Ecdsa.verify(hash, sig, pubKey);
  } catch (err) {
    return false;
  }
}

/**
 * Build a secure hash of an object (canonical JSON SHA256)
 * @param {object} obj
 * @returns {Buffer}
 */
function computeSha256(obj) {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash('sha256').update(json).digest();
}

/**
 * Example: Derive subkeys for a multi-branch tree
 * @param {string} baseMessage - e.g. 'user-abc'
 * @param {string[]} paths - e.g. ['auth', 'transfer', 'encryption']
 * @returns {Object.<string, bsv.KeyPair>}
 */
function deriveKeyTree(baseMessage, paths = []) {
  const tree = {};
  for (const path of paths) {
    tree[path] = deriveKeyFromMessage(`${baseMessage}/${path}`);
  }
  return tree;
}

/**
 * Express middleware to verify client signature (x-sig, x-pub headers)
 * Verifies that req.body is signed by the claimed public key
 */
function verifyClientSignatureMiddleware(req, res, next) {
  try {
    const sig = req.get('x-sig');
    const pub = req.get('x-pub');
    const hashBuf = computeSha256(req.body);
    if (!verifyHashSignature(hashBuf, sig, pub)) {
      return res.status(401).json({ error: 'Invalid client signature' });
    }
    next();
  } catch (err) {
    return res.status(400).json({ error: 'Failed to verify client signature' });
  }
}

/**
 * Build a recovery message for account/key recovery
 * @param {string} userId
 * @param {number|string} timestamp
 * @returns {string}
 */
function buildRecoveryMessage(userId, timestamp = Date.now()) {
  return JSON.stringify({ user: userId, action: 'recover', timestamp });
}

/**
 * Build a revocation message for record/account revocation
 * @param {string} userId
 * @param {string} txid
 * @param {string} reason
 * @returns {string}
 */
function buildRevocationMessage(userId, txid, reason = 'manual') {
  return JSON.stringify({ user: userId, action: 'revoke', txid, reason });
}

module.exports = {
  buildDeterministicMessage,
  deriveKeyFromMessage,
  deriveEphemeralSessionKey,
  computeMerkleRoot,
  computeMerklePath,
  verifyMerkleProof,
  computeSha256,
  signHash,
  verifyHashSignature,
  deriveKeyTree,
  verifyClientSignatureMiddleware,
  buildRecoveryMessage,
  buildRevocationMessage,
  runBatchAnchor
};
