# MDM Document Form Structure Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild document structured output form handling so users can define forms, a required main table, an optional detail table, fields, archival rules, and department-role responsibility without confusing free-text or duplicate table concepts.

**Architecture:** Keep the existing Express + MySQL + single-file frontend shape. Extend the existing process-design MySQL tables instead of adding a parallel truth source; new form fields are unified in `process_design_form_table_fields` with `structure_kind=main/detail`. Existing legacy form records are shown as read-only reference when needed, but are not migrated or kept editable through the old UI.

**Tech Stack:** Express.js, MySQL, vanilla HTML/CSS/JS in `apps/mdm-platform/public/index.html`, Node test scripts, Playwright CLI.

**Implementation Status (2026-07-03):** Core behavior is implemented: related-department checkboxes with `全公司`, form/main/detail/field MySQL structure, generated form and field codes, field type dictionary, roster-derived archive responsibility roles, form/detail/field delete, field reorder, publish validation, Markdown/schema/docs, fixed-start smoke, and Playwright screenshot. Deferred deliberately: old draft code compaction and a full edit-mode UX for existing form metadata; current editable flow supports adding, deleting, detail maintenance, field deletion, and field ordering.

---

## File Map

- `apps/mdm-platform/server/mysqlSchema.js`: add new columns and dictionary table definitions for process-design forms, form tables, and table fields.
- `apps/mdm-platform/server/routes/processDesignMysql.js`: add migrations, field type dictionary API, roster-derived department-role API, form numbering, main/detail table rules, field CRUD, delete/reorder behavior, and publish validation.
- `apps/mdm-platform/public/index.html`: replace related-department multiselect with checkbox group; replace old form/table/field UI with form list plus current form field maintenance.
- `apps/mdm-platform/scripts/test-process-design-mysql-api.js`: TDD API coverage for form numbering, main/detail rules, archival rules, roster role lookup, field CRUD, and validation.
- `apps/mdm-platform/scripts/test-process-governance-frontend.js`: TDD frontend coverage for checkbox departments, removed fields, new form UI, field actions, and readonly old-structure references.
- `apps/mdm-platform/README.md`: update document structured output behavior.
- `apps/mdm-platform/docs/role-based-usage-guide.md`: update operator-facing usage.
- `docs/glossary.md`: update terminology for form/main/detail/field numbering and department-role responsibility.
- `docs/contracts/document-structured-output.schema.json`: update structured output contract for form code, main table, optional detail table, fields, and archive rules.

---

## Decisions Locked From Grill-Me

- `涉及其他部门` becomes a checkbox group. Multiple concrete departments can be checked; `全公司` is exclusive and stores `["全公司"]`.
- Form model: `表单 -> 主表/可选明细表 -> 字段`.
- Form code is system-generated: `FM-{制度编号}-{版次}-{三位序号}`.
- Main table always exists and has a required editable name, default `主表`.
- Detail table is optional, must be explicitly created before detail fields can be added, only one detail table per form, and must have a name.
- Field code is system-generated and hidden in editing UI: `{form_code}-M-001` or `{form_code}-D-001`.
- In `draft` before first submission, deleting forms may compact form and field codes. After submission and in `needs_changes`, numbers stay locked.
- Forms must point to a non-voided business behavior.
- Archive location values: `部门自行保存`, `资料室`.
- Retention period values: `1年`, `3年`, `10年`, `永久`.
- Archive responsibility is `归档责任部门 + 归档责任角色`. Department comes from all company departments; role comes only from roster-derived positions for that department.
- If archive location is `资料室`, default department is `工程技术部`; if `部门自行保存`, default department is the draft department. Auto defaults do not overwrite manual changes; a button can reapply defaults.
- Field types come from a dictionary API, seeded with `文本、长文本、数字、金额、日期、日期时间、枚举、布尔、部门、人员、文件编号、签名、图片、附件、二维码`. This round does not expose type maintenance.
- Old form data is not migrated. Legacy structures may be shown as readonly reference, but new publishing checks use the new structure.

---

## Tasks

### Task 1: Related Department Checkbox Group

- [ ] Write frontend test assertions that `pgDesignRelatedDepartments` is no longer a `select`, has checkbox inputs, keeps multiple concrete departments, and makes `全公司` exclusive.
- [ ] Run `npm --prefix apps/mdm-platform run test:process-governance-frontend`; expected failure on current select-based UI.
- [ ] Update `index.html` to render a checkbox group from `state.departments`, with `全公司` first and exclusive.
- [ ] Run `npm --prefix apps/mdm-platform run test:process-governance-frontend`; expected pass.

### Task 2: MySQL Schema And Dictionary

- [ ] Add failing API/schema tests for form code, main table name, archive location, retention period, responsible department/role, detail table name, `structure_kind`, field code, field dictionary including `二维码`.
- [ ] Run `npm --prefix apps/mdm-platform run test:process-design`; expected failure.
- [ ] Extend `mysqlSchema.js` and route startup migration code with additive columns and `process_design_field_types`.
- [ ] Seed default field types idempotently.
- [ ] Add `GET /api/process-design/field-types`.
- [ ] Add `GET /api/process-design/departments/:id/roster-roles`.

### Task 3: New Form And Table API

- [ ] Implement system form numbering and draft-only compaction.
- [ ] Create/update forms with: `step_id`, `form_name`, `main_table_name`, `archive_location`, `retention_period`, `responsible_department_id`, `responsible_department_name`, `responsible_role`.
- [ ] Remove editable `description` and free-text `archive_rule` from new UI/API behavior.
- [ ] Ensure each form points to a non-voided step in the same draft.
- [ ] Implement detail table create/update/delete: one detail table per form, name required, delete cascades detail fields.
- [ ] Keep legacy routes compatible only enough not to crash, but new UI uses new semantics.

### Task 4: Unified Field API

- [ ] Add field create/update/delete/reorder against `process_design_form_table_fields` for both `main` and `detail` structure kinds.
- [ ] Enforce main fields attach to the implicit main table and detail fields require an existing detail table.
- [ ] Generate field code from current form code and `M/D` sequence.
- [ ] Enforce enum field options when `field_type='枚举'`.
- [ ] Preserve numbers in `needs_changes`; compact only never-submitted draft forms.

### Task 5: Publish/Risk/Markdown/Preview

- [ ] Update risks and publish checks:
  - forms require non-voided step, form code, form name, main table name, archive location, retention period, responsible department, responsible role;
  - every form requires at least one main field;
  - detail table, if present, requires name and at least one detail field;
  - enum fields require enum options.
- [ ] Update Markdown and `content_json` to include form code, main table, optional detail table, hidden field codes, archive rules, and responsibility snapshot.
- [ ] Ensure old legacy structures are marked as reference only and cannot satisfy publish checks.

### Task 6: Frontend Redesign

- [ ] Remove form description, free-text archive rule, old table name/description inputs, and old separate data-field form.
- [ ] Add form list with generated code display, behavior link, archive summary, field counts, edit/delete/maintain fields.
- [ ] Add form editor: behavior select, form name, main table name, archive location radio/select, retention period radio/select, responsible department select, responsible role select, reapply default responsibility button.
- [ ] Add detail table section: create detail table, edit detail table name, delete detail table with confirm.
- [ ] Add field editor: structure kind, field name, type dictionary, required, description, enum options; add/edit/delete/reorder fields.
- [ ] Keep field codes hidden on edit screen; show them only in preview/Markdown.

### Task 7: Documentation And Validation

- [ ] Update README, role guide, glossary, and JSON schema contract.
- [ ] Run:
  - `npm --prefix apps/mdm-platform run test:process-design`
  - `npm --prefix apps/mdm-platform run test:process-governance-frontend`
  - `npm --prefix apps/mdm-platform run test:frontend`
  - `npm --prefix apps/mdm-platform run test:process-governance`
  - `npm --prefix apps/mdm-platform run test:mainline`
  - `npm run smoke:infomat-services`
- [ ] Playwright CLI verification on `http://127.0.0.1:3000/#/processGovernance?view=documentStructure`:
  - verify related-department checkbox multiple selection and `全公司` exclusivity;
  - create/open a draft;
  - create a form and verify generated code;
  - set archive defaults and roster role enum;
  - add main field;
  - create detail table and add detail field;
  - delete/reorder a field;
  - capture screenshot at `output/playwright/document-structured-output-form-structure-redesign.png`.

---

## Self-Review

- The plan covers every grill-me decision: checkbox departments, form numbering, main/detail separation, field CRUD, archival rules, roster role source, field type dictionary, validation, documentation, and Playwright.
- The plan intentionally does not implement a field type management UI or old-data migration.
- The plan uses additive schema changes only and keeps existing route names where practical to reduce blast radius.
