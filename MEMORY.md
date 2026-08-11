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
  - `apps/structured-output-service/`: stateless single-process governance compiler, default port `3001`.
  - `apps/structure-assistant/`: centrally deployed browser assistant for the four-account DeepSeek structure pilot, default HTTPS ports `3003` and `3004`.
  - `apps/weekly-action-service/`: PMO weekly action service, default port `3002`.
  - `apps/information-collection-service/`: internal information collection service; admin port `4000`, respondent port `4001`.
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
- Information collection service:
  - `npm run migrate:information-collection:dry-run`
  - `npm run migrate:information-collection:apply`
  - `npm run check:information-collection-schema`
  - `npm run test:information-collection`
  - `npm run start:information-collection`
  - `npm run smoke:information-collection`
- Structure pilot:
  - `npm run verify:structure-pilot`
  - `npm run start:structure-pilot`
  - `npm run smoke:structure-pilot`
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
- As of 2026-08-10, `apps/information-collection-service/` provides the internal 4000 admin and 4001 respondent applications from one Express process. It reads `person -> user_accounts` and `departments` for identity only, keeps application grants and all collection business data in `collection_*` tables, and stores attachment bodies under the repository-external `COLLECTION_FILE_ROOT`.
- Information collection roles are only `collection_admin` and department-bound `collection_designer`; MDM `admin`, MDM work roles, and department responsibility do not grant access automatically. The first collection administrator must be explicitly bootstrapped with a confirmed employee number.
- As of 2026-08-10, each 3001 form uses one compact inline-edit table with main, all detail, and unassigned field groups. Detail titles and ordering remain on group headers; mobile uses compact two-column cards. Moving a field keeps the same object and `item_ref`; multiple details and historical `item_type` values remain separate and lossless.
- As of 2026-07-30, 3001 “填写项类型” is a controlled selector backed by `/api/enums.fieldType`; users cannot type arbitrary values. Unlisted historical `item_type` values remain intact and visibly warned until the user selects a standard type. The v1 Schema keeps `item_type` as a string only for legacy round-trip compatibility, not as permission for free entry.
- As of 2026-08-10, 3001 uses “two actions, one todo record” for cross-department work. The local initiating action remains in `behaviors[]`; the external handling action and todo facts exist only once in `cross_department_handoffs[]`. New behaviors can select only the owning department or `全公司`. The business-flow list is the only handoff editor, while the handoff summary is read-only; formal todos are generated only after 3000 audit import.
- As of 2026-08-10, 3001 no longer asks users to repeat behavior trigger, input, and output facts already expressed by relations and data. Only a process-entry behavior edits `trigger` as “流程如何开始”; `precondition` is an optional additional constraint, and action or decision nodes retain `completion_standard`. “输出物与数据” is the only editor for producer and consumer relationships. Historical `trigger`, `input_description`, `output_description`, and behavior-side data references remain lossless and are never normalized on import.
- As of 2026-08-10, 3001 data availability follows explicit non-loop graph reachability, never `behaviors[]` order. A behavior cannot consume its own output; an earlier behavior cannot consume later output; unordered parallel siblings cannot consume each other; a downstream join may consume branch output. Inbound handoff data is available from its anchor, returned handoff data from its resume behavior, and explicit loop edges do not relax the rule. Selectors, export warnings, and scoring share `dataFlowConsistencyDetails()`; historical invalid references are preserved and warned until the user edits that relationship.
- As of 2026-08-10, `parallel_split` is displayed as “并行开始（同时启动多条路线）”, `parallel_join` as “并行汇合（等待多条路线完成）”, and `relation_type=parallel` as “并行路线”. A split needs two distinct outgoing route targets. A join needs two distinct sources; a returning outbound handoff whose resume behavior is the join counts as one source. Export warnings and scoring share the same counter.
- As of 2026-08-10, the 3001 business-flow sidebar projects local behaviors, control nodes, and handoffs by `handoff_direction` plus `anchor_behavior_ref`; `resume_behavior_ref` records where a returning handoff resumes. Flow relations and data objects retain selector-sidebars and stable-reference reordering. Handoffs have no independent order editor and do not use ordinary flow relations to duplicate their sequence.
- As of 2026-07-06, the structured-output service recognizes common procedure-file `工作程序` sections as workflow-step sources and filters standalone trigger-condition lists such as `下列/包括` items out of editable steps.
- As of 2026-07-27, “能力域” and “业务能力” are optional classification results in 3001. They may remain unclassified and never block draft export or PMO review.
- As of 2026-07-06, the structured-output service uses field-level lexicons for `trigger_scene`, `precondition`, `input_materials`, `output_result`, and `execution_standard`, informed by a `docs/norms` sample pass across 237 readable files / 17,469 sentences and guarded by real Word fixtures for corrective action, vehicle use, and furnace handoff documents.
- As of 2026-07-27, 3001 directly creates blank processes and exports `process-governance-v1`. New behavior/node type defaults blank. Historical multi-process v2 files are split into in-memory candidates and exported one process per file; unconvertible evidence and extra role bindings are preserved as a legacy supplemental reference.
- As of 2026-07-07, MDM MySQL identity passwords are owned by `user_accounts`. `init:mysql` and service startup must not overwrite existing `user_accounts.password_hash` or `must_change_password` from the legacy `users` table; if a user reports that a changed password no longer works after restart, first check the legacy-to-person identity migration path.
- As of 2026-07-28, 3001 selects each business behavior's current execution position from `docs/organization/花名册.md` through local `/api/enums`; it saves a concrete choice as department plus position and `全公司通用` as `全公司`. No department or position is selected by default. Imported unlisted values and roster-load failures never clear existing data.
- As of 2026-07-28, the 3001 execution-department selector lists every organization department. A selected department equal to the process owner is in-department execution; a different selected department is cross-department execution. The position selector contains only positions assigned to the selected department by `docs/organization/花名册.md`. 3001 preserves the roster assignment even when a position name appears organizationally surprising; HR must correct the roster truth source rather than 3001 guessing a different department.
- As of 2026-07-28, ordinary 3001 editing does not create or edit formal `work_role` values. New behaviors use `work_role: null`; legal imported work roles remain hidden and are re-exported with their behavior binding. Work roles remain distinct from positions, people, and RBAC roles, and full names retain behavior plus duty, such as “费用审核行为的审核角色”.
- As of 2026-07-10, 3001 treats explicit workflow field groups headed by `行为N` or `业务行为N` as authoritative within their workflow section. It maps `执行角色 / 触发场景 / 前置条件 / 输入(材料) / 输出(结果) / 执行标准` directly with field-level source evidence, suppresses duplicate natural-language step splitting in that section, normalizes only department-position dash separators, and preserves source wording or mistakes for user review.
- As of 2026-07-09, PMO task truth source rows may use `受控交付物编号` to generate an explicit `deliverableId`. Use it when a planned deliverable must bind to a specific `pmo/deliverables/DLV-XXX-*.md` canonical file or when automatic sequential IDs would collide with existing controlled deliverables.
- As of 2026-07-16, formal work roles are governed by HR in `docs/organization/工作角色目录与岗位映射.md` and generated read-only to `docs/work-role-data.json`. Codes are sequential `WR-0001` values assigned only after HR confirmation; the initial directory is intentionally empty. Work roles are distinct from source role wording, roster positions, people, and MDM project governance/RBAC roles.
- As of 2026-07-27, work-role details, cross-department input and returned data, internal process calls, countersign target departments, candidate data objects, and form entry structure are carried by `process-governance-v1`. The current 3000 does not accept this contract; only PMO-approved JSON may be manually uploaded after the planned 3000 refactor.
- As of 2026-07-28, DeepSeek and CC Switch assistance remain removed from 3001, including UI requests, service configuration, health output, and network calls. The business page no longer displays the model-retirement notice or the general notice about 3001 statelessness, 3000 communication, and offline review; those boundaries remain enforced through product and technical rules.
- As of 2026-07-28, 3001 checks `/api/schema` on page load and before new-process creation or export. If a newly loaded frontend is served by a stale backend process, the page must preserve current in-memory work and instruct the user to keep the page open while port 3001 is restarted. HTML or other non-JSON API responses must be converted into an actionable service/version message instead of exposing a JSON parse error; legacy contract errors must not be reported as broken technical references.
- As of 2026-07-28, 3001 exposes the server-owned blank `process-governance-v1` template, Git commit, and schema digest, and listens on `0.0.0.0:3001` by default for direct company-LAN access. It is independent of DeepSeek, `apps/structure-assistant`, and any authentication gateway; optional pilot scripts must not stop, rebind, or manage 3001. The browser page no longer carries a second blank-contract implementation.
- As of 2026-07-29, the 3001 business-behavior sidebar can move items up or down by swapping `behaviors[]` order while preserving every stable reference. Export-check business warnings are clickable non-blocking items that locate and highlight the related editor field or card; only schema or technical-reference damage remains an export blocker.
- As of 2026-07-29, a process-internal loop is a triggered relationship back to an existing earlier behavior, not a separate node that must follow a decision. Decision-outlet checks count outgoing sequence, condition, loop, and cross-department handoff paths; explicit loops are excluded from mainline entry/exit counts so “reject and return / approve and hand off” is recognized as two outlets.
- As of 2026-07-29, 3001 keeps an always-visible plain-language comparison at the top of the flow-relations editor: a conditional branch moves forward to a later handling step, while an internal loop returns to an existing earlier step for rework. The explanation appears once regardless of relation count, stacks on mobile, and the diagram legend repeats the forward-arrow versus “回路” return-arrow distinction without changing JSON or graph logic.
- As of 2026-07-28, the four-account AI pilot is implemented in `apps/structure-assistant/`, separate from 3001. It uses one centrally deployed Infomat checkout, DeepSeek V4 Flash for fill dialogue and V4 Pro for independent structural review, four server-side keys, no business-content persistence, authenticated HTTPS access, and pre/post model-call commit plus schema-digest checks.
- The structure assistant only reviews structure. Deterministic schema/type/enum/local-reference errors cannot be dismissed; field-placement and object-splitting suggestions may remain unchanged only with a recorded reason. Review records stay separate from `process-governance-v1`.
- As of 2026-07-29, independent structural review imports, updates, previews, and downloads the same `process-governance-v1` document rather than creating a review-specific format. The page keeps issue handling on the left and synchronized structured content, exact JSON, and the existing 3001 read-only cross-functional diagram on the right; review opinions and dispositions remain separate from the JSON.
- As of 2026-07-29, the MDM-AI assistant can import a partially completed `process-governance-v1` JSON from the fill page's optional-material area and continue editing it as the current in-memory draft. Import clears the previous dialogue, field statuses, and text materials. Fill dialogue asks one main question per turn and follows each business-behavior branch until actor department and position, actual work, forms or records and all items, data origins, data destinations, triggers, conditions, timing, completion, and onward routing are explicitly confirmed, temporarily unknown, or not applicable. Current validation errors and prior field statuses are included in each model turn; ordinary fill dialogue must not create formal `work_role` values.
- As of 2026-08-10, 3001's stateless cross-functional preview places each cross-department todo node in the receiving department swimlane, or in “承接部门待明确” when unknown. Dashed hollow arrows connect the local anchor to the todo and, when required, the todo to the resume behavior. Solid local flows, historical internal calls, no inferred arrows, no graphical editing, and no persisted coordinates remain unchanged.
- As of 2026-08-10, imported external-department ordinary behaviors remain untouched on import and are labeled as duplication created by the old page, not user error. A user-confirmed merge wizard keeps the local initiating behavior, reuses one matching outbound handoff or creates one, merges the external action plus return data/resume location, then removes duplicate handoffs, the external behavior, and its ordinary relations only on a deep copy. Conflicts require explicit choices; multiple branches, formal work roles, countersign data, internal calls, or unsafe references block the merge. The current draft changes only after `/api/validate` succeeds, and the source file is never modified.
- As of 2026-07-28, 3001's business page no longer exposes reference-material upload, drag/drop, editing, or missing-reference prompts. New templates keep `reference_materials: []`; valid historical references imported from JSON remain hidden in memory and survive re-export. The deterministic parser and upload endpoint remain only for historical migration and regression tests.
- As of 2026-07-28, 3001 text editing is split into basic information, purpose and scope, terms, process steps, forms and records, and export checks. Sidebar labels update without replacing the active form control, preventing adjacent-field input from being lost during blur-driven rerenders.
- As of 2026-07-28, `behaviors[].behavior_name` remains the primary business behavior or node name used by diagrams, relations, and work-role binding. The optional `behaviors[].behavior_description` stores “具体做什么” as the verbatim account of actual work inside that coarse behavior: data inputs and outputs, calculation and checking, off-process judgment, actual practices, exceptions, and work concerns. It supports later evidence-linked decomposition into data chains, decision chains, pain points, and bottlenecks; 3001 keeps the input lightweight, does not show it in diagram nodes, and never replaces or rewrites the original text. Previous v1 and legacy v2 imports without this field receive an empty string only in current-page memory, with no inferred or copied content.
- As of 2026-07-23, `process-evidence-mapping` accepts only directly readable sources and must block images, scan-only PDFs, conversion failures, and empty extractions; it must not invoke image-to-text conversion or infer unreadable content. Its canonical machine output is `artifacts/process-input-baseline-review/<run-id>/document-structured-output-v2.json`, validated against `docs/contracts/document-structured-output.schema.json`; legacy review-item files and Markdown are intermediate or derived only, and the skill never emits a formal structure-block projection.
- As of 2026-07-24, `technical-chinese-writer` is the repository source for controlled Chinese technical, business, and management writing. Ordinary replies receive a lightweight fact, subject, and terminology check; formal deliverables receive the full controlled-writing review. `humanizer-zh` is explicit-only and cannot replace the controlled-writing pass, while the English `humanizer` skill is removed.
- As of 2026-07-28, Chinese user-facing text must not call schemas, interfaces, configuration, or tests “合同” or “契约”. Use plain terms such as “结构规则”, “接口约定”, “固定配置”, and “版本一致性检查”. Real procurement, labor, customer, and other business contracts keep their original names; stable paths, fields, and error codes are not renamed for wording alone.
- As of 2026-07-28, every 3000 or 3001 version update must assess and handle legacy-data migration as part of the same change. 3000 uses controlled migration or compatible reads for persisted data, with backup, idempotency, rollback or compensation, and post-migration verification. 3001 migrates supported historical JSON only in current-page memory and remains stateless. Neither application may silently discard, clear, guess, or default incompatible old content; an update is not complete until migration or compatibility tests and recovery instructions pass.
- As of 2026-07-27, department contact, meeting, action-item, adjustment, escalation, completion-confirmation, data-submission, and responsibility-pool execution rules are governed by `pmo/信息化项目_协同工作规则.md`; the current department roster is maintained separately in `pmo/信息化项目_部门主备对接人名单.md`.
- The first roster remains pending project decision-group confirmation. The current roster source contains eight named main contacts; the business-development main contact and all backup positions remain blank. Do not infer any blank position from historical informationization-group or specialist-group lists. The project lead proposes each main contact, each department head proposes the backup, and the project decision group confirms the final roster.
- The weekly informationization meeting is Thursday 13:30-14:00. The suggested main-contact allocation is at least 1 hour per day or 5 hours per week, including meeting and training time; it is not a mandatory work-hour or personal performance measure, and the PMO must not create duplicate time sheets or routine reports.
- Departments own the truthfulness, completeness, and accuracy of submitted data. The PMO no longer appoints departmental data-quality officers; the data-quality working group retains rule-setting, cross-department consistency checks, sampling, and audit responsibilities.
- As of 2026-07-31, 3000 uses fixed governance model `rbac-raci-v3-2026-07-31`. The seven role codes and `person -> user_accounts -> person_roles` identity chain remain fixed; `admin` manages identity but all governance business writes return 403. Each role has read-only `visibleTabs`, and multi-role accounts use the union without custom menu permissions. MDM has one process-governance entry with process editing, cross-department handoff todos, and handoff-conflict todos. Full `process-governance-v2` JSON in MySQL is the editing source of truth, while handoff/todo tables are governance projections; saves require `expected_revision`. 3001 remains an active stateless service: MDM accepts its v1/v2 files and saves/exports v2, but does not stop, proxy, or manage 3001.
