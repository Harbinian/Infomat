// Native process formats. Keep historical API/table identifiers and stored bodies.
const PRIMARY_SCHEMA = 'process-governance-v8';
const SUPPORTED_SCHEMAS = Object.freeze([PRIMARY_SCHEMA, 'process-governance-v7']);
const supports = schema => SUPPORTED_SCHEMAS.includes(schema);
module.exports = { PRIMARY_SCHEMA, SUPPORTED_SCHEMAS, supports };
