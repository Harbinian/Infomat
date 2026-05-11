# 第2、3章扩写实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `信息化系统应用与集成说明会.html` 中扩写第2、3章，作为会议开篇点题内容，用行业benchmark数据驱动前后对比。

**Architecture:** 单HTML文件修改，纯内容层扩写。第2章增加五维度行业对标矩阵，第3章增加系统攻坚矩阵和MDM说明，视觉复用现有CSS样式。

**Tech Stack:** 原生 HTML/CSS，ECharts CDN，localStorage（无新增依赖）

---

## 文件映射

- **Modify:** `docs/Demo/信息化系统应用与集成说明会.html`
  - 第2章（467-470行）：插入五维度行业对标矩阵和收束段落
  - 第3章（473-487行）：在 `.gauto` 系统卡片区之前插入系统攻坚矩阵，在系统卡片区之后插入MDM说明

---

## Task 1: 扩写第2章——公司数字化目标

**Target area:** `<div class="sec" id="s2">` (行467-470)

- [ ] **Step 1: 在现有 `.card` 之后插入五维度行业对标表格**

在第469行 `</div>` 之后插入：

```html
  <div class="tw" style="margin-top:16px">
    <table>
      <thead><tr><th>维度</th><th>行业平均水准</th><th>数字化目标</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td><strong>交付效率</strong></td><td style="color:var(--gray)">订单交付周期 45–60天；计划达成率 75–80%</td><td style="color:var(--green);font-weight:700">交付周期 ≤30天；计划达成率 ≥90%</td><td>复材件交付受适航取证约束，周期压缩空间有限，数字化重点在减少等待和返工</td></tr>
        <tr><td><strong>生产运营</strong></td><td style="color:var(--gray)">OEE 设备综合效率 55–65%；在制品周转 15–20天</td><td style="color:var(--green);font-weight:700">OEE ≥75%；在制品周转 ≤8天</td><td>复材固化曲线长、换料频次高，OEE提升依赖工艺数字化和设备 IoT</td></tr>
        <tr><td><strong>质量管控</strong></td><td style="color:var(--gray)">一次合格率 85–90%；返工率 8–12%；追溯覆盖率 ≤60%</td><td style="color:var(--green);font-weight:700">一次合格率 ≥95%；返工率 &lt;3%；追溯覆盖率 ≥98%</td><td>适航审查要求零件编号+质量编号全链路可查，追溯覆盖是硬门槛</td></tr>
        <tr><td><strong>数据协同</strong></td><td style="color:var(--gray)">主数据错误率 15–20%；跨系统一致率 60–70%；信息孤岛 5–8个</td><td style="color:var(--green);font-weight:700">主数据错误率 &lt;3%；跨系统一致率 ≥95%；信息孤岛基本消除</td><td>复材BOM层级多、ECO变更频，数据不一致会直接传导到工序执行</td></tr>
        <tr><td><strong>成本控制</strong></td><td style="color:var(--gray)">库存周转 4–6次/年；报工及时率 70–80%；废品率 3–5%</td><td style="color:var(--green);font-weight:700">库存周转 ≥8次/年；报工及时率 ≥95%；废品率 &lt;1.5%</td><td>原材料（碳纤维、预浸料）成本占比高，库存周转和废品率直接影响利润</td></tr>
      </tbody>
    </table>
  </div>
  <div class="info" style="margin-top:12px"><p>数据来源：离散制造/航空复材行业通用benchmark，供参考。</p></div>
  <div class="card" style="margin-top:16px"><p>通过数字化建设，打通研发、制造、采购、质量、财务五大业务域数据流，实现从 EBOM → MBOM → 生产执行 → 成本核算的全链路数字化闭环，支撑航空适航零件编号+质量编号全链路追溯。</p></div>
```

- [ ] **Step 2: 验证第2章修改**
  - 浏览器打开文件，检查五维度表格是否正常渲染
  - 检查行业平均数字（灰色）和目标数字（绿色高亮）是否可区分
  - 检查数据来源说明是否在表格下方

- [ ] **Step 3: 提交**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "$(cat <<'EOF'
feat(meeting): expand ch2 with 5-dimension industry benchmark matrix

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 扩写第3章——我们有哪 4 套系统

**Target area:** `<div class="sec" id="s3">` (行473-487)

- [ ] **Step 1: 在 `.sec-hd` 之后、`.gauto` 之前插入系统攻坚矩阵**

在第475行 `<div class="gauto">` 之前插入：

```html
  <div class="g4" style="margin-bottom:20px">
    <div class="sc erp"><div class="sn">ERP</div><div class="sv">用友 U8</div><div class="sr">计划/采购/库存/财务/成本账务<br/>PS · FI · CO · PP · MM · SD</div></div>
    <div class="sc mes"><div class="sn">MES</div><div class="sv">北京虎蜥</div><div class="sr">生产计划/执行/工艺管控/质量闭环/设备IoT/仓储物流/批次追溯</div></div>
    <div class="sc oa"><div class="sn">OA</div><div class="sv">华天动力</div><div class="sr">行政事务（统一流程/表单/收文发文）、考勤管理、人事组织（角色/权限）、跨系统流程协同、统一待办入口、移动协同</div></div>
    <div class="sc plm"><div class="sn">PLM</div><div class="sv">翎瑞鸿翔</div><div class="sr">EBOM→MBOM 结构转换、工艺文件管控、ECO 变更闭环、工程项目管理、设计数据唯一黄金源</div></div>
  </div>
  <div class="info" style="margin-bottom:16px"><p><strong>MDM（主数据管理）</strong>作为集成基石，独立于四套系统：统一主数据标准（组织身份、物料、供应商），是所有系统的集成底座，负责黄金源认定和跨系统数据一致性保障。</p></div>
```

- [ ] **Step 2: 验证第3章修改**
  - 浏览器打开文件，检查系统攻坚矩阵四卡片是否正常显示
  - 检查每张卡片左侧颜色边框（erp=蓝、mes=绿、oa=琥珀、plm=紫）是否正确
  - 检查MDM说明是否在系统卡片下方单独呈现

- [ ] **Step 3: 提交**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "$(cat <<'EOF'
feat(meeting): expand ch3 with system responsibility matrix and MDM note

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 实施约束

- 不引入构建流程，继续使用原生 HTML/CSS/JavaScript
- 继续使用 ECharts CDN，不引入额外依赖
- 数据来源统一标注为"行业通用benchmark，供参考"
- 修改后验证：浏览器打开正常、导航锚点正常、表格可横向滚动

## 验证清单

修改完成后至少检查：
1. HTML 文件可直接用浏览器打开，页面不是空白
2. 顶部导航锚点（s2、s3）能正常跳转
3. 第2章五维度表格横向可滚动，无内容溢出
4. 第3章系统攻坚矩阵四卡片颜色边框正确
5. MDM说明在系统卡片区下方单独呈现
6. 封面、正文、附录的版本日期保持一致（2026-05-14）