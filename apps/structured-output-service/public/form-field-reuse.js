(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FormFieldReuse = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createFormFieldReuseApi() {
  'use strict';

  const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).reduce((result, key) => {
      result[key] = clone(value[key]);
      return result;
    }, {});
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function error(code, message, details = {}) {
    return { code, message, ...details };
  }

  function indexDataFields(documentValue) {
    const groups = [];
    const fields = [];
    const errors = [];
    const entriesByRef = Object.create(null);
    const dataRefCounts = Object.create(null);

    array(documentValue?.data_objects).forEach((dataObject, dataIndex) => {
      const dataRef = text(dataObject?.data_ref);
      const dataName = dataObject?.data_name == null ? '' : String(dataObject.data_name);
      if (!dataRef) {
        errors.push(error('DATA_REF_REQUIRED', '数据对象缺少技术标识，无法建立对象字段目录', { dataIndex }));
      } else {
        dataRefCounts[dataRef] = (dataRefCounts[dataRef] || 0) + 1;
      }

      const group = { dataRef, dataName, dataIndex, fields: [] };
      array(dataObject?.fields).forEach((field, fieldIndex) => {
        const fieldRef = text(field?.field_ref);
        const entry = {
          fieldRef,
          fieldName: field?.field_name == null ? '' : String(field.field_name),
          fieldType: field?.field_type == null ? '' : String(field.field_type),
          definition: field?.definition == null ? '' : String(field.definition),
          dataRef,
          dataName,
          dataIndex,
          fieldIndex,
          referenceCount: 0,
          references: []
        };
        group.fields.push(entry);
        fields.push(entry);
        if (!fieldRef) {
          errors.push(error('FIELD_REF_REQUIRED', '对象字段缺少技术标识，无法被表单字段引用', {
            dataRef,
            dataIndex,
            fieldIndex
          }));
          return;
        }
        if (!entriesByRef[fieldRef]) entriesByRef[fieldRef] = [];
        entriesByRef[fieldRef].push(entry);
      });
      groups.push(group);
    });

    Object.keys(dataRefCounts).forEach(dataRef => {
      if (dataRefCounts[dataRef] > 1) {
        errors.push(error('DUPLICATE_DATA_REF', `数据对象技术标识“${dataRef}”重复，无法唯一确定字段归属`, { dataRef }));
      }
    });

    Object.keys(entriesByRef).forEach(fieldRef => {
      if (entriesByRef[fieldRef].length > 1) {
        errors.push(error('DUPLICATE_FIELD_REF', `对象字段技术标识“${fieldRef}”重复，无法唯一引用`, { fieldRef }));
      }
    });

    array(documentValue?.forms).forEach(form => {
      array(form?.areas).forEach(area => {
        array(area?.items).forEach(item => {
          const fieldRef = text(item?.data_field_ref);
          if (!fieldRef || !entriesByRef[fieldRef]) return;
          const reference = {
            formRef: text(form?.form_ref),
            formName: form?.form_name == null ? '' : String(form.form_name),
            areaRef: text(area?.area_ref),
            areaType: area?.area_type == null ? '' : String(area.area_type),
            areaTitle: area?.area_title == null ? '' : String(area.area_title),
            itemRef: text(item?.item_ref),
            itemName: item?.item_name == null ? '' : String(item.item_name)
          };
          entriesByRef[fieldRef].forEach(entry => {
            entry.references.push(clone(reference));
            entry.referenceCount += 1;
          });
        });
      });
    });

    const byFieldRef = Object.create(null);
    Object.keys(entriesByRef).forEach(fieldRef => {
      if (entriesByRef[fieldRef].length === 1) byFieldRef[fieldRef] = entriesByRef[fieldRef][0];
    });

    return { groups, fields, byFieldRef, errors };
  }

  function buildReferencePatch(item, fieldRef, index) {
    const normalizedFieldRef = text(fieldRef);
    const errors = [];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(error('ITEM_REQUIRED', '必须提供待引用对象字段的表单字段'));
    }
    if (!normalizedFieldRef) {
      errors.push(error('FIELD_REF_REQUIRED', '必须明确选择对象字段'));
    }
    if (array(index?.errors).some(itemError => itemError.fieldRef === normalizedFieldRef)) {
      errors.push(error('FIELD_REF_AMBIGUOUS', `对象字段“${normalizedFieldRef}”存在重复定义，无法唯一引用`, {
        fieldRef: normalizedFieldRef
      }));
    }
    const field = index?.byFieldRef?.[normalizedFieldRef];
    if (field && array(index?.errors).some(itemError => (
      itemError.code === 'DUPLICATE_DATA_REF' && itemError.dataRef === field.dataRef
    ))) {
      errors.push(error('FIELD_OWNER_AMBIGUOUS', `对象字段“${normalizedFieldRef}”的所属数据对象存在重复定义`, {
        fieldRef: normalizedFieldRef,
        dataRef: field.dataRef
      }));
    }
    if (normalizedFieldRef && !field && !errors.some(itemError => itemError.code === 'FIELD_REF_AMBIGUOUS')) {
      errors.push(error('FIELD_NOT_FOUND', `对象字段“${normalizedFieldRef}”不存在`, { fieldRef: normalizedFieldRef }));
    }
    if (errors.length) return { ok: false, patch: null, field: null, errors };

    const patch = {
      data_field_ref: field.fieldRef,
      business_data_ref: field.dataRef,
      item_type: field.fieldType
    };
    if (!text(item.item_name)) patch.item_name = field.fieldName;
    return { ok: true, patch, field: clone(field), errors: [] };
  }

  function failure(input, errors) {
    return {
      ok: false,
      document: null,
      addedItems: [],
      createdArea: null,
      candidateKey: text(input?.candidateKey),
      documentFingerprint: text(input?.documentFingerprint),
      errors
    };
  }

  function planBatchReference(documentValue, input = {}, refFactory) {
    const errors = [];
    if (!documentValue || typeof documentValue !== 'object' || Array.isArray(documentValue)) {
      return failure(input, [error('DOCUMENT_REQUIRED', '必须提供当前流程治理文档')]);
    }
    if (!text(input.candidateKey)) {
      errors.push(error('CANDIDATE_KEY_REQUIRED', '批量引用必须绑定当前候选标识'));
    }
    if (!text(input.documentFingerprint)) {
      errors.push(error('DOCUMENT_FINGERPRINT_REQUIRED', '批量引用必须绑定打开草稿时的文档指纹'));
    }

    const formRef = text(input.formRef);
    const forms = array(documentValue.forms).filter(form => text(form?.form_ref) === formRef);
    if (!formRef) errors.push(error('FORM_REF_REQUIRED', '必须明确选择目标表单'));
    else if (!forms.length) errors.push(error('FORM_NOT_FOUND', `表单“${formRef}”不存在`, { formRef }));
    else if (forms.length > 1) errors.push(error('FORM_REF_AMBIGUOUS', `表单技术标识“${formRef}”重复`, { formRef }));

    const rawFieldRefs = array(input.fieldRefs);
    const fieldRefs = rawFieldRefs.map(text);
    if (!fieldRefs.length) errors.push(error('FIELD_SELECTION_REQUIRED', '至少选择一个对象字段'));
    fieldRefs.forEach((fieldRef, index) => {
      if (!fieldRef) errors.push(error('FIELD_REF_REQUIRED', `第 ${index + 1} 个对象字段技术标识为空`, { fieldIndex: index }));
    });
    const seenFieldRefs = new Set();
    fieldRefs.forEach(fieldRef => {
      if (!fieldRef) return;
      if (seenFieldRefs.has(fieldRef)) {
        errors.push(error('DUPLICATE_FIELD_SELECTION', `同一批次不能重复选择对象字段“${fieldRef}”`, { fieldRef }));
      }
      seenFieldRefs.add(fieldRef);
    });

    const requiredByFieldRef = input.requiredByFieldRef;
    if (!requiredByFieldRef || typeof requiredByFieldRef !== 'object' || Array.isArray(requiredByFieldRef)) {
      errors.push(error('REQUIRED_SELECTIONS_REQUIRED', '必须逐项明确选择“必填”或“非必填”'));
    } else {
      seenFieldRefs.forEach(fieldRef => {
        if (!hasOwn(requiredByFieldRef, fieldRef) || typeof requiredByFieldRef[fieldRef] !== 'boolean') {
          errors.push(error('REQUIRED_SELECTION_REQUIRED', `对象字段“${fieldRef}”尚未明确选择“必填”或“非必填”`, { fieldRef }));
        }
      });
    }

    const areaRef = text(input.areaRef);
    const newArea = input.newArea;
    if (areaRef && newArea) {
      errors.push(error('AREA_TARGET_CONFLICT', '现有区域和新建区域不能同时作为目标'));
    } else if (!areaRef && !newArea) {
      errors.push(error('AREA_TARGET_REQUIRED', '必须明确选择现有区域或新建区域'));
    }

    let selectedArea = null;
    if (forms.length === 1 && areaRef) {
      const matchingAreas = array(forms[0].areas).filter(area => text(area?.area_ref) === areaRef);
      const areasInOtherForms = array(documentValue.forms).flatMap(form => (
        text(form?.form_ref) === formRef ? [] : array(form?.areas)
      )).filter(area => text(area?.area_ref) === areaRef);
      if (!matchingAreas.length) {
        errors.push(error(
          areasInOtherForms.length ? 'AREA_FORM_MISMATCH' : 'AREA_NOT_FOUND',
          areasInOtherForms.length ? `区域“${areaRef}”不属于目标表单` : `区域“${areaRef}”不存在`,
          { formRef, areaRef }
        ));
      } else if (matchingAreas.length > 1 || areasInOtherForms.length) {
        errors.push(error('AREA_REF_AMBIGUOUS', `区域技术标识“${areaRef}”重复，无法唯一确定目标`, { areaRef }));
      } else {
        selectedArea = matchingAreas[0];
        if (!Array.isArray(selectedArea.items)) {
          errors.push(error('AREA_ITEMS_INVALID', `区域“${areaRef}”的字段明细不是有效数组`, { formRef, areaRef }));
        }
      }
    }

    let newAreaType = null;
    let newAreaTitle = '';
    if (newArea) {
      if (!newArea || typeof newArea !== 'object' || Array.isArray(newArea)) {
        errors.push(error('NEW_AREA_INVALID', '新建区域参数无效'));
      } else {
        newAreaType = newArea.areaType;
        newAreaTitle = text(newArea.areaTitle);
        if (!['', '明细清单'].includes(newAreaType)) {
          errors.push(error('NEW_AREA_TYPE_INVALID', '批量引用只允许新建明细表或归属待确认区域', {
            areaType: newAreaType
          }));
        }
        if (newAreaType === '明细清单' && !newAreaTitle) {
          errors.push(error('DETAIL_AREA_TITLE_REQUIRED', '新建明细表时必须填写明细表名称'));
        }
      }
    }

    const fieldIndex = indexDataFields(documentValue);
    fieldIndex.errors.forEach(indexError => errors.push(clone(indexError)));
    seenFieldRefs.forEach(fieldRef => {
      if (!fieldIndex.byFieldRef[fieldRef]
        && !errors.some(itemError => itemError.fieldRef === fieldRef)) {
        errors.push(error('FIELD_NOT_FOUND', `对象字段“${fieldRef}”不存在`, { fieldRef }));
      }
    });
    if (typeof refFactory !== 'function') errors.push(error('REF_FACTORY_REQUIRED', '必须提供稳定技术标识生成器'));
    if (errors.length) return failure(input, errors);

    const existingAreaRefs = new Set();
    const existingItemRefs = new Set();
    array(documentValue.forms).forEach(form => array(form?.areas).forEach(area => {
      const currentAreaRef = text(area?.area_ref);
      if (currentAreaRef) existingAreaRefs.add(currentAreaRef);
      array(area?.items).forEach(item => {
        const itemRef = text(item?.item_ref);
        if (itemRef) existingItemRefs.add(itemRef);
      });
    }));

    let generatedAreaRef = areaRef;
    if (newArea) {
      try {
        generatedAreaRef = text(refFactory('area'));
      } catch (refError) {
        errors.push(error('REF_FACTORY_FAILED', `生成区域技术标识失败：${refError?.message || '未知错误'}`, { entity: 'area' }));
      }
      if (!generatedAreaRef || !REF_PATTERN.test(generatedAreaRef)) {
        errors.push(error('AREA_REF_INVALID', '区域技术标识生成结果无效', { areaRef: generatedAreaRef }));
      } else if (existingAreaRefs.has(generatedAreaRef)) {
        errors.push(error('AREA_REF_CONFLICT', `区域技术标识“${generatedAreaRef}”已经存在`, { areaRef: generatedAreaRef }));
      }
    }

    const plannedItems = [];
    fieldRefs.forEach(fieldRef => {
      let itemRef = '';
      try {
        itemRef = text(refFactory('item'));
      } catch (refError) {
        errors.push(error('REF_FACTORY_FAILED', `生成表单字段技术标识失败：${refError?.message || '未知错误'}`, {
          entity: 'item',
          fieldRef
        }));
        return;
      }
      if (!itemRef || !REF_PATTERN.test(itemRef)) {
        errors.push(error('ITEM_REF_INVALID', '表单字段技术标识生成结果无效', { fieldRef, itemRef }));
        return;
      }
      if (existingItemRefs.has(itemRef) || plannedItems.some(item => item.item_ref === itemRef)) {
        errors.push(error('ITEM_REF_CONFLICT', `表单字段技术标识“${itemRef}”已经存在`, { fieldRef, itemRef }));
        return;
      }
      const item = {
        item_ref: itemRef,
        item_name: '',
        item_type: '',
        required: requiredByFieldRef[fieldRef],
        instructions: '',
        business_data_ref: null,
        data_field_ref: null,
        value_usage_mode: 'pending_confirmation',
        value_origin_mode: 'pending_confirmation',
        source_links: []
      };
      const patchResult = buildReferencePatch(item, fieldRef, fieldIndex);
      if (!patchResult.ok) {
        patchResult.errors.forEach(itemError => errors.push(itemError));
        return;
      }
      plannedItems.push(Object.assign(item, patchResult.patch));
    });
    if (errors.length) return failure(input, errors);

    const candidate = clone(documentValue);
    const candidateForm = array(candidate.forms).find(form => text(form?.form_ref) === formRef);
    let candidateArea;
    let createdArea = null;
    if (newArea) {
      candidateArea = {
        area_ref: generatedAreaRef,
        area_type: newAreaType,
        area_title: newAreaTitle,
        items: []
      };
      candidateForm.areas = array(candidateForm.areas);
      candidateForm.areas.push(candidateArea);
      createdArea = {
        areaRef: generatedAreaRef,
        areaType: newAreaType,
        areaTitle: newAreaTitle
      };
    } else {
      candidateArea = array(candidateForm.areas).find(area => text(area?.area_ref) === text(selectedArea?.area_ref));
    }
    plannedItems.forEach(item => candidateArea.items.push(clone(item)));

    return {
      ok: true,
      document: candidate,
      addedItems: plannedItems.map(item => ({
        itemRef: item.item_ref,
        fieldRef: item.data_field_ref,
        dataRef: item.business_data_ref,
        areaRef: candidateArea.area_ref,
        required: item.required
      })),
      createdArea,
      candidateKey: text(input.candidateKey),
      documentFingerprint: text(input.documentFingerprint),
      errors: []
    };
  }

  return {
    indexDataFields,
    buildReferencePatch,
    planBatchReference
  };
}));
