// db.js
// Multi-database support for PatchProof Auth API
// Supports SQLite (production default), PostgreSQL, and MySQL (stubs)
// Usage: require and call getDb(), saveRecord(), getRecord() as needed.

const sqlite3 = require('sqlite3').verbose();
// Uncomment or add these when ready for Postgres/MySQL
// const { Client: PgClient } = require('pg');
// const mysql = require('mysql2/promise');

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let db;

function initDb() {
  if (DB_TYPE === 'sqlite') {
    const DB_FILE = process.env.DB_FILE || 'records.db';
    db = new sqlite3.Database(DB_FILE);
    // Table schema must be created via migration before startup. No CREATE TABLE logic here for production safety.
  } else if (DB_TYPE === 'postgres') {
    // Stub for PostgreSQL
    // db = new PgClient({ connectionString: process.env.DB_URL });
    // await db.connect();
    throw new Error('PostgreSQL support not yet implemented.');
  } else if (DB_TYPE === 'mysql') {
    // Stub for MySQL
    // db = await mysql.createConnection(process.env.DB_URL);
    throw new Error('MySQL support not yet implemented.');
  } else {
    throw new Error(`Unsupported DB_TYPE: ${DB_TYPE}`);
  }
}

function saveRecord(txid, record) {
  if (DB_TYPE === 'sqlite') {
    return new Promise((resolve, reject) => {
      db.run('INSERT OR REPLACE INTO records (txid, record) VALUES (?, ?)', [txid, JSON.stringify(record)], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  } else if (DB_TYPE === 'postgres') {
    // Stub for PostgreSQL
    // await db.query('INSERT INTO records (txid, record) VALUES ($1, $2) ON CONFLICT (txid) DO UPDATE SET record = $2', [txid, JSON.stringify(record)]);
    throw new Error('PostgreSQL support not yet implemented.');
  } else if (DB_TYPE === 'mysql') {
    // Stub for MySQL
    // await db.execute('INSERT INTO records (txid, record) VALUES (?, ?) ON DUPLICATE KEY UPDATE record = VALUES(record)', [txid, JSON.stringify(record)]);
    throw new Error('MySQL support not yet implemented.');
  }
}

function getRecord(txid) {
  if (DB_TYPE === 'sqlite') {
    return new Promise((resolve, reject) => {
      db.get('SELECT record FROM records WHERE txid = ?', [txid], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        try {
          const record = JSON.parse(row.record);
          resolve(record);
        } catch (e) {
          resolve(null);
        }
      });
    });
  } else if (DB_TYPE === 'postgres') {
    // Stub for PostgreSQL
    // const res = await db.query('SELECT record FROM records WHERE txid = $1', [txid]);
    // if (!res.rows.length) return null;
    // return JSON.parse(res.rows[0].record);
    throw new Error('PostgreSQL support not yet implemented.');
  } else if (DB_TYPE === 'mysql') {
    // Stub for MySQL
    // const [rows] = await db.execute('SELECT record FROM records WHERE txid = ?', [txid]);
    // if (!rows.length) return null;
    // return JSON.parse(rows[0].record);
    throw new Error('MySQL support not yet implemented.');
  }
}

// --- Verification Code Helpers ---
function saveCodeDb(identifier, code, expiresAt) {
  return new Promise((resolve, reject) => {
    db.run('INSERT OR REPLACE INTO verification_codes (identifier, code, expires_at) VALUES (?, ?, ?)', [identifier, code, expiresAt], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function getCodeDb(identifier) {
  return new Promise((resolve, reject) => {
    db.get('SELECT identifier, code, expires_at FROM verification_codes WHERE identifier = ?', [identifier], (err, row) => {
      if (err) return reject(err);
      resolve(row); // { identifier, code, expires_at }
    });
  });
}

function deleteCodeDb(identifier) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM verification_codes WHERE identifier = ?', [identifier], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// --- Transfer Request Helpers ---
function saveTransferRequestDb(txid, request, expiresAt) {
  return new Promise((resolve, reject) => {
    db.run('INSERT OR REPLACE INTO transfer_requests (txid, request, expires_at) VALUES (?, ?, ?)', [txid, JSON.stringify(request), expiresAt], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function getTransferRequestDb(txid) {
  return new Promise((resolve, reject) => {
    db.get('SELECT txid, request, expires_at FROM transfer_requests WHERE txid = ?', [txid], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      try {
        const request = JSON.parse(row.request);
        resolve({ request, expiresAt: row.expires_at });
      } catch (e) {
        resolve(null);
      }
    });
  });
}

function deleteTransferRequestDb(txid) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM transfer_requests WHERE txid = ?', [txid], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = {
  initDb,
  saveRecord,
  getRecord,
  saveCodeDb,
  getCodeDb,
  deleteCodeDb,
  saveTransferRequestDb,
  getTransferRequestDb,
  deleteTransferRequestDb
};
