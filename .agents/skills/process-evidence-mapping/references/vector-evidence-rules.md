# Vector Evidence Rules

Use these rules when embeddings, semantic search, nearest-neighbor retrieval, or alias clustering helps with Infomat process evidence work.

## Core Rule

Embeddings are retrieval aids only. They may surface candidate evidence, but they never prove a business fact.

Final conclusions must be verified against original source anchors:

- clause number and excerpt
- table name, row, column, and cell excerpt
- form name, field group, or signature block
- flowchart node, edge, or swimlane
- ledger field, handoff record, signature, notice, issuance, feedback, or receipt
- attachment number/title and excerpt

If no source anchor is available, write `候选，未见可核验原文定位`.

Extraction repair is not source evidence. If extracted text is broken, such as `公司 月综合打分表`, keep the broken `raw_text`, mark `extraction_quality=partial`, and use any `normalized_candidate` only to find the original source location. Cite the clean original clause/table after review, not the repair hint.

## Allowed Uses

Embedding retrieval may recommend:

- candidate clauses, table rows, form fields, ledgers, flow nodes, and attachments
- candidate object aliases
- candidate similar L3/A1 coverage gaps
- candidate approval-chain snippets
- candidate controlled-transfer snippets
- candidate near-duplicate files or older/reference versions
- candidate source-company organization names needing boundary checks
- candidate domain attributes to strip, such as `装配`

All retrieved items default to `evidence_status=candidate` and `review_required=true`.

## Forbidden Uses

Do not use embedding similarity alone to conclude:

- two object names are the same business object
- L3 or A1 is valid
- an input/output department relationship exists
- an approval type is `单人审批`, `多级审批`, `会签`, or `无审批`
- a source-company organization maps to a current company department
- a source document belongs to the target department
- assembly or other domain-specific logic is transferable
- a Sankey node or link may enter the formal chart

## Evidence Status

Use these statuses consistently:

| Status | Meaning | May enter final DCM/BBM/H5 |
|---|---|---|
| `confirmed` | Verified against original source location | Yes |
| `candidate` | Retrieved or suggested, not yet verified | No |
| `insufficient` | Some clues exist but source chain is incomplete | No |
| `no_evidence` | Search/read found no supporting source | No |
| `conflict` | Source fragments disagree | No |
| `excluded` | Reviewed and rejected | No |
| `pending_department_confirmation` | Needs department/business confirmation | Review draft only |

Do not use `confidence` as a substitute for evidence status. `retrieval_score` is only a ranking signal.

## Same Object Rule

Semantic similarity does not prove object identity. Object names may be merged only when source evidence proves the same object chain through at least one of:

- explicit wording such as `以下简称`
- same form or attachment number
- same table title and field set
- same signature block or approval chain
- same flowchart output node
- same ledger lifecycle/status fields
- clear contextual reference in the same source file
- cross-file reference by document number, form number, or attachment number

Otherwise write `对象别名候选，未见同一对象链路证据，待确认`.

For GLTX-JY-05-like cases, `绩效结果`, `核算结果`, and `公司月度综合打分表` remain alias candidates until the same form number, table title, field set, signature block, flow output, or explicit clause proves the object chain.

## Controlled Transfer Rule

Embeddings may retrieve possible transfer fragments. `输入来源部门` and `输出目标部门` may be filled only when the source proves controlled transfer of a concrete object between departments.

Controlled transfer evidence includes:

- clauses saying one department submits/reports/issues/feeds back a named object to another
- flowchart arrows between swimlanes
- form routing or signature fields showing department handoff
- ledger handoff, receipt, sign-off, or feedback fields
- notice, issuance, distribution, receipt, or return records

The following are not transfer evidence by themselves:

- basis/reference documents
- responsibility ownership
- collaboration participants
- approval actors
- archive recipients
- external customers, suppliers, banks, agencies
- semantic similarity to another department's work

Otherwise write `未见受控传递证据，待补`.

## Approval Type Rule

Approval type must be determined from the approval/control chain of the same output object. Embeddings may retrieve approval-related words, but final approval type must cite source chain evidence.

Preparation actions such as `编制`, `填写`, `汇总`, or `形成` identify the object chain; they do not prove approval type. Abstract actions such as `确认`, `处理`, `跟踪`, or `形成结果` do not prove approval type.

If the output-object approval chain is incomplete, write `审批链未闭合，待确认`.

## Source Company Boundary Rule

If `source_company` differs from the target company, raw `source_org_name` values are source-file roles only. They must not enter `部门（D1）`, `输入来源部门`, or `输出目标部门` unless a controlled organization-mapping source exists.

For 沈飞民机 materials used in 昌兴复材 mapping, write `源公司组织名，未见昌兴复材部门映射证据，待确认` unless the mapping has been confirmed.

## Portable Process Abstraction Rule

Domain attributes such as `装配` may be stripped only as a candidate abstraction. Preserve:

- original title and path
- original object/action
- stripped attribute
- candidate portable logic
- missing target-company confirmation

Do not transfer source-specific forms, roles, departments, approval chains, or controlled-transfer chains as target-company facts.

