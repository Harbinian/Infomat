const CUSTOMER_TEXT_RE = /(客户|顾客|商飞|波音|空客|MA700|A220|customer|boeing|airbus)/i;

function normalizedText(parts) {
  return parts
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join('\n');
}

function hasGltx(text) {
  return /\bGLTX[-_ ]?[A-Z0-9]{1,6}[-_ ]?\d{2,6}(?:[-_ ]?[A-Z])?\b/i.test(text);
}

function hasCustomerProcedure(text) {
  return /\bGL[GBCL][-_ ]?\d{3,8}(?:[-_ ]?\d{1,4})?(?:[-_ ]?[A-Z])?\b/i.test(text);
}

function hasCustomerForm(text) {
  return /(?:^|[^A-Z0-9])FM[-_ ]?\d{2,8}(?:[-_. ]?\d{1,4})*(?:[-_ ]?[A-Z])?(?:$|[^A-Z0-9])/i.test(text);
}

function result(flag, overrides = {}) {
  const defaults = {
    changxing_owned: {
      source_boundary_flag: 'changxing_owned',
      source_boundary_label: '昌兴自有文件',
      acceptance_status: '已形成昌兴承接流程',
      allowed_downstream_use: 'changxing_evidence',
      customer_acceptance_required: false,
    },
    customer_requirement: {
      source_boundary_flag: 'customer_requirement',
      source_boundary_label: '客户要求文件',
      acceptance_status: '未识别承接',
      allowed_downstream_use: 'customer_requirement_only',
      customer_acceptance_required: true,
    },
    customer_form: {
      source_boundary_flag: 'customer_form',
      source_boundary_label: '客户体系表单',
      acceptance_status: '未识别承接',
      allowed_downstream_use: 'customer_form_only',
      customer_acceptance_required: true,
    },
    mixed_boundary: {
      source_boundary_flag: 'mixed_boundary',
      source_boundary_label: '昌兴文件与客户要求混合引用',
      acceptance_status: '已识别承接责任',
      allowed_downstream_use: 'mixed_requires_review',
      customer_acceptance_required: true,
    },
    source_boundary_review: {
      source_boundary_flag: 'source_boundary_review',
      source_boundary_label: '来源边界待确认',
      acceptance_status: '未识别承接',
      allowed_downstream_use: 'review_only',
      customer_acceptance_required: true,
    },
    internal_or_unknown: {
      source_boundary_flag: 'internal_or_unknown',
      source_boundary_label: '内部或未识别来源',
      acceptance_status: '已入已确认流程映射',
      allowed_downstream_use: 'review_required_before_formal_use',
      customer_acceptance_required: false,
    },
  };
  return { ...defaults[flag], ...overrides };
}

export function classifySourceBoundary(input = {}) {
  const directText = normalizedText([input.fileName, input.fileNo]);
  const text = normalizedText([
    input.path,
    input.fileName,
    input.fileNo,
    input.rawText,
    input.citation,
  ]);
  const directGltx = hasGltx(directText);
  const directCustomerProcedure = hasCustomerProcedure(directText);
  const directCustomerForm = hasCustomerForm(directText);
  if (directGltx && (directCustomerProcedure || directCustomerForm)) return result('mixed_boundary');
  if (directGltx) return result('changxing_owned');
  if (directCustomerProcedure) return result('customer_requirement');
  if (directCustomerForm) return result('customer_form');

  const gltx = hasGltx(text);
  const customerProcedure = hasCustomerProcedure(text);
  const customerForm = hasCustomerForm(text);

  if (gltx && (customerProcedure || customerForm)) return result('mixed_boundary');
  if (gltx) return result('changxing_owned');
  if (customerProcedure) return result('customer_requirement');
  if (customerForm) return result('customer_form');
  if (CUSTOMER_TEXT_RE.test(text)) return result('source_boundary_review');
  return result('internal_or_unknown');
}

export function sourceBoundaryFromCitation(citation = '') {
  return classifySourceBoundary({ citation });
}

export function withSourceBoundary(record = {}, input = {}) {
  return {
    ...record,
    ...classifySourceBoundary({
      path: record.path || record.source_file || input.path,
      fileName: record.fileName || record.source_file_name || input.fileName,
      fileNo: record.fileNo || record.doc_no || input.fileNo,
      rawText: input.rawText,
      citation: input.citation,
    }),
  };
}
