'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app: structuredOutputApp } = require('../../structured-output-service/server');
const { hashPassword } = require('../lib/auth');
const { AppError } = require('../lib/errors');
const { repositoryState } = require('../lib/repository');
const { createStructuredToolClient } = require('../lib/structured-tool');
const { createAssistantRuntime, createDshGatewayHandler } = require('../server');

const repoRoot = path.join(__dirname, '..', '..', '..');
const appRoot = path.join(__dirname, '..');
const repo = repositoryState(repoRoot);
const runtimeDir = path.join(os.tmpdir(), `structure-assistant-browser-${process.pid}`);
const passwordHash = hashPassword('Pilot-Browser-2026!');
const accounts = [
  ['zgy', 'zhangguangyi', '张广懿', '信息化项目组', 'admin'],
  ['dingshuo', 'dingshuo', '丁硕', '信息化项目组', 'user'],
  ['engineering_rd', 'engineering-rd-pilot', '工程技术部研发', '工程技术部', 'user'],
  ['engineering_production', 'engineering-production-pilot', '工程技术部批产', '工程技术部', 'user'],
  ['hr', 'hr-pilot', '行政人事部', '行政人事部', 'user']
].map(item => ({
  id: item[0],
  username: item[1],
  displayName: item[2],
  department: item[3],
  role: item[4],
  passwordHash
}));

const config = {
  appRoot,
  repoRoot,
  assistant: {
    host: '127.0.0.1',
    port: 3103,
    gatewayPort: 3104,
    structuredToolBaseUrl: 'http://127.0.0.1:3101'
  },
  security: {
    sessionHours: 8,
    maxUploadBytes: 10 * 1024 * 1024,
    maxModelInputChars: 240000,
    loginWindowMinutes: 15,
    loginMaxAttempts: 5,
    allowHttp: true,
    allowDirty: true,
    sessionSecret: 'browser-fixture-session-secret',
    tlsCertPath: '',
    tlsKeyPath: ''
  },
  deepseek: {
    baseUrl: 'http://fixture.invalid',
    fillModel: 'deepseek-v4-pro',
    reviewModel: 'deepseek-v4-pro',
    fillMaxTokens: 8192,
    reviewMaxTokens: 8192,
    requestTimeoutMs: 1000,
    lowBalanceCny: 20
  },
  dsh: {
    version: '0.1.0-rc.6',
    nodeMajor: 24,
    maxInstances: 10,
    startTimeoutMs: 60000,
    stopGraceMs: 5000,
    nodeExecutable: process.execPath,
    trustedPublicHosts: ['127.0.0.1:3104']
  },
  accounts,
  runtime: {
    dir: runtimeDir,
    usageLogPath: path.join(runtimeDir, 'usage-metadata.jsonl'),
    maintenancePath: path.join(runtimeDir, 'maintenance.json'),
    dshRoot: path.join(runtimeDir, 'dsh')
  }
};

const fillProgressByKey = new Map();

function modelUserContent(options) {
  return options.messages.findLast(item => item.role === 'user')?.content || '';
}

function promptJsonSection(options, startLabel, endLabel) {
  const content = modelUserContent(options);
  const start = content.indexOf(startLabel);
  const end = content.indexOf(endLabel, start + startLabel.length);
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(content.slice(start + startLabel.length, end).trim());
  } catch (_) {
    return null;
  }
}

function currentUserAnswer(options) {
  const content = modelUserContent(options);
  const marker = '本轮用户回答：';
  const index = content.lastIndexOf(marker);
  return index >= 0 ? content.slice(index + marker.length).trim().slice(0, 500) : '';
}

function namedValue(answer, label) {
  const match = String(answer || '').match(new RegExp(`${label}[：:]\\s*([^；;\\n]+)`));
  return match?.[1]?.trim() || '';
}

function fillFixtureResult(options) {
  const priorMessages = promptJsonSection(options, '此前对话：', '本轮用户回答：') || [];
  const currentDocument = promptJsonSection(options, '当前JSON：', '当前结构校验错误：') || {};
  const progress = fillProgressByKey.get(options.apiKey) || {
    turn: priorMessages.filter(message => message?.role === 'assistant').length,
    hasForm: Array.isArray(currentDocument.forms) && currentDocument.forms.length > 0
  };
  const answer = currentUserAnswer(options);
  let result;

  if (progress.turn === 0) {
    result = {
      assistant_message: '已经建立第一项业务行为，先把实际执行角色问清楚。',
      questions: [{
        path: '/behaviors/0/current_actor_role',
        question: '“提交费用申请”由哪个部门的哪个岗位实际执行，该岗位在这里具体承担什么工作？建议按“部门：…；岗位：…；承担的工作：…”回答，便于分别记录执行角色和具体工作；暂不清楚时请直接写“暂不清楚”。'
      }],
      patch: [
        { op: 'replace', path: '/process/process_name', value: '费用申请流程' },
        { op: 'replace', path: '/process/scope', value: '公司内部费用申请事项' },
        {
          op: 'add',
          path: '/behaviors/-',
          value: {
            behavior_ref: 'behavior_submit_expense',
            node_type: 'action',
            behavior_name: '提交费用申请',
            behavior_description: '',
            current_actor_role: '',
            trigger: '',
            precondition: '',
            input_description: '',
            timing: null,
            completion_standard: '',
            output_description: '',
            work_role: null,
            countersign_all_required: false,
            countersign_target_departments: []
          }
        }
      ],
      field_statuses: [
        { path: '/process/process_name', status: 'confirmed', note: '演示环境已记录流程名称' },
        { path: '/behaviors/0/current_actor_role', status: 'temporarily_missing', note: '正在确认执行部门、岗位和实际工作' }
      ]
    };
  } else if (progress.turn === 1) {
    const department = namedValue(answer, '部门');
    const position = namedValue(answer, '岗位');
    const duty = namedValue(answer, '承担的工作') || namedValue(answer, '职责');
    const actor = [department, position].filter(Boolean).join('') || answer || '暂不清楚';
    result = {
      assistant_message: '已经记录这项业务行为的执行角色，接着确认它实际使用的表单或记录。',
      questions: [{
        path: '/forms',
        question: '“提交费用申请”使用哪一份表单、台账或记录，是否有编号？建议按“名称：…；编号：…”回答；确实没有时请明确写“没有表单或记录”，便于把该分支标为不适用。'
      }],
      patch: [
        { op: 'replace', path: '/behaviors/0/current_actor_role', value: actor },
        { op: 'replace', path: '/behaviors/0/behavior_description', value: duty || answer }
      ],
      field_statuses: [
        { path: '/behaviors/0/current_actor_role', status: 'confirmed', note: '已记录执行部门和岗位' },
        { path: '/behaviors/0/behavior_description', status: 'confirmed', note: '已记录该岗位在本行为中的实际工作' },
        { path: '/forms', status: 'temporarily_missing', note: '正在确认表单或记录' }
      ]
    };
  } else if (progress.turn === 2) {
    const hasNoForm = /没有|无表单|不适用/.test(answer);
    progress.hasForm = !hasNoForm;
    if (hasNoForm) {
      result = {
        assistant_message: '已经确认该行为不使用表单或记录，下一步核对它收到的数据及来源。',
        questions: [{
          path: '/behaviors/0/input_description',
          question: '执行“提交费用申请”前会收到哪些数据，这些数据分别从哪个部门、岗位、表单、系统或外部流程取得？建议逐项按“数据名称：…；来源：…”回答；没有输入数据时请明确说明。'
        }],
        patch: [],
        field_statuses: [
          { path: '/forms', status: 'not_applicable', note: '用户明确没有表单或记录' },
          { path: '/behaviors/0/input_description', status: 'temporarily_missing', note: '正在确认输入数据及来源' }
        ]
      };
    } else {
      const formName = namedValue(answer, '名称') || answer || '费用申请单';
      const formNo = namedValue(answer, '编号') || null;
      result = {
        assistant_message: '已经记录表单名称和编号，继续把表单内的数据项逐项问清楚。',
        questions: [{
          path: '/forms/0/areas',
          question: `“${formName}”包含哪些分区和数据项？建议逐项按“分区：…；数据项：…；类型：…；是否必填：…；填写说明：…”回答，所有数据项都需要列出；暂时无法列全时请说明还缺哪一部分。`
        }],
        patch: [{
          op: 'add',
          path: '/forms/-',
          value: {
            form_ref: 'form_expense_application',
            form_name: formName,
            form_no: formNo,
            form_design_state: 'current_state',
            behavior_links: [{
              link_ref: 'form_link_submit_expense',
              behavior_ref: 'behavior_submit_expense',
              operations: [],
              notes: ''
            }],
            areas: []
          }
        }],
        field_statuses: [
          { path: '/forms/0/form_name', status: 'confirmed', note: '已记录表单或记录名称' },
          { path: '/forms/0/areas', status: 'temporarily_missing', note: '正在逐项确认分区和数据项' }
        ]
      };
    }
  } else if (progress.turn === 3 && progress.hasForm) {
    const itemName = namedValue(answer, '数据项') || '申请事由';
    const itemType = namedValue(answer, '类型') || '文字';
    const requiredText = namedValue(answer, '是否必填');
    const instructions = namedValue(answer, '填写说明');
    result = {
      assistant_message: '已经记录当前说明中的表单数据项，下一步核对这项行为收到的数据及其来源。',
      questions: [{
        path: '/behaviors/0/input_description',
        question: '执行“提交费用申请”前会收到哪些数据，这些数据分别从哪个部门、岗位、表单、系统或外部流程取得？建议逐项按“数据名称：…；来源部门或岗位：…；来源表单或系统：…”回答；没有输入数据时请明确说明。'
      }],
      patch: [{
        op: 'replace',
        path: '/forms/0/areas',
        value: [{
          area_ref: 'area_expense_basic',
          area_type: '基本信息',
          area_title: namedValue(answer, '分区') || '基本信息',
          items: [{
            item_ref: 'item_expense_reason',
            item_name: itemName,
            item_type: itemType,
            required: /是|必填/.test(requiredText),
            instructions,
            business_data_ref: null,
            value_origin_mode: 'pending_confirmation',
            source_links: []
          }]
        }]
      }],
      field_statuses: [
        { path: '/forms/0/areas', status: 'confirmed', note: '已记录当前提供的分区和数据项' },
        { path: '/behaviors/0/input_description', status: 'temporarily_missing', note: '正在确认输入数据及来源' }
      ]
    };
  } else {
    result = {
      assistant_message: '已经记录当前输入数据说明，接着确认处理结果和明确去向。',
      questions: [{
        path: '/behaviors/0/output_description',
        question: '“提交费用申请”完成后产生哪些数据或结果，分别交给哪个部门或岗位、写入哪份表单或记录、发送到哪个系统或后续流程？建议逐项按“结果或数据：…；接收方：…；进入的表单、系统或流程：…”回答。'
      }],
      patch: [{
        op: 'replace',
        path: '/behaviors/0/input_description',
        value: answer
      }],
      field_statuses: [
        { path: '/behaviors/0/input_description', status: 'confirmed', note: '已记录输入数据及来源' },
        { path: '/behaviors/0/output_description', status: 'temporarily_missing', note: '正在确认输出数据及去向' }
      ]
    };
  }

  progress.turn += 1;
  fillProgressByKey.set(options.apiKey, progress);
  return result;
}

const modelClient = {
  async completion(options) {
    if (options.apiKey === 'revoked-browser-api-key') {
      throw new AppError(502, 'MODEL_AUTH_FAILED', '当前账号的DeepSeek接口密钥不可用。');
    }
    if (options.thinking === true) {
      return {
        content: JSON.stringify({
          summary: '发现1项字段归位建议；未发现硬性结构错误。',
          hard_error_fixes: [],
          suggestions: [{
            category: 'field_placement',
            path: '/process/scope',
            title: '确认适用范围字段',
            explanation: '当前范围文字应继续保留在适用范围字段。',
            patch: [{ op: 'replace', path: '/process/scope', value: '公司内部费用申请事项' }]
          }]
        }),
        finishReason: 'stop',
        usage: { prompt_tokens: 160, completion_tokens: 60, total_tokens: 220 },
        transportAttempts: 1
      };
    }
    return {
      content: JSON.stringify(fillFixtureResult(options)),
      finishReason: 'stop',
      usage: { prompt_tokens: 120, completion_tokens: 55, total_tokens: 175 },
      transportAttempts: 1
    };
  },
  async balance(apiKey) {
    if (apiKey === 'invalid-browser-api-key') {
      throw new AppError(502, 'MODEL_AUTH_FAILED', '当前账号的DeepSeek接口密钥不可用。');
    }
    const totalBalance = apiKey === 'low-browser-api-key' ? 10 : 199;
    return {
      isAvailable: true,
      currency: 'CNY',
      totalBalance,
      toppedUpBalance: totalBalance,
      grantedBalance: 0
    };
  }
};

const structuredServer = structuredOutputApp.listen(3101, '127.0.0.1');
const structuredTool = createStructuredToolClient({
  baseUrl: config.assistant.structuredToolBaseUrl,
  appCommit: repo.commit
});
const runtime = createAssistantRuntime({
  config,
  repoState: repo,
  appCommit: repo.commit,
  modelClient,
  structuredTool
});
const assistantServer = runtime.app.listen(3103, '127.0.0.1');
const gatewayServer = require('http')
  .createServer(createDshGatewayHandler({
    auth: runtime.auth,
    dshRuntimeManager: runtime.dshRuntimeManager,
    assistantBaseUrl: 'http://127.0.0.1:3103',
    structuredToolBaseUrl: config.assistant.structuredToolBaseUrl,
    trustedHosts: config.dsh.trustedPublicHosts,
    allowHttp: true
  }))
  .listen(3104, '127.0.0.1');

Promise.all([
  new Promise(resolve => structuredServer.once('listening', resolve)),
  new Promise(resolve => assistantServer.once('listening', resolve)),
  new Promise(resolve => gatewayServer.once('listening', resolve))
]).then(() => {
  console.log(JSON.stringify({
    ready: true,
    url: 'http://127.0.0.1:3103',
    gateway: 'http://127.0.0.1:3104',
    username: 'zhangguangyi',
    password: 'Pilot-Browser-2026!',
    fixtureId: crypto.randomBytes(4).toString('hex')
  }));
});

async function shutdown() {
  await runtime.dshRuntimeManager.close();
  runtime.apiKeyStore.clear();
  structuredServer.close();
  assistantServer.close();
  gatewayServer.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
