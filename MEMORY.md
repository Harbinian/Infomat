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

- `apps/structured-output-service/` is stateless. It must not save user uploads or page contents, write databases, write back to `docs/norms/`, or call MDM write APIs.
- `docs/contracts/document-structured-output.schema.json` is the standard contract for structured-output fields and export shape.
- `docs/organization/组织架构和部门职责.md` is the source for department-to-domain mapping.
- As of 2026-07-06, the structured-output service treats `form_tables` as an editable user-facing object: users choose a form, choose or add a table, edit the table header name, then edit fields for that table.
- As of 2026-07-06, the structured-output service recognizes common procedure-file `工作程序` sections as workflow-step sources and filters standalone trigger-condition lists such as `下列/包括` items out of editable steps.
- As of 2026-07-06, the structured-output service treats “能力域” and “业务能力” as read-only process-mapping values from `docs/norms/*映射关系.md`, not manual page fields; when a procedure body lacks header metadata, matching may use upload source hints or form-code fragments in the body.
- As of 2026-07-06, the structured-output service uses field-level lexicons for `trigger_scene`, `precondition`, `input_materials`, `output_result`, and `execution_standard`, informed by a `docs/norms` sample pass across 237 readable files / 17,469 sentences and guarded by real Word fixtures for corrective action, vehicle use, and furnace handoff documents.
- As of 2026-07-07, document structured-output uses `document-structured-output-v2` only. `steps[]` requires `step_type=action|decision`, `step_transitions[]` stores same-process decision branches with nullable `to_step_ref`, 3001 supports multi-process editing and process-level collapse, and 3000 imports/saves/read-only displays branches without a branch editor.
- As of 2026-07-07, MDM MySQL identity passwords are owned by `user_accounts`. `init:mysql` and service startup must not overwrite existing `user_accounts.password_hash` or `must_change_password` from the legacy `users` table; if a user reports that a changed password no longer works after restart, first check the legacy-to-person identity migration path.
- As of 2026-07-16, 3001 preserves each business behavior `actor_role` as free-text “制度原文中的角色/岗位称谓”; roster positions are read-only candidate hints and never overwrite the source wording. Form/record `responsible_role` keeps the legacy department-scoped roster selector for compatibility.
- As of 2026-07-16, `公司领导` and its roster positions remain available only where the legacy form/record role selector needs them. Business behavior source roles are no longer rewritten through a roster selector.
- As of 2026-07-10, 3001 treats explicit workflow field groups headed by `行为N` or `业务行为N` as authoritative within their workflow section. It maps `执行角色 / 触发场景 / 前置条件 / 输入(材料) / 输出(结果) / 执行标准` directly with field-level source evidence, suppresses duplicate natural-language step splitting in that section, normalizes only department-position dash separators, and preserves source wording or mistakes for user review.
- As of 2026-07-09, PMO task truth source rows may use `受控交付物编号` to generate an explicit `deliverableId`. Use it when a planned deliverable must bind to a specific `pmo/deliverables/DLV-XXX-*.md` canonical file or when automatic sequential IDs would collide with existing controlled deliverables.
- As of 2026-07-16, formal work roles are governed by HR in `docs/organization/工作角色目录与岗位映射.md` and generated read-only to `docs/work-role-data.json`. Codes are sequential `WR-0001` values assigned only after HR confirmation; the initial directory is intentionally empty. Work roles are distinct from source role wording, roster positions, people, and MDM project governance/RBAC roles.
- As of 2026-07-16, `document-structured-output-v2` has an optional `work_role_bindings[]`. Automatic extraction can only create `proposed`; `confirmed` must pass target, active role/effective mapping, precise directly readable evidence, and business confirmation checks. Until the later MySQL milestone, 3000 rejects non-empty bindings from either the top level or `structure_block_projection` before repository initialization with `422 WORK_ROLE_BINDINGS_UNSUPPORTED`.
- As of 2026-07-23, `process-evidence-mapping` accepts only directly readable sources and must block images, scan-only PDFs, conversion failures, and empty extractions; it must not invoke image-to-text conversion or infer unreadable content. Its canonical machine output is `artifacts/process-input-baseline-review/<run-id>/document-structured-output-v2.json`, validated against `docs/contracts/document-structured-output.schema.json`; legacy review-item files and Markdown are intermediate or derived only, and the skill never emits a formal structure-block projection.
- As of 2026-07-24, `technical-chinese-writer` is the repository source for controlled Chinese technical, business, and management writing. Ordinary replies receive a lightweight fact, subject, and terminology check; formal deliverables receive the full controlled-writing review. `humanizer-zh` is explicit-only and cannot replace the controlled-writing pass, while the English `humanizer` skill is removed.
