# Minimal Vector Evidence Example

Use this as a regression example when vector retrieval suggests object aliases or approval/transfer facts.

## Source Fragments

```text
文件：GLTX-JY-05《月度绩效管理办法》§5.2
经营发展部编制公司月度综合打分表，提交部门负责人校对后，报公司领导批准。

附件1：公司月度综合打分表
字段：部门、评分项、得分、校对人、批准人。

§5.3
各部门于每月3日前反馈绩效评分数据。
```

## Vector Retrieval ReviewItem

```json
{
  "query": "绩效结果 评分表 核算结果",
  "retrieved_reviewItems": [
    {
      "chunk_id": "GLTX-JY-05#5.2",
      "raw_text": "经营发展部编制公司月度综合打分表...",
      "retrieval_score": 0.86,
      "claim_reviewItem": "绩效结果可能与公司月度综合打分表相关",
      "evidence_status": "needs_review",
      "review_required": true
    }
  ]
}
```

## Correct Handling

| Item | Status | Reason |
|---|---|---|
| `综合打分表` and `公司月度综合打分表` | confirmed | Attachment title and clause object match |
| `绩效结果` equals `公司月度综合打分表` | reviewItem | Similar wording only; no explicit same-object source |
| `核算结果` equals `公司月度综合打分表` | no_evidence | The phrase does not appear in the sample source |
| Approval type for `公司月度综合打分表` | confirmed as `多级审批` | Same output object has `编制 -> 校对 -> 批准` |
| Input from `各部门` | reviewItem/needs decomposition | `反馈绩效评分数据` is a transfer clue, but `各部门` is a generic group and should be decomposed or confirmed |
| Output to company leader | not an output department | Approver is an approval actor, not an output target department |

## Wrong Handling

- Do not merge `绩效结果` and `公司月度综合打分表` because the vectors are close.
- Do not write company leader as `输出目标部门` just because the leader approves.
- Do not set approval type from an abstract action such as `确认`.
- Do not map source-company departments into current departments by semantic similarity.

## Correct A1 Notes

```text
对象别名待确认：
“绩效结果” ↔ “公司月度综合打分表”：向量召回待确认；未见同一表单/同一字段/上下文指代证据，待确认。

审批类型：
公司月度综合打分表：原文链路为“编制 -> 校对 -> 批准”，同一输出物存在多个控制节点，可标“多级审批”。

跨部门输入：
“各部门 -> 经营发展部”仅为待确认受控传递线索。需记录对象“绩效评分数据”和动作“反馈”，并确认是否允许泛称“各部门”或需拆解到具体部门。
```

