# Minimal Vector Evidence Example

Use this regression example when retrieval suggests object aliases, approval or
handoff facts.

## Source Fragments

```text
文件：GLTX-JY-05《月度绩效管理办法》§5.2
经营发展部编制公司月度综合打分表，提交部门负责人校对后，报公司领导批准。

附件1：公司月度综合打分表
字段：部门、评分项、得分、校对人、批准人。

§5.3
各部门于每月3日前反馈绩效评分数据。
```

## Retrieval Candidate

```json
{
  "query": "绩效结果 评分表 核算结果",
  "retrieved_candidates": [
    {
      "chunk_id": "GLTX-JY-05#5.2",
      "raw_text": "经营发展部编制公司月度综合打分表...",
      "retrieval_score": 0.86,
      "candidate_claim": "绩效结果可能与公司月度综合打分表相关",
      "evidence_status": "pending_review",
      "review_required": true,
      "allowed_downstream_use": "review_only"
    }
  ]
}
```

## Correct Handling

| Item | Status | Reason |
|---|---|---|
| `综合打分表` and `公司月度综合打分表` | verified | Attachment title and clause object match |
| `绩效结果` equals `公司月度综合打分表` | pending_review | Similar wording only |
| `核算结果` equals `公司月度综合打分表` | source_missing | Phrase is absent |
| Approval chain for `公司月度综合打分表` | pending_review | Same object shows prepare, check and approve, but human confirmation is still required |
| Input from `各部门` | pending_review | Transfer clue exists, but the generic group needs confirmation |
| Output to company leader | not a handoff | Approver is not an output department |

## Wrong Handling

- Do not merge objects because vectors are close.
- Do not write an approver as an output department.
- Do not set an approval conclusion from an abstract action.
- Do not map source-company departments by semantic similarity.

## Expected v2 Result

- Evidence enters `evidence_catalog[]` with `status=pending_review`.
- Candidate fields enter `processes[]`, `steps[]` or `behavior_details[]`.
- Unresolved object, approval and handoff facts enter `pending_issues[]`.
- `cross_dept_handoffs[]` stays empty until the concrete object and both parties
  are confirmed.
