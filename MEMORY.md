# Infomat Project Memory

> Created: 2026-07-06
> Purpose: long-lived project context for Codex collaboration. Do not store secrets here.

## Current Stage

The repository is in the "process map and data map consolidation" stage. The default analysis object is the business process, not a specific application system.

MDM platform development is currently paused unless the user explicitly asks for MDM platform work. Process input baselines, PMO views, and business source materials must not be written into platform source code by accident.

## Technical Shape

- Package manager: npm, inferred from `package-lock.json`.
- Root runtime: Node.js CommonJS scripts.
- Main dependency at root: `mysql2`.
- Main runnable apps:
  - `apps/mdm-platform/`: MDM platform, Express backend and static frontend.
  - `apps/structured-output-service/`: local document structured-output assistant, default port `3001`.
  - `apps/weekly-action-service/`: PMO weekly action service, default port `3002`.
- Main document and source directories:
  - `docs/`: information assets, contracts, source materials, reports, architecture notes.
  - `docs/norms/`: process input baselines and source materials.
  - `docs/organization/`: organization and people source documents.
  - `pmo/`: PMO workbench, dashboard, Gantt app, and controlled deliverables.
  - `scripts/`: repository-level parsing, generation, and verification scripts.

## Operating Rules

- Start cross-directory work by reading `AGENTS.md`, `CODEX.md`, `REPOSITORY_BOUNDARY.md`, `DIRECTORY_OWNERSHIP.md`, `MAINLINE_MAP.md`, then any task-related directory `AGENTS.md` or `README.md`.
- Keep changes scoped to the responsible asset. Do not adjust `docs/norms/`, PMO dashboards, or MDM source while fixing `apps/structured-output-service/` unless the user explicitly asks.
- Code, script, interface, database, frontend behavior, startup command, or test command changes require a documentation sync check.
- The project uses local ignored environment files for secrets. This file must record only where configuration lives, never secret values.

## Common Commands

- Root service startup: `npm run start:infomat-services`
- Root service smoke: `npm run smoke:infomat-services`
- MDM selected checks:
  - `npm --prefix apps/mdm-platform run test:frontend`
  - `npm --prefix apps/mdm-platform run test:process-governance`
  - `npm --prefix apps/mdm-platform run test:mainline`
- Structured output service:
  - `npm --prefix apps/structured-output-service start`
  - `npm --prefix apps/structured-output-service test`
- Document structured-output schema:
  - `npm run test:document-structured-output-schema`
  - `npm run build:work-role-data`
  - `npm run test:work-role-contract`
- PMO/process map:
  - `node scripts/parse-sankey-data.mjs`
  - `node scripts/check-dashboard-data.mjs`

## Notes

- `apps/structured-output-service/` is stateless. It must not save user uploads or page contents, use browser persistence, write databases, write back to `docs/norms/`, or communicate with 3000 through APIs, databases, queues, callbacks, shared sessions, or polling.
- `docs/contracts/process-governance-v1.schema.json` defines the 3001 export structure. One file contains exactly one process and no review status, review comments, approval marker, or formal document association. `document-structured-output-v2` remains only as the deterministic parser and historical-import structure.
- `docs/organization/组织架构和部门职责.md` is the source for department-to-domain mapping.
- As of 2026-07-28, 3001 uses an independent “表单与记录” workbench: select a form or record, select its main or one detail structure, then edit that structure's items. A new form creates one empty main structure; multiple details remain separate. JSON still uses `forms[].areas[].items[]`, with `基本信息` for main and `明细清单` for detail. Missing, duplicate, or unclassified main structures are preserved and warned, not hard-blocked.
- As of 2026-07-06, the structured-output service recognizes common procedure-file `工作程序` sections as workflow-step sources and filters standalone trigger-condition lists such as `下列/包括` items out of editable steps.
- As of 2026-07-27, “能力域” and “业务能力” are optional classification results in 3001. They may remain unclassified and never block draft export or PMO review.
- As of 2026-07-06, the structured-output service uses field-level lexicons for `trigger_scene`, `precondition`, `input_materials`, `output_result`, and `execution_standard`, informed by a `docs/norms` sample pass across 237 readable files / 17,469 sentences and guarded by real Word fixtures for corrective action, vehicle use, and furnace handoff documents.
- As of 2026-07-27, 3001 directly creates blank processes and exports `process-governance-v1`. New behavior/node type defaults blank. Historical multi-process v2 files are split into in-memory candidates and exported one process per file; unconvertible evidence and extra role bindings are preserved as a legacy supplemental reference.
- As of 2026-07-07, MDM MySQL identity passwords are owned by `user_accounts`. `init:mysql` and service startup must not overwrite existing `user_accounts.password_hash` or `must_change_password` from the legacy `users` table; if a user reports that a changed password no longer works after restart, first check the legacy-to-person identity migration path.
- As of 2026-07-30, 3000 uses fixed governance model `rbac-raci-v2-2026-07-30`. The only runtime identity chain is `person -> user_accounts -> person_roles`; `users/user_roles`, SQLite personnel APIs, self-registration, roster/project batch account scripts, and RBAC batch import cannot create or authorize production accounts. The seven fixed MDM governance roles are `admin`, `mdm_lead`, `department_contact`, `department_mdm_reviewer`, `data_conflict_handler`, `data_quality_auditor`, and `decision_group`. `admin` manages accounts and role assignments but has governance read-only access; business writes require the relevant governance permission, data scope, object state, assignment relationship, and responsibility evidence. Existing databases must run the controlled dry-run/apply migration, which backs up identity authorization data, preserves only controlled `ADMIN001` as administrator, disables other legacy accounts, retires every non-fixed role without automatic mapping, invalidates old sessions through `auth_version`, and supports pre-new-event rollback or later compensation.
- As of 2026-07-28, 3001 selects each business behavior's current execution position from `docs/organization/花名册.md` through local `/api/enums`; it saves a concrete choice as department plus position and `全公司通用` as `全公司`. No department or position is selected by default. Imported unlisted values and roster-load failures never clear existing data.
- As of 2026-07-28, the 3001 execution-department selector lists every organization department. A selected department equal to the process owner is in-department execution; a different selected department is cross-department execution. The position selector contains only positions assigned to the selected department by `docs/organization/花名册.md`. 3001 preserves the roster assignment even when a position name appears organizationally surprising; HR must correct the roster truth source rather than 3001 guessing a different department.
- As of 2026-07-28, ordinary 3001 editing does not create or edit formal `work_role` values. New behaviors use `work_role: null`; legal imported work roles remain hidden and are re-exported with their behavior binding. Work roles remain distinct from positions, people, and RBAC roles, and full names retain behavior plus duty, such as “费用审核行为的审核角色”.
- As of 2026-07-10, 3001 treats explicit workflow field groups headed by `行为N` or `业务行为N` as authoritative within their workflow section. It maps `执行角色 / 触发场景 / 前置条件 / 输入(材料) / 输出(结果) / 执行标准` directly with field-level source evidence, suppresses duplicate natural-language step splitting in that section, normalizes only department-position dash separators, and preserves source wording or mistakes for user review.
- As of 2026-07-09, PMO task truth source rows may use `受控交付物编号` to generate an explicit `deliverableId`. Use it when a planned deliverable must bind to a specific `pmo/deliverables/DLV-XXX-*.md` canonical file or when automatic sequential IDs would collide with existing controlled deliverables.
- As of 2026-07-16, formal work roles are governed by HR in `docs/organization/工作角色目录与岗位映射.md` and generated read-only to `docs/work-role-data.json`. Codes are sequential `WR-0001` values assigned only after HR confirmation; the initial directory is intentionally empty. Work roles are distinct from source role wording, roster positions, people, and MDM project governance/RBAC roles.
- As of 2026-07-27, work-role details, cross-department input and returned data, internal process calls, countersign target departments, candidate data objects, and form entry structure are carried by `process-governance-v1`. The current 3000 does not accept this structure; only PMO-approved JSON may be manually uploaded after the planned 3000 refactor.
- As of 2026-07-28, DeepSeek and CC Switch assistance remain removed from 3001, including UI requests, service configuration, health output, and network calls. The business page no longer displays the model-retirement notice or the general notice about 3001 statelessness, 3000 communication, and offline review; those boundaries remain enforced through product and technical rules.
- As of 2026-07-28, 3001 checks `/api/schema` on page load and before new-process creation or export. If a newly loaded frontend is served by a stale backend process, the page must preserve current in-memory work and instruct the user to keep the page open while port 3001 is restarted. HTML or other non-JSON API responses must be converted into an actionable service/version message instead of exposing a JSON parse error; legacy structure errors must not be reported as broken technical references.
- As of 2026-07-28, 3001 exposes the server-owned blank `process-governance-v1` template, Git commit, and schema digest, and listens on `0.0.0.0:3001` by default for direct company-LAN access. The browser page no longer carries a second blank-structure implementation.
- As of 2026-07-28, 3001 provides a stateless read-only cross-functional process preview generated from the current single-process form. It uses a minimal BPMN 2.0.2 visual subset implemented with local `cytoscape@3.34.0`: horizontal department swimlanes, positions on the second node line, solid local flows, dashed hollow cross-department handoffs outside the lanes, thick-border historical internal calls in the caller lane, and an always-visible seven-item legend. New blank processes open in text editing, while imports with named behaviors open in preview. The diagram draws only explicit valid relations, does not show data objects or infer start/end events, never persists coordinates or page state, never mutates the JSON, and never offers direct graphical editing. The `process-governance-v1` structure is unchanged, so legacy handling is display compatibility plus lossless import/export regression rather than a data migration.
- As of 2026-07-28, a 3001 business-behavior card can create and prefill one or more `cross_department_handoffs[]` records by binding the current behavior as `send_behavior_ref`; the handoff workbench continues editing those same records. Deleting a behavior requires confirmation when its handoffs will be removed. Department-internal calls are an MDM formal feature: 3001 has no internal-call editor, preserves imported `internal_process_calls[]` unchanged for read-only diagram preview and re-export, and blocks deletion of behavior or data objects referenced by those hidden calls.
- As of 2026-07-28, 3001's business page no longer exposes reference-material upload, drag/drop, editing, or missing-reference prompts. New templates keep `reference_materials: []`; valid historical references imported from JSON remain hidden in memory and survive re-export. The deterministic parser and upload endpoint remain only for historical migration and regression tests.
- As of 2026-07-28, 3001 text editing is split into basic information, purpose and scope, terms, process steps, forms and records, and export checks. Sidebar labels update without replacing the active form control, preventing adjacent-field input from being lost during blur-driven rerenders.
- As of 2026-07-23, `process-evidence-mapping` accepts only directly readable sources and must block images, scan-only PDFs, conversion failures, and empty extractions; it must not invoke image-to-text conversion or infer unreadable content. Its canonical machine output is `artifacts/process-input-baseline-review/<run-id>/document-structured-output-v2.json`, validated against `docs/contracts/document-structured-output.schema.json`; legacy review-item files and Markdown are intermediate or derived only, and the skill never emits a formal structure-block projection.
- As of 2026-07-24, `technical-chinese-writer` is the repository source for controlled Chinese technical, business, and management writing. Ordinary replies receive a lightweight fact, subject, and terminology check; formal deliverables receive the full controlled-writing review. `humanizer-zh` is explicit-only and cannot replace the controlled-writing pass, while the English `humanizer` skill is removed.
- As of 2026-07-28, every 3000 or 3001 version update must assess and handle legacy-data migration as part of the same change. 3000 uses controlled migration or compatible reads for persisted data, with backup, idempotency, rollback or compensation, and post-migration verification. 3001 migrates supported historical JSON only in current-page memory and remains stateless. Neither application may silently discard, clear, guess, or default incompatible old content; an update is not complete until migration or compatibility tests and recovery instructions pass.
