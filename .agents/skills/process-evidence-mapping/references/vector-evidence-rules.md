# Vector Evidence Rules

Use these rules when embeddings or semantic retrieval help locate process
evidence.

## Core Rule

Embeddings are retrieval aids only. They may surface candidates, but they never
prove a business fact.

Final conclusions must be verified against a directly readable source anchor:

- clause number and excerpt
- table name, row, column and cell excerpt
- form name, field group or signature block
- directly readable flowchart node, edge or swimlane
- ledger handoff, receipt, sign-off or feedback field
- attachment number/title and excerpt

If no source anchor is available, emit a `来源证据不足` pending issue. Broken
extraction text stays in `raw_text`; a repair hint may only help find a clean
source location.

## Allowed Uses

Embedding retrieval may recommend candidates for:

- clauses, table rows, form fields, ledgers, flow nodes and attachments
- object aliases
- L3/A1 coverage gaps
- approval-chain snippets
- controlled-transfer snippets
- near-duplicate or older/reference files
- source-company organization names needing boundary checks
- domain attributes that might be stripped during abstraction

All retrieved records use `evidence_status=pending_review`,
`review_required=true` and `allowed_downstream_use=review_only`.

## Forbidden Uses

Do not use similarity alone to conclude:

- two names identify the same business object
- an L3 or A1 is valid
- an input/output department relationship exists
- an approval type is single approval, multi-level approval, countersignature or no approval
- a source-company organization maps to a current company department
- a document belongs to the target department
- source-specific business logic is transferable
- a candidate may enter a formal structure block

## Evidence Status

Use the current document structured-output vocabulary:

| Status | Meaning | May support formal projection |
|---|---|---|
| `verified` | Human-confirmed against a directly readable source location | Yes |
| `pending_review` | Extracted or retrieved and awaiting review | No |
| `source_missing` | Required source location is absent | No |
| `review_only` | Context or retrieval hint only | No |

Do not use confidence or retrieval score as a substitute for evidence status.

## Same Object Rule

Semantic similarity does not prove object identity. Names may be merged only
when a directly readable source proves the same object chain through at least
one of:

- explicit wording such as `以下简称`
- same form or attachment number
- same table title and field set
- same signature block or approval chain
- same flowchart output node
- same ledger lifecycle/status fields
- clear contextual reference in the same source file
- cross-file reference by document, form or attachment number

Otherwise create an `原文定义不足` pending issue for the object alias.

## Controlled Transfer Rule

Create a cross-department handoff candidate only when a directly readable source
shows a concrete object moving between departments. Evidence includes:

- one department submits, reports, issues or feeds back a named object to another
- a directly readable flow arrow connects department swimlanes
- a form route or signature field shows the handoff
- a ledger contains handoff, receipt, sign-off or feedback fields
- a notice/distribution/receipt record names the object and parties

Responsibility ownership, collaboration, approval, archive destinations and
semantic similarity are not transfer evidence. Until both departments confirm
the object, action and acceptance standard, keep
`cross_dept_handoffs[]` empty and emit `跨部门承接待确认`.

## Approval Rule

Approval must be determined from the control chain of the same output object.
Preparation actions identify the object chain but do not prove approval type.
Abstract actions such as confirming, handling, tracking or producing a result do
not prove approval.

If the object-level chain is incomplete, emit an `原文定义不足` pending issue
against `behavior_details.approval_note`.

## Source Company Boundary Rule

If `source_company` differs from the target company, raw organization names are
source-file roles only. They must not enter department or handoff fields unless a
controlled organization-mapping source exists.

## Portable Process Abstraction Rule

Domain attributes may be stripped only as a candidate abstraction. Preserve:

- original title and path
- original object/action
- stripped attribute
- candidate portable logic
- missing target-company confirmation

Do not transfer source-specific forms, roles, departments, approvals or
handoffs as target-company facts.

