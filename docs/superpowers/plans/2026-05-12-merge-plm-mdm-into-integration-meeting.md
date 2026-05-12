# Merge PLM & MDM Detailed Docs into Integration Meeting Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fuse the detailed PLM implementation plan and MDM 5-stage workflow HTML into the master integration meeting page, enriching s8 (PLM) and s12+s14 (MDM) while preserving the target's unique analytical framework.

**Architecture:** Single-file HTML merge. The three files share ~80% CSS overlap with identical `:root` variables. CSS classes from sources are added to the target `<style>` block; HTML sections are inserted at specific anchor points. No build step, no JS changes.

**Tech Stack:** Plain HTML/CSS (no framework, no build tools).

**Spec:** `docs/superpowers/specs/2026-05-12-merge-plm-mdm-into-integration-meeting-design.md`

**Source files:**
- Target: `docs/Demo/信息化系统应用与集成说明会.html`
- Source 1: `docs/Demo/PLM精细化实施方案.html`
- Source 2: `docs/Demo/主数据管理 五阶段工作流程.html`

---

### Task 1: Merge CSS from both source files into target

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (insert CSS before `</style>` on line 419)
- Read: `docs/Demo/PLM精细化实施方案.html` (CSS block, lines 1-164)
- Read: `docs/Demo/主数据管理 五阶段工作流程.html` (CSS block, lines 1-65)

- [ ] **Step 1: Add PLM-source CSS classes**

Insert the following CSS block just before `</style>` (line 419) in the target:

```css
/* ── MERGED from PLM精细化实施方案 ── */
.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.summary-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px;border-top:4px solid var(--purple);box-shadow:0 1px 3px rgba(0,0,0,.04)}
.summary-card h4{font-size:13px;color:var(--navy);margin-bottom:8px;display:flex;align-items:center;gap:6px}
.summary-card p{font-size:12px;color:var(--muted);line-height:1.8}
.summary-icon{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0}
.phase-tag.purple{color:#6d28d9;background:#ede9fe}
.phase-tag.teal{color:#0e7490;background:#cffafe}
.phase-tag.orange{color:#c2410c;background:#fff7ed}
.phase-tag.blue{color:#1d4ed8;background:#dbeafe}
.phase-tag.green{color:#166534;background:#dcfce7}
.flow-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px}
.flow-step-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;border-top:4px solid var(--green);position:relative}
.flow-step-card .fs-num{width:28px;height:28px;border-radius:50%;background:var(--green);color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:10px}
.flow-step-card h4{font-size:13px;color:var(--navy);margin-bottom:6px}
.flow-step-card p{font-size:12px;color:var(--muted);line-height:1.75}
.flow-step-card .fs-check{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;margin-top:8px;background:#fee2e2;color:#b91c1c}
.res-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px}
.res-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;text-align:center}
.res-card .rn{font-size:28px;font-weight:900;color:var(--purple);line-height:1}
.res-card .rl{font-size:12px;color:var(--gray);margin-top:4px}
.res-card .rd{font-size:11px;color:var(--muted);margin-top:6px;line-height:1.6}
.dd-section{margin-bottom:20px}
.dd-section h4{font-size:14px;color:var(--navy);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--purple);display:flex;align-items:center;gap:8px}
.dd-section h4 .dd-num{width:24px;height:24px;border-radius:50%;background:var(--purple);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.field-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.field-card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px;border-left:3px solid var(--teal)}
.field-card .fn{font-size:12px;font-weight:700;color:var(--navy);margin-bottom:3px}
.field-card .fd{font-size:11px;color:var(--muted);line-height:1.65}
.field-card .ft{display:inline-block;font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;margin-top:5px}
.ft-mes{background:#dcfce7;color:#166534}
.ft-erp{background:#dbeafe;color:#1d4ed8}
.ft-quality{background:#fef3c7;color:#92400e}
.ft-plm{background:#ede9fe;color:#6d28d9}
```

- [ ] **Step 2: Add MDM-source CSS classes**

Insert the following after the PLM CSS block (still before `</style>`):

```css
/* ── MERGED from 主数据管理五阶段工作流程 ── */
.cat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.cat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center;transition:.2s}
.cat-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.08);border-color:var(--blue)}
.cat-card .cat-icon{font-size:28px;margin-bottom:6px}
.cat-card .cat-name{font-size:13px;font-weight:800;color:var(--navy)}
.cat-card .cat-desc{font-size:11px;color:var(--gray);margin-top:4px}
.resp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.resp-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;border-left:4px solid var(--blue)}
.resp-card .r-sys{font-size:13px;font-weight:800;color:var(--navy);margin-bottom:4px}
.resp-card .r-dept{font-size:11px;color:var(--amber);font-weight:700;margin-bottom:4px}
.resp-card .r-desc{font-size:11px;color:var(--muted);line-height:1.6}
.badge-row{display:flex;flex-wrap:wrap;gap:7px}
.badge{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800}
.badge.plm{background:#ede9fe;color:#6d28d9}
.badge.erp{background:#dbeafe;color:#1d4ed8}
.badge.mes{background:#dcfce7;color:#166534}
.badge.owner{background:#ffedd5;color:#c2410c}
.badge.std{background:#e8f0fe;color:#1a56db}
.badge.clean{background:#fef3c7;color:#92400e}
.badge.proc{background:#ede9fe;color:#6d28d9}
.badge.integ{background:#dcfce7;color:#166534}
.badge.ops{background:#ffe4e6;color:#be123c}
.flow{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
.flow-step{position:relative;background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 14px 12px;border-top:4px solid var(--blue);min-height:160px}
.flow-step:after{content:"→";position:absolute;right:-12px;top:48%;transform:translateY(-50%);color:#94a3b8;font-size:20px;font-weight:900}
.flow-step:last-child:after{display:none}
.flow-step .n{width:26px;height:26px;border-radius:50%;background:var(--blue);color:#fff;font-size:12px;font-weight:900;display:flex;align-items:center;justify-content:center;margin-bottom:8px}
.flow-step h3{font-size:13px;color:var(--navy);margin-bottom:6px}
.flow-step p{font-size:12px;line-height:1.7;color:var(--muted)}
.flow-step.green{border-top-color:var(--green)}.flow-step.green .n{background:var(--green)}
.flow-step.amber{border-top-color:var(--amber)}.flow-step.amber .n{background:var(--amber)}
.flow-step.purple{border-top-color:var(--purple)}.flow-step.purple .n{background:var(--purple)}
.flow-step.red{border-top-color:var(--red)}.flow-step.red .n{background:var(--red)}
.status-chain{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.st{background:#fff;border:1px solid var(--border);border-radius:999px;padding:7px 12px;font-size:12px;font-weight:800;color:var(--navy)}
.arrow{color:#94a3b8;font-weight:900}
.dataflow{background:#06172a;border:1px solid #1d4ed8;border-radius:12px;padding:18px;overflow:hidden;box-shadow:0 12px 30px rgba(15,42,94,.18)}
.dataflow svg{display:block;width:100%;height:auto}
.legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:12px;color:#dbeafe;font-size:11px}
.dot{width:12px;height:12px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:-2px}
.summary-box{background:linear-gradient(135deg,#081e4a,#1a56db);border-radius:12px;padding:24px 28px;color:#fff;margin-top:12px}
.summary-box h3{font-size:16px;margin-bottom:10px;color:#7dd3fc}
.summary-box p{font-size:13px;line-height:1.9;color:rgba(255,255,255,.82)}
.danger{background:#fef2f2;border:1px solid #fecaca;border-left:4px solid var(--red);border-radius:8px;padding:12px 16px;margin-bottom:14px}
.danger .dt{font-size:13px;font-weight:800;color:#991b1b;margin-bottom:5px}
.danger p{font-size:12px;color:#7f1d1d;line-height:1.8}
```

- [ ] **Step 3: Add responsive rules for new grid components**

Insert before the existing `@media` rule in target:

```css
@media(max-width:980px){
  .summary-grid,.flow-steps,.res-grid,.field-grid,.dd-section .field-grid,.cat-grid,.resp-grid,.flow{grid-template-columns:1fr 1fr}
  .flow-step:after{display:none}
}
@media(max-width:640px){
  .summary-grid,.flow-steps,.res-grid,.field-grid,.cat-grid,.resp-grid,.flow{grid-template-columns:1fr}
}
```

- [ ] **Step 4: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "style: merge CSS from PLM and MDM detailed docs into integration meeting page"
```

---

### Task 2: Update navigation bar with new sub-section links

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (nav links on line 427-432)

- [ ] **Step 1: Replace the nav links**

Replace lines 427-432 with expanded navigation:

```html
    <a href="#cover">首页</a><a href="#s1">会议定位</a><a href="#s2">数字化目标</a><a href="#s3">4套系统</a>
    <a href="#s4">排期</a><a href="#s5">里程碑</a><a href="#s6">卡点</a>
    <a href="#s7">OA</a><a href="#s8">PLM</a><a href="#s9">MES</a><a href="#s10">其他系统</a>
    <a href="#s11">事故链</a><a href="#s12">MDM基石</a><a href="#s13">拓扑数据流</a>
    <a href="#s14">MDM路径</a><a href="#s15">黄金源</a><a href="#s16">接口</a>
    <a href="#s17">Q成熟度</a><a href="#s18">组织分工</a><a href="#s19">行动清单</a><a href="#appendix">附录</a>
```

(No change to link count — sub-sections within s8 and s14 use scroll positioning from section headers, not separate nav entries.)

- [ ] **Step 2: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: update nav with PLM and MDM detailed section anchors"
```

---

### Task 3: Expand s8 with PLM detailed implementation content

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (insert content before s8 closing `</div>` on line 594)
- Read: `docs/Demo/PLM精细化实施方案.html` (lines 200-628 for content to adapt)

- [ ] **Step 1: Insert PLM 前情总结 sub-section**

Insert after the existing s8 warn block (before `</div>` closing s8 on line 594):

```html

  <!-- ── PLM 前情总结 ── -->
  <div class="sec-hd sub" id="plm-summary"><div class="sec-num" style="background:var(--purple)">0</div><div><h2>前情总结：从"打基础"到"系统集成"</h2><div class="sd">三大奠基工作回顾 · 为PLM精细化实施铺路</div></div></div>

  <div class="summary-grid">
    <div class="summary-card">
      <h4><span class="summary-icon" style="background:#dbeafe;color:#1d4ed8">1</span>MDM主数据奠基</h4>
      <p>明确主数据作为企业"通用语言"的地位，通过统一编码（不少于30位）和标准化属性（标准号、牌号等），解决"一物多码"历史问题，为后续系统集成扫清障碍。</p>
    </div>
    <div class="summary-card">
      <h4><span class="summary-icon" style="background:#ede9fe;color:#6d28d9">2</span>PLM计划精细化</h4>
      <p>识别出原甘特图过于粗略的风险，将建设重点转向技术深水区，包括CAD深度集成、多视图BOM转化（EBOM→MBOM）以及复材专项管理。</p>
    </div>
    <div class="summary-card">
      <h4><span class="summary-icon" style="background:#dcfce7;color:#166534">3</span>工艺规程数字化攻坚</h4>
      <p>锁定"最硬的骨头"——将1000多本非结构化工艺规程转化为结构化"数字指令"，以支撑二阶段MES的精准执行与追溯。</p>
    </div>
  </div>

  <div class="info"><p><strong>实施策略：</strong>基于昌兴现状，将PLM实施路径细化为五个关键阶段，侧重于数据源头治理与异构系统集成。以下方案覆盖从标准体系定义到试运行验收的完整周期（T+6个月）。</p></div>
```

- [ ] **Step 2: Insert PLM 五阶段实施路径**

Insert after the info block from Step 1:

```html

  <!-- ── PLM 五阶段实施路径 ── -->
  <div class="sec-hd sub" id="plm-phases"><div class="sec-num" style="background:var(--purple)">1</div><div><h2>PLM精细化实施路径拆解（T+6个月）</h2><div class="sd">五阶段递进 · 数据源头治理 → 异构系统集成</div></div></div>

  <div class="phase-stack">

    <!-- Phase 1 -->
    <div class="phase-card" style="border-left-color:var(--purple)">
      <div class="phase-head">
        <div class="phase-num" style="background:var(--purple)">1</div>
        <div class="phase-title">标准体系与管理底座定义</div>
        <div class="phase-period" style="color:#6d28d9;background:#ede9fe">T+1</div>
      </div>
      <div class="g3" style="margin-bottom:10px">
        <div class="card" style="margin-bottom:0">
          <h3>编码与属性标准化</h3>
          <p>确立零部件、图文档及物料的统一编码规则（支持30位以上混合编码），定义材料类主数据的必填属性（如密度、牌号、供应状态）。</p>
        </div>
        <div class="card" style="margin-bottom:0">
          <h3>权限与安全架构</h3>
          <p>基于"4W+1H"原则配置静态组织权限与动态项目权限，确保复材涉密数据安全。</p>
        </div>
        <div class="card" style="margin-bottom:0">
          <h3>生命周期与工作流配置</h3>
          <p>定义从"正在工作"到"已发布"的升版逻辑（采用A.1两级管理机制），建立符合CMII标准的闭环变更流程。</p>
        </div>
      </div>
      <div class="phase-tags">
        <span class="phase-tag purple">编码规则</span><span class="phase-tag purple">4W+1H</span><span class="phase-tag purple">CMII变更流程</span><span class="phase-tag purple">A.1两级管理</span>
      </div>
    </div>

    <!-- Phase 2 -->
    <div class="phase-card" style="border-left-color:var(--teal)">
      <div class="phase-head">
        <div class="phase-num" style="background:var(--teal)">2</div>
        <div class="phase-title">CAD深度集成与数据自动捕获</div>
        <div class="phase-period" style="color:#0e7490;background:#cffafe">T+2 ~ T+3</div>
      </div>
      <div class="g2" style="margin-bottom:10px">
        <div class="card" style="margin-bottom:0">
          <h3>MCAD（CATIA V5）集成</h3>
          <p>实现从3D数模自动提取物理特征，支持图纸标题栏信息双向同步，并在检入时自动产生/更新EBOM结构。</p>
        </div>
        <div class="card" style="margin-bottom:0">
          <h3>ECAD（CHS）集成</h3>
          <p>实现电气图样文档的结构化存储与版本控制，确保机电一体化设计的协同。</p>
        </div>
      </div>
      <div class="phase-tags">
        <span class="phase-tag teal">CATIA V5</span><span class="phase-tag teal">3D数模特征提取</span><span class="phase-tag teal">EBOM自动生成</span><span class="phase-tag teal">CHS电气集成</span>
      </div>
    </div>

    <!-- Phase 3 -->
    <div class="phase-card" style="border-left-color:var(--orange)">
      <div class="phase-head">
        <div class="phase-num" style="background:var(--orange)">3</div>
        <div class="phase-title">工艺结构化与多视图BOM重构</div>
        <div class="phase-period" style="color:#c2410c;background:#fff7ed">T+3 ~ T+4</div>
      </div>
      <div class="g2" style="margin-bottom:10px">
        <div class="card" style="margin-bottom:0">
          <h3>消耗式MBOM重构</h3>
          <p>配置从EBOM向MBOM转化的逻辑，支持工艺组合件、拆分件以及在制造件上关联工艺指令。</p>
        </div>
        <div class="card" style="margin-bottom:0">
          <h3>复材专项工艺数字化</h3>
          <p>配置铺层参数管理、固化曲线绑定模块，将非结构化附件转化为可校验的系统字段。</p>
        </div>
      </div>
      <div class="phase-tags">
        <span class="phase-tag orange">EBOM→MBOM</span><span class="phase-tag orange">工艺组合件</span><span class="phase-tag orange">铺层参数</span><span class="phase-tag orange">固化曲线</span>
      </div>
    </div>

    <!-- Phase 4 -->
    <div class="phase-card" style="border-left-color:var(--blue)">
      <div class="phase-head">
        <div class="phase-num" style="background:var(--blue)">4</div>
        <div class="phase-title">多系统"大动脉"联调</div>
        <div class="phase-period" style="color:#1d4ed8;background:#dbeafe">T+4 ~ T+5</div>
      </div>
      <div class="card" style="margin-bottom:10px">
        <h3>集成开发与全链路闭环测试</h3>
        <div class="g2">
          <div>
            <p style="font-weight:700;color:var(--navy)">PLM → MES</p>
            <p>推送生效EBOM、ECN及结构化工艺指令。</p>
          </div>
          <div>
            <p style="font-weight:700;color:var(--navy)">PLM ↔ ERP</p>
            <p>实现物料主数据与MBOM的同步，支撑MRP运算。</p>
          </div>
        </div>
        <p style="margin-top:8px"><strong>全链路闭环测试：</strong>验证"设计更改 → 工艺分析 → 计划调整 → 现场执行"的数据流转完整性。</p>
      </div>
      <div class="phase-tags">
        <span class="phase-tag blue">PLM→MES</span><span class="phase-tag blue">PLM↔ERP</span><span class="phase-tag blue">EBOM推送</span><span class="phase-tag blue">ECN同步</span><span class="phase-tag blue">MRP运算</span>
      </div>
    </div>

    <!-- Phase 5 -->
    <div class="phase-card" style="border-left-color:var(--green)">
      <div class="phase-head">
        <div class="phase-num" style="background:var(--green)">5</div>
        <div class="phase-title">试运行与验收上线</div>
        <div class="phase-period" style="color:#166534;background:#dcfce7">T+5 ~ T+6</div>
      </div>
      <div class="g2" style="margin-bottom:10px">
        <div class="card" style="margin-bottom:0">
          <h3>典型型号验证</h3>
          <p>选取一个型号进行全流程跑通，验证数据在多系统间的不失真。</p>
        </div>
        <div class="card" style="margin-bottom:0">
          <h3>存量数据最终校验</h3>
          <p>完成历史数据的分批迁移与质量审计。</p>
        </div>
      </div>
      <div class="phase-tags">
        <span class="phase-tag green">全流程验证</span><span class="phase-tag green">数据不失真</span><span class="phase-tag green">历史数据迁移</span><span class="phase-tag green">质量审计</span>
      </div>
    </div>

  </div>

  <div class="warn"><div class="wt">实施风险提示</div><p>五个阶段存在强依赖关系——标准体系未定义则CAD集成无法对齐字段；EBOM结构未稳定则MBOM重构缺乏基准；联调阶段若发现数据源头问题，将连锁影响试运行验收窗口。各阶段Go/No-Go节点必须严格执行。</p></div>
```

- [ ] **Step 3: Insert 工艺规程结构化迁移专项**

Insert after the phase risk warning:

```html

  <!-- ── 工艺规程结构化迁移专项 ── -->
  <div class="sec-hd sub" id="plm-migration"><div class="sec-num" style="background:var(--purple)">2</div><div><h2>工艺规程结构化迁移专项计划</h2><div class="sd">针对1000+本非结构化规程 · "三步走"迁移策略</div></div></div>

  <div class="alert"><div class="at">攻坚目标</div><p>将1000多本非结构化工艺规程转化为结构化"数字指令"，确保PLM输出的数据能被MES直接读取、校验和执行。这是整个PLM一期项目中工作量最大、专业要求最高的环节。</p></div>

  <div class="flow-steps">
    <div class="flow-step-card">
      <div class="fs-num">1</div>
      <h4>定义模板</h4>
      <p><strong>核心任务：</strong>联合定义复材专用的工序、工步模板。</p>
      <p style="margin-top:6px"><strong>交付物：</strong>《复材结构化工艺标准模板》</p>
      <div class="fs-check">关键控制点：必须包含铺层/固化特定字段</div>
    </div>
    <div class="flow-step-card" style="border-top-color:var(--blue)">
      <div class="fs-num" style="background:var(--blue)">2</div>
      <h4>典型试点</h4>
      <p><strong>核心任务：</strong>选取1个代表性型号进行全流程拆解。</p>
      <p style="margin-top:6px"><strong>交付物：</strong>结构化MBOM、数字化指令</p>
      <div class="fs-check">关键控制点：必须通过MES开工校验测试</div>
    </div>
    <div class="flow-step-card" style="border-top-color:var(--purple)">
      <div class="fs-num" style="background:var(--purple)">3</div>
      <h4>规模迁移</h4>
      <p><strong>核心任务：</strong>组织工艺员开展大规模存量规程拆解录入。</p>
      <p style="margin-top:6px"><strong>交付物：</strong>1000+份结构化数字规程</p>
      <div class="fs-check">关键控制点：完成率与资源绑定率监控</div>
    </div>
  </div>

  <div class="tw">
    <table>
      <thead><tr><th>步骤</th><th>核心任务</th><th>交付物</th><th>关键控制点</th></tr></thead>
      <tbody>
        <tr><td><strong>Step 1: 定义模板</strong></td><td>联合定义复材专用的工序、工步模板</td><td>《复材结构化工艺标准模板》</td><td>必须包含铺层/固化特定字段</td></tr>
        <tr><td><strong>Step 2: 典型试点</strong></td><td>选取1个代表性型号进行全流程拆解</td><td>结构化MBOM、数字化指令</td><td>必须通过MES开工校验测试</td></tr>
        <tr><td><strong>Step 3: 规模迁移</strong></td><td>组织工艺员开展大规模存量规程拆解录入</td><td>1000+份结构化数字规程</td><td>完成率与资源绑定率监控</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <h3>资源投入建议</h3>
    <div class="res-grid">
      <div class="res-card"><div class="rn">3人</div><div class="rl">工艺专家组</div><div class="rd">负责技术要求合规性审定</div></div>
      <div class="res-card"><div class="rn">8-10人</div><div class="rl">数据录入组</div><div class="rd">负责规程拆解及MBOM绑定<br/>预计工作量 4000 人/小时</div></div>
      <div class="res-card"><div class="rn">2人</div><div class="rl">质量校验组</div><div class="rd">负责结构化数据的最终发布审核</div></div>
    </div>
  </div>

  <div class="warn"><div class="wt">资源风险</div><p>4000人/小时的工作量换算约为 500 人天。若数据录入组 8-10 人全职投入，预计需要 50-63 个工作日（约 2.5-3 个月）。需提前锁定工艺专家组的排期，避免因技术审定延迟导致录入组停工待审。</p></div>
```

- [ ] **Step 4: Insert 数据字典模板**

Insert after the resource risk warning:

```html

  <!-- ── 复材工艺结构化数据字典 ── -->
  <div class="sec-hd sub" id="plm-datadict"><div class="sec-num" style="background:var(--purple)">3</div><div><h2>复材工艺结构化数据字典模板</h2><div class="sd">确保PLM输出的数据能被MES直接读取 · 四类标准字段</div></div></div>

  <div class="info"><p><strong>设计原则：</strong>以下字段字典用于指导PLM系统中工艺数据的结构化定义，确保工艺数据从PLM输出后能被MES直接消费，无需二次解析或人工补全。每个字段应明确其系统归属和消费方。</p></div>

  <!-- 3.1 基础工序信息 -->
  <div class="dd-section">
    <h4><span class="dd-num">3.1</span>基础工序信息（通用字段）</h4>
    <div class="field-grid">
      <div class="field-card"><div class="fn">工序编码/名称</div><div class="fd">如"OP10 铺层"。作为跨系统引用工艺步骤的唯一标识。</div><span class="ft ft-mes">MES消费</span></div>
      <div class="field-card"><div class="fn">工种资质要求</div><div class="fd">用于MES开工时的权限校验，确保只有具备对应资质的人员才能执行该工序。</div><span class="ft ft-mes">MES校验</span></div>
      <div class="field-card"><div class="fn">额定准备/单件工时</div><div class="fd">MRP运算的核心参数，直接影响生产计划排程和成本核算的准确性。</div><span class="ft ft-erp">ERP消费</span></div>
      <div class="field-card"><div class="fn">关联资源编码</div><div class="fd">关联设备、工装、工刀量具主数据，确保工艺执行时资源可追溯。</div><span class="ft ft-mes">MES消费</span></div>
      <div class="field-card"><div class="fn">工序类型</div><div class="fd">区分：普通工序 / 检验工序 / 特殊工序 / 外协工序。</div><span class="ft ft-plm">PLM维护</span></div>
      <div class="field-card"><div class="fn">前后置工序</div><div class="fd">定义工序间的串行/并行约束关系，用于MES工序流转控制。</div><span class="ft ft-mes">MES消费</span></div>
    </div>
  </div>

  <!-- 3.2 铺层专项数据 -->
  <div class="dd-section">
    <h4><span class="dd-num">3.2</span>铺层专项数据（结构化字典）</h4>
    <div class="field-grid">
      <div class="field-card" style="border-left-color:var(--orange)"><div class="fn">铺层顺序号</div><div class="fd">材料堆叠的物理次序，从第1层到第N层严格编号。铺层顺序错误将导致力学性能不达标。</div><span class="ft ft-mes">MES强校验</span></div>
      <div class="field-card" style="border-left-color:var(--orange)"><div class="fn">铺层方向</div><div class="fd">下拉选择：0°、±45°、90° 等。为枚举值，禁止自由文本输入以防止输入错误。</div><span class="ft ft-mes">MES强校验</span></div>
      <div class="field-card" style="border-left-color:var(--orange)"><div class="fn">层数/厚度要求</div><div class="fd">标准值，用于完工检验时的自动比对。超出公差范围自动触发不合品流程。</div><span class="ft ft-quality">质检消费</span></div>
      <div class="field-card" style="border-left-color:var(--orange)"><div class="fn">激光投影关联</div><div class="fd">关联对应的投影数据路径，用于铺层定位引导。路径需在PLM中受控管理。</div><span class="ft ft-mes">MES消费</span></div>
      <div class="field-card" style="border-left-color:var(--orange)"><div class="fn">材料规格号</div><div class="fd">关联预浸料主数据中的材料规范号，确保用料正确。需与ERP-MM中的物料编码对应。</div><span class="ft ft-erp">ERP关联</span></div>
      <div class="field-card" style="border-left-color:var(--orange)"><div class="fn">铺层区域标识</div><div class="fd">对应零件上的铺层区域编号，用于复杂曲面多区域铺层的分区管理。</div><span class="ft ft-mes">MES消费</span></div>
    </div>
  </div>

  <!-- 3.3 固化联动控制数据 -->
  <div class="dd-section">
    <h4><span class="dd-num">3.3</span>固化联动控制数据（参数字典）</h4>
    <div class="field-grid">
      <div class="field-card" style="border-left-color:var(--red)"><div class="fn">升/降温速率</div><div class="fd">单位：℃/min。固化过程中温度变化的速率控制，超出范围将影响材料性能。</div><span class="ft ft-mes">MES实时比对</span></div>
      <div class="field-card" style="border-left-color:var(--red)"><div class="fn">保温/保压点</div><div class="fd">目标温度及允许公差。多个保温平台需分别定义温度值、允许偏差和持续时间。</div><span class="ft ft-mes">MES实时比对</span></div>
      <div class="field-card" style="border-left-color:var(--red)"><div class="fn">真空度/压力阶梯</div><div class="fd">热压罐控制逻辑——各阶段的真空度要求、正压值及其允许波动范围。</div><span class="ft ft-mes">MES实时比对</span></div>
      <div class="field-card" style="border-left-color:var(--red)"><div class="fn">标准曲线模板</div><div class="fd">用于MES实时比对与预警。固化过程中实际参数与标准曲线的偏差超过阈值时自动告警。</div><span class="ft ft-mes">MES预警</span></div>
      <div class="field-card" style="border-left-color:var(--red)"><div class="fn">固化设备类型</div><div class="fd">指定适用的热压罐/烘箱类型，与设备主数据关联。不同类型设备不可混用。</div><span class="ft ft-mes">MES校验</span></div>
      <div class="field-card" style="border-left-color:var(--red)"><div class="fn">最大允许偏差</div><div class="fd">各参数（温度、压力、真空度、时间）的最大允许偏差值，超过视为工艺异常。</div><span class="ft ft-quality">质检判定</span></div>
    </div>
  </div>

  <!-- 3.4 质量检验 Checklist -->
  <div class="dd-section">
    <h4><span class="dd-num">3.4</span>质量检验 Checklist（检验一体化）</h4>
    <div class="field-grid">
      <div class="field-card" style="border-left-color:var(--green)"><div class="fn">检验特征点</div><div class="fd">如"外形尺寸"、"表面质量"、"无损检测"、"重量"等。每个特征点对应具体的检验方法和判定标准。</div><span class="ft ft-quality">质检消费</span></div>
      <div class="field-card" style="border-left-color:var(--green)"><div class="fn">标准值/公差</div><div class="fd">自动判定逻辑——检验值落在公差带内自动判定合格，超出则触发不合格品处理流程。</div><span class="ft ft-quality">自动判定</span></div>
      <div class="field-card" style="border-left-color:var(--green)"><div class="fn">提检类型</div><div class="fd">下拉选择：自检 / 专检 / 军检。不同类型的检验对应不同的检验人员资质要求和记录规范。</div><span class="ft ft-mes">MES派工</span></div>
      <div class="field-card" style="border-left-color:var(--green)"><div class="fn">检验工具/设备</div><div class="fd">指定检验用工具（如卡尺、千分尺、CMM、超声检测设备等），与设备主数据关联。</div><span class="ft ft-mes">MES校验</span></div>
      <div class="field-card" style="border-left-color:var(--green)"><div class="fn">检验频次</div><div class="fd">定义：首件检验 / 过程抽检 / 完工全检。首件检验未通过不得继续生产。</div><span class="ft ft-quality">质检消费</span></div>
      <div class="field-card" style="border-left-color:var(--green)"><div class="fn">不合格品处置</div><div class="fd">关联不合格品处理流程：返工 / 让步接收 / 报废。每个选项对应不同的审批路径。</div><span class="ft ft-quality">质检联动</span></div>
    </div>
  </div>

  <div class="success"><p><strong>预期收益：</strong>结构化数据字典落地后，MES可直接读取PLM输出的工艺指令进行开工校验、参数比对和自动判定，消除人工解读非结构化规程的歧义和错误，为二阶段MES的精准执行与追溯奠定数据基础。</p></div>
```

- [ ] **Step 5: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: add PLM detailed implementation plan to s8 (5 phases, migration, data dictionary)"
```

---

### Task 4: Enhance s12 with MDM Stage 1 detail

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (insert after existing s12 content, before `</div>` closing s12)
- Read: `docs/Demo/主数据管理 五阶段工作流程.html` (lines 166-217 for Stage 1 content)

- [ ] **Step 1: Insert MDM 5-stage pipeline overview + Stage 1 detail**

Insert after the existing `</div>` that closes the `g3` grid in s12 (after the "今天要确认" card), but before the closing `</div>` of s12:

```html

  <!-- ── MDM 五阶段流水线总览 ── -->
  <div class="sec-hd sub" id="mdm-pipeline"><div class="sec-num" style="background:var(--green)">◆</div><div><h2>MDM 五阶段工作流程</h2><div class="sd">定标准 → 清存量 → 控过程 → 促集成 → 保运行</div></div></div>

  <div class="dataflow">
    <svg viewBox="0 0 640 200" role="img" aria-label="MDM 五阶段流水线">
      <defs>
        <marker id="mdm-ar" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#7dd3fc"/></marker>
      </defs>
      <rect x="10" y="10" width="620" height="180" rx="16" fill="none" stroke="rgba(255,255,255,.08)"/>
      <rect x="20" y="30" width="110" height="100" rx="12" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.2)"/>
      <text x="75" y="60" text-anchor="middle" fill="#fff" font-size="16" font-weight="900">定标准</text>
      <text x="75" y="80" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">体系定义 · 编码规范</text>
      <text x="75" y="96" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">属性标准 · 职责划分</text>

      <path d="M134 80 L148 80" stroke="#7dd3fc" stroke-width="3" marker-end="url(#mdm-ar)"/>

      <rect x="150" y="30" width="110" height="100" rx="12" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.2)"/>
      <text x="205" y="60" text-anchor="middle" fill="#fbbf24" font-size="16" font-weight="900">清存量</text>
      <text x="205" y="80" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">多源盘点 · 人工去重</text>
      <text x="205" y="96" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">补全属性 · 校验规则</text>

      <path d="M264 80 L278 80" stroke="#7dd3fc" stroke-width="3" marker-end="url(#mdm-ar)"/>

      <rect x="280" y="30" width="110" height="100" rx="12" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.2)"/>
      <text x="335" y="60" text-anchor="middle" fill="#c084fc" font-size="16" font-weight="900">控过程</text>
      <text x="335" y="80" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">全生命周期 · 变更审批</text>
      <text x="335" y="96" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">权限架构 · 闭环管控</text>

      <path d="M394 80 L408 80" stroke="#7dd3fc" stroke-width="3" marker-end="url(#mdm-ar)"/>

      <rect x="410" y="30" width="110" height="100" rx="12" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.2)"/>
      <text x="465" y="60" text-anchor="middle" fill="#4ade80" font-size="16" font-weight="900">促集成</text>
      <text x="465" y="80" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">系统打通 · 同源同步</text>
      <text x="465" y="96" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">映射关系 · 双向实时</text>

      <path d="M524 80 L538 80" stroke="#7dd3fc" stroke-width="3" marker-end="url(#mdm-ar)"/>

      <rect x="540" y="30" width="80" height="100" rx="12" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.2)"/>
      <text x="580" y="60" text-anchor="middle" fill="#fda4af" font-size="16" font-weight="900">保运行</text>
      <text x="580" y="80" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">导入校验 · 培训</text>
      <text x="580" y="96" text-anchor="middle" fill="rgba(255,255,255,.6)" font-size="10">动态维护 · 持续清洗</text>

      <rect x="20" y="145" width="600" height="36" rx="10" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.12)"/>
      <text x="320" y="167" text-anchor="middle" fill="#7dd3fc" font-size="14" font-weight="900">一物一码 · 一处维护 · 多系统一致消费</text>
    </svg>
    <div class="legend">
      <span>定标准 → 清存量 → 控过程 → 促集成 → 保运行</span>
    </div>
  </div>

  <!-- ── MDM 阶段一：体系定义与标准制定 ── -->
  <div class="sec-hd sub" id="mdm-stage1"><div class="sec-num" style="background:var(--green)">1</div><div><h2>阶段一：体系定义与标准制定</h2><div class="sd">确立企业全局的"通用语言"和"唯一身份证"规则，从源头杜绝一物多码。</div></div></div>

  <div class="card">
    <h3>一、主数据分类体系</h3>
    <p>明确划分以下八大类主数据，每类建立独立的管理标准和属性模板：</p>
    <div class="cat-grid" style="margin-top:12px">
      <div class="cat-card"><div class="cat-icon">🔩</div><div class="cat-name">标准件</div><div class="cat-desc">紧固件、轴承等<br/>国标/航标件</div></div>
      <div class="cat-card"><div class="cat-icon">🧱</div><div class="cat-name">原材料</div><div class="cat-desc">金属/非金属<br/>板材、型材</div></div>
      <div class="cat-card"><div class="cat-icon">💻</div><div class="cat-name">电子元器件</div><div class="cat-desc">电阻、电容<br/>连接器、线缆</div></div>
      <div class="cat-card"><div class="cat-icon">⚙️</div><div class="cat-name">零组件</div><div class="cat-desc">自制/外协件<br/>组件、部件</div></div>
      <div class="cat-card"><div class="cat-icon">🔧</div><div class="cat-name">工艺组件</div><div class="cat-desc">工艺拆分件<br/>虚拟件</div></div>
      <div class="cat-card"><div class="cat-icon">🏭</div><div class="cat-name">设备</div><div class="cat-desc">生产设备<br/>检测设备</div></div>
      <div class="cat-card"><div class="cat-icon">🛠️</div><div class="cat-name">工装</div><div class="cat-desc">模具、夹具<br/>型架、样板</div></div>
      <div class="cat-card"><div class="cat-icon">📐</div><div class="cat-name">工具</div><div class="cat-desc">刀具、量具<br/>辅具</div></div>
    </div>
  </div>

  <div class="g2">
    <div class="card">
      <h3>二、统一编码规范</h3>
      <ul>
        <li>支持<strong>不少于 30 位混合编码</strong>，涵盖大类、中类、小类、流水号及校验位</li>
        <li>每一物料/零部件分配<strong>唯一编码</strong>，作为跨系统的"身份证号"</li>
        <li>编码规则需兼顾<strong>可读性、可扩展性和机器解析</strong>要求</li>
        <li>从源头杜绝"一物多码"和"多物一码"</li>
      </ul>
    </div>
    <div class="card">
      <h3>三、标准化属性标准</h3>
      <ul>
        <li><strong>必填属性：</strong>每类数据定义不可为空的强制字段</li>
        <li><strong>可选属性：</strong>视业务场景需要的辅助字段</li>
        <li>示例 — 材料类必填：标准号、牌号、供应状态、规格、密度</li>
        <li>示例 — 零组件类必填：图号、名称、版次、材料牌号、重量</li>
      </ul>
    </div>
  </div>

  <div class="card">
    <h3>四、归口管理职责</h3>
    <p>落实各部门维护责任，确保每类主数据有明确的 Owner：</p>
    <div class="resp-grid" style="margin-top:10px">
      <div class="resp-card"><div class="r-sys">物料主数据</div><div class="r-dept">物资保障部 + 工程技术部</div><div class="r-desc">联合维护物料编码、名称、规格、计量单位等核心属性</div></div>
      <div class="resp-card"><div class="r-sys">设备主数据</div><div class="r-dept">运维安环部</div><div class="r-desc">维护设备台账、技术参数、保养周期、精度指标</div></div>
      <div class="resp-card"><div class="r-sys">零组件主数据</div><div class="r-dept">工程技术部</div><div class="r-desc">维护图号、名称、版次、材料、工艺路线等工程属性</div></div>
      <div class="resp-card"><div class="r-sys">工装 / 工具主数据</div><div class="r-dept">工程技术部 + 复材车间</div><div class="r-desc">维护工装图号、工具编号、适用机型、检定周期</div></div>
    </div>
  </div>
```

- [ ] **Step 2: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: add MDM 5-stage pipeline overview and Stage 1 detail to s12"
```

---

### Task 5: Rewrite s14 with MDM Stages 2-5 workflow

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (replace s14 content between the sec-hd header and the Sankey charts)
- Read: `docs/Demo/主数据管理 五阶段工作流程.html` (lines 219-488 for Stages 2-5 + Summary)

- [ ] **Step 1: Replace s14 chain content with MDM Stages 2-5**

Find the s14 section starting at `<!-- ══ 14 MDM 建设路径 ══ -->`. Keep the sec-hd header and the Sankey chart blocks (`#sankey-d4`, `#sankey-d1`, `#sankey-d3`, `#sankey-d2`), but replace everything between the header and the first Sankey wrap with the MDM stages.

Replace from the `.alert` block through the `.chain` block (but keeping the Sankey wraps that follow) with:

```html

  <div class="alert">
    <div class="at">MDM 是系统集成的基石</div>
    <p>先用业务流程牵引数据盘点，统一术语和字段口径，再确定黄金源、维护部门、审批部门和消费系统。以下五阶段来源于 MDM 工作流程专项方案，与组织身份先行、流程牵引的建设路径互补。</p>
  </div>

  <!-- ── MDM 阶段二：存量数据盘点与清洗 ── -->
  <div class="sec-hd sub" id="mdm-stage2"><div class="sec-num" style="background:var(--green)">2</div><div><h2>阶段二：存量数据盘点与清洗</h2><div class="sd">整个流程中最耗时、工作量最大的环节（通常需 5-6 个月），涉及上万条数据的处理。</div></div></div>

  <div class="warn">
    <div class="wt">工作量预警</div>
    <p>存量清洗通常需 <strong>5-6 个月</strong>，涉及 <strong>上万条数据</strong> 的人工核对、去重、纠错和补全。此阶段质量直接决定后续 MRP 运算、车间报工和物料齐套性检查的准确性。</p>
  </div>

  <div class="flow">
    <div class="flow-step"><div class="n">1</div><h3>多源数据盘点</h3><p>对现有 ERP 系统数据、纸质单据、个人电脑电子文档及库房实物进行全面盘点。</p></div>
    <div class="flow-step amber"><div class="n">2</div><h3>人工整理去重</h3><p>组织专业人员对数据进行人工核对，识别并合并重复编码，纠正错误信息。</p></div>
    <div class="flow-step purple"><div class="n">3</div><h3>属性字段补全</h3><p>根据标准补全缺失的属性字段，确保每条数据信息完整、可追溯。</p></div>
    <div class="flow-step green"><div class="n">4</div><h3>校验规则建立</h3><p>设定完整性、准确性和唯一性校验逻辑，防止无效或重复数据再次进入系统。</p></div>
    <div class="flow-step"><div class="n">5</div><h3>清洗成果确认</h3><p>输出清洗后的高质量主数据台账，经业务部门确认后封版。</p></div>
  </div>

  <div class="g3" style="margin-top:14px">
    <div class="card">
      <h3>盘点范围</h3>
      <ul>
        <li>现有 ERP 系统中的物料/零部件数据</li>
        <li>纸质单据（工艺卡、BOM 表、领料单）</li>
        <li>个人电脑中的 Excel 台账</li>
        <li>库房实物核对（名称、规格、数量）</li>
      </ul>
    </div>
    <div class="card">
      <h3>去重策略</h3>
      <ul>
        <li>同图号不同名称 → 提交 Owner 确认</li>
        <li>同名称不同图号 → 核实是否为同一物料</li>
        <li>近似编码 → 人工核查是否为重复创建</li>
        <li>历史遗留"一物多码" → 建立映射关系</li>
      </ul>
    </div>
    <div class="card">
      <h3>校验规则类型</h3>
      <ul>
        <li><strong>完整性校验：</strong>必填字段非空检查</li>
        <li><strong>准确性校验：</strong>格式、取值范围检查</li>
        <li><strong>唯一性校验：</strong>编码不重复、名称+规格不重</li>
        <li><strong>关联性校验：</strong>图号与材料牌号一致性</li>
      </ul>
    </div>
  </div>

  <!-- ── MDM 阶段三：全生命周期管理流程 ── -->
  <div class="sec-hd sub" id="mdm-stage3"><div class="sec-num" style="background:var(--green)">3</div><div><h2>阶段三：全生命周期管理流程建设</h2><div class="sd">将主数据的产生与变更纳入系统化、闭环化的管控体系。</div></div></div>

  <div class="card">
    <h3>规范化生命周期阶段</h3>
    <div class="status-chain" style="margin-top:10px;margin-bottom:14px">
      <span class="st">新增</span><span class="arrow">→</span>
      <span class="st">审核</span><span class="arrow">→</span>
      <span class="st">生效</span><span class="arrow">→</span>
      <span class="st">变更</span><span class="arrow">→</span>
      <span class="st">停用</span><span class="arrow">→</span>
      <span class="st">归档</span>
    </div>
    <p>每个状态节点对应明确的触发条件、审批人和处理时限，形成端到端的闭环管理。主数据<strong>不允许物理删除</strong>，停用和归档保留完整历史痕迹。</p>
  </div>

  <div class="g2">
    <div class="card">
      <h3>变更审批机制</h3>
      <ul>
        <li>任何主数据的<strong>新增、修改、停用</strong>必须经过相关部门线上审批</li>
        <li>记录<strong>变更原因、变更内容及历史版本</strong>，实现全链路可追溯</li>
        <li>审批流程支持<strong>多级会签</strong>（如物料变更需仓储 + 技术 + 质量联合会签）</li>
        <li>变更生效后<strong>自动通知</strong>所有消费系统（ERP、MES、PLM）</li>
      </ul>
    </div>
    <div class="card">
      <h3>权限架构配置（4W+1H）</h3>
      <ul>
        <li><strong>Who：</strong>谁——操作人身份与角色</li>
        <li><strong>When：</strong>何时——操作时间窗口</li>
        <li><strong>Where：</strong>何地——操作终端/网络位置</li>
        <li><strong>What：</strong>何对象——哪个主数据对象</li>
        <li><strong>How：</strong>何种权限——增/删/改/查/审批</li>
      </ul>
    </div>
  </div>

  <div class="info">
    <p><strong>设计原则：</strong>主数据修改权限集中在归口管理部门，消费系统（ERP、MES）对主数据只有<strong>只读消费</strong>权限，不允许回写覆盖 MDM 标准值。</p>
  </div>

  <!-- ── MDM 阶段四：多系统集成与协同 ── -->
  <div class="sec-hd sub" id="mdm-stage4"><div class="sec-num" style="background:var(--green)">4</div><div><h2>阶段四：多系统集成与协同配置</h2><div class="sd">主数据必须作为"单一数据源"在各系统间流转，确保同源同步。</div></div></div>

  <div class="dataflow">
    <svg viewBox="0 0 1100 320" role="img" aria-label="MDM 多系统集成拓扑图">
      <defs>
        <marker id="mab" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#60a5fa"/></marker>
        <marker id="mag" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#22c55e"/></marker>
        <marker id="map" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#c084fc"/></marker>
      </defs>
      <rect x="20" y="20" width="1060" height="280" rx="18" fill="#071a31" stroke="#1e3a8a"/>
      <rect x="50" y="90" width="180" height="130" rx="14" fill="#ede9fe" stroke="#a78bfa"/>
      <text x="140" y="130" text-anchor="middle" fill="#4c1d95" font-size="20" font-weight="900">PLM</text>
      <text x="140" y="154" text-anchor="middle" fill="#5b21b6" font-size="11">产品生命周期管理</text>
      <text x="140" y="174" text-anchor="middle" fill="#334155" font-size="10">MBOM · ECO · 图文档</text>
      <text x="140" y="194" text-anchor="middle" fill="#6d28d9" font-size="10" font-weight="700">主数据产生源</text>
      <rect x="430" y="60" width="240" height="190" rx="16" fill="#f8fafc" stroke="#1a56db" stroke-width="3"/>
      <text x="550" y="108" text-anchor="middle" fill="#0f2a5e" font-size="22" font-weight="900">MDM</text>
      <text x="550" y="134" text-anchor="middle" fill="#1d4ed8" font-size="12" font-weight="700">主数据管理平台</text>
      <text x="550" y="158" text-anchor="middle" fill="#475569" font-size="11">编码 · 属性 · 黄金源</text>
      <text x="550" y="178" text-anchor="middle" fill="#475569" font-size="11">生命周期 · 审批 · 发布</text>
      <text x="550" y="198" text-anchor="middle" fill="#475569" font-size="11">变更通知 · 同步调度</text>
      <text x="550" y="224" text-anchor="middle" fill="#1a56db" font-size="11" font-weight="800">← 单一数据源 →</text>
      <rect x="860" y="62" width="180" height="88" rx="14" fill="#dbeafe" stroke="#60a5fa"/>
      <text x="950" y="96" text-anchor="middle" fill="#1d4ed8" font-size="18" font-weight="900">ERP（用友 U8）</text>
      <text x="950" y="120" text-anchor="middle" fill="#475569" font-size="10">计划 · 采购 · 库存 · 财务</text>
      <text x="950" y="138" text-anchor="middle" fill="#1d4ed8" font-size="10" font-weight="700">主数据消费方</text>
      <rect x="860" y="176" width="180" height="88" rx="14" fill="#dcfce7" stroke="#4ade80"/>
      <text x="950" y="210" text-anchor="middle" fill="#166534" font-size="18" font-weight="900">MES（虎蜥）</text>
      <text x="950" y="234" text-anchor="middle" fill="#475569" font-size="10">派工 · 报工 · 追溯 · 质检</text>
      <text x="950" y="252" text-anchor="middle" fill="#166534" font-size="10" font-weight="700">主数据消费方</text>
      <path d="M230 135 C300 125 360 120 430 128" fill="none" stroke="#c084fc" stroke-width="3" marker-end="url(#map)"/>
      <text x="330" y="110" text-anchor="middle" fill="#d8b4fe" font-size="10">维护确认</text>
      <path d="M670 120 C740 100 800 98 860 106" fill="none" stroke="#60a5fa" stroke-width="3" marker-end="url(#mab)"/>
      <text x="765" y="90" text-anchor="middle" fill="#bfdbfe" font-size="10">发布消费</text>
      <path d="M670 190 C740 215 800 225 860 218" fill="none" stroke="#22c55e" stroke-width="3" marker-end="url(#mag)"/>
      <text x="765" y="245" text-anchor="middle" fill="#bbf7d0" font-size="10">发布消费</text>
      <path d="M950 150 C950 162 950 168 950 176" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="5 4"/>
      <text x="985" y="168" fill="#94a3b8" font-size="9">库存变动反馈 MRP</text>
    </svg>
    <div class="legend">
      <span><i class="dot" style="background:#c084fc"></i>PLM → MDM 维护链路</span>
      <span><i class="dot" style="background:#60a5fa"></i>MDM → ERP 发布链路</span>
      <span><i class="dot" style="background:#22c55e"></i>MDM → MES 发布链路</span>
    </div>
  </div>

  <div class="g3" style="margin-top:14px">
    <div class="card">
      <h3>打通集成通道</h3>
      <p>开发 PLM、ERP、MES 三大系统间的主数据同步接口，实现统一的接口规范和数据格式。</p>
      <div class="badge-row" style="margin-top:8px">
        <span class="badge plm">PLM ↔ MDM</span>
        <span class="badge erp">MDM → ERP</span>
        <span class="badge mes">MDM → MES</span>
      </div>
    </div>
    <div class="card">
      <h3>双向实时同步</h3>
      <p>MES 中的物料主数据与库房库存变动需<strong>实时反馈至 ERP</strong>，支撑其 MRP 运算。主数据变更在 MDM 发布后自动推送至所有消费系统。</p>
    </div>
    <div class="card">
      <h3>新旧编码映射</h3>
      <p>在处理"一物多码"历史问题时，建立<strong>旧编码与新标准编码的映射关系</strong>，保障历史业务数据的可追溯性，支持按新码或旧码双向查询。</p>
    </div>
  </div>

  <!-- ── MDM 阶段五：数据导入验证与持续运营 ── -->
  <div class="sec-hd sub" id="mdm-stage5"><div class="sec-num" style="background:var(--green)">5</div><div><h2>阶段五：数据导入、验证与持续运营</h2><div class="sd">将高质量数据导入生产环境，建立长效维护机制，确保数据质量持续稳定。</div></div></div>

  <div class="g3">
    <div class="card">
      <h3>分批导入与验证</h3>
      <ul>
        <li>将清洗后的高质量数据<strong>分批次</strong>导入生产环境</li>
        <li>每批次导入后进行<strong>全链路业务跑通验证</strong></li>
        <li>验证场景：BOM 展开、MRP 运算、采购下单、车间派工、报工、入库</li>
        <li>导入异常数据<strong>回滚并记录</strong>，修正后重新导入</li>
      </ul>
    </div>
    <div class="card">
      <h3>用户培训</h3>
      <ul>
        <li>针对<strong>主数据维护人员</strong>进行标准化录入与变更规范培训</li>
        <li>培训内容：编码规则、属性填写规范、审批流程操作、常见错误案例</li>
        <li>建立<strong>操作手册和培训考核</strong>机制</li>
        <li>消费系统用户培训：如何识别和使用标准主数据</li>
      </ul>
    </div>
    <div class="card">
      <h3>动态维护与持续清洗</h3>
      <ul>
        <li>建立<strong>定期维护机制</strong>（如月度/季度数据质量巡检）</li>
        <li>动态更新<strong>主数据台账</strong>，确保账实一致</li>
        <li>定期清理系统内的<strong>冗余数据</strong>（重复、过期、无效记录）</li>
        <li>数据质量 KPI 监控：准确率、完整率、及时率</li>
      </ul>
    </div>
  </div>

  <div class="card">
    <h3>数据质量监控指标</h3>
    <div class="tw">
      <table>
        <thead><tr><th>指标</th><th>定义</th><th>目标值</th><th>监控频率</th><th>责任人</th></tr></thead>
        <tbody>
          <tr><td><strong>完整率</strong></td><td>必填字段非空的数据占比</td><td>≥ 99%</td><td>月度</td><td>数据管理员</td></tr>
          <tr><td><strong>准确率</strong></td><td>字段值与实物/标准一致的数据占比</td><td>≥ 98%</td><td>季度</td><td>归口部门</td></tr>
          <tr><td><strong>唯一率</strong></td><td>无重复编码的数据占比</td><td>100%</td><td>月度</td><td>MDM 管理员</td></tr>
          <tr><td><strong>及时率</strong></td><td>变更后 24h 内同步至消费系统的占比</td><td>≥ 95%</td><td>实时监控</td><td>IT 运维</td></tr>
          <tr><td><strong>消费一致率</strong></td><td>ERP/MES 中数据与 MDM 标准一致的占比</td><td>≥ 99%</td><td>月度</td><td>IT 运维</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── MDM 总结 ── -->
  <div class="summary-box">
    <h3>MDM 的本质</h3>
    <p>MDM 工作流程的本质是将昌兴的<strong>线下管理规则转化为系统的"技术法规"</strong>。它不是单纯的数据录入项目，而是企业数字化建设的<strong>基础设施工程</strong>，其质量直接影响所有上层业务系统的运行效果。</p>
  </div>

  <div class="g2" style="margin-top:14px">
    <div class="danger">
      <div class="dt">流程执行不彻底的后果</div>
      <p>清洗不净 → 二阶段 <strong>MRP 运算失真</strong><br/>编码规则不统一 → <strong>车间无法报工</strong><br/>一物多码 → <strong>物料齐套性检查失效</strong></p>
    </div>
    <div class="success">
      <p><strong>流程执行到位的收益</strong><br/>一物一码，跨系统一致消费<br/>MRP 运算准确，采购计划可信<br/>车间报工顺畅，生产进度实时可见<br/>物料齐套检查可靠，装配计划可执行<br/>质量追溯链路完整，适航审核合规</p>
    </div>
  </div>
```

Note: The existing Sankey chart blocks (`sankey-d4`, `sankey-d1`, `sankey-d3`, `sankey-d2`) are preserved after the MDM content above. They are the data visualization evidence supporting the MDM建设路径.

- [ ] **Step 2: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "feat: rewrite s14 with MDM 5-stage workflow (stages 2-5, summary)"
```

---

### Task 6: Update appendix with source documents

**Files:**
- Modify: `docs/Demo/信息化系统应用与集成说明会.html` (appendix table, lines 1247-1263)

- [ ] **Step 1: Add source document entries to appendix table**

Insert before the last `</tbody>` in the appendix table:

```html
      <tr><td>PLM项目第一阶段精细化实施方案</td><td>V1.0</td><td>2026-05-11</td><td>已融合至 §8 PLM 是什么</td></tr>
      <tr><td>主数据管理 MDM 五阶段工作流程</td><td>—</td><td>2026</td><td>已融合至 §12 MDM基石 + §14 MDM路径</td></tr>
```

- [ ] **Step 2: Commit**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "docs: add merged source documents to appendix"
```

---

### Task 7: Verification

**Files:**
- Check: `docs/Demo/信息化系统应用与集成说明会.html`

- [ ] **Step 1: Verify HTML structure integrity**

```bash
# Check the file parses correctly by counting open/close tags
# Verify file size is reasonable
(Get-Content "docs/Demo/信息化系统应用与集成说明会.html" | Measure-Object -Line).Lines
```

- [ ] **Step 2: Check that all critical sections are present**

Verify the following sections exist in the merged file:
- s8: PLM 前情总结, 五阶段路径, 工艺迁移, 数据字典
- s11: 事故链 (unchanged)
- s12: original 5 cards + MDM pipeline SVG + Stage 1 detail
- s14: Stages 2-5 + Sankey charts
- s15-s19: golden source, interfaces, Q1-Q8, org, action items (unchanged)

Run: Check file for section IDs

```powershell
Select-String -Path "docs/Demo/信息化系统应用与集成说明会.html" -Pattern 'id="(plm-|mdm-|s1[1-9]|s8|s9)' | ForEach-Object { $_.Line.Trim() }
```

- [ ] **Step 3: Open in browser and verify**
  - File opens without blank page
  - Nav links scroll to correct sections
  - All grid layouts render without overflow
  - ECharts Sankey charts still render
  - Topo modal click still works

- [ ] **Step 4: Responsive check**
  - Resize to mobile width (~640px)
  - Verify new grids (`.flow`, `.cat-grid`, `.resp-grid`, `.field-grid`, `.summary-grid`) collapse to 1 or 2 columns
  - Verify `.flow-step:after` arrows hide on mobile

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add docs/Demo/信息化系统应用与集成说明会.html
git commit -m "fix: verification fixes for PLM/MDM merge"
```
