# Weekly Action Service v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade 3002 from a simple weekly action ledger into a PMO after-meeting tracking ledger with personnel snapshots, v2 audit events, action-based APIs, evidence verification, weekly review packs, and responsibility drill-through.

**Architecture:** Keep 3002 as a local Node.js service with JSON runtime files under `artifacts/weekly-actions/`. Use a generated read-only personnel snapshot from `docs/organization/信息化项目人员角色映射.md`; the service consumes the snapshot but never writes organization or PMO truth sources. Replace generic item updates with business action handlers that validate state, role permissions, required fields, and append audit events.

**Tech Stack:** Node.js built-in `http`, `fs`, `path`, `crypto`; browser HTML/CSS/JavaScript in `public/index.html`; no SQLite; no MySQL in v2 first implementation.

---

## Design Baseline

Primary design source:

- `apps/weekly-action-service/docs/weekly-action-service-v2-design.md`

The implementation must preserve these hard boundaries:

- No writes to PMO Markdown truth sources.
- No writes to `pmo/tasks.json` or `pmo/gantt-react/public/tasks.json`.
- No writes to MDM databases.
- No SQLite dependency or `.db` runtime file.
- No automatic sync from 5173 to 3002.
- No direct Markdown parsing by 3002 at runtime.

## File Structure

Create or modify these files:

- Create `scripts/generate-weekly-action-personnel-snapshot.mjs`: repository-level script that reads the organization mapping Markdown and roster, validates consistency, and writes the read-only snapshot to `artifacts/weekly-actions/personnel-snapshot.json`.
- Create `scripts/test-weekly-action-personnel-snapshot.mjs`: repository-level contract test for snapshot generation and validation errors.
- Modify `scripts/README.md`: document snapshot script input, output, and no-database behavior.
- Create `apps/weekly-action-service/lib/weeklyRange.js`: shared Thursday-to-Wednesday week utilities.
- Create `apps/weekly-action-service/lib/v2Ledger.js`: v2 ledger read/write, atomic save, event append, and v1 migration helpers.
- Create `apps/weekly-action-service/lib/personnelSnapshot.js`: service-side snapshot loader, snapshot warnings, role lookup, stale detection.
- Create `apps/weekly-action-service/lib/actionRules.js`: status machine, destination required fields, action permission checks, overdue/review reminders.
- Create `apps/weekly-action-service/lib/exporters.js`: meeting review pack and responsibility drill-through export helpers.
- Modify `apps/weekly-action-service/server.js`: route to v2 handlers while preserving v1 health and static serving patterns.
- Replace `apps/weekly-action-service/public/index.html`: PMO workbench, weekly review pack, responsibility drill-through, item detail workflow, intake area.
- Modify `apps/weekly-action-service/scripts/test-service-contract.js`: v2 API contract and end-to-end sample.
- Modify `apps/weekly-action-service/README.md`: current v1 status, v2 target, run/test commands, runtime directories.
- Modify `apps/weekly-action-service/AGENTS.md`: v2 boundaries, no SQLite/MySQL, v2 verification command.
- Modify `docs/glossary.md`: include v2 terms introduced by the implementation.

## Task 1: Personnel Snapshot Script

**Files:**
- Create: `scripts/generate-weekly-action-personnel-snapshot.mjs`
- Create: `scripts/test-weekly-action-personnel-snapshot.mjs`
- Modify: `scripts/README.md`
- Modify: `package.json`

- [ ] **Step 1: Add failing test for snapshot generation**

Create `scripts/test-weekly-action-personnel-snapshot.mjs` with these assertions:

```javascript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-action-personnel-'));
const outputPath = path.join(tmpDir, 'personnel-snapshot.json');

const scriptPath = path.join(repoRoot, 'scripts', 'generate-weekly-action-personnel-snapshot.mjs');
const mappingPath = path.join(repoRoot, 'docs', 'organization', '信息化项目人员角色映射.md');
const rosterPath = path.join(repoRoot, 'docs', 'organization', '花名册.md');

execFileSync(process.execPath, [
  scriptPath,
  '--mapping', mappingPath,
  '--roster', rosterPath,
  '--out', outputPath,
  '--generated-by', 'contract-test'
], { stdio: 'pipe' });

const snapshot = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

assert.equal(snapshot.schemaVersion, 1);
assert.ok(snapshot.snapshotId.startsWith('PERSONNEL-'));
assert.equal(snapshot.generatedBy, 'contract-test');
assert.ok(snapshot.sourceHash.length >= 16);
assert.ok(snapshot.rowCount > 0);
assert.ok(Array.isArray(snapshot.people));
assert.ok(Array.isArray(snapshot.personRoles));
assert.ok(snapshot.personRoles.some(role => role.name === '刘春含'));
assert.ok(snapshot.personRoles.some(role => role.personnelMatchStatus === '花名册待补'));
assert.ok(snapshot.warnings.some(warning => warning.code === 'ROSTER_PENDING'));

const duplicateKeys = snapshot.personRoles
  .map(role => role.personRoleKey)
  .filter((key, index, all) => all.indexOf(key) !== index);
assert.deepEqual(duplicateKeys, []);

console.log('weekly action personnel snapshot checks passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node scripts/test-weekly-action-personnel-snapshot.mjs
```

Expected: fail because `generate-weekly-action-personnel-snapshot.mjs` does not exist.

- [ ] **Step 3: Implement snapshot generation script**

Create `scripts/generate-weekly-action-personnel-snapshot.mjs` with these exported responsibilities:

```javascript
const REQUIRED_COLUMNS = [
  '工号',
  '姓名',
  '花名册部门',
  '花名册职务',
  '项目组织',
  '项目角色',
  '任命状态',
  '来源材料',
  '来源位置',
  '来源可信度',
  '人员匹配状态',
  '是否待确认'
];

function parseMarkdownTables(markdown) {
  const rows = [];
  let currentHeader = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) {
      currentHeader = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.every(cell => /^-+$/.test(cell.replace(/:/g, '')))) continue;
    if (!currentHeader) {
      currentHeader = cells;
      continue;
    }
    if (REQUIRED_COLUMNS.every(column => currentHeader.includes(column))) {
      const row = Object.fromEntries(currentHeader.map((column, index) => [column, cells[index] || '']));
      rows.push(row);
    }
  }
  return rows;
}
```

Use these implementation rules:

- Read mapping Markdown and roster Markdown from CLI args.
- Parse roster rows by header names `姓名`, `工号`, `部门`, `职务`.
- For rows marked `已匹配花名册`, compare name, employee number, department, and title exactly.
- For rows marked `花名册待补`, require `工号`, `花名册部门`, and `花名册职务` to be `待花名册确认`.
- Generate `personRoleKey` from employee number or pending name hash plus normalized project organization and project role.
- Exclude rows with `任命状态` equal to `已撤销` from selectable `personRoles`.
- Write snapshot JSON atomically by writing a temporary file and renaming it.
- Exit with non-zero status for hard validation failures.

- [ ] **Step 4: Add npm script**

Modify root `package.json` scripts:

```json
{
  "scripts": {
    "generate:weekly-action-personnel": "node scripts/generate-weekly-action-personnel-snapshot.mjs",
    "test:weekly-action-personnel": "node scripts/test-weekly-action-personnel-snapshot.mjs"
  }
}
```

Keep existing scripts unchanged.

- [ ] **Step 5: Document the script**

In `scripts/README.md`, add:

```markdown
### Weekly action personnel snapshot

`generate-weekly-action-personnel-snapshot.mjs` reads `docs/organization/信息化项目人员角色映射.md` and `docs/organization/花名册.md`, validates the mapping, and writes `artifacts/weekly-actions/personnel-snapshot.json`.

It only reads organization truth sources and writes a runtime snapshot. It does not modify organization Markdown, PMO Markdown, MDM data, SQLite, or MySQL.

Run:

```powershell
npm run generate:weekly-action-personnel -- --generated-by "<name>"
npm run test:weekly-action-personnel
```
```

- [ ] **Step 6: Verify**

Run:

```powershell
npm run test:weekly-action-personnel
```

Expected output contains:

```text
weekly action personnel snapshot checks passed
```

## Task 2: v2 Ledger and Audit Event Store

**Files:**
- Create: `apps/weekly-action-service/lib/weeklyRange.js`
- Create: `apps/weekly-action-service/lib/v2Ledger.js`
- Modify: `apps/weekly-action-service/scripts/test-service-contract.js`

- [ ] **Step 1: Add failing ledger tests**

Append tests to `apps/weekly-action-service/scripts/test-service-contract.js` that start the service with a temporary `WEEKLY_ACTION_DATA_DIR` and verify:

```javascript
assert.equal(ledger.version, 2);
assert.ok(Array.isArray(ledger.items));
assert.ok(Array.isArray(ledger.events));
assert.ok(ledger.events.some(event => event.eventType === 'itemCreated'));
```

Also assert that no `weekly-action-ledger-v1.json` is written during v2 actions.

- [ ] **Step 2: Run app contract test to verify it fails**

Run:

```powershell
npm --prefix apps/weekly-action-service test
```

Expected: fail because v2 ledger helpers and v2 route behavior are not present.

- [ ] **Step 3: Create shared week range utility**

Create `apps/weekly-action-service/lib/weeklyRange.js`:

```javascript
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWeeklyRange(value = new Date()) {
  const current = parseDate(value) || new Date();
  const start = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  const day = start.getDay();
  const offset = day >= 4 ? day - 4 : day + 3;
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    weekId: formatDate(start),
    start: formatDate(start),
    end: formatDate(end),
    label: `${formatDate(start)} 至 ${formatDate(end)}`
  };
}

module.exports = { formatDate, parseDate, getWeeklyRange };
```

- [ ] **Step 4: Create v2 ledger helper**

Create `apps/weekly-action-service/lib/v2Ledger.js` with:

```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function eventId(type) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `EVT-${String(type || 'event').toUpperCase()}-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function readLedger(dataDir) {
  const file = path.join(dataDir, 'weekly-action-ledger-v2.json');
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      version: 2,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      events: Array.isArray(parsed.events) ? parsed.events : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 2, items: [], events: [] };
    throw error;
  }
}

function writeLedger(dataDir, ledger) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'weekly-action-ledger-v2.json');
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 2, items: ledger.items, events: ledger.events }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function appendEvent(ledger, event) {
  const next = {
    eventId: event.eventId || eventId(event.eventType),
    operatedAt: event.operatedAt || new Date().toISOString(),
    ...event
  };
  ledger.events.push(next);
  return next;
}

module.exports = { readLedger, writeLedger, appendEvent, eventId };
```

- [ ] **Step 5: Verify**

Run:

```powershell
npm --prefix apps/weekly-action-service test
```

Expected: ledger-specific assertions pass after route wiring in later tasks. If the test still fails because routes are not wired, keep the failing assertion in place until Task 4.

## Task 3: Personnel Snapshot Loader and Action Rules

**Files:**
- Create: `apps/weekly-action-service/lib/personnelSnapshot.js`
- Create: `apps/weekly-action-service/lib/actionRules.js`
- Modify: `apps/weekly-action-service/scripts/test-service-contract.js`

- [ ] **Step 1: Add tests for snapshot loading and stale warnings**

Add contract assertions:

```javascript
assert.equal(meta.personnelSnapshot.status, 'loaded');
assert.equal(typeof meta.personnelSnapshot.snapshotId, 'string');
assert.ok(Array.isArray(meta.personnelSnapshot.warnings));
```

Run without a snapshot once and assert:

```javascript
assert.equal(meta.personnelSnapshot.status, 'missing');
```

- [ ] **Step 2: Implement snapshot loader**

Create `apps/weekly-action-service/lib/personnelSnapshot.js`:

```javascript
const fs = require('fs');
const path = require('path');

function loadPersonnelSnapshot(dataDir, now = new Date()) {
  const file = path.join(dataDir, 'personnel-snapshot.json');
  try {
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    const generatedAt = snapshot.generatedAt ? new Date(snapshot.generatedAt) : null;
    const ageDays = generatedAt && !Number.isNaN(generatedAt.getTime())
      ? Math.floor((now.getTime() - generatedAt.getTime()) / 86400000)
      : null;
    return {
      status: 'loaded',
      snapshot,
      summary: {
        status: ageDays != null && ageDays > 14 ? 'stale' : 'loaded',
        snapshotId: snapshot.snapshotId,
        generatedAt: snapshot.generatedAt,
        warningCount: Number(snapshot.warningCount || 0),
        warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
        ageDays
      }
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        status: 'missing',
        snapshot: null,
        summary: { status: 'missing', warnings: [{ code: 'PERSONNEL_SNAPSHOT_MISSING', message: '人员快照未生成' }] }
      };
    }
    throw error;
  }
}

function findPersonRole(snapshot, personRoleKey) {
  return snapshot && Array.isArray(snapshot.personRoles)
    ? snapshot.personRoles.find(role => role.personRoleKey === personRoleKey) || null
    : null;
}

module.exports = { loadPersonnelSnapshot, findPersonRole };
```

- [ ] **Step 3: Implement action rules**

Create `apps/weekly-action-service/lib/actionRules.js` with:

```javascript
const STATUSES = ['待分派', '处理中', '待核验', '需升级', '暂缓', '已关闭', '已作废'];
const TRACKING_DESTINATIONS = ['行动项台账', '责任池', '材料缺口清单', '制度或表单待补说明', '后续访谈清单', 'MDM现有入口'];

function requireFields(input, fields) {
  return fields.filter(field => !String(input[field] || '').trim());
}

function requiredFieldsForDestination(destination) {
  const common = ['title', 'trackingDestination', 'source', 'pmoTracker', 'closeEvidenceRequirement'];
  const byDestination = {
    行动项台账: ['primaryResponsible'],
    责任池: ['responsibilityBoundaryTarget'],
    材料缺口清单: ['materialName', 'materialProvider'],
    制度或表单待补说明: ['relatedDocument', 'gapLocation'],
    后续访谈清单: ['interviewTarget', 'plannedInterviewAt'],
    MDM现有入口: ['mdmEntryDescription', 'mdmConfirmer']
  };
  return [...common, ...(byDestination[destination] || [])];
}

function canTransition(from, to) {
  const transitions = {
    待分派: ['处理中', '需升级', '已作废'],
    处理中: ['待核验', '需升级', '暂缓', '已作废'],
    待核验: ['处理中', '需升级', '已关闭', '已作废'],
    需升级: ['处理中', '暂缓', '已作废'],
    暂缓: ['处理中', '已作废'],
    已关闭: [],
    已作废: []
  };
  return (transitions[from] || []).includes(to);
}

module.exports = { STATUSES, TRACKING_DESTINATIONS, requireFields, requiredFieldsForDestination, canTransition };
```

- [ ] **Step 4: Verify**

Run:

```powershell
npm --prefix apps/weekly-action-service test
```

Expected: snapshot and rule tests pass once server meta route is wired.

## Task 4: v2 Business Action APIs

**Files:**
- Modify: `apps/weekly-action-service/server.js`
- Modify: `apps/weekly-action-service/scripts/test-service-contract.js`

- [ ] **Step 1: Add failing API contract sequence**

In the contract test, script this sequence against temporary data:

```javascript
await post('/api/current-operator', { personRoleKey: pmoPersonRoleKey });
const intake = await post('/api/intakes', { sourceType: '人工粘贴', sourceTitle: '测试周会摘录', sourceText: '请张三在周五前提交材料。' });
const confirmed = await post(`/api/intakes/${intake.intakeId}/confirm`, { candidateIds: [intake.candidateItems[0].candidateId] });
const item = confirmed.items[0];
await post(`/api/items/${item.id}/assign`, { primaryResponsible: businessPersonRoleKey, pmoTracker: pmoPersonRoleKey, pmoVerifier: pmoPersonRoleKey, assignmentReason: '端到端测试分派' });
await post(`/api/items/${item.id}/progress`, { note: '已准备材料' });
const evidence = await post(`/api/items/${item.id}/evidence`, { evidenceType: '文字说明', title: '材料完成说明', description: '材料已补齐' });
await post(`/api/items/${item.id}/verify`, { evidenceId: evidence.evidenceId, decision: '退回', verificationNote: '需要补充附件或正式路径' });
await post(`/api/items/${item.id}/evidence`, { evidenceType: 'PMO 正本路径', title: '正式材料路径', recordLink: 'pmo/deliverables/example.md' });
const delay = await post(`/api/items/${item.id}/delay-requests`, { newDueDate: '2026-07-10', reason: '补充正式路径', impact: '不影响本周复盘', recoveryAction: '当天补齐' });
await post(`/api/items/${item.id}/delay-requests/${delay.requestId}/decide`, { decision: '通过', decisionNote: '同意延期' });
await post(`/api/items/${item.id}/verify`, { decision: '通过', verificationNote: '证据充分' });
await post(`/api/items/${item.id}/close`, { closeNote: '端到端测试关闭' });
```

Assert final item status is `已关闭` and events include `intakeCreated`, `candidateConfirmed`, `itemAssigned`, `evidenceSubmitted`, `evidenceRejected`, `delayRequested`, `delayApproved`, `itemClosed`.

- [ ] **Step 2: Wire route dispatch**

In `server.js`, keep static serving and health route, then add v2 route helpers:

```javascript
async function handleV2Api(req, res, pathname, searchParams) {
  if (req.method === 'GET' && pathname === '/api/meta') return sendJson(res, 200, buildMetaPayload());
  if (req.method === 'POST' && pathname === '/api/current-operator') return handleSetCurrentOperator(req, res);
  if (req.method === 'POST' && pathname === '/api/intakes') return handleCreateIntake(req, res);
  if (req.method === 'POST' && /^\/api\/intakes\/[^/]+\/confirm$/.test(pathname)) return handleConfirmIntake(req, res, pathname);
  if (req.method === 'POST' && pathname === '/api/items') return handleCreateItem(req, res);
  if (req.method === 'GET' && pathname === '/api/items') return handleListItems(req, res, searchParams);
  if (req.method === 'POST' && /^\/api\/items\/[^/]+\/assign$/.test(pathname)) return handleAssignItem(req, res, pathname);
  if (req.method === 'POST' && /^\/api\/items\/[^/]+\/progress$/.test(pathname)) return handleProgress(req, res, pathname);
  if (req.method === 'POST' && /^\/api\/items\/[^/]+\/evidence$/.test(pathname)) return handleEvidence(req, res, pathname);
  if (req.method === 'POST' && /^\/api\/items\/[^/]+\/verify$/.test(pathname)) return handleVerify(req, res, pathname);
  if (req.method === 'POST' && /^\/api\/items\/[^/]+\/delay-requests$/.test(pathname)) return handleDelayRequest(req, res, pathname);
  if (req.method === 'POST' && /^\/api\/items\/[^/]+\/delay-requests\/[^/]+\/decide$/.test(pathname)) return handleDelayDecision(req, res, pathname);
  if (req.method === 'POST' && /^\/api\/items\/[^/]+\/close$/.test(pathname)) return handleClose(req, res, pathname);
  if (req.method === 'POST' && /^\/api\/items\/[^/]+\/void$/.test(pathname)) return handleVoid(req, res, pathname);
  return null;
}
```

Each handler must read the ledger, validate, mutate item state, append one or more events, and write the ledger atomically.

- [ ] **Step 3: Preserve compatibility responses**

Keep these routes working:

```text
GET /api/health
GET /
GET /api/meta
GET /api/items
```

For removed v1 write semantics, return `405` with:

```json
{ "error": "v2 使用业务动作接口，不支持通用更新或物理删除" }
```

for `PUT /api/items/:id` and `DELETE /api/items/:id`.

- [ ] **Step 4: Verify**

Run:

```powershell
npm --prefix apps/weekly-action-service test
```

Expected: API contract passes through item closure and audit event assertions.

## Task 5: Evidence Files, Intakes, Drafts, and Exports

**Files:**
- Create: `apps/weekly-action-service/lib/exporters.js`
- Modify: `apps/weekly-action-service/server.js`
- Modify: `apps/weekly-action-service/scripts/test-service-contract.js`

- [ ] **Step 1: Add tests for runtime directory layout**

Assert these paths are created under the temporary data directory:

```javascript
assert.ok(fs.existsSync(path.join(dataDir, 'weekly-action-ledger-v2.json')));
assert.ok(fs.existsSync(path.join(dataDir, 'intakes', `${intake.intakeId}.json`)));
assert.ok(fs.existsSync(path.join(dataDir, 'meeting-drafts')));
assert.ok(fs.existsSync(path.join(dataDir, 'exports')));
```

- [ ] **Step 2: Implement intake persistence**

When creating an intake, write:

```json
{
  "intakeId": "INTAKE-...",
  "sourceType": "人工粘贴",
  "sourceTitle": "测试周会摘录",
  "sourceText": "...",
  "createdBy": {},
  "createdAt": "2026-07-06T00:00:00.000Z",
  "candidateItems": []
}
```

to `artifacts/weekly-actions/intakes/{intakeId}.json`.

- [ ] **Step 3: Implement exporters**

Create `apps/weekly-action-service/lib/exporters.js`:

```javascript
function buildMeetingReviewPack(ledger, weekId) {
  const items = ledger.items || [];
  return {
    weekId,
    overdueItems: items.filter(item => item.status !== '已关闭' && item.dueDate && item.dueDate < new Date().toISOString().slice(0, 10)),
    pendingVerificationItems: items.filter(item => item.status === '待核验'),
    escalationItems: items.filter(item => item.status === '需升级'),
    unassignedItems: items.filter(item => item.status === '待分派'),
    closedItems: items.filter(item => item.status === '已关闭')
  };
}

function buildResponsibilityDrilldown(ledger) {
  const rows = [];
  for (const item of ledger.items || []) {
    const responsible = item.primaryResponsible && item.primaryResponsible.assignmentSnapshot;
    if (!responsible) continue;
    rows.push({
      itemId: item.id,
      title: item.title,
      status: item.status,
      dueDate: item.dueDate,
      department: responsible.rosterDepartment,
      position: responsible.rosterPosition,
      name: responsible.name,
      projectOrganization: responsible.projectOrganization,
      projectRole: responsible.projectRole,
      assessmentCandidate: Boolean(item.assessmentCandidate)
    });
  }
  return rows;
}

module.exports = { buildMeetingReviewPack, buildResponsibilityDrilldown };
```

- [ ] **Step 4: Add export endpoints**

Add:

```text
POST /api/meeting-drafts
POST /api/exports
```

Both endpoints write JSON or Markdown/HTML runtime exports to `meeting-drafts/` or `exports/` and append audit events.

- [ ] **Step 5: Verify**

Run:

```powershell
npm --prefix apps/weekly-action-service test
```

Expected: tests confirm draft/export files exist and ledger events include `meetingDraftGenerated` and `exportGenerated`.

## Task 6: Frontend v2 Experience

**Files:**
- Replace: `apps/weekly-action-service/public/index.html`

- [ ] **Step 1: Create static UI structure**

Use a single HTML file with these top-level regions:

```html
<header class="topbar">
  <div>
    <strong>3002 会后跟踪总账</strong>
    <span id="snapshot-status"></span>
  </div>
  <select id="current-operator"></select>
</header>

<nav class="tabs" aria-label="视图切换">
  <button data-view="workbench">PMO工作台</button>
  <button data-view="review">周会复盘包</button>
  <button data-view="responsibility">责任穿透视图</button>
  <button data-view="intake">会后整理录入</button>
</nav>

<main>
  <section id="view-workbench"></section>
  <section id="view-review" hidden></section>
  <section id="view-responsibility" hidden></section>
  <section id="view-intake" hidden></section>
  <aside id="item-detail" hidden></aside>
</main>
```

- [ ] **Step 2: Implement API client**

Add browser JavaScript helpers:

```javascript
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

async function loadMeta() {
  state.meta = await api('/api/meta');
  renderSnapshotStatus();
  renderOperatorSelect();
}
```

- [ ] **Step 3: Render three fixed views**

Implement render functions:

```javascript
function renderWorkbench(items) {
  renderList('view-workbench', items.filter(item => ['待分派', '待核验', '需升级'].includes(item.status) || item.alerts?.length));
}

function renderReview(items) {
  renderList('view-review', items.filter(item => item.status !== '已作废'));
}

function renderResponsibility(items) {
  const rows = items.map(item => item.primaryResponsible?.assignmentSnapshot).filter(Boolean);
  document.getElementById('view-responsibility').innerHTML = renderResponsibilityRows(rows, items);
}
```

- [ ] **Step 4: Implement item detail workflow**

The detail panel must show sections:

```text
基本信息
责任分派
进展记录
证据清单
延期与暂缓
升级与考核候选
审计历史
来源摘录
```

Each action button calls the v2 business endpoint rather than a generic item update endpoint.

- [ ] **Step 5: Verify in browser and contract test**

Run:

```powershell
npm --prefix apps/weekly-action-service test
npm --prefix apps/weekly-action-service start
```

Open:

```text
http://127.0.0.1:3002
```

Expected: no console error, visible tabs for PMO workbench, weekly review pack, responsibility drill-through, and intake.

## Task 7: v1 Migration

**Files:**
- Modify: `apps/weekly-action-service/lib/v2Ledger.js`
- Modify: `apps/weekly-action-service/server.js`
- Modify: `apps/weekly-action-service/scripts/test-service-contract.js`

- [ ] **Step 1: Add migration test**

Create a temporary `weekly-action-ledger-v1.json`:

```json
{
  "version": 1,
  "items": [
    {
      "id": "ACTION-LEGACY",
      "weekId": "2026-07-02",
      "type": "action",
      "title": "旧事项",
      "owner": "PMO",
      "dueDate": "2026-07-08",
      "status": "open",
      "source": "周会现场",
      "closeCriteria": "形成关闭说明"
    }
  ]
}
```

Call:

```text
POST /api/migrations/v1-to-v2
```

Assert v2 ledger contains one item and one `legacyImported` event.

- [ ] **Step 2: Implement manual migration endpoint**

Add route:

```text
POST /api/migrations/v1-to-v2
```

It must:

- Read v1 only if v2 has no items.
- Map v1 statuses `open`, `doing`, `blocked`, `closed` to `待分派`, `处理中`, `需升级`, `已关闭`.
- Put v1 `owner` into `legacyOwnerText`.
- Append `legacyImported` event for every migrated item.
- Leave v1 file untouched.

- [ ] **Step 3: Verify**

Run:

```powershell
npm --prefix apps/weekly-action-service test
```

Expected: migration test passes and v1 file remains on disk.

## Task 8: Documentation Sync

**Files:**
- Modify: `apps/weekly-action-service/README.md`
- Modify: `apps/weekly-action-service/AGENTS.md`
- Modify: `docs/glossary.md`

- [ ] **Step 1: README update**

Document:

- v2 runtime layout.
- Personnel snapshot generation command.
- v2 business action endpoints.
- v1 migration behavior.
- No SQLite/MySQL in v2 first implementation.
- Verification commands:

```powershell
npm run test:weekly-action-personnel
npm --prefix apps/weekly-action-service test
```

- [ ] **Step 2: AGENTS update**

Add:

```markdown
## v2 设计边界

- v2 设计基线见 `docs/weekly-action-service-v2-design.md`。
- 人员快照由仓库脚本生成，3002 只读消费，不直接解析组织 Markdown 真源。
- 写操作必须走业务动作接口，并写入全局审计事件流。
- 删除语义为误录作废，不允许物理删除事项和证据。
- 不引入 SQLite；PMO 管理模型稳定前不接 MySQL。
```

- [ ] **Step 3: Glossary update**

Ensure these terms exist:

```text
人员快照
会后整理录入
审计事件流
周会复盘包
责任穿透视图
考核候选
误录作废
```

- [ ] **Step 4: Verify docs**

Run:

```powershell
Select-String -Path 'apps/weekly-action-service/README.md','apps/weekly-action-service/AGENTS.md','docs/glossary.md' -Pattern '人员快照|审计事件流|误录作废'
```

Expected: each file returns matching lines.

## Task 9: Final Verification

**Files:**
- Modify only files touched by Tasks 1 through 8.

- [ ] **Step 1: Run personnel snapshot test**

Run:

```powershell
npm run test:weekly-action-personnel
```

Expected:

```text
weekly action personnel snapshot checks passed
```

- [ ] **Step 2: Run 3002 service contract test**

Run:

```powershell
npm --prefix apps/weekly-action-service test
```

Expected:

```text
weekly action service contract checks passed
```

- [ ] **Step 3: Check for forbidden storage choices**

Run:

```powershell
Select-String -Path 'apps/weekly-action-service/**/*','scripts/generate-weekly-action-personnel-snapshot.mjs' -Pattern 'sqlite|better-sqlite3|\\.db|mysql' -CaseSensitive:$false
```

Expected: no SQLite dependency or database file creation. Mentions of “MySQL” are allowed only in boundary text that says v2 does not use MySQL.

- [ ] **Step 4: Review changed files**

Run:

```powershell
git diff -- apps/weekly-action-service scripts docs/glossary.md package.json
```

Expected: changes are scoped to the weekly action service, personnel snapshot script, docs, tests, and root script registration.

## Self-Review

Spec coverage:

- Personnel snapshot: Task 1 and Task 3.
- v2 ledger and event stream: Task 2.
- Business action APIs: Task 4.
- Evidence, intakes, drafts, exports: Task 5.
- Frontend views: Task 6.
- v1 migration: Task 7.
- Documentation and glossary: Task 8.
- End-to-end acceptance: Task 9.

Placeholder scan:

- This plan avoids placeholder tokens and vague generic instructions.
- Every task lists exact files, commands, and expected results.

Type consistency:

- `personRoleKey`, `snapshotId`, `assignmentSnapshot`, `eventId`, `itemId`, `intakeId`, `evidenceId`, and `requestId` match the v2 design baseline.
