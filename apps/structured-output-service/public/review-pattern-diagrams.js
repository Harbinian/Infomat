(function initializeReviewPatternDiagrams(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReviewPatternDiagrams = api;
})(typeof window !== 'undefined' ? window : globalThis, function createReviewPatternDiagramsApi() {
  const EXAMPLE_DEPARTMENT = '示例部门';
  const EXAMPLE_ROLE = `${EXAMPLE_DEPARTMENT} 示例岗位`;

  function action(ref, name, options = {}) {
    return {
      ref,
      name,
      type: 'action',
      countersign: false,
      ...options
    };
  }

  function control(ref, name, type) {
    return { ref, name, type, countersign: false };
  }

  function relation(ref, from, to, type = 'sequence', condition = '', joinMode = null) {
    return { ref, from, to, type, condition, joinMode };
  }

  const PATTERNS = [
    {
      id: 'sequence',
      title: '1. 基础顺序：业务行为接业务行为',
      badge: '适用',
      tone: 'normal',
      size: 'compact',
      rule: '前一个行为完成后，后一个行为才开始。',
      nodes: [action('a', '业务行为A'), action('b', '业务行为B'), action('c', '业务行为C')],
      relations: [relation('r1', 'a', 'b'), relation('r2', 'b', 'c')]
    },
    {
      id: 'decision-merge',
      title: '2. 判断分支：不同结果进入共同后续',
      badge: '适用',
      tone: 'normal',
      size: 'standard',
      rule: '判断分支表示只选择符合条件的路线，不使用并行开始。',
      nodes: [
        action('start', '提交业务材料'),
        control('decision', '判断处理结果', 'decision'),
        action('path-a', '处理A'),
        action('path-b', '处理B'),
        action('next', '共同后续')
      ],
      relations: [
        relation('r1', 'start', 'decision'),
        relation('r2', 'decision', 'path-a', 'condition', '条件A'),
        relation('r3', 'decision', 'path-b', 'condition', '条件B'),
        relation('r4', 'path-a', 'next'),
        relation('r5', 'path-b', 'next')
      ]
    },
    {
      id: 'single-loop',
      title: '3. 单层循环：继续条件和退出条件分开',
      badge: '适用',
      tone: 'normal',
      size: 'standard',
      rule: '回路关系填写继续循环条件；复核节点必须另有退出本层循环的路线。',
      nodes: [action('work', '办理'), control('review', '复核结果', 'decision'), action('next', '下一步')],
      relations: [
        relation('r1', 'work', 'review'),
        relation('r2', 'review', 'work', 'loop', '未通过'),
        relation('r3', 'review', 'next', 'condition', '通过')
      ]
    },
    {
      id: 'countersign-parallel-end',
      title: '4. 会签作为并行路线末项',
      badge: '适用',
      tone: 'normal',
      size: 'standard',
      rule: '会签可以是路线中的最后一个业务行为，但不能代替并行汇合。',
      nodes: [
        control('split', '并行开始', 'parallel_split'),
        action('sign', '会签行为', { countersign: true }),
        action('other', '另一业务行为'),
        control('join', '并行汇合', 'parallel_join')
      ],
      relations: [
        relation('r1', 'split', 'sign', 'parallel'),
        relation('r2', 'split', 'other', 'parallel'),
        relation('r3', 'sign', 'join', 'parallel', '', 'all'),
        relation('r4', 'other', 'join', 'parallel', '', 'all')
      ]
    },
    {
      id: 'parallel-decision',
      title: '5. 并行路线内含判断',
      badge: '需核对',
      tone: 'caution',
      size: 'complex',
      rule: '判断的每一种结果都必须进入同一个共同汇合；任一结果提前结束时不得使用并行。',
      nodes: [
        control('split', '并行开始', 'parallel_split'),
        control('decision', '判断', 'decision'),
        action('path-a', '处理A'),
        action('path-b', '处理B'),
        action('path-c', '路线C'),
        control('join', '共同汇合', 'parallel_join')
      ],
      relations: [
        relation('r1', 'split', 'decision', 'parallel'),
        relation('r2', 'split', 'path-c', 'parallel'),
        relation('r3', 'decision', 'path-a', 'condition', '条件A'),
        relation('r4', 'decision', 'path-b', 'condition', '条件B'),
        relation('r5', 'path-a', 'join', 'parallel', '', 'all'),
        relation('r6', 'path-b', 'join', 'parallel', '', 'all'),
        relation('r7', 'path-c', 'join', 'parallel', '', 'all')
      ]
    },
    {
      id: 'parallel-loop',
      title: '6. 并行路线内含循环',
      badge: '需核对',
      tone: 'caution',
      size: 'complex',
      rule: '循环必须有退出路线，退出后仍要进入当前并行层的共同汇合。',
      nodes: [
        control('split', '并行开始', 'parallel_split'),
        action('path-a', '路线A办理'),
        control('check', '检查', 'decision'),
        action('path-b', '路线B办理'),
        control('join', '共同汇合', 'parallel_join')
      ],
      relations: [
        relation('r1', 'split', 'path-a', 'parallel'),
        relation('r2', 'split', 'path-b', 'parallel'),
        relation('r3', 'path-a', 'check'),
        relation('r4', 'check', 'path-a', 'loop', '继续'),
        relation('r5', 'check', 'join', 'parallel', '', 'all'),
        relation('r6', 'path-b', 'join', 'parallel', '', 'all')
      ]
    },
    {
      id: 'nested-loops',
      title: '7. 嵌套循环：每一层分别退出',
      badge: '需核对',
      tone: 'caution',
      size: 'complex',
      rule: '内层退出可以进入外层检查；最外层必须有到循环外后续行为的退出路线。',
      nodes: [
        action('outer-work', '外层办理'),
        action('inner-work', '内层办理'),
        control('inner-check', '内层检查', 'decision'),
        control('outer-check', '外层检查', 'decision'),
        action('next', '循环外后续')
      ],
      relations: [
        relation('r1', 'outer-work', 'inner-work'),
        relation('r2', 'inner-work', 'inner-check'),
        relation('r3', 'inner-check', 'inner-work', 'loop', '继续内层'),
        relation('r4', 'inner-check', 'outer-check', 'condition', '退出内层'),
        relation('r5', 'outer-check', 'outer-work', 'loop', '继续外层'),
        relation('r6', 'outer-check', 'next', 'condition', '退出外层')
      ]
    },
    {
      id: 'nested-parallel',
      title: '8. 并行路线中的并行路线',
      badge: '适用',
      tone: 'normal',
      size: 'complex',
      rule: '内层并行必须先汇合，内层汇合的结果再作为外层路线进入外层汇合。',
      nodes: [
        control('outer-split', '外层并行开始', 'parallel_split'),
        control('inner-split', '内层并行开始', 'parallel_split'),
        action('inner-a', '内层A1'),
        action('inner-b', '内层A2'),
        control('inner-join', '内层汇合', 'parallel_join'),
        action('outer-b', '外层路线B'),
        control('outer-join', '外层汇合', 'parallel_join'),
        action('next', '后续')
      ],
      relations: [
        relation('r1', 'outer-split', 'inner-split', 'parallel'),
        relation('r2', 'outer-split', 'outer-b', 'parallel'),
        relation('r3', 'inner-split', 'inner-a', 'parallel'),
        relation('r4', 'inner-split', 'inner-b', 'parallel'),
        relation('r5', 'inner-a', 'inner-join', 'parallel', '', 'all'),
        relation('r6', 'inner-b', 'inner-join', 'parallel', '', 'all'),
        relation('r7', 'inner-join', 'outer-join', 'parallel', '', 'all'),
        relation('r8', 'outer-b', 'outer-join', 'parallel', '', 'all'),
        relation('r9', 'outer-join', 'next')
      ]
    },
    {
      id: 'forbidden-parallel-termination',
      title: '9. 禁止：并行路线在汇合前中止流程',
      badge: '禁止',
      tone: 'forbidden',
      size: 'complex',
      rule: '只要一条路线可能在共同汇合前中止整个流程，就不得设置并行；互斥结果应改用判断分支。',
      nodes: [
        control('split', '并行开始', 'parallel_split'),
        action('path-a', '行为A'),
        action('terminate', '中止流程'),
        action('path-b', '行为B'),
        control('join', '并行汇合', 'parallel_join'),
        action('next', '共同后续')
      ],
      relations: [
        relation('r1', 'split', 'path-a', 'parallel'),
        relation('r2', 'split', 'path-b', 'parallel'),
        relation('r3', 'path-a', 'terminate'),
        relation('r4', 'path-b', 'join', 'parallel', '', 'all'),
        relation('r5', 'join', 'next')
      ]
    }
  ];

  function definitions() {
    return PATTERNS.map(pattern => ({
      ...pattern,
      nodes: pattern.nodes.map(node => ({ ...node })),
      relations: pattern.relations.map(item => ({ ...item }))
    }));
  }

  function buildDocument(pattern) {
    const selected = pattern && typeof pattern === 'object' ? pattern : {};
    const patternId = String(selected.id || 'unknown');
    return {
      schema_version: 'process-governance-v3',
      process: {
        process_ref: `review-pattern-${patternId}`,
        process_name: String(selected.title || '流程评审图例'),
        owning_department: EXAMPLE_DEPARTMENT
      },
      behaviors: (Array.isArray(selected.nodes) ? selected.nodes : []).map((node, index) => ({
        behavior_ref: `review-${patternId}-${node.ref || index + 1}`,
        node_type: node.type || 'action',
        behavior_name: String(node.name || '未命名节点'),
        behavior_description: '',
        current_actor_role: EXAMPLE_ROLE,
        actor_assignment_mode: 'fixed_department',
        actor_department_data_ref: null,
        trigger: '',
        precondition: '',
        completion_standard: '',
        countersign_all_required: Boolean(node.countersign),
        countersign_target_departments: node.countersign ? ['示例部门甲', '示例部门乙'] : [],
        input_description: '',
        output_description: '',
        input_data_refs: [],
        output_data_refs: [],
        work_role: null
      })),
      flow_relations: (Array.isArray(selected.relations) ? selected.relations : []).map((item, index) => ({
        relation_ref: `review-${patternId}-${item.ref || index + 1}`,
        from_behavior_ref: `review-${patternId}-${item.from}`,
        to_behavior_ref: `review-${patternId}-${item.to}`,
        relation_type: item.type || 'sequence',
        condition: String(item.condition || ''),
        join_mode: item.joinMode || null
      })),
      cross_department_handoffs: [],
      internal_process_calls: [],
      data_objects: [],
      forms: []
    };
  }

  function mount(options = {}) {
    const processDiagram = options.processDiagram
      || (typeof globalThis !== 'undefined' ? globalThis.ProcessDiagram : null);
    if (!processDiagram?.mount) throw new Error('流程图组件未加载。');
    return processDiagram.mount({
      container: options.container,
      documentData: buildDocument(options.pattern),
      departmentOrder: [EXAMPLE_DEPARTMENT],
      cytoscape: options.cytoscape,
      onViewportModeChange: options.onViewportModeChange
    });
  }

  return {
    EXAMPLE_DEPARTMENT,
    definitions,
    buildDocument,
    mount
  };
});
