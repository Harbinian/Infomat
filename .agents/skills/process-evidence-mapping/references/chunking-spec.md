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

Generated mapping deliverables, governance reports, and helper outputs are not source evidence for vector retrieval. Exclude canonical mapping Markdown, MDM requirement Markdown, department Sankey HTML, `docs/norms/流程治理/`, `_quality-report.md`, `README.md`, `CLAUDE.md`, `_extracted/`, scripts, and ECharts assets from production evidence chunks unless the user explicitly requests an audit of generated outputs.

When running this broad production pass, do not extract Visio content unless the user explicitly asks for a visual-flow专项抽取. Keep Visio files in the source index as deferred visual material:

```powershell
node .agents/skills/process-evidence-mapping/scripts/extract-evidence-chunks.mjs --input docs/norms --out artifacts/evidence-index/<run-id>/chunks.jsonl --defer-ext .vsd,.vsdx --defer-reason "本轮取消Visio内容提取；按解释性图表登记，后续如需流程图证据再人工目视或专项抽取。"
```

Deferred Visio files must remain in `source_index.jsonl` with `extraction_status=deferred`; do not infer DCM/BBM facts from these diagrams unless they are later reviewed as original visual evidence.

For scan-only PDF and image sources, run the repository OCR wrapper first:

```powershell
node scripts/ocr-source.mjs --input <file-or-dir> --out artifacts/ocr/<run-id>
```

OCR blocks remain review-only source text with `evidence_status=ocr_extracted_not_confirmed`. They can be chunked for retrieval, but downstream mapping fields require original visual source review before use.

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
| `normalized_review_text` | Search-only repair/alias hint; not a source quote |
| `artifact_type` | body/table/form/ledger/flow/attachment/ocr |
| `extraction_method` | Tool/path used to extract the text |
| `extraction_quality` | clean/partial/failed/needs_ocr |
| `retrieval_method` | chunking/vector/keyword/rule/manual |
| `retrieval_score` | Similarity or ranking score, if any |
| `evidence_status` | confirmed/reviewItem/insufficient/no_evidence/conflict/excluded |
| `verification_status` | unverified/source_checked/rejected/confirmed |
| `review_required` | true/false |
| `review_reason` | Why review is needed |
| `allowed_downstream_use` | review_only unless source-verified |
| `content_hash` | Source content hash |
| `chunk_hash` | Raw text hash |

## Extraction Quality

Use these values:

| Value | Meaning |
|---|---|
| `clean` | Extracted text is usable for review, subject to normal source checking |
| `partial` | Missing words, broken spaces, template blanks, underscores, or suspected extraction damage |
| `failed` | Extraction failed; no text chunk can support a reviewItem |
| `needs_ocr` | Scan-only PDF/image or visual source requiring OCR/manual reading |

When a chunk is `partial`, preserve `raw_text` exactly and put repair hints only in `normalized_review_text`.
For example, `raw_text=公司 月综合打分表` may have `normalized_review_text=公司__月综合打分表 / 公司月度综合打分表待确认`.
Do not cite the reviewItem as the final source sentence; use it to locate a cleaner original clause or table.

## ReviewItem Output Rules

Retriever output must not look like final mapping. ReviewItem records must include:

- `claim_type`
- `claim_text`
- `supporting_chunk_ids`
- `retrieval_method`
- `retrieval_score`
- `evidence_status`
- `review_required`
- `allowed_downstream_use`

Default `allowed_downstream_use` is `review_only`. Change it only after source verification.

ReviewItem records should also include `relation_type`:

- `object_alias_review`
- `approval_chain_review`
- `controlled_transfer_review`
- `archive_or_retention`
- `responsibility_or_participation`
- `reference_basis`
- `extraction_quality_issue`
