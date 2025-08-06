// verificationStore.js
// In-memory store for verification codes (email/SMS). Replace with DB for production.
// Structure: { [identifier]: { code, expiresAt } }

const { saveCodeDb, getCodeDb, deleteCodeDb } = require('./db');
const CODE_TTL = 10 * 60 * 1000; // 10 minutes

async function saveCode(identifier, code) {
  const expiresAt = Date.now() + CODE_TTL;
  await saveCodeDb(identifier, code, expiresAt);
}

async function verifyCode(identifier, code) {
  const entry = await getCodeDb(identifier);
  if (!entry) return false;
  if (Date.now() > entry.expires_at) {
    await deleteCodeDb(identifier);
    return false;
  }
  if (entry.code !== code) return false;
  await deleteCodeDb(identifier);
  return true;
}

module.exports = { saveCode, verifyCode };
