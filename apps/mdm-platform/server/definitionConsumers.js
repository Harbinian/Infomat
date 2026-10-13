// Explicit composition root: no nested transaction, source grant cache or worker startup.
const {createFixedMappingContext} = require('./fixedMappingContext');
const {createFixedSource} = require('./v7FixedSource');
function createDefinitionConsumers(base, factories) {
  const fixedSource = base.fixedSource || createFixedSource(base.fixedSourceDependencies);
  const dependencies = {...base, fixedSource};
  const mappingContext = createFixedMappingContext(dependencies);
  const helpers = Object.freeze({...dependencies,...mappingContext,mappingContext});
  const modules = factories || [require('./v7Mappings'),require('./excelEvidence'),require('./wordEvidence'),require('./pdfEvidence'),require('./analysisIssues'),require('./analysisApi'),require('./analysisRuns'),require('./analysisQueue'),require('./designHandoffs')];
  const result = {};
  for (const create of modules) {
    const consumer = create(helpers);
    for (const [name,operation] of Object.entries(consumer)) {
      if (Object.hasOwn(result,name)) throw new Error('Duplicate definition operation: '+name);
      result[name] = operation;
    }
  }
  return result;
}
module.exports = {createDefinitionConsumers};
