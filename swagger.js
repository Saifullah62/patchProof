// swagger.js
// Serves Swagger UI for the PatchProof API using the openapi.yaml spec.
const path = require('path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const openapiPath = path.join(__dirname, 'openapi.yaml');
const openapiSpec = YAML.load(openapiPath);

function setupSwagger(app) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
}

module.exports = setupSwagger;
