# Glossary Maintenance Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the project glossary (`docs/glossary.md`) is actively referenced during AI-assisted development and stays up-to-date as the codebase evolves.

**Architecture:** Three components: (1) enhanced CLAUDE.md instructions that trigger glossary lookup at the right moments, (2) a lightweight Node lookup script for terminal use, (3) documented term-addition conventions. No new dependencies — the lookup script parses the existing Markdown table format with vanilla Node.js.

**Tech Stack:** Node.js (already in project), Markdown parsing via regex

---

### Task 1: Add glossary usage protocol to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:9-11`

- [ ] **Step 1: Replace the current glossary reference with a usage protocol**

The current glossry reference (line 9-11) is a passive pointer. Replace it with active instructions.

Read the current lines:
```
**重要参考文件：**
- `docs/glossary.md` — 项目术语表，覆盖业务域/主数据域/体系文件域/技术域/供应链协同域 ~180 条术语定义。开发时遇到不熟悉的术语优先查阅此文件。
```

Replace with:

```
**术语表 (`docs/glossary.md`)：**
开发时按以下协议使用术语表，确保命名和概念一致：

1. **启动任何开发任务前**，判断任务属于哪个术语域（业务/主数据/体系文件/技术/供应链协同），Read `docs/glossary.md` 对应章节获取语境
2. **命名新变量/函数/路由/表字段时**，先 grep 术语表确认项目中已有该术语的中文名和英文缩写，复用而非重造
3. **写 commit message 和 PR 描述时**，使用术语表中的标准术语，不用个人习惯的别名
4. **新增或修改术语时**，按文件末尾的"术语新增流程"追加到术语表，作为当前 commit 的一部分
5. **遇到不确定的术语**，先查术语表附录的缩写速查表，再 grep 代码中的实际用法
```

- [ ] **Step 2: Verify the change reads correctly**

```bash
head -20 CLAUDE.md
```

Expected: The new glossary protocol section is visible in the output.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: replace glossary reference with active usage protocol in CLAUDE.md"
```

---

### Task 2: Add term addition workflow to glossary.md

**Files:**
- Modify: `docs/glossary.md` (append section at end)

- [ ] **Step 1: Append the term addition workflow section**

Append the following after the abbreviation appendix (after the last `| WAL | ... |` line):

```markdown
---

## 术语新增流程

当开发过程中产生新术语需要纳入术语表时，按以下步骤操作：

1. **判断所属域**：确认术语属于 1-业务域 / 2-主数据域 / 3-体系文件域 / 4-技术域 / 5-供应链协同域 中的哪一个
2. **写条目**：按 `| 术语 | 英文/缩写 | 定义 |` 三列格式，追加到对应章节日志（line break后空一行然后追加行）
3. **定义要求**：1-2 句话，只解释"这个术语在项目中是什么意思"，不含实现细节或代码路径
4. **更新附录**：如果术语有缩写，追加到附录缩写速查表（按字母顺序插入）
5. **同 commit 提交**：术语表变更和代码变更放在同一个 commit 中，确保术语和实现同步

### 示例：新增一个技术域术语

原始代码中引入了 `rateLimiter` 中间件，需要记录术语：

**1. 打开 `docs/glossary.md`，找到 `## 4. 技术域` 章节的表格末尾**
**2. 追加行：**

| 速率限制 | Rate Limiter | Express 中间件，限制同一 IP 在时间窗口内的请求次数，防止 API 滥用 |

**3. 找到 `## 附录：缩写速查表`，按字母顺序插入：**

（本例无新缩写，跳过此步）

**4. 提交：**

```bash
git add docs/glossary.md src/middleware/rateLimiter.js
git commit -m "feat: add rate limiter middleware for API protection"
```

> 注意：不要在 commit 中只更新术语表而不更新代码，反之亦然。术语和代码应保持同步。
```

- [ ] **Step 2: Verify the appended section**

```bash
tail -30 docs/glossary.md
```

Expected: The 术语新增流程 section is visible.

- [ ] **Step 3: Update the version and date in the header**

Change line 3-4:
```
> 版本：V1.0
> 更新日期：2026-05-27
```
to:
```
> 版本：V1.1
> 更新日期：2026-05-27
```

- [ ] **Step 4: Commit**

```bash
git add docs/glossary.md
git commit -m "docs: add term addition workflow to glossary"
```

---

### Task 3: Create glossary lookup script

**Files:**
- Create: `scripts/glossary.mjs`
- Modify: `CLAUDE.md` (add command to 常用命令 section)

- [ ] **Step 1: Write the lookup script**

Create `scripts/glossary.mjs`:

```javascript
#!/usr/bin/env node
// Glossary lookup — grep docs/glossary.md by keyword, domain, or abbreviation
// Usage: node scripts/glossary.mjs <keyword>            full-text search
//        node scripts/glossary.mjs --domain <1-5>       list domain
//        node scripts/glossary.mjs --abbr <ABBR>        lookup abbreviation
//        node scripts/glossary.mjs --list               list all terms

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const glossaryPath = join(__dirname, '..', 'docs', 'glossary.md');

const text = readFileSync(glossaryPath, 'utf-8');

const domainHeaders = {
  1: '## 1. 业务域',
  2: '## 2. 主数据域',
  3: '## 3. 体系文件域',
  4: '## 4. 技术域',
  5: '## 5. 供应链协同域',
};

function extractSection(startMarker, nextMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = nextMarker ? text.indexOf(nextMarker, start) : text.length;
  if (end === -1) return text.slice(start);
  return text.slice(start, end);
}

function parseRows(section) {
  const rows = [];
  const lines = section.split('\n');
  for (const line of lines) {
    // Match | term | abbr | def |
    if (line.startsWith('| ') && !line.startsWith('| 术语') && !line.startsWith('|---') && !line.startsWith('| 缩写')) {
      const parts = line.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 3) rows.push({ term: parts[0], abbr: parts[1], def: parts[2] });
    }
  }
  return rows;
}

function parseAbbrRows(section) {
  const rows = [];
  const lines = section.split('\n');
  for (const line of lines) {
    if (line.startsWith('| ') && !line.startsWith('| 缩写') && !line.startsWith('|---')) {
      const parts = line.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 3) rows.push({ abbr: parts[0], full: parts[1], domain: parts[2] });
    }
  }
  return rows;
}

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`Usage:
  node scripts/glossary.mjs <keyword>        Full-text search
  node scripts/glossary.mjs --domain <1-5>   List all terms in a domain
  node scripts/glossary.mjs --domains         List domain names
  node scripts/glossary.mjs --abbr <ABBR>    Lookup abbreviation
  node scripts/glossary.mjs --list            List all terms`);
  process.exit(0);
}

if (args[0] === '--domains') {
  for (const [k, v] of Object.entries(domainHeaders)) {
    console.log(`${k}: ${v.replace('## ', '')}`);
  }
  process.exit(0);
}

if (args[0] === '--domain') {
  const domain = args[1];
  const header = domainHeaders[domain];
  if (!header) { console.error(`Unknown domain: ${domain}. Use --domains to list.`); process.exit(1); }
  const nextHeader = domain < 5 ? domainHeaders[Number(domain) + 1] : '## 附录';
  const section = extractSection(header, nextHeader);
  const rows = parseRows(section);
  for (const r of rows) {
    console.log(`${r.term}  [${r.abbr}]  ${r.def}`);
  }
  process.exit(0);
}

if (args[0] === '--abbr') {
  const abbr = args[1].toUpperCase();
  const appendix = extractSection('## 附录：缩写速查表', null);
  const rows = parseAbbrRows(appendix);
  const match = rows.find(r => r.abbr.toUpperCase() === abbr);
  if (match) {
    console.log(`${match.abbr}: ${match.full}  (${match.domain})`);
  } else {
    console.log(`Abbreviation "${abbr}" not found.`);
  }
  process.exit(0);
}

if (args[0] === '--list') {
  for (let d = 1; d <= 5; d++) {
    const header = domainHeaders[d];
    const nextHeader = d < 5 ? domainHeaders[d + 1] : '## 附录';
    const section = extractSection(header, nextHeader);
    const rows = parseRows(section);
    console.log(`\n${'='.repeat(60)}`);
    console.log(header.replace('## ', ''));
    console.log('='.repeat(60));
    for (const r of rows) {
      console.log(`  ${r.term}  [${r.abbr}]`);
    }
  }
  process.exit(0);
}

// Full-text search
const keyword = args[0].toLowerCase();
const lines = text.split('\n');
const results = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].toLowerCase().includes(keyword) && lines[i].startsWith('|')) {
    results.push(lines[i].trim());
  }
}
if (results.length === 0) {
  console.log(`No results for "${args[0]}".`);
} else {
  for (const r of results) {
    console.log(r);
  }
}
```

- [ ] **Step 2: Verify the script runs**

```bash
node scripts/glossary.mjs --help
node scripts/glossary.mjs --domains
node scripts/glossary.mjs --domain 1 | head -5
node scripts/glossary.mjs --abbr RBAC
node scripts/glossary.mjs MBOM
```

Expected: Help shows usage. --domains lists 5 domains. --domain 1 shows business domain terms. --abbr RBAC shows "Role-Based Access Control". MBOM search returns matching rows.

- [ ] **Step 3: Add lookup command to CLAUDE.md 常用命令 section**

Insert after the Gantt section (after line 56, before `## 技术栈`):

```markdown
### 术语表查询

```bash
node scripts/glossary.mjs <keyword>       # 全文搜索术语
node scripts/glossary.mjs --domain <1-5>  # 列出某个域的全部术语
node scripts/glossary.mjs --abbr <ABBR>   # 查缩写全称
node scripts/glossary.mjs --list           # 列出所有术语
```
```

- [ ] **Step 4: Commit**

```bash
git add scripts/glossary.mjs CLAUDE.md
git commit -m "feat: add glossary lookup script with keyword, domain, and abbreviation search"
```

---
