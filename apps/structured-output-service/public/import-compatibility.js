(function initImportCompatibility(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ImportCompatibility = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createImportCompatibility() {
  'use strict';

  const REPAIRABLE_RULE_CODES = Object.freeze([
    'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED',
    'FORM_RELATION_ACTION_BEHAVIOR_REQUIRED'
  ]);
  const NORMALIZATION_DETAIL_LIMIT = 200;
  const repairableRuleCodes = new Set(REPAIRABLE_RULE_CODES);

  function own(value, key) {
    return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
  }

  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function snapshotValue(value) {
    return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  }

  function pointerToken(value) {
    return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  function pointerSegments(path) {
    if (!path) return [];
    return path.slice(1).split('/').map(value => value.replace(/~1/g, '/').replace(/~0/g, '~'));
  }

  function collectDifferences(before, after, path = '', result = []) {
    if (Object.is(before, after)) return result;
    if (Array.isArray(before) && Array.isArray(after)) {
      const length = Math.max(before.length, after.length);
      for (let index = 0; index < length; index += 1) {
        const nextPath = `${path}/${index}`;
        if (index >= before.length) {
          result.push({ kind: 'added', path: nextPath, before_present: false, after_present: true, after_value: snapshotValue(after[index]) });
        } else if (index >= after.length) {
          result.push({ kind: 'removed', path: nextPath, before_present: true, before_value: snapshotValue(before[index]), after_present: false });
        } else {
          collectDifferences(before[index], after[index], nextPath, result);
        }
      }
      return result;
    }
    if (isObject(before) && isObject(after)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      keys.forEach(key => {
        const nextPath = `${path}/${pointerToken(key)}`;
        if (!own(before, key)) {
          result.push({ kind: 'added', path: nextPath, before_present: false, after_present: true, after_value: snapshotValue(after[key]) });
        } else if (!own(after, key)) {
          result.push({ kind: 'removed', path: nextPath, before_present: true, before_value: snapshotValue(before[key]), after_present: false });
        } else {
          collectDifferences(before[key], after[key], nextPath, result);
        }
      });
      return result;
    }
    result.push({
      kind: typeof before === typeof after ? 'changed' : 'type_changed',
      path,
      before_present: true,
      before_value: snapshotValue(before),
      after_present: true,
      after_value: snapshotValue(after)
    });
    return result;
  }

  function namedIdentity(item, refKey, nameKey, fallbackName = '') {
    return {
      stable_object_ref: String(item?.[refKey] || ''),
      object_name: String(item?.[nameKey] || fallbackName || '')
    };
  }

  function identityForPath(path, before, after) {
    const segments = pointerSegments(path);
    const root = segments[0];
    const index = Number(segments[1]);
    const source = after || before || {};
    const fallback = before || after || {};
    if (root === 'process') return namedIdentity(source.process || fallback.process, 'process_ref', 'process_name');
    if (root === 'export_meta') return namedIdentity(source.export_meta || fallback.export_meta, 'package_ref', 'package_ref');
    if (root === 'behaviors' && Number.isInteger(index)) {
      return namedIdentity(source.behaviors?.[index] || fallback.behaviors?.[index], 'behavior_ref', 'behavior_name');
    }
    if (root === 'flow_relations' && Number.isInteger(index)) {
      const relation = source.flow_relations?.[index] || fallback.flow_relations?.[index];
      return namedIdentity(relation, 'relation_ref', 'relation_ref');
    }
    if (root === 'data_objects' && Number.isInteger(index)) {
      const dataObject = source.data_objects?.[index] || fallback.data_objects?.[index];
      const fieldIndex = segments[2] === 'fields' ? Number(segments[3]) : NaN;
      if (Number.isInteger(fieldIndex)) {
        const field = dataObject?.fields?.[fieldIndex];
        return namedIdentity(field, 'field_ref', 'field_name', dataObject?.data_name);
      }
      return namedIdentity(dataObject, 'data_ref', 'data_name');
    }
    if (root === 'forms' && Number.isInteger(index)) {
      const form = source.forms?.[index] || fallback.forms?.[index];
      const areaIndex = segments[2] === 'areas' ? Number(segments[3]) : NaN;
      if (Number.isInteger(areaIndex)) {
        const area = form?.areas?.[areaIndex];
        const itemIndex = segments[4] === 'items' ? Number(segments[5]) : NaN;
        if (Number.isInteger(itemIndex)) {
          return namedIdentity(area?.items?.[itemIndex], 'item_ref', 'item_name', area?.area_name || form?.form_name);
        }
        return namedIdentity(area, 'area_ref', 'area_name', form?.form_name);
      }
      return namedIdentity(form, 'form_ref', 'form_name');
    }
    if (root === 'terms' && Number.isInteger(index)) {
      return namedIdentity(source.terms?.[index] || fallback.terms?.[index], 'term_ref', 'term_name');
    }
    if (root === 'migration' && Number.isInteger(Number(segments[2]))) {
      const archive = source.migration?.[segments[1]]?.[Number(segments[2])]
        || fallback.migration?.[segments[1]]?.[Number(segments[2])];
      const refKey = own(archive, 'record_ref') ? 'record_ref'
        : own(archive, 'archive_ref') ? 'archive_ref'
          : own(archive, 'material_ref') ? 'material_ref'
            : own(archive, 'call_ref') ? 'call_ref'
              : own(archive, 'handoff_ref') ? 'handoff_ref'
                : '';
      return refKey ? namedIdentity(archive, refKey, refKey) : { stable_object_ref: '', object_name: '' };
    }
    return { stable_object_ref: '', object_name: '' };
  }

  function genericChangeCode(kind) {
    if (kind === 'added') return 'NORMALIZATION_PROPERTY_ADDED';
    if (kind === 'removed') return 'NORMALIZATION_PROPERTY_REMOVED';
    if (kind === 'type_changed') return 'NORMALIZATION_TYPE_CHANGED';
    return 'NORMALIZATION_VALUE_CHANGED';
  }

  function dynamicActorChanges(before, after, rawDifferences) {
    if (before?.schema_version !== 'process-governance-v7') return { changes: [], consumed: new Set() };
    const consumed = new Set();
    const changes = [];
    const archives = Array.isArray(after?.migration?.unresolved_actor_roles)
      ? after.migration.unresolved_actor_roles
      : [];
    (Array.isArray(before?.behaviors) ? before.behaviors : []).forEach((behavior, index) => {
      const rawActor = typeof behavior?.current_actor_role === 'string' ? behavior.current_actor_role : '';
      if (behavior?.actor_assignment_mode !== 'dynamic_from_data' || !rawActor.trim()) return;
      const normalizedBehavior = (Array.isArray(after?.behaviors) ? after.behaviors : [])
        .find(item => item?.behavior_ref === behavior.behavior_ref);
      if (!normalizedBehavior || normalizedBehavior.current_actor_role !== '') return;
      const archiveIndex = archives.findIndex(item => (
        item?.behavior_ref === behavior.behavior_ref
        && item?.raw_actor_role === rawActor
        && item?.original_actor_assignment_mode === 'dynamic_from_data'
        && item?.source_schema_version === 'process-governance-v7'
        && String(item?.reason || '').trim()
      ));
      if (archiveIndex < 0) return;
      const actorPath = `/behaviors/${index}/current_actor_role`;
      rawDifferences.forEach((difference, differenceIndex) => {
        if (difference.path === actorPath || difference.path.startsWith(`/migration/unresolved_actor_roles/${archiveIndex}`)) {
          consumed.add(differenceIndex);
        }
      });
      changes.push({
        code: 'DYNAMIC_ACTOR_ROLE_ARCHIVED',
        path: actorPath,
        stable_object_ref: String(behavior.behavior_ref || ''),
        object_name: String(behavior.behavior_name || ''),
        before_present: true,
        before_value: rawActor,
        after_present: true,
        after_value: '',
        migration_archive_ref: String(archives[archiveIndex].record_ref || '')
      });
    });
    return { changes, consumed };
  }

  function summarizeNormalization(before, after, options = {}) {
    const rawDifferences = collectDifferences(before, after);
    const grouped = dynamicActorChanges(before, after, rawDifferences);
    const generic = rawDifferences
      .filter((_difference, index) => !grouped.consumed.has(index))
      .map(difference => ({
        code: genericChangeCode(difference.kind),
        path: difference.path,
        ...identityForPath(difference.path, before, after),
        before_present: difference.before_present,
        ...(difference.before_present ? { before_value: difference.before_value } : {}),
        after_present: difference.after_present,
        ...(difference.after_present ? { after_value: difference.after_value } : {}),
        migration_archive_ref: ''
      }));
    const allChanges = [...grouped.changes, ...generic];
    const requestedLimit = Number.isInteger(options.limit) ? options.limit : NORMALIZATION_DETAIL_LIMIT;
    const limit = Math.max(0, Math.min(NORMALIZATION_DETAIL_LIMIT, requestedLimit));
    const changes = allChanges.slice(0, limit);
    return {
      changed: allChanges.length > 0,
      totalChanges: allChanges.length,
      shownChanges: changes.length,
      truncated: changes.length < allChanges.length,
      changes
    };
  }

  function classifyPostMigrationValidation(validation) {
    if (validation?.valid === true) return { allowed: true, repairableErrors: [] };
    const errors = Array.isArray(validation?.errors) ? validation.errors : [];
    if (!errors.length || !errors.every(error => repairableRuleCodes.has(error?.rule_code))) {
      return { allowed: false, repairableErrors: [] };
    }
    return { allowed: true, repairableErrors: errors };
  }

  function classifyPostMigrationBatch(validations) {
    const values = Array.isArray(validations) ? validations : [];
    const classifications = values.map(classifyPostMigrationValidation);
    const failedIndex = classifications.findIndex(result => !result.allowed);
    if (!classifications.length || failedIndex >= 0) {
      return {
        allowed: false,
        failedIndex,
        repairableErrorCount: 0,
        classifications
      };
    }
    return {
      allowed: true,
      failedIndex: -1,
      repairableErrorCount: classifications.reduce(
        (sum, result) => sum + result.repairableErrors.length,
        0
      ),
      classifications
    };
  }

  return {
    REPAIRABLE_RULE_CODES,
    NORMALIZATION_DETAIL_LIMIT,
    classifyPostMigrationValidation,
    classifyPostMigrationBatch,
    summarizeNormalization
  };
}));
