// Internal read capability only: no HTTP routes, effective links, tasks or notifications.
const { failure } = require('./dataMapDefinitionValues');
const store = require('./historicalReviewStore');
module.exports = helpers => {
  const { transaction, actor } = helpers;
  const unavailable = () => failure('HISTORY_RESOURCE_UNAVAILABLE', 404);
  async function history(db, session, key) {
    const who = await actor(db, session);
    // Responsibility suggestions cannot grant departmental access to a mixed historical batch.
    if (!who.permissions.has('governance:read-global')) throw unavailable();
    if (!(await store.inspect(db)).ready) throw failure('HISTORY_MIGRATION_REQUIRED', 503);
    try { return await store.read(db, key); }
    catch (e) { if (e.code === 'HISTORY_BATCH_NOT_FOUND') throw unavailable(); throw e; }
  }
  return {
    getHistoricalReview(session, batchKey) { return transaction(db => history(db, session, batchKey)); },
    compareHistoricalReviewIssue(session, batchKey, originalId, issueId) {
      return transaction(async db => {
        const snapshot = await history(db, session, batchKey);
        const opinion = snapshot.items.find(i => i.original_id === originalId);
        if (!opinion) throw unavailable();
        const target = await require('./analysisIssues')({ ...helpers, transaction: fn => fn(db) }).getAnalysisIssue(session, issueId);
        return { historical: opinion, existing_issue: target, relation: 'comparison_only',
          formal_link_enabled: false, changes_governance: false };
      });
    }
  };
};
