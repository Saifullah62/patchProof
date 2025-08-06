// utxoConfig.js
// Simple UTXO and key configuration for BSV transaction funding
// For production, replace with a wallet API or dynamic UTXO/key manager
// All values can be moved to secrets or a secure config store

const { getSecret } = require('./secrets');

module.exports = {
  utxo: {
    txid: getSecret('UTXO_TXID'),
    vout: getSecret('UTXO_OUTPUT_INDEX') ? parseInt(getSecret('UTXO_OUTPUT_INDEX'), 10) : null,
    satoshis: getSecret('UTXO_SATOSHIS') ? parseInt(getSecret('UTXO_SATOSHIS'), 10) : null,
    scriptPubKey: getSecret('UTXO_SCRIPT_HEX'),
  },
  privKeyWIF: getSecret('UTXO_PRIVKEY_WIF'), // Add this secret for signing
  changeAddress: getSecret('UTXO_CHANGE_ADDRESS'), // Optional: fallback to derived address if not set
};
