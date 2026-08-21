(function attachGovernanceWorkflow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GovernanceWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createGovernanceWorkflow() {
  'use strict';

  const STEPS = Object.freeze([
    {
      id: 'start',
      number: 1,
      label: 'JSON基本信息',
      responsibility: '新建、导入、文件基本信息核对和候选流程切换',
      primaryAction: '新建流程或继续已有流程'
    },
    {
      id: 'boundary',
      number: 2,
      label: '流程边界',
      responsibility: '填写流程名称、归口部门、发起部门、编制人、目的和范围',
      primaryAction: '定位首个未填写的边界字段'
    },
    {
      id: 'skeleton',
      number: 3,
      label: '流程骨架',
      responsibility: '维护节点名称、节点类型、执行主体以及关系起点、终点和类型',
      primaryAction: '新增节点、建立关系或处理首个骨架缺项'
    },
    {
      id: 'action',
      number: 4,
      label: '动作与异常',
      responsibility: '逐动作说明完成标准、触发条件、时限、判断、退回、会签和并行规则',
      primaryAction: '定位首个动作或异常问题'
    },
    {
      id: 'data',
      number: 5,
      label: '数据与表单',
      responsibility: '先维护数据对象及其字段明细，再让表单主表或明细表引用对象字段，并核对数据关系和值来源',
      primaryAction: '从业务输出或现有表单选择真实起点'
    },
    {
      id: 'cross-department',
      number: 6,
      label: '跨部门核对',
      responsibility: '汇总跨部门行为、异常路径和待定事项，并返回唯一编辑位置',
      primaryAction: '核对首个跨部门事项或下载第四轮草稿'
    },
    {
      id: 'handoff',
      number: 7,
      label: '评审与交接',
      responsibility: '核对六方面、结构阻断、业务提示、外部材料和3000停止边界',
      primaryAction: '处理首个阻断或打开最终交接卡'
    }
  ]);

  const ROLE_SEQUENCE = Object.freeze([
    Object.freeze({
      order: 1,
      role: '编制人',
      action: '新建或导入一条流程，按七步填写，并在每轮结束时下载阶段草稿。',
      handoff: '阶段草稿'
    }),
    Object.freeze({
      order: 2,
      role: '业务核对人',
      action: '依据制度、表单、台账和实际做法，核对流程、跨部门、数据与表单事实；发现问题时明确退回位置。',
      handoff: '业务核对记录'
    }),
    Object.freeze({
      order: 3,
      role: '编制人',
      action: '根据核对意见修改唯一草稿，重新执行技术检查，并下载最终待核对文件。',
      handoff: '最终待核对v7文件'
    }),
    Object.freeze({
      order: 4,
      role: 'MDM工作组',
      action: '核对结构错误、待定项、文件名和SHA-256，接收v7文件及JSON之外的核对记录。',
      handoff: '受控接收；暂不导入3000'
    })
  ]);

  const STEP_IDS = new Set(STEPS.map(step => step.id));
  const AUTHORING_STEP_IDS = new Set(['start', 'boundary', 'skeleton', 'action', 'data']);
  const STAGES = Object.freeze({
    start: { key: 'round-1', label: '第1轮-流程骨架', round: 1 },
    boundary: { key: 'round-1', label: '第1轮-流程骨架', round: 1 },
    skeleton: { key: 'round-1', label: '第1轮-流程骨架', round: 1 },
    action: { key: 'round-2', label: '第2轮-动作与异常', round: 2 },
    data: { key: 'round-3', label: '第3轮-数据与表单', round: 3 },
    'cross-department': { key: 'round-4', label: '第4轮-跨部门核对', round: 4 },
    handoff: { key: 'final', label: '最终待核对', round: null }
  });

  function normalizeStepId(value) {
    return STEP_IDS.has(value) ? value : 'start';
  }

  function stepById(value) {
    const id = normalizeStepId(value);
    return STEPS.find(step => step.id === id);
  }

  function stageForStep(value) {
    return STAGES[normalizeStepId(value)];
  }

  function stepForTarget(target = {}) {
    const editorSection = String(target.editorSection || '');
    const processSection = String(target.processSection || '');
    const focusKind = String(target.focusKind || '');
    const focusPath = String(target.focusPath || '');
    if (editorSection === 'export') return 'handoff';
    if (editorSection === 'forms' || focusKind === 'form' || focusKind === 'area') return 'data';
    if (focusKind === 'data' || ['data', 'relationships'].includes(processSection)) return 'data';
    if (editorSection === 'basic' || editorSection === 'profile' || editorSection === 'terms') return 'boundary';
    if (focusKind === 'relation') return focusPath.endsWith('.condition') ? 'action' : 'skeleton';
    if (focusKind === 'behavior') {
      return /\.(behavior_description|trigger|precondition|timing|completion_standard|countersign)/.test(focusPath)
        ? 'action'
        : 'skeleton';
    }
    if (processSection === 'relations' || processSection === 'behaviors') return 'skeleton';
    return 'handoff';
  }

  function issueVocabularyForStep(stepId) {
    const step = normalizeStepId(stepId);
    if (AUTHORING_STEP_IDS.has(step)) return { singular: '本轮自检项', plural: '本轮自检项', action: '处理' };
    if (step === 'cross-department') return { singular: '业务核对项', plural: '业务核对项', action: '核对' };
    return { singular: '交接检查事项', plural: '交接检查事项', action: '处理' };
  }

  function issuesVisibleForStep(stepId, context = {}) {
    const step = normalizeStepId(stepId);
    if (!AUTHORING_STEP_IDS.has(step)) return true;
    return Array.isArray(context.checkedSteps) && context.checkedSteps.includes(step);
  }

  function statusForStep(stepId, context = {}) {
    const step = normalizeStepId(stepId);
    if (!context.hasDocument) {
      return step === 'start'
        ? { key: 'in-progress', label: '编制中' }
        : { key: 'not-started', label: '未开始' };
    }
    const technicalCount = Number(context.technicalCount || 0);
    const issueCount = Number(context.issueCounts?.[step] || 0);
    if (step === 'handoff' && technicalCount > 0) {
      return { key: 'error', label: `结构错误${technicalCount}项` };
    }
    if (issueCount > 0 && issuesVisibleForStep(step, context)) {
      if (AUTHORING_STEP_IDS.has(step)) return { key: 'missing', label: `自检${issueCount}项` };
      if (step === 'cross-department') return { key: 'missing', label: `待核对${issueCount}项` };
      return { key: 'missing', label: `待交接${issueCount}项` };
    }
    if (AUTHORING_STEP_IDS.has(step) && issuesVisibleForStep(step, context)) return { key: 'reviewable', label: '本轮已检查' };
    if (context.activeStep === step) {
      if (step === 'cross-department') return { key: 'in-progress', label: '核对中' };
      if (step === 'handoff') return { key: 'in-progress', label: '交接检查中' };
      return { key: 'in-progress', label: '编制中' };
    }
    if (AUTHORING_STEP_IDS.has(step) && context.startedSteps?.includes(step)) return { key: 'reviewable', label: '可自检' };
    if (!AUTHORING_STEP_IDS.has(step) && context.startedSteps?.includes(step)) return { key: 'reviewable', label: '可核对' };
    return { key: 'not-started', label: '未开始' };
  }

  function primaryActionForStep(stepId, context = {}) {
    const step = stepById(stepId);
    if (!context.hasDocument) return stepId === 'start' ? step.primaryAction : '先新建或导入一条流程';
    const issueCount = Number(context.issueCounts?.[step.id] || 0);
    if (step.id === 'handoff' && Number(context.technicalCount || 0) > 0) return '处理首个结构阻断';
    if (issueCount > 0 && issuesVisibleForStep(step.id, context)) {
      const vocabulary = issueVocabularyForStep(step.id);
      return `${vocabulary.action}首个${vocabulary.singular}（共${issueCount}项）`;
    }
    return step.primaryAction;
  }

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return new TextEncoder().encode(String(input));
  }

  function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  function sha256Fallback(input) {
    const source = toBytes(input);
    const bitLength = source.length * 8;
    const paddingLength = ((56 - ((source.length + 1) % 64)) + 64) % 64;
    const bytes = new Uint8Array(source.length + 1 + paddingLength + 8);
    bytes.set(source);
    bytes[source.length] = 0x80;
    const view = new DataView(bytes.buffer);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    view.setUint32(bytes.length - 8, high, false);
    view.setUint32(bytes.length - 4, low, false);

    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const schedule = new Uint32Array(64);

    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) schedule[index] = view.getUint32(offset + index * 4, false);
      for (let index = 16; index < 64; index += 1) {
        const first = schedule[index - 15];
        const second = schedule[index - 2];
        const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
        const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
        schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temp1 = (h + sum1 + choose + constants[index] + schedule[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map(value => value.toString(16).padStart(8, '0')).join('');
  }

  async function sha256Hex(input, options = {}) {
    const bytes = toBytes(input);
    const subtle = Object.prototype.hasOwnProperty.call(options, 'subtle')
      ? options.subtle
      : globalThis.crypto?.subtle;
    if (subtle?.digest) {
      try {
        const digest = await subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      } catch (_error) {
        // Ordinary HTTP pages may expose crypto without subtle.digest permission.
      }
    }
    return sha256Fallback(bytes);
  }

  return Object.freeze({
    STEPS,
    ROLE_SEQUENCE,
    normalizeStepId,
    stepById,
    stageForStep,
    stepForTarget,
    issueVocabularyForStep,
    issuesVisibleForStep,
    statusForStep,
    primaryActionForStep,
    sha256Fallback,
    sha256Hex
  });
});
