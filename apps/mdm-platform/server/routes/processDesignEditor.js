const express = require('express');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const { requireAuth, getDepartmentByIdAsync } = require('../auth');
const {
  V2,
  createEmptyProcessGovernanceDocument
} = require('../processGovernanceV2');

const router = express.Router();
const contractsDir = path.resolve(__dirname, '../../../../docs/contracts');
const schemaPath = path.join(contractsDir, 'process-governance-v2.schema.json');
const v1SchemaPath = path.join(contractsDir, 'process-governance-v1.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const v1Schema = JSON.parse(fs.readFileSync(v1SchemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(v1Schema);
const validateSchema = ajv.compile(schema);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function items(value) {
  return Array.isArray(value) ? value : [];
}

function technicalValidationResult(data) {
  const schemaValid = validateSchema(data);
  const errors = schemaValid
    ? []
    : items(validateSchema.errors).map(error => ({
        path: error.instancePath || '/',
        keyword: error.keyword,
        message: error.message || '不符合单流程结构规则',
        params: error.params || {}
      }));

  const addError = (pathKey, message, params = {}) => {
    errors.push({ path: pathKey, keyword: 'localReference', message, params });
  };
  const uniqueRefs = (values, key, basePath) => {
    const seen = new Set();
    items(values).forEach((item, index) => {
      const value = text(item && item[key]);
      if (!value) return;
      if (seen.has(value)) {
        addError(`${basePath}/${index}/${key}`, `技术标识 ${value} 在当前文件中重复`, { ref: value });
      }
      seen.add(value);
    });
    return seen;
  };
  const requireLocalRef = (set, value, pathKey, label) => {
    const ref = text(value);
    if (ref && !set.has(ref)) addError(pathKey, `${label} ${ref} 不在当前文件中`, { ref });
  };

  const behaviors = items(data && data.behaviors);
  const relations = items(data && data.flow_relations);
  const dataObjects = items(data && data.data_objects);
  const handoffs = items(data && data.cross_department_handoffs);
  const calls = items(data && data.internal_process_calls);
  const forms = items(data && data.forms);
  const behaviorRefs = uniqueRefs(behaviors, 'behavior_ref', '/behaviors');
  const dataRefs = uniqueRefs(dataObjects, 'data_ref', '/data_objects');

  uniqueRefs(relations, 'relation_ref', '/flow_relations');
  uniqueRefs(handoffs, 'handoff_ref', '/cross_department_handoffs');
  uniqueRefs(calls, 'call_ref', '/internal_process_calls');
  uniqueRefs(forms, 'form_ref', '/forms');
  uniqueRefs(data && data.reference_materials, 'material_ref', '/reference_materials');
  uniqueRefs(data && data.terms, 'term_ref', '/terms');

  behaviors.forEach((behavior, index) => {
    items(behavior && behavior.input_data_refs).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/behaviors/${index}/input_data_refs/${refIndex}`, '输入数据标识');
    });
    items(behavior && behavior.output_data_refs).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/behaviors/${index}/output_data_refs/${refIndex}`, '输出数据标识');
    });
    if (behavior && behavior.work_role) {
      requireLocalRef(
        behaviorRefs,
        behavior.work_role.behavior_ref,
        `/behaviors/${index}/work_role/behavior_ref`,
        '工作角色绑定的业务行为'
      );
      if (text(behavior.work_role.behavior_ref) !== text(behavior.behavior_ref)) {
        addError(`/behaviors/${index}/work_role/behavior_ref`, '工作角色必须绑定当前业务行为', {
          expected: behavior.behavior_ref,
          actual: behavior.work_role.behavior_ref
        });
      }
    }
  });

  relations.forEach((relation, index) => {
    requireLocalRef(behaviorRefs, relation && relation.from_behavior_ref, `/flow_relations/${index}/from_behavior_ref`, '起点业务行为');
    requireLocalRef(behaviorRefs, relation && relation.to_behavior_ref, `/flow_relations/${index}/to_behavior_ref`, '终点业务行为');
  });

  dataObjects.forEach((dataObject, index) => {
    requireLocalRef(
      behaviorRefs,
      dataObject && dataObject.produced_by_behavior_ref,
      `/data_objects/${index}/produced_by_behavior_ref`,
      '数据产生行为'
    );
    items(dataObject && dataObject.consumed_by_behavior_refs).forEach((ref, refIndex) => {
      requireLocalRef(behaviorRefs, ref, `/data_objects/${index}/consumed_by_behavior_refs/${refIndex}`, '数据使用行为');
    });
  });

  handoffs.forEach((handoff, index) => {
    requireLocalRef(behaviorRefs, handoff && handoff.anchor_behavior_ref, `/cross_department_handoffs/${index}/anchor_behavior_ref`, '本流程锚点行为');
    requireLocalRef(dataRefs, handoff && handoff.transfer_data_ref, `/cross_department_handoffs/${index}/transfer_data_ref`, '跨部门传递数据');
    requireLocalRef(dataRefs, handoff && handoff.returned_data_ref, `/cross_department_handoffs/${index}/returned_data_ref`, '跨部门返回数据');
    requireLocalRef(behaviorRefs, handoff && handoff.resume_behavior_ref, `/cross_department_handoffs/${index}/resume_behavior_ref`, '本流程恢复行为');
  });

  calls.forEach((call, index) => {
    requireLocalRef(behaviorRefs, call && call.caller_behavior_ref, `/internal_process_calls/${index}/caller_behavior_ref`, '调用行为');
    requireLocalRef(behaviorRefs, call && call.return_behavior_ref, `/internal_process_calls/${index}/return_behavior_ref`, '返回后的恢复行为');
    items(call && call.input_data_refs).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/internal_process_calls/${index}/input_data_refs/${refIndex}`, '调用输入数据');
    });
    items(call && call.output_data_refs).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/internal_process_calls/${index}/output_data_refs/${refIndex}`, '调用输出数据');
    });
  });

  forms.forEach((form, formIndex) => {
    requireLocalRef(behaviorRefs, form && form.behavior_ref, `/forms/${formIndex}/behavior_ref`, '表单对应行为');
    uniqueRefs(form && form.areas, 'area_ref', `/forms/${formIndex}/areas`);
    items(form && form.areas).forEach((area, areaIndex) => {
      uniqueRefs(area && area.items, 'item_ref', `/forms/${formIndex}/areas/${areaIndex}/items`);
    });
  });

  return { valid: errors.length === 0, errors };
}

router.get('/schema', requireAuth, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(schema);
});

router.get('/template', requireAuth, async (req, res, next) => {
  try {
    if (req.query.version && req.query.version !== V2) {
      return res.status(400).json({ error: `不支持的空白模板版本: ${req.query.version}` });
    }
    const department = req.session.departmentId
      ? await getDepartmentByIdAsync(Number(req.session.departmentId))
      : null;
    const departmentName = text(department && (department.name || department.department_name));
    return res.json({
      schema_version: V2,
      data: createEmptyProcessGovernanceDocument({
        owning_department: departmentName,
        compiler: text(req.session.username || req.session.loginName)
      })
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/validate', requireAuth, (req, res) => {
  const data = req.body && req.body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: '缺少待校验的单流程治理JSON' });
  }
  if (text(data.schema_version) !== V2) {
    return res.status(400).json({ error: `MDM编制工作台只校验${V2}内容` });
  }
  return res.json({ ...technicalValidationResult(data), data: JSON.parse(JSON.stringify(data)) });
});

module.exports = router;
