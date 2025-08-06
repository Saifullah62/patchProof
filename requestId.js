// requestId.js
// Express middleware to assign a unique request ID (correlation ID) to each request
const { randomUUID } = require('crypto');

function requestIdMiddleware(req, res, next) {
  const incoming = req.get('x-request-id');
  req.requestId = incoming || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = requestIdMiddleware;
