// secrets.js
// Secrets management abstraction for PatchProof Auth API
// Supports environment variable fallback for local/dev, and is ready for
// integration with cloud secrets managers or HSM for production.
// Usage: const secrets = require('./secrets'); secrets.getSecret('API_KEY')

const secretsCache = {};

// Map of logical secret names to env var names
const SECRET_ENV_MAP = {
  'MASTER_SECRET': 'MASTER_SECRET',
  'API_KEY': 'API_KEY',
  'MERCHANT_API_URL': 'MERCHANT_API_URL',
  'UTXO_TXID': 'UTXO_TXID',
  'UTXO_OUTPUT_INDEX': 'UTXO_OUTPUT_INDEX',
  'UTXO_SATOSHIS': 'UTXO_SATOSHIS',
  'UTXO_SCRIPT_HEX': 'UTXO_SCRIPT_HEX',
  // Add more as needed
};

/**
 * Get a secret by logical name. Fallback to process.env for local/dev.
 * In production, replace this logic with a cloud secrets manager or HSM call.
 * @param {string} name - Logical secret name (e.g., 'API_KEY')
 * @returns {string|null}
 */
function getSecret(name) {
  if (secretsCache[name]) return secretsCache[name];
  // In production, insert cloud secrets manager/HSM logic here
  const envVar = SECRET_ENV_MAP[name];
  const value = process.env[envVar] || null;
  secretsCache[name] = value;
  return value;
}

module.exports = { getSecret };
