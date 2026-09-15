// Read-only route review. Loads formal registrations with DB factories/SQLite blocked;
// never listens, reads private config, or executes requests. JSON is a trace, not an authorization whitelist.
const {source,reference,staticRoutes,formalRoutes,localEvidence,sha}=require('./testHelpers/routeInventory');

const repositories={
  offices:['officeRepository'],
  publications:['publicationRepository'],
  accounts:['governanceAccessMysqlRepository'],governance:['governanceAccessMysqlRepository'],
  conflicts:['conflictMysqlRepository'],dataMap:['dataMapMysqlRepository'],fieldEntries:['dataMapMysqlRepository'],
  fieldIdentities:['dataMapMysqlRepository'],import:['dataMapMysqlRepository'],mappings:['mappingMysqlRepository','governanceAccessMysqlRepository'],
  terminology:['terminologyMysqlRepository'],todos:['todoMysqlRepository'],
  governanceGuidance:['governanceGuidanceMysqlRepository'],processV7PreviewReview:['processV7PreviewReviewRepository'],
  processDataGovernance:['processDataGovernanceRepository'],processDesignMysql:['routes/processDesignMysql'],
  processGovernance:['processGovernanceMysqlRepository','processGovernanceIssuePoolRepository','processInputBaselineReviewRepository']
};
const notes={
  offices:'办公室任务复用mdm_todos。交办沿用治理分派权限；成员分配仅限明确的办公室负责人，办结仅限当前办理人。事务中复核当前身份、办公室和成员状态、修订号，写入任务与人员事件，不授予正式审核或发布权限。',
  publications:'手工导入发布；事务内复核当前账号和发布权限、唯一标识、内容摘要、目录基线及版本指针，追加不可变发布记录和变更日志。组织和人员保留原标识，不批量创建账号。',
  accounts:'身份管理；仓储检查授权依据、生效期、同部门授权、账号状态、最后管理员及撤权，事务更新auth_version并记录identity_access_events。',
  governance:'部门责任记录；仓储检查当前人员、部门最终负责人及依据。无客户端修订令牌，按追加记录保存，不能视为流程审核或发布。',
  processV7PreviewReview:'预览专表；写入受精确process_ref及开关限制。已有案例写入在事务中锁定案例/当前修订并复核摘要；核对绑定参与部门。提升才写正式草稿，非正式版本。',
  processDesignMysql:'V7状态转换在同一事务中锁定案例、主档、草稿、审核及版本，复核正式身份、部门、状态、修订和摘要并记录事件；旧结构编辑入口拒绝V7。V3完整内容保存有expected_revision；旧分项编辑没有统一客户端修订令牌，不作V7事务证明。',
  processDataGovernance:'默认关闭；精确不可变process_version_id，锁定工作包，复核来源摘要、expected_revision和当前状态；MDM治理或指定部门事实答复，写事件。',
  processGovernance:'质量单、映射待办及问题池分别检查权限、部门/参与人和对象状态，调用各自事件仓储。旧工单部分动作无统一客户端修订令牌；不能以此清单宣称事务/并发验收。输入基线复核仍读指定artifact批次并写MySQL。',
  mappings:'部门草稿、提交/审核任务、结构门槛和责任证据分别检查；仓储复核状态、记录审核/版本历史。具体锁与条件UPDATE见对应方法，不从路由分类推定原子性。',
  governanceGuidance:'有效办理人、最终负责人或有效委派及指导意见状态检查；记录guidance事件。无统一客户端修订令牌，不能视为V7审核或事务证明。',
  conflicts:'分派、处理人、升级与终裁权限分别检查，仓储校验指派及状态并记录历史。非V7发布事务。',
  dataMap:'部门上下文维护；不是正式数据地图发布。无统一客户端修订令牌，状态/审计范围以具体SQL和方法为准。',
  fieldEntries:'按所属上下文的部门及业务权限维护字段；保留字段变更审计。无统一客户端修订令牌，非正式版本发布。',
  fieldIdentities:'本部门字段身份维护/确认；按现有字段与上下文校验。无统一客户端修订令牌，非V7事务。',
  import:'内存Excel上传；本部门上下文、固定列和内容校验；不发送通知。无客户端修订令牌，不代表实际导入验收。',
  terminology:'本部门流程下待审术语维护与部门审核；当前部分动作仅有状态检查及审核字段，无统一修订令牌或全量变更事件，不能视为正式术语发布验收。',
  todos:'任务分派、目标部门办理、结构权限删除；完成与删除在事务中锁定待办并拒绝已由办公室承接的任务。旧任务仍无客户端修订令牌，创建事件与创建写入尚未合并事务；不作为V7核对待办实现或验收。'
};

function repositoryEvidence(row,trace) {
  const files=(repositories[row.file.replace(/\.js$/,'')]||[]).map(name=>'server/'+name+'.js');
  const methods=[];
  for(const name of trace.repositoryCalls) {
    for(const file of files) {
      const content=source(file);const pattern=new RegExp('(?:async\\s+|function\\s+)'+name+'\\s*\\(');const match=pattern.exec(content);
      if(!match)continue;
      const next=content.slice(match.index+match[0].length).search(/\n    (?:async )?\w+\([^\n]*\)\s*\{|\n  (?:async )?function /);
      const body=content.slice(match.index,next<0?content.length:match.index+match[0].length+next);
      const ref={file,line:content.slice(0,match.index).split('\n').length,anchor:name};
      const signals=body.split(/\r?\n/).map((s,i)=>({line:ref.line+i,text:s.trim()})).filter(s=>/FOR UPDATE|FOR SHARE|beginTransaction|withTransaction|runFormalV7Transaction|status[=!.]|status\s+(?:IN|NOT)|expected|revision|content_hash|addEvent|insertEvent|record.*Event|audit|affectedRows|commit\(|rollback\(/i.test(s.text));
      methods.push({...ref,signals});break;
    }
  }
  return {files:files.map(file=>({file,sha256:sha(source(file))})),methods};
}

function buildAudit() {
  const declarations=staticRoutes();const formal=formalRoutes();const entries=[];const first=new Map();
  for(const row of formal.rows) {
    const trace=localEvidence(row);const code=trace.source;
    const key=`${row.base} ${row.method} ${row.path}`;
    const previous=first.get(key);
    let classification;
    if(previous&&previous.category==='retired')classification={category:'shadowed',reason:'同一路径前置终止处理器已拒绝；后方旧实现不可达',blockedBy:previous.id};
    else if(/LEGACY_IDENTITY_API_RETIRED|CORE_GOVERNANCE_MODEL_READ_ONLY|ORGANIZATION_TRUTH_READ_ONLY/.test(row.handlers.map(h=>h.body).join('\n'))) classification={category:'retired',reason:'正式注册但明确拒绝写入'};
    else if(row.file==='org.js'&&['/login','/logout','/me/password'].includes(row.path))classification={category:'publicOrSelfService',reason:'登录或本人会话/口令服务；不能作为业务写权限'};
    else if((row.file==='publications.js'&&['/parse','/preview'].includes(row.path))||(row.file==='processDesignEditor.js'&&row.path==='/validate')||(row.file==='processDesignMysql.js'&&row.path==='/import-structured-output/preview')||(row.file==='processV7PreviewReview.js'&&row.path.endsWith('/revisions/preview')))classification={category:'validationOnly',reason:'POST承载内存校验/差异预览，不持久化业务记录'};
    else if(trace.guards.length&&(repositories[row.file.replace(/\.js$/,'')])) classification={category:row.file==='accounts.js'?'identityWrite':'businessWrite',reason:notes[row.file.replace(/\.js$/,'')]};
    else classification={category:'unclassified',reason:'未找到已追溯的权限及仓储路径，须核对后补充具体证据'};
    const entry={id:`${row.file}:${row.line} ${row.method} ${row.path}`,file:row.file,line:row.line,base:row.base,path:row.path,method:row.method,...classification,
      authentication:row.handlers.some(h=>h.name==='requireAuth')||row.middleware.some(m=>m.handlers.some(h=>h.name==='requireAuth'))?'requireAuth: 账号/person状态、auth_version、首次改密':'公共登录/退出；见具体处理器',
      csrf:'server/index.js在所有路由注册前应用csrfProtection；登录例外；本人会话写入要求令牌',
      permissions:trace.permissions,guards:trace.guards,helperReferences:trace.helpers,
      departmentAndStateChecks:code.split('\n').map(s=>s.trim()).filter(s=>/if\s*\(|assert\w+\(|expected|revision|content_hash/.test(s)).slice(0,100),
      repository:repositoryEvidence(row,trace),sourceSha256:sha(source('server/routes/'+row.file))};
    const signals=entry.repository.methods.flatMap(method=>method.signals.map(signal=>({file:method.file,...signal})));
    entry.controls={
      permission:{guards:entry.guards,codes:entry.permissions,authentication:entry.authentication},
      department:{references:entry.helperReferences.filter(ref=>/Department|Visible|Scope|Participant|Actor|View|Edit|Review/.test(ref.anchor)),checks:entry.departmentAndStateChecks.filter(line=>/department|scope|participant|Visible/i.test(line))},
      objectState:{checks:entry.departmentAndStateChecks.filter(line=>/status|state|draft|case|task|conflict/i.test(line)),repositorySignals:signals.filter(signal=>/status|state/i.test(signal.text))},
      concurrency:{signals:signals.filter(signal=>/FOR UPDATE|FOR SHARE|Transaction|expected|revision|content_hash|affectedRows|commit|rollback/i.test(signal.text)),limitation:'静态锁、修订或事务线索不代表已执行；缺少线索不按默认值补造。V7另有真实隔离MySQL证据，旧分项接口不据此宣称并发安全。'},
      audit:{signals:signals.filter(signal=>/event|audit|review|history/i.test(signal.text)),limitation:'按具体仓储方法、业务事件/审核字段追溯；没有独立事件或事务的部分如实保留，分类不是业务验收。'}
    };
    entries.push(entry);if(!previous)first.set(key,entry);
  }
  const index=source('server/index.js');
  const isolatedNames=[];
  for(const row of declarations) {
    if(formal.rows.some(r=>r.file===row.file&&r.line===row.line))continue;
    const isolated=isolatedNames.includes(row.file)||row.file==='processDesign.js';
    entries.push({...row,id:`${row.file}:${row.line} ${row.method} ${row.path}`,category:isolated?'isolatedLegacy':'unregistered',
      reason:isolated?'正式模式不加载；历史SQLite记录保留。流程设计由MySQL模块取代，其余在正式入口requireAuth后返回410。':'未在正式Express注册中发现，须检查消费者；不计为已保护的正式业务写入',
      registration:reference('server/index.js','function registerRouteIfExists'),
      permission:'正式请求不能进入此实现；旧签名权限只作历史信息',department:'正式请求不能进入此实现',state:'正式请求不能进入此实现',concurrency:'正式请求不能进入此实现',audit:'正式请求不能进入此实现'});
  }
  const counts={};for(const entry of entries)counts[entry.category]=(counts[entry.category]||0)+1;
  return {schemaVersion:2,kind:'read-only registration and source trace; not business acceptance',counts,formalRegistrations:formal.rows.length,staticDeclarations:declarations.length,
    globalControls:[reference('server/index.js','app.use(csrfProtection)'),reference('server/auth.js','function requireAuth'),reference('server/roleDefinitions.js','const ACCESS_MODEL_VERSION')],
    mounts:formal.mounts,entries,unclassified:entries.filter(e=>['unclassified','unregistered'].includes(e.category))};
}
if(require.main===module) {
  const audit=buildAudit();
  console.log(JSON.stringify(process.argv.includes('--json')?audit:{counts:audit.counts,formalRegistrations:audit.formalRegistrations,staticDeclarations:audit.staticDeclarations,unclassified:audit.unclassified},null,2));
  if(audit.unclassified.length)process.exitCode=1;
}
module.exports={buildAudit};
