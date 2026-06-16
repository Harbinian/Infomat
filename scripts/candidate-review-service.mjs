#!/usr/bin/env node
/**
 * MySQL-backed candidate review web service.
 */
import http from 'node:http';
import {
  buildReviewAppHtml,
  createMysqlPoolFromEnv,
  makeCandidateReviewRepository,
} from './candidate-review-core.mjs';

function parseArgs(argv) {
  const args = {
    host: process.env.CANDIDATE_REVIEW_HOST || '127.0.0.1',
    port: Number(process.env.CANDIDATE_REVIEW_PORT || 8765),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host') {
      args.host = argv[++index];
    } else if (arg === '--port') {
      args.port = Number(argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/candidate-review-service.mjs [--host 127.0.0.1] [--port 8765]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function sendText(res, status, value, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(value);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = await createMysqlPoolFromEnv();
  const repo = makeCandidateReviewRepository(pool);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = decodeURIComponent(url.pathname);

      if (req.method === 'GET' && pathname === '/') {
        sendText(res, 200, buildReviewAppHtml(), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && pathname === '/api/runs') {
        sendJson(res, 200, await repo.listRuns());
        return;
      }

      const candidateListMatch = pathname.match(/^\/api\/runs\/([^/]+)\/candidates$/);
      if (req.method === 'GET' && candidateListMatch) {
        sendJson(res, 200, await repo.getCandidates(candidateListMatch[1]));
        return;
      }

      const reviewMatch = pathname.match(/^\/api\/runs\/([^/]+)\/candidates\/([^/]+)\/review$/);
      if (req.method === 'PUT' && reviewMatch) {
        const body = await readBody(req);
        await repo.saveDecision({
          run_id: reviewMatch[1],
          stable_key: reviewMatch[2],
          decision: body.decision || '',
          evidence_status: body.evidence_status || 'not_reviewed',
          next_action: body.next_action || 'keep_todo',
          failure_class: body.failure_class || '',
          issue_type: body.issue_type || '',
          definition_status: body.definition_status || '',
          normalized_note: body.normalized_note || '',
          reviewer: body.reviewer || 'web',
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });

  server.listen(args.port, args.host, () => {
    console.log(`candidate_review_service=http://${args.host}:${args.port}/`);
  });

  const shutdown = async () => {
    server.close();
    await pool.end();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
