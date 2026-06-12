# Chunking Spec

This spec defines evidence chunks for vector retrieval. Chunks are retrieval units, not conclusions.

## Default Ollama Embedding Config

The default local embedding provider is defined in `ollama-embedding-config.json`:

- provider: `ollama`
- base URL: `http://127.0.0.1:11434`
- endpoint: `/api/embed`
- model: `qwen3-embedding:latest`
- dimensions: `1024`

The model, dimensions, chunking rule, and hash must be recorded in the embedding manifest. Rebuild embeddings when any of these change.

## Chunk Units

| Source type | Chunk unit |
|---|---|
| Markdown/text | heading + paragraph group or table row |
| Word body | clause/heading + paragraph group after extraction |
| Word table | table name + row + header/cell values |
| Excel | sheet + header + row |
| Form/template | form name + field group + signature block |
| Ledger | ledger name + row/status/handoff fields |
| Flowchart | node, edge, swimlane, decision, approval node |
| Attachment | attachment title/number + fields/instructions |
| Image/OCR | OCR block + manual review status |

For binary Office/PDF/VSD sources, first extract text, tables, or flow descriptions with an appropriate converter. If extraction fails, create a manifest entry with `extraction_status=failed` or `待复核`; do not silently skip it.

## Required Chunk Fields

Every chunk should contain:

| Field | Meaning |
|---|---|
| `chunk_id` | Stable chunk ID |
| `source_file_id` | Stable source file ID |
| `source_file` | Repository-relative source path |
| `source_file_name` | File name |
| `leaf_dir` | Deepest source directory |
| `doc_no` | Document number, if known |
| `version` | Revision/version, if known |
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
| `raw_text` | Original excerpt |
| `normalized_text` | Search-only normalized text |
| `artifact_type` | body/table/form/ledger/flow/attachment/ocr |
| `retrieval_method` | chunking/vector/keyword/rule/manual |
| `retrieval_score` | Similarity or ranking score, if any |
| `evidence_status` | confirmed/candidate/insufficient/no_evidence/conflict/excluded |
| `review_required` | true/false |
| `review_reason` | Why review is needed |
| `content_hash` | Source content hash |
| `chunk_hash` | Raw text hash |

## Candidate Output Rules

Retriever output must not look like final mapping. Candidate records must include:

- `claim_type`
- `claim_text`
- `supporting_chunk_ids`
- `retrieval_method`
- `retrieval_score`
- `evidence_status`
- `review_required`
- `allowed_downstream_use`

Default `allowed_downstream_use` is `review_only`. Change it only after source verification.
