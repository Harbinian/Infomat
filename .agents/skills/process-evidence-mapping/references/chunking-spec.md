# Chunking Spec

This spec defines traceable evidence chunks used to build a
`document-structured-output-v2` review draft. A chunk is a retrieval unit, not a
business conclusion.

## Readability Gate

Accepted sources must expose text or structured cells directly:

- Markdown, text, CSV, JSON and HTML
- Word body text and tables
- Excel sheets and cells
- text-based PDF pages
- Visio text, nodes and edges when a supported converter can read them

Image files, scan-only PDF pages and any source without directly readable text
are blocked. The skill must not convert images into text, guess their contents
or silently omit them. The source manifest records `blocked_unreadable`, and the
workflow stops until the material owner supplies a machine-readable original or
a manually confirmed text version.

If an otherwise readable file contains an embedded diagram that cannot be
extracted, record the visual gap in `chunking_warnings.md`; do not infer facts
from that diagram.

## Default Ollama Embedding Config

The optional local embedding provider is defined in
`ollama-embedding-config.json`:

- provider: `ollama`
- base URL: `http://127.0.0.1:11434`
- endpoint: `/api/embed`
- model: `qwen3-embedding:latest`
- dimensions: `1024`

The model, dimensions, chunking rule and source hash must be recorded in the
embedding manifest. Rebuild embeddings when any of them changes.

## Chunk Units

| Source type | Chunk unit |
|---|---|
| Markdown/text | heading + paragraph group or table row |
| Word body | clause/heading + paragraph group after extraction |
| Word table | table name + row + header/cell values |
| Excel | sheet + header + row |
| Form/template | form name + field group + signature block |
| Ledger | ledger name + row/status/handoff fields |
| Flowchart | directly readable node, edge, swimlane, decision or approval text |
| Attachment | attachment title/number + fields/instructions |

Generated mapping deliverables, governance reports and helper outputs are not
source evidence. Exclude canonical mapping Markdown, MDM requirement Markdown,
department Sankey HTML, `docs/norms/流程治理/`, `_quality-report.md`, `README.md`,
`CLAUDE.md`, `_extracted/`, scripts and ECharts assets unless the user explicitly
requests an audit of generated outputs.

Visio may be deferred without extraction:

```powershell
node .agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs --input docs/norms --out artifacts/evidence-index/<run-id>/chunks.jsonl --defer-ext .vsd,.vsdx --defer-reason "本轮不读取Visio内容；仅登记来源，不形成结构化候选。"
```

Deferred files remain in `source_index.jsonl` with
`extraction_status=deferred`; they do not support a structured field.

## Required Chunk Fields

Every chunk should contain:

| Field | Meaning |
|---|---|
| `chunk_id` | Stable chunk ID |
| `source_file_id` | Stable source file ID |
| `source_file` | Repository-relative source path |
| `source_file_name` | File name |
| `leaf_dir` | Deepest source directory |
| `doc_no` | Document number, if directly readable |
| `version` | Revision/version, if directly readable |
| `source_company` | Raw/source company if known |
| `source_org_name` | Raw organization names if extracted |
| `clause` | Clause number |
| `clause_title` | Heading/title |
| `page_no` | Page number if available |
| `paragraph_id` | Paragraph or block ID |
| `table_id` | Table ID |
| `row_id` | Row ID |
| `column_name` | Header/column name |
| `sheet_name` | Excel sheet |
| `form_name` | Form/template name |
| `form_field` | Form field |
| `signature_block` | Signature/approval field group |
| `flow_id` | Flowchart ID |
| `flow_node_id` | Flow node ID |
| `flow_edge_id` | Flow edge/arrow ID |
| `swimlane` | Swimlane/role |
| `raw_text` | Directly extracted source excerpt |
| `normalized_text` | Search-only normalized text |
| `normalized_review_text` | Search-only repair/alias hint, never a source quote |
| `artifact_type` | body/table/form/ledger/flow/attachment |
| `extraction_method` | Direct extraction tool/path |
| `extraction_quality` | clean/partial/failed/blocked_unreadable |
| `retrieval_method` | chunking/vector/keyword/rule/manual |
| `retrieval_score` | Ranking score, if any |
| `evidence_status` | pending_review/review_only/source_missing/verified |
| `verification_status` | unverified/source_checked/rejected/confirmed |
| `review_required` | true/false |
| `review_reason` | Why review is needed |
| `allowed_downstream_use` | review_only unless source-verified |
| `content_hash` | Source content hash |
| `chunk_hash` | Raw text hash |

## Extraction Quality

| Value | Meaning |
|---|---|
| `clean` | Directly extracted text is usable for review |
| `partial` | Text has broken spaces, template blanks or suspected extraction damage |
| `failed` | Converter failed; the workflow blocks |
| `blocked_unreadable` | No directly readable text; the workflow blocks |

Preserve `raw_text` exactly. Repair hints belong only in
`normalized_review_text` and may only help locate a clean source excerpt.

## Candidate Output Rules

Retriever output must not look like a final mapping. Candidate records include:

- `claim_type`
- `claim_text`
- `supporting_chunk_ids`
- `retrieval_method`
- `retrieval_score`
- `evidence_status=pending_review`
- `review_required=true`
- `allowed_downstream_use=review_only`

Candidate relation types are:

- `object_alias_review`
- `approval_chain_review`
- `controlled_transfer_review`
- `archive_or_retention`
- `responsibility_or_participation`
- `reference_basis`
- `extraction_quality_issue`
