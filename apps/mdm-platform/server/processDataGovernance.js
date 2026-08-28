const crypto = require('node:crypto');

const DETAIL_TYPES = Object.freeze([
  'data_object_identity',
  'critical_field',
  'data_flow',
  'lifecycle_rule'
]);
const DETAIL_STATUSES = Object.freeze([
  'pending',
  'needs_business_fact',
  'confirmed',
  'not_applicable',
  'terminated'
]);
const COMPLETE_DETAIL_STATUSES = new Set(['confirmed', 'not_applicable', 'terminated']);
const HIGH_RISK_ACTIONS = new Set(['destroy', 'irreversible_anonymize']);
const RULE_VERSION = 'process-data-governance-rules-v1-2026-08-27';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex');
}

function detailRef(type, ...parts) {
  return `${type}:${parts.map(text).filter(Boolean).join(':')}`;
}

function dataBehaviorOperations(link) {
  const operation = text(link && link.operation);
  return operation ? [operation] : [];
}

function lifecycleEvents(dataObject) {
  return list(dataObject && dataObject.lifecycle && dataObject.lifecycle.routes)
    .flatMap(route => list(route && route.events).map(event => ({ route, event })));
}

function buildGovernanceCandidates(document) {
  const candidates = [];
  for (const dataObject of list(document && document.data_objects)) {
    const dataRef = text(dataObject && dataObject.data_ref);
    if (!dataRef) continue;
    const behaviorLinks = list(dataObject.behavior_links);
    const sourceRelations = list(dataObject.source_relations);
    const fields = list(dataObject.fields);
    const lifecycleItems = lifecycleEvents(dataObject);
    const informationType = text(dataObject.information_type) || 'pending_confirmation';
    candidates.push({
      detail_ref: detailRef('object', dataRef),
      detail_type: 'data_object_identity',
      source_ref: dataRef,
      parent_source_ref: null,
      rule_code: 'V7_DATA_OBJECT_PRESENT',
      candidate: {
        proposed_object_class: 'pending_confirmation',
        proposed_master_data_status: 'pending_confirmation',
        proposed_match_status: 'pending_confirmation',
        reason_codes: ['source_data_object'],
        information_type_signal: informationType
      },
      source_digest: digest({
        data_ref: dataRef,
        information_type: informationType,
        field_refs: fields.map(field => text(field.field_ref)),
        behavior_link_refs: behaviorLinks.map(link => text(link.link_ref)),
        source_relation_refs: sourceRelations.map(relation => text(relation.source_ref)),
        lifecycle_event_refs: lifecycleItems.map(item => text(item.event && item.event.event_ref))
      }),
      high_risk: false
    });

    const fieldSignals = ['declared_field'];
    if (informationType === 'identifier') fieldSignals.push('identifier_object');
    if (behaviorLinks.length > 1) fieldSignals.push('used_by_multiple_behaviors');
    if (sourceRelations.length > 0) fieldSignals.push('has_declared_source_relation');
    if (fields.length) {
      for (const field of fields) {
        const fieldRef = text(field && field.field_ref);
        if (!fieldRef) continue;
        candidates.push({
          detail_ref: detailRef('field', dataRef, fieldRef),
          detail_type: 'critical_field',
          source_ref: fieldRef,
          parent_source_ref: dataRef,
          rule_code: 'V7_STRUCTURAL_CRITICAL_FIELD_SIGNAL',
          candidate: {
            proposed_critical_field_status: 'pending_confirmation',
            reason_codes: fieldSignals
          },
          source_digest: digest({ data_ref: dataRef, field_ref: fieldRef, signals: fieldSignals }),
          high_risk: false
        });
      }
    } else {
      candidates.push({
        detail_ref: detailRef('field', dataRef, 'field-scope'),
        detail_type: 'critical_field',
        source_ref: dataRef,
        parent_source_ref: dataRef,
        rule_code: 'V7_NO_DECLARED_FIELD',
        candidate: {
          proposed_critical_field_status: 'pending_confirmation',
          reason_codes: ['no_declared_field']
        },
        source_digest: digest({ data_ref: dataRef, fields: [] }),
        high_risk: false
      });
    }

    for (const link of behaviorLinks) {
      const operations = dataBehaviorOperations(link);
      const linkRef = text(link && link.link_ref) || digest([
        dataRef,
        link && link.behavior_ref,
        operations,
        list(link && link.updated_field_refs)
      ]).slice(0, 24);
      candidates.push({
        detail_ref: detailRef('flow', dataRef, linkRef),
        detail_type: 'data_flow',
        source_ref: linkRef,
        parent_source_ref: dataRef,
        rule_code: 'V7_DATA_BEHAVIOR_LINK',
        candidate: {
          proposed_relation_status: 'pending_confirmation',
          behavior_ref: text(link && link.behavior_ref),
          operation_codes: operations,
          reason_codes: ['declared_behavior_link']
        },
        source_digest: digest({
          data_ref: dataRef,
          link_ref: linkRef,
          behavior_ref: text(link && link.behavior_ref),
          operations,
          updated_field_refs: list(link && link.updated_field_refs).map(text).filter(Boolean)
        }),
        high_risk: false
      });
    }
    if (!behaviorLinks.length) {
      candidates.push({
        detail_ref: detailRef('flow', dataRef, 'flow-scope'),
        detail_type: 'data_flow',
        source_ref: dataRef,
        parent_source_ref: dataRef,
        rule_code: 'V7_NO_DATA_BEHAVIOR_LINK',
        candidate: {
          proposed_relation_status: 'pending_confirmation',
          reason_codes: ['no_declared_behavior_link']
        },
        source_digest: digest({ data_ref: dataRef, behavior_links: [] }),
        high_risk: false
      });
    }

    for (const { route, event } of lifecycleItems) {
      const eventRef = text(event && event.event_ref);
      if (!eventRef) continue;
      const action = text(event.action);
      const highRisk = Boolean(event.high_risk) || HIGH_RISK_ACTIONS.has(action) || text(event.target_scope) === 'all_records';
      candidates.push({
        detail_ref: detailRef('lifecycle', dataRef, eventRef),
        detail_type: 'lifecycle_rule',
        source_ref: eventRef,
        parent_source_ref: dataRef,
        rule_code: highRisk ? 'V7_LIFECYCLE_HIGH_RISK_EVENT' : 'V7_LIFECYCLE_EVENT',
        candidate: {
          proposed_rule_status: 'pending_confirmation',
          action,
          route_ref: text(route && route.route_ref),
          high_risk_reason_codes: [
            ...(Boolean(event.high_risk) ? ['source_high_risk_flag'] : []),
            ...(HIGH_RISK_ACTIONS.has(action) ? ['irreversible_action'] : []),
            ...(text(event.target_scope) === 'all_records' ? ['all_records_scope'] : [])
          ]
        },
        source_digest: digest({ data_ref: dataRef, route_ref: route && route.route_ref, event }),
        high_risk: highRisk
      });
    }
    if (!lifecycleItems.length) {
      candidates.push({
        detail_ref: detailRef('lifecycle', dataRef, 'lifecycle-scope'),
        detail_type: 'lifecycle_rule',
        source_ref: dataRef,
        parent_source_ref: dataRef,
        rule_code: 'V7_NO_LIFECYCLE_EVENT',
        candidate: {
          proposed_rule_status: 'pending_confirmation',
          reason_codes: ['no_declared_lifecycle_event']
        },
        source_digest: digest({ data_ref: dataRef, lifecycle_events: [] }),
        high_risk: false
      });
    }
  }
  if (!candidates.some(item => item.detail_type === 'data_object_identity')) {
    const processRef = text(document && document.process && document.process.process_ref) || 'current-process';
    candidates.push({
      detail_ref: detailRef('object', processRef, 'data-scope'),
      detail_type: 'data_object_identity',
      source_ref: processRef,
      parent_source_ref: null,
      rule_code: 'V7_NO_DATA_OBJECT_SCOPE',
      candidate: {
        proposed_object_class: 'pending_confirmation',
        proposed_master_data_status: 'pending_confirmation',
        proposed_match_status: 'pending_confirmation',
        reason_codes: ['no_declared_data_object']
      },
      source_digest: digest({ process_ref: processRef, data_objects: [] }),
      high_risk: false
    });
  }
  return candidates.sort((left, right) => left.detail_ref.localeCompare(right.detail_ref));
}

function buildSourceIndex(document) {
  const index = new Map();
  const behaviors = new Map(list(document && document.behaviors).map(item => [text(item && item.behavior_ref), item]));
  for (const dataObject of list(document && document.data_objects)) {
    const dataRef = text(dataObject && dataObject.data_ref);
    if (!dataRef) continue;
    index.set(detailRef('object', dataRef), {
      data_ref: dataRef,
      data_name: text(dataObject.data_name),
      description: text(dataObject.description),
      information_type: text(dataObject.information_type)
    });
    for (const field of list(dataObject.fields)) {
      const fieldRef = text(field && field.field_ref);
      index.set(detailRef('field', dataRef, fieldRef), {
        data_ref: dataRef,
        data_name: text(dataObject.data_name),
        field_ref: fieldRef,
        field_name: text(field && field.field_name),
        field_type: text(field && field.field_type),
        definition: text(field && field.definition)
      });
    }
    if (!list(dataObject.fields).length) {
      index.set(detailRef('field', dataRef, 'field-scope'), {
        data_ref: dataRef,
        data_name: text(dataObject.data_name),
        missing_field_scope: true
      });
    }
    for (const link of list(dataObject.behavior_links)) {
      const operations = dataBehaviorOperations(link);
      const linkRef = text(link && link.link_ref) || digest([
        dataRef,
        link && link.behavior_ref,
        operations,
        list(link && link.updated_field_refs)
      ]).slice(0, 24);
      const behavior = behaviors.get(text(link && link.behavior_ref)) || {};
      index.set(detailRef('flow', dataRef, linkRef), {
        data_ref: dataRef,
        data_name: text(dataObject.data_name),
        link_ref: linkRef,
        behavior_ref: text(link && link.behavior_ref),
        behavior_name: text(behavior.behavior_name),
        operations,
        updated_field_refs: list(link && link.updated_field_refs).map(text).filter(Boolean)
      });
    }
    if (!list(dataObject.behavior_links).length) {
      index.set(detailRef('flow', dataRef, 'flow-scope'), {
        data_ref: dataRef,
        data_name: text(dataObject.data_name),
        missing_data_flow_scope: true
      });
    }
    const lifecycleItems = lifecycleEvents(dataObject);
    for (const { route, event } of lifecycleItems) {
      const eventRef = text(event && event.event_ref);
      index.set(detailRef('lifecycle', dataRef, eventRef), {
        data_ref: dataRef,
        data_name: text(dataObject.data_name),
        route_ref: text(route && route.route_ref),
        route_label: text(route && route.route_label),
        event_ref: eventRef,
        action: text(event && event.action),
        trigger: event && event.trigger || null,
        responsibility: event && event.responsibility || null,
        exception_handling: text(event && event.exception_handling),
        source_review_status: text(event && event.review_status),
        high_risk: Boolean(event && event.high_risk)
      });
    }
    if (!lifecycleItems.length) {
      index.set(detailRef('lifecycle', dataRef, 'lifecycle-scope'), {
        data_ref: dataRef,
        data_name: text(dataObject.data_name),
        missing_lifecycle_scope: true
      });
    }
  }
  if (!list(document && document.data_objects).length) {
    const processRef = text(document && document.process && document.process.process_ref) || 'current-process';
    index.set(detailRef('object', processRef, 'data-scope'), {
      process_ref: processRef,
      process_name: text(document && document.process && document.process.process_name),
      missing_data_scope: true
    });
  }
  return index;
}

function riskFromDocument(document) {
  const candidates = buildGovernanceCandidates(document);
  const highRiskCount = candidates.filter(item => item.high_risk).length;
  return {
    risk_level: highRiskCount ? 'high' : 'normal',
    high_risk_detail_count: highRiskCount,
    rule_codes: [...new Set(candidates.filter(item => item.high_risk).map(item => item.rule_code))]
  };
}

function addBusinessDays(start, amount) {
  const date = new Date(start);
  let remaining = Number(amount) || 0;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date;
}

module.exports = {
  COMPLETE_DETAIL_STATUSES,
  DETAIL_STATUSES,
  DETAIL_TYPES,
  HIGH_RISK_ACTIONS,
  RULE_VERSION,
  addBusinessDays,
  buildGovernanceCandidates,
  buildSourceIndex,
  digest,
  riskFromDocument,
  stableValue,
  text
};
