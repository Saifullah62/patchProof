// logger.js
// Winston logger with optional log aggregation (e.g., Graylog, Datadog, or CloudWatch)
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, json, errors } = format;

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  transports: [
    new transports.Console(),
    // Example: Forward logs to Graylog/Datadog/CloudWatch
    // Uncomment and configure as needed:
    // new transports.Http({
    //   host: 'graylog.example.com',
    //   port: 12201,
    //   path: '/gelf',
    //   ssl: true,
    // }),
    // Or use a community transport, e.g. winston-graylog2, winston-cloudwatch, winston-datadog-logs
  ],
});

module.exports = logger;
