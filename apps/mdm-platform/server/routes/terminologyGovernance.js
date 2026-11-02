const express = require('express');
const { requireAuth } = require('../auth');
const { sessionOf } = require('../legacyGovernanceWrites');
const repositories = require('../terminologyGovernanceRepository');
const { logRequestFailure } = require('../securityLog');
const router = express.Router();
const run = action => async (req,res) => {
  try { const repo = await repositories.getTerminologyGovernanceRepository();res.set('Cache-Control','no-store').json(await action(repo,sessionOf(req.session),req)); }
  catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({error:error.message,code:error.code});
    logRequestFailure(res,error);
    res.status(500).json({error:'术语治理操作未完成，请保留输入后核对',code:'TERM_GOVERNANCE_UNAVAILABLE'});
  }
};
router.get('/capabilities',requireAuth,run((repo,session) => repo.capabilities(session)));
router.get('/terms',requireAuth,run((repo,session,req) => repo.listTerms(session,req.query)));
router.get('/suggestions',requireAuth,run((repo,session,req) => repo.suggestions(session,req.query)));
router.get('/terms/:id',requireAuth,run((repo,session,req) => repo.getTerm(session,req.params.id)));
router.post('/terms',requireAuth,run((repo,session,req) => repo.createTerm(session,req.body || {})));
router.put('/terms/:id',requireAuth,run((repo,session,req) => repo.updateTerm(session,req.params.id,req.body || {})));
router.post('/terms/:id/actions',requireAuth,run((repo,session,req) => repo.action(session,req.params.id,req.body || {})));
router.get('/terms/:id/challenges',requireAuth,run((repo,session,req) => repo.listChallenges(session,req.params.id)));
router.post('/terms/:id/challenges',requireAuth,run((repo,session,req) => repo.createChallenge(session,req.params.id,req.body || {})));
router.post('/terms/:id/challenges/:challengeId/actions',requireAuth,run((repo,session,req) => repo.challengeAction(session,req.params.id,req.params.challengeId,req.body || {})));
module.exports = router;
