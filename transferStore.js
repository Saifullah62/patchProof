// transferStore.js
// In-memory store for pending transfer requests. Replace with DB for production.
// Structure: { [txid]: { transferRequest, expiresAt } }

const { saveTransferRequestDb, getTransferRequestDb, deleteTransferRequestDb } = require('./db');
const REQUEST_TTL = 15 * 60 * 1000; // 15 minutes

async function saveTransferRequest(txid, transferRequest) {
  const expiresAt = Date.now() + REQUEST_TTL;
  await saveTransferRequestDb(txid, transferRequest, expiresAt);
}

async function getTransferRequest(txid) {
  const entry = await getTransferRequestDb(txid);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    await deleteTransferRequestDb(txid);
    return null;
  }
  return entry.request;
}

async function deleteTransferRequest(txid) {
  await deleteTransferRequestDb(txid);
}

module.exports = { saveTransferRequest, getTransferRequest, deleteTransferRequest };
