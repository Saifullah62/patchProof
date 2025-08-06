# PatchProof™ Authentication API – Production Deployment Guide

## Overview
This API provides secure authentication, chain of custody, and on-chain anchoring for PatchProof™ records. It is designed for production with robust error handling, modular funding, JWT-based authentication, and flexible database and secrets management.

---

## Deployment Requirements

### Database Migrations (Production)
For production, use formal database migrations to manage schema changes safely and predictably. This project uses [Knex](https://knexjs.org/) migrations:

- Migration config: `knexfile.js`
- Migration scripts: `/migrations`
- To create the database schema, run:
  ```sh
  npx knex migrate:latest
  ```
- To create a new migration:
  ```sh
  npx knex migrate:make migration_name
  ```
- To rollback:
  ```sh
  npx knex migrate:rollback
  ```

**Why?**
- Migrations provide version control for your schema, enable safe upgrades/downgrades, and are required for multi-instance or cloud deployments.
- The API no longer creates tables automatically in production; run migrations as a deployment step.

### 1. Environment Variables

#### Database
- `DB_TYPE` – `sqlite` (default), `postgres`, or `mysql` (Postgres/MySQL are stubs)

#### Secrets Management
- All secrets are accessed via `secrets.js` abstraction. For local/dev, use environment variables. For production, use a secrets manager or HSM.
- Required secrets:
  - `MASTER_SECRET` – Master secret for deterministic key derivation
  - `API_KEY` – API key for admin/protected endpoints
  - `JWT_SECRET` – JWT signing secret

#### On-Chain Anchoring (Funding Modes)

**A. Static/Manual Mode (Single UTXO, for dev/test):**
- `MERCHANT_API_URL` – Merchant API endpoint for BSV broadcast
- `UTXO_TXID` – Funding UTXO transaction ID
- `UTXO_OUTPUT_INDEX` – UTXO output index (integer)
- `UTXO_SATOSHIS` – UTXO value in satoshis
- `UTXO_SCRIPT_HEX` – UTXO locking script in hex
- `UTXO_PRIVKEY_WIF` – Private key (WIF) for signing
- `UTXO_CHANGE_ADDRESS` – Address for change output (optional)

**B. Dynamic SmartLedger Wallet Mode (Recommended for Production):**
- `SMARTLEDGER_API_BASE_URL` – e.g. `https://smartledger.dev`
- `SMARTLEDGER_API_KEY` – Your SmartLedger API key
- `FUNDING_ADDRESS` – BSV address to fund anchoring transactions
- `FUNDING_WIF` – Corresponding private key (WIF) for signing

If all SmartLedger variables are set, dynamic wallet mode is used. Otherwise, static/manual mode is used as fallback.

#### Other
- `PORT` – Port to run the API (default: 3000)

---

## Security & Operational Best Practices
- **Secrets:** Use a cloud secrets manager or HSM in production. Never hardcode secrets in source code or config files.
- **Key Rotation:** With dynamic funding, rotate `FUNDING_WIF` and funding addresses regularly. Multiple sources or wallet APIs can be integrated in the future.
- **JWT Expiry:** JWTs are short-lived (default 10 minutes). Adjust expiry as needed.
- **CORS:** Restrict allowed origins to trusted domains only (see below).
- **Rate Limiting:** Adjust thresholds based on expected traffic and threat model.
- **Monitoring:** Configure Winston or your preferred logger to forward logs to a central aggregation service. Optionally, add Prometheus metrics or APM.

---

## CORS & Rate Limiting Configuration

### CORS
By default, CORS is permissive for dev. For production, restrict origins:
```js
const allowedOrigins = [
  'https://yourdomain.com',
  'https://admin.yourdomain.com'
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
```

### Rate Limiting
Default is 100 requests per 15 minutes per IP. Adjust for your needs:
```js
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Tune for your traffic
  standardHeaders: true,
  legacyHeaders: false,
}));
```

---

## 🚀 CI/CD & Automated Testing

This project includes a ready-to-use GitHub Actions workflow for continuous integration and deployment:

- **Lint & Test:** Runs `npm install` and `npm test` (Jest + Supertest integration tests) on every push and pull request.
- **Database Migrations:** Runs `npx knex migrate:latest` to ensure schema is up to date before tests.
- **Example Workflow:** See `.github/workflows/ci.yml` for configuration (auto-created if missing).

**To enable:**
1. Push this repo to GitHub.
2. GitHub Actions will run by default (see Actions tab).
3. Add secrets (if needed) for production deploys.

---

## 🗄️ Database Migrations

- Uses [Knex](http://knexjs.org/) for formal schema management.
- **Run migrations locally:**
  ```sh
  npx knex migrate:latest
  ```
- **Create a new migration:**
  ```sh
  npx knex migrate:make migration_name
  ```
- **Rollback:**
  ```sh
  npx knex migrate:rollback
  ```
- See `knexfile.js` for SQLite/Postgres/MySQL config. Default is SQLite (file-based, easy for dev).

---

## ⚙️ Environment Setup

- Copy `.env.example` to `.env` and set required secrets:
  - `MASTER_SECRET`, `API_KEY`, `JWT_SECRET`, `PORT`, etc.
  - For on-chain anchoring: `MERCHANT_API_URL`, UTXO vars, or SmartLedger wallet vars.
- See `.env.example` and README Environment section for all options.
- Start server:
  ```sh
  node auth_api_production.js
  ```

---

## 🛡️ Security & Production Best Practices
- **Secrets:** Use a secrets manager or HSM in production. Never commit secrets to source control.
- **CORS:** Only allow trusted origins in production (see CORS config).
- **Rate Limiting:** Enabled by default, tune for your traffic.
- **JWT:** All sensitive endpoints require JWT authentication.
- **Chain of Custody:** Fully auditable, two-step transfer with cryptographic signatures.
- **Monitoring:** Winston logger supports log aggregation (Datadog, CloudWatch, etc).
- **Testing:** Run `npm test` for full integration coverage.

---

## 📖 API Documentation
- OpenAPI/Swagger docs available at [`/docs`](http://localhost:3000/docs) when running the server.
- See `openapi.yaml` for full endpoint specs.

### Verification Endpoint with Merkle Proof

`GET /verify/:txid`

Returns:
```json
{
  "txid": "...",
  "validHash": true,
  "validSig": true,
  "merkleProofValid": true
}
```
- `merkleProofValid` is `true` if the record's hash, Merkle path, and Merkle root together prove inclusion in the batch anchor.
- If the record was not batch anchored, `merkleProofValid` will be `null`.

---

## 🔐 Advanced Cryptographic Utilities

PatchProof™ uses a modern, production-grade cryptographic toolkit in [`keyUtils.js`](./keyUtils.js) to ensure all authentication and chain-of-custody operations are secure, auditable, and standards-compliant (WP0042 / EP3268914B1).

### Key Features
- **Hierarchical Deterministic Key Derivation:**
  - `deriveKeyFromMessage(message, depth)` – Deterministically derives a BSV key pair from any message (e.g., user ID, record ID). Supports optional hierarchy (depth).
  - `deriveEphemeralSessionKey(userId, label)` – Generates a single-use/session key with timestamp entropy for login, claim, or transfer flows.
  - `deriveKeyTree(baseMessage, paths)` – Derives a tree of subkeys for multi-branch workflows.
- **Digital Signatures:**
  - `signHash(hash, keyPair)` – Signs a SHA256 hash with a BSV key pair (returns base64 signature).
  - `verifyHashSignature(hash, signature, pubKeyStr)` – Verifies a signature against a hash and public key.
- **Canonical Object Hashing:**
  - `computeSha256(obj)` – Computes a SHA256 hash of an object using canonical JSON serialization (field order independent).
- **Merkle Batching:**
  - `computeMerkleRoot(hashes)` – Computes a Merkle root from an array of SHA256 hashes (for batch anchoring or multi-record proofs).
- **Merkle Proof Validation:**
  - `verifyMerkleProof(leaf, path, root)` – Verifies a Merkle inclusion proof for a record in a batch anchor (used in verification endpoints).

### Example Usage
```js
const {
  deriveKeyFromMessage,
  deriveEphemeralSessionKey,
  computeMerkleRoot,
  signHash,
  verifyHashSignature,
  computeSha256,
  deriveKeyTree
} = require('./keyUtils');

// Deterministic user key
type KeyPair = deriveKeyFromMessage('user@example.com');

// Ephemeral session key
const sessionKey = deriveEphemeralSessionKey('user@example.com', 'login');

// Sign and verify
const hash = computeSha256({ some: 'object' });
const sig = signHash(hash, sessionKey);
const valid = verifyHashSignature(hash, sig, sessionKey.pubKey.toString());

// Merkle batching
const hashes = [computeSha256({a:1}), computeSha256({b:2})];
const root = computeMerkleRoot(hashes);
```

### Security Notes
- **No private keys are ever stored**: All keys are derived on demand from a master secret (see `secrets.js`).
- **Session/ephemeral keys** are unique per login/claim/transfer and cannot be reused.
- **Canonical hashing** ensures object hashes are stable regardless of field order.
- **All cryptographic operations** use industry-standard primitives (SHA256, ECDSA, HMAC).
- **Ready for Merkle batching**: Enables scalable, auditable batch anchoring for high-throughput use cases.

See [`tests/keyUtils.test.js`](./tests/keyUtils.test.js) for full test coverage and usage patterns.

---

## 💸 Funding Abstraction & Extensibility
- The broadcast logic is fully abstracted: rotate funding keys, support multiple sources, or plug in a wallet service/API with minimal code changes.
- SmartLedger wallet integration is recommended for production.

---

## 🤝 Contact & Support
For support or questions, contact SmartLedger or your system integrator, or open an issue in this repository.
