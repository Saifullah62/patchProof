// knexfile.js
module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: './patchproof.sqlite3'
    },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations'
    }
  },
  production: {
    client: process.env.DB_TYPE || 'sqlite3',
    connection: process.env.DB_TYPE === 'postgres'
      ? process.env.DATABASE_URL
      : process.env.DB_TYPE === 'mysql'
      ? {
          host: process.env.DB_HOST,
          user: process.env.DB_USER,
          password: process.env.DB_PASS,
          database: process.env.DB_NAME,
        }
      : {
          filename: process.env.DB_FILE || './patchproof.sqlite3'
        },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations'
    }
  }
};
