const fs = require('fs');

const imgs = JSON.parse(fs.readFileSync('screenshots/screenshots-base64.json', 'utf-8'));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>MDM 平台使用说明</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --navy:#0f2a5e;--blue:#1a56db;--blue-lt:#e8f0fe;
  --bg:#f8fafc;--card:#fff;--border:#e2e8f0;
  --text:#1e293b;--muted:#475569;--gray:#64748b;
  --green:#16a34a;--red:#dc2626;--amber:#d97706;
}
html{scroll-behavior:smooth}
body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.8;display:flex;min-height:100vh}

/* ── SIDEBAR ── */
.sidebar{position:fixed;top:0;left:0;width:240px;height:100vh;background:var(--navy);color:#fff;display:flex;flex-direction:column;z-index:100;overflow-y:auto}
.sidebar-header{padding:24px 20px 20px;border-bottom:1px solid rgba(255,255,255,.1)}
.sidebar-logo{font-size:22px;font-weight:800;color:#7dd3fc;margin-bottom:4px}
.sidebar-title{font-size:12px;color:rgba(255,255,255,.55)}
.sidebar-nav{list-style:none;padding:12px 0;flex:1}
.sidebar-nav li{margin:0}
.nav-item{display:block;padding:8px 20px;color:rgba(255,255,255,.6);font-size:13px;text-decoration:none;border-left:3px solid transparent;transition:.15s}
.nav-item:hover{color:#fff;background:rgba(255,255,255,.06)}
.nav-item.active{color:#fff;background:rgba(255,255,255,.1);border-left-color:#7dd3fc}
.nav-item .nav-num{display:inline-block;width:20px;font-size:11px;color:rgba(255,255,255,.35);margin-right:6px}
.sidebar-footer{padding:16px 20px;font-size:11px;color:rgba(255,255,255,.3);border-top:1px solid rgba(255,255,255,.1)}

/* ── CONTENT ── */
.content{margin-left:240px;flex:1;min-width:0;padding:48px 56px;max-width:960px}
.sec{margin-bottom:56px;scroll-margin-top:32px}

/* Cover */
.cover-sec{background:linear-gradient(135deg,#0f2a5e 0%,#1a56db 100%);color:#fff;padding:56px 48px;border-radius:12px;margin-bottom:48px}
.cover-badge{display:inline-block;background:rgba(255,255,255,.12);color:#a5c8ff;font-size:11px;padding:3px 12px;border-radius:20px;border:1px solid rgba(255,255,255,.2);margin-bottom:16px}
.cover-sec h1{font-size:36px;margin-bottom:8px}
.cover-sub{color:rgba(255,255,255,.65);font-size:15px;margin-bottom:20px}
.cover-meta{display:flex;gap:16px;font-size:12px;color:rgba(255,255,255,.45)}
.cover-meta span{background:rgba(255,255,255,.08);padding:4px 12px;border-radius:12px}

/* Section heading */
.sec-hd{display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid var(--border)}
.sec-num{width:32px;height:32px;border-radius:50%;background:var(--blue);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sec-hd h2{font-size:22px;color:var(--navy)}
.sec-hd .sd{font-size:12px;color:var(--gray);margin-left:auto}

/* Card */
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px 24px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card h3{font-size:15px;color:var(--navy);margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.card p,.card li{font-size:13px;color:var(--muted);line-height:1.85}
.card ul{padding-left:18px}

/* Screenshot */
.ss-wrap{margin:20px 0}
.ss-wrap img{width:100%;max-width:100%;border-radius:8px;box-shadow:0 2px 16px rgba(0,0,0,.1);border:1px solid var(--border);display:block}
.ss-wrap .ss-cap{font-size:12px;color:var(--gray);margin-top:8px;text-align:center}

/* Tables */
.tw{overflow-x:auto;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:13px}
thead{background:var(--navy);color:#fff}
th,td{padding:8px 12px;text-align:left;border:1px solid var(--border)}
th{font-weight:600;font-size:12px}
tbody tr:nth-child(even){background:var(--bg)}
tbody tr:hover{background:var(--blue-lt)}
td .chk{color:var(--green);font-weight:700}
td .na{color:var(--gray)}

/* Info boxes */
.info{background:#dbeafe;border-left:4px solid var(--blue);padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;font-size:13px;color:#1e40af}
.warn{background:#fef3c7;border-left:4px solid var(--amber);padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;font-size:13px;color:#92400e}

/* Code */
pre{background:#1e293b;color:#e2e8f0;padding:16px 20px;border-radius:8px;overflow-x:auto;font-size:12px;line-height:1.7;margin:16px 0}
pre code{font-family:"Cascadia Code","Fira Code","Consolas",monospace}
code{background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:12px;font-family:monospace;color:#c2410c}

/* Flow diagram */
.flow{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;padding:16px 0}
.flow-node{background:var(--blue-lt);color:var(--blue);padding:4px 12px;border-radius:4px;font-weight:600}
.flow-arrow{color:var(--gray)}
.flow-reject{color:var(--red);font-size:11px}

/* Menu toggle (mobile) */
.menu-toggle{display:none;position:fixed;top:12px;left:12px;z-index:110;width:40px;height:40px;border-radius:8px;border:1px solid var(--border);background:var(--card);align-items:center;justify-content:center;font-size:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.1)}

@media(max-width:768px){
  .sidebar{transform:translateX(-100%);transition:transform .25s ease}
  .sidebar.open{transform:translateX(0)}
  .content{margin-left:0;padding:20px 16px}
  .menu-toggle{display:flex}
  .cover-sec{padding:32px 24px}
  .cover-sec h1{font-size:26px}
}
</style>
</head>
<body>

<nav class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <div class="sidebar-logo">MDM</div>
    <div class="sidebar-title">平台使用说明</div>
  </div>
  <ul class="sidebar-nav" id="sidebarNav">
    <li><a href="#cover" class="nav-item active"><span class="nav-num">00</span>概览</a></li>
    <li><a href="#login" class="nav-item"><span class="nav-num">01</span>登录与账号</a></li>
    <li><a href="#dashboard" class="nav-item"><span class="nav-num">02</span>统计看板</a></li>
    <li><a href="#masterdata" class="nav-item"><span class="nav-num">03</span>主数据台账</a></li>
    <li><a href="#approval" class="nav-item"><span class="nav-num">04</span>主数据审批</a></li>
    <li><a href="#quality" class="nav-item"><span class="nav-num">05</span>数据质量</a></li>
    <li><a href="#bizmap" class="nav-item"><span class="nav-num">06</span>业务地图</a></li>
    <li><a href="#commands" class="nav-item"><span class="nav-num">07</span>常用命令</a></li>
  </ul>
  <div class="sidebar-footer">v1.0 · 2026-05-18<br>昌兴复材 · 信息化项目组</div>
</nav>

<button class="menu-toggle" id="menuToggle" aria-label="菜单">&#9776;</button>

<main class="content" id="content">

<!-- ══════════ 00 封面 ══════════ -->
<section id="cover" class="sec cover-sec">
  <div class="cover-badge">使用说明</div>
  <h1>MDM 平台</h1>
  <p class="cover-sub">航空复材制造领域 · 主数据管理与业务关系映射工具集</p>
  <div class="cover-meta">
    <span>版本 1.0</span>
    <span>2026-05-18</span>
    <span>昌兴复材</span>
  </div>
</section>

<!-- ══════════ 01 登录与账号 ══════════ -->
<section id="login" class="sec">
  <div class="sec-hd">
    <div class="sec-num">1</div>
    <h2>登录与账号</h2>
    <div class="sd">账户体系 / 角色权限</div>
  </div>

  <div class="card">
    <h3>登录方式</h3>
    <p>打开系统后进入登录页，输入<strong>工号</strong>和<strong>密码</strong>，点击「登录」按钮即可进入。系统采用自建用户体系，使用 bcrypt 加密存储密码。</p>
  </div>

  <div class="ss-wrap">
    <img src="${imgs.login}" alt="MDM平台登录页"/>
    <div class="ss-cap">▲ MDM 平台登录页面</div>
  </div>

  <div class="card">
    <h3>预设账号</h3>
    <p>以下 10 个演示账号已预置在系统中，<strong>统一密码：demo12345678</strong></p>
  </div>
  <div class="tw">
  <table>
    <thead><tr><th>工号</th><th>姓名</th><th>岗位</th><th>角色</th><th>权限范围</th></tr></thead>
    <tbody>
      <tr><td>ADMIN001</td><td>系统管理员</td><td>系统管理员</td><td>admin</td><td>全部功能</td></tr>
      <tr><td>EMP0001</td><td>张工</td><td>主任工程师</td><td>owner</td><td>台账 + 审批</td></tr>
      <tr><td>EMP0002</td><td>李质量</td><td>质量主管</td><td>reviewer</td><td>台账 + 审批 + 质量</td></tr>
      <tr><td>EMP0003</td><td>王物资</td><td>物资主管</td><td>owner</td><td>台账 + 审批</td></tr>
      <tr><td>EMP0004</td><td>赵信息</td><td>项目经理</td><td>admin</td><td>全部功能</td></tr>
      <tr><td>EMP0005</td><td>刘车间</td><td>车间主任</td><td>submitter</td><td>仅台账</td></tr>
      <tr><td>EMP0006</td><td>陈财务</td><td>财务主管</td><td>reviewer</td><td>台账 + 审批 + 质量</td></tr>
      <tr><td>EMP0007</td><td>周人事</td><td>人事主管</td><td>owner</td><td>台账 + 审批</td></tr>
      <tr><td>EMP0008</td><td>吴运维</td><td>运维主管</td><td>submitter</td><td>仅台账</td></tr>
      <tr><td>EMP0009</td><td>郑项目</td><td>项目经理</td><td>submitter</td><td>仅台账</td></tr>
    </tbody>
  </table>
  </div>

  <div class="card">
    <h3>角色权限矩阵</h3>
  </div>
  <div class="tw">
  <table>
    <thead><tr><th>功能模块</th><th>admin</th><th>owner</th><th>reviewer</th><th>submitter</th></tr></thead>
    <tbody>
      <tr><td>统计看板</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td></tr>
      <tr><td>报送管理</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td></tr>
      <tr><td>能力与流程申报</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td></tr>
      <tr><td>业务地图</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td></tr>
      <tr><td>待办收到</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="na">—</span></td></tr>
      <tr><td>评审记录</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="na">—</span></td></tr>
      <tr><td>术语词典</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="na">—</span></td></tr>
      <tr><td>冲突管理</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="na">—</span></td></tr>
      <tr><td>主数据台账</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td></tr>
      <tr><td>主数据审批</td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="chk">&#10003;</span></td><td><span class="na">—</span></td></tr>
      <tr><td>数据质量</td><td><span class="chk">&#10003;</span></td><td><span class="na">—</span></td><td><span class="chk">&#10003;</span></td><td><span class="na">—</span></td></tr>
    </tbody>
  </table>
  </div>
</section>

<!-- ══════════ 02 统计看板 ══════════ -->
<section id="dashboard" class="sec">
  <div class="sec-hd">
    <div class="sec-num">2</div>
    <h2>统计看板</h2>
    <div class="sd">概览仪表盘 / 数据可视化</div>
  </div>

  <div class="card">
    <h3>概览指标</h3>
    <p>系统首页仪表盘提供四个核心指标卡片和两张图表，帮助管理员快速掌握全局状态：</p>
    <ul>
      <li><strong>流程映射</strong> — 已录入的业务流程→系统映射总数</li>
      <li><strong>字段台账</strong> — 已登记的字段条目总数</li>
      <li><strong>待处理待办</strong> — 当前跨部门待办事项数量</li>
      <li><strong>未解决冲突</strong> — 尚未解决的字段/术语冲突数</li>
    </ul>
  </div>

  <div class="ss-wrap">
    <img src="${imgs.dashboard}" alt="MDM平台统计看板"/>
    <div class="ss-cap">▲ MDM 平台统计看板 — 概览指标卡片 + 图表</div>
  </div>

  <div class="card">
    <h3>图表说明</h3>
    <ul>
      <li><strong>各部门流程数</strong>：柱状图展示每个部门的流程映射数量分布</li>
      <li><strong>审批状态分布</strong>：饼图展示当前所有映射的审批状态比例</li>
    </ul>
  </div>
</section>

<!-- ══════════ 03 主数据台账 ══════════ -->
<section id="masterdata" class="sec">
  <div class="sec-hd">
    <div class="sec-num">3</div>
    <h2>主数据台账</h2>
    <div class="sd">主数据注册中心 / 编码引擎 / 批量导入</div>
  </div>

  <div class="card">
    <h3>功能概述</h3>
    <p>主数据台账是 MDM 核心模块，提供主数据条目的统一管理入口，支持手动新增、Excel 批量导入、自动编码和去重合并。</p>
  </div>

  <div class="ss-wrap">
    <img src="${imgs.masterdata}" alt="MDM平台主数据台账"/>
    <div class="ss-cap">▲ 主数据台账 — 分类筛选 / 状态筛选 / 搜索 / CRUD 操作</div>
  </div>

  <div class="card">
    <h3>筛选条件</h3>
  </div>
  <div class="tw">
  <table>
    <thead><tr><th>筛选项</th><th>可选值</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>分类</td><td>全部 / 零组件 / 工艺组件 / 工装 / 原材料 / 设备 / 工具</td><td>按物料类别过滤</td></tr>
      <tr><td>状态</td><td>全部 / 新增 / 审核中 / 生效 / 变更中 / 停用 / 归档</td><td>按生命周期状态过滤</td></tr>
      <tr><td>搜索</td><td>自由文本</td><td>按编码或名称模糊搜索</td></tr>
    </tbody>
  </table>
  </div>

  <div class="card">
    <h3>操作按钮</h3>
  </div>
  <div class="tw">
  <table>
    <thead><tr><th>按钮</th><th>功能</th></tr></thead>
    <tbody>
      <tr><td>查询</td><td>应用筛选条件刷新列表</td></tr>
      <tr><td>+ 新增条目</td><td>弹出表单手动添加主数据条目，编码由规则引擎自动生成</td></tr>
      <tr><td>Excel 导入</td><td>批量上传 Excel 文件，支持格式校验和导入结果明细</td></tr>
    </tbody>
  </table>
  </div>

  <div class="info">
    <strong>自动编码引擎</strong>：新增主数据条目时，系统根据分类和编码规则自动生成唯一物料编码，无需手动维护编码序列。
  </div>
</section>

<!-- ══════════ 04 主数据审批 ══════════ -->
<section id="approval" class="sec">
  <div class="sec-hd">
    <div class="sec-num">4</div>
    <h2>主数据审批</h2>
    <div class="sd">生命周期状态机 / 多级会签</div>
  </div>

  <div class="card">
    <h3>功能概述</h3>
    <p>管理主数据变更的完整审批流程，支持 7 种生命周期状态和多级会签审批机制。每个变更申请经过严格的状态流转，确保数据变更的可追溯性。</p>
  </div>

  <div class="ss-wrap">
    <img src="${imgs.approval}" alt="MDM平台主数据审批"/>
    <div class="ss-cap">▲ 主数据审批 — 变更审批列表</div>
  </div>

  <div class="card">
    <h3>生命周期状态流转</h3>
  </div>
  <div class="flow" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px 20px">
    <span class="flow-node">新增</span>
    <span class="flow-arrow">→</span>
    <span class="flow-node">审核中</span>
    <span class="flow-arrow">→</span>
    <span class="flow-node">生效</span>
    <span class="flow-arrow">→</span>
    <span class="flow-node">变更中</span>
    <span class="flow-arrow">→</span>
    <span class="flow-node">停用</span>
    <span class="flow-arrow">→</span>
    <span class="flow-node">归档</span>
  </div>
  <div class="flow">
    <span class="flow-reject" style="margin-top:4px">↑ 审核不通过可驳回至「新增」状态重新修改</span>
  </div>

  <div class="card">
    <h3>审批流程</h3>
    <p><code>提交变更申请 → 部门负责人审核 → 数据管理员复核 → 变更生效（或驳回）</code></p>
    <p style="margin-top:8px">每个审批节点可配置审批人，审批历史完整记录到 <code>approval_history</code> 表，确保审计追踪。</p>
  </div>
</section>

<!-- ══════════ 05 数据质量 ══════════ -->
<section id="quality" class="sec">
  <div class="sec-hd">
    <div class="sec-num">5</div>
    <h2>数据质量</h2>
    <div class="sd">KPI 仪表盘 / 黄金源确认进度</div>
  </div>

  <div class="card">
    <h3>功能概述</h3>
    <p>数据质量仪表盘提供四大核心 KPI 指标和黄金源确认进度追踪，帮助数据治理团队持续监控和改进数据质量。</p>
  </div>

  <div class="ss-wrap">
    <img src="${imgs.quality}" alt="MDM平台数据质量仪表盘"/>
    <div class="ss-cap">▲ 数据质量仪表盘 — KPI 指标 + 黄金源确认进度</div>
  </div>

  <div class="card">
    <h3>四大 KPI 指标</h3>
  </div>
  <div class="tw">
  <table>
    <thead><tr><th>指标</th><th>说明</th><th>目标</th></tr></thead>
    <tbody>
      <tr><td>完整率</td><td>必填字段的填写比例，反映数据完整性</td><td>100%</td></tr>
      <tr><td>唯一率</td><td>编码/名称无重复的比例，防止重复数据</td><td>100%</td></tr>
      <tr><td>及时率</td><td>按时完成的数据更新比例</td><td>≥95%</td></tr>
      <tr><td>消费一致率</td><td>下游系统消费数据与源头的一致性</td><td>100%</td></tr>
    </tbody>
  </table>
  </div>

  <div class="card">
    <h3>黄金源确认进度</h3>
    <p>按数据域（固化工艺、工艺资源、工艺路线、物料主数据等）展示字段黄金源的确认比例，逐域追踪数据治理进度。每个字段需要明确：<strong>维护部门、审批部门、只读系统</strong>。</p>
  </div>
</section>

<!-- ══════════ 06 业务地图 ══════════ -->
<section id="bizmap" class="sec">
  <div class="sec-hd">
    <div class="sec-num">6</div>
    <h2>业务地图</h2>
    <div class="sd">桑基图 / 关系链路可视化</div>
  </div>

  <div class="card">
    <h3>功能概述</h3>
    <p>以桑基图（Sankey）形式可视化展示 <strong>部门 → 业务能力 → 业务流程 → 应用系统</strong> 之间的完整关系链路，支持交互式筛选和钻取分析。</p>
  </div>

  <div class="ss-wrap">
    <img src="${imgs.bizmap}" alt="MDM平台业务地图"/>
    <div class="ss-cap">▲ 业务地图 — ECharts 桑基图展示四层关系链路</div>
  </div>

  <div class="card">
    <h3>交互功能</h3>
    <ul>
      <li><strong>悬停高亮</strong>：鼠标悬停在节点或流线上，高亮关联的上下游链路</li>
      <li><strong>拖拽节点</strong>：可拖拽调整节点垂直位置，优化布局</li>
      <li><strong>缩放平移</strong>：支持鼠标滚轮缩放和拖拽平移，适应大规模数据</li>
    </ul>
  </div>
</section>

<!-- ══════════ 07 常用命令 ══════════ -->
<section id="commands" class="sec">
  <div class="sec-hd">
    <div class="sec-num">7</div>
    <h2>常用命令</h2>
    <div class="sd">开发 / 测试 / 运维速查</div>
  </div>

  <div class="card">
    <h3>服务管理</h3>
    <pre><code>cd mdm-platform
npm install              # 安装依赖
npm start                # 启动服务（Express，端口 3000）
npm run dev              # 开发模式（nodemon 自动重启）
npm run init-db          # 初始化/重建数据库</code></pre>
  </div>

  <div class="card">
    <h3>测试命令</h3>
    <pre><code>npm run smoke                     # 基础冒烟测试
node scripts/smoke-master-data.js # 主数据模块冒烟测试（8 用例）
node scripts/smoke-integration.js # 集成接口冒烟测试（7 用例）

npm test:org          # 组织架构路由测试
npm test:catalog      # 业务能力/流程目录测试
npm test:mappings     # 映射路由测试
npm test:conflicts    # 冲突管理测试
npm test:terms        # 术语与版本测试
npm test:export       # 导出测试
npm test:import       # 导入测试
npm test:frontend     # 前端静态资源测试</code></pre>
  </div>

  <div class="card">
    <h3>数据操作</h3>
    <pre><code># 数据库文件位置
mdm-platform/data/platform.db

# 使用 sqlite3 命令行直接查询
sqlite3 data/platform.db "SELECT * FROM users;"

# 重置演示数据
node scripts/init-db.js && node scripts/seed-demo-data.js</code></pre>
  </div>

  <div class="info">
    <strong>注意</strong>：SQLite 是本地文件数据库，不适用于多进程并发部署。生产环境建议迁移至 PostgreSQL。
  </div>
</section>

</main>

<script>
(function() {
  // ── IntersectionObserver: highlight current nav item ──
  var sections = document.querySelectorAll('section[id]');
  var navItems = document.querySelectorAll('.nav-item');
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        navItems.forEach(function(item) {
          var href = item.getAttribute('href');
          item.classList.toggle('active', href === '#' + entry.target.id);
        });
      }
    });
  }, { rootMargin: '-15% 0px -70% 0px' });
  sections.forEach(function(s) { observer.observe(s); });

  // ── Mobile hamburger menu ──
  var toggle = document.getElementById('menuToggle');
  var sidebar = document.getElementById('sidebar');
  toggle.addEventListener('click', function() {
    sidebar.classList.toggle('open');
  });
  // Close sidebar when nav item clicked (mobile)
  sidebar.querySelectorAll('.nav-item').forEach(function(a) {
    a.addEventListener('click', function() {
      sidebar.classList.remove('open');
    });
  });
})();
</script>

</body>
</html>`;

fs.writeFileSync('MDM平台使用说明.html', html, 'utf-8');
console.log('HTML written:', html.length, 'chars');
console.log('Done!');
