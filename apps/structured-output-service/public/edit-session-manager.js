(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EditSessionManager = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createEditSessionManagerApi() {
  'use strict';

  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).reduce((result, key) => {
      result[key] = clone(value[key]);
      return result;
    }, {});
  }

  function equalValues(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      return left.every((item, index) => equalValues(item, right[index]));
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && equalValues(left[key], right[key]));
  }

  function normalizeAllowedFields(fields) {
    if (!Array.isArray(fields)) return [];
    return [...new Set(fields.filter(field => typeof field === 'string' && field))];
  }

  function selectAllowedFields(value, allowedFields) {
    const source = value && typeof value === 'object' ? value : {};
    return allowedFields.reduce((result, field) => {
      if (hasOwn(source, field)) result[field] = clone(source[field]);
      return result;
    }, {});
  }

  function ignoredPatchFields(value, allowedFields) {
    if (!value || typeof value !== 'object') return [];
    const allowed = new Set(allowedFields);
    return Object.keys(value).filter(field => !allowed.has(field));
  }

  function fieldState(value, field) {
    return {
      exists: Boolean(value && typeof value === 'object' && hasOwn(value, field)),
      value: value && typeof value === 'object' ? value[field] : undefined
    };
  }

  function equalFieldState(left, right) {
    return left.exists === right.exists && (!left.exists || equalValues(left.value, right.value));
  }

  function changedPatchFields(baselineFields, patch, allowedFields) {
    return allowedFields.filter(field => {
      if (!hasOwn(patch, field)) return false;
      return !equalFieldState(fieldState(baselineFields, field), fieldState(patch, field));
    });
  }

  function mergeAllowedPatch(options = {}) {
    const currentEntity = options.currentEntity;
    if (!currentEntity || typeof currentEntity !== 'object' || Array.isArray(currentEntity)) {
      return {
        ok: false,
        code: 'ENTITY_MISSING',
        mergedEntity: clone(currentEntity),
        conflicts: [],
        changedFields: []
      };
    }

    const allowedFields = normalizeAllowedFields(options.allowedFields);
    const baselineFields = selectAllowedFields(options.baselineFields, allowedFields);
    const patch = selectAllowedFields(options.patch, allowedFields);
    const changedFields = changedPatchFields(baselineFields, patch, allowedFields);
    const conflicts = changedFields.reduce((result, field) => {
      const baseline = fieldState(baselineFields, field);
      const current = fieldState(currentEntity, field);
      if (!equalFieldState(baseline, current)) {
        result.push({
          field,
          baselineExists: baseline.exists,
          baselineValue: clone(baseline.value),
          currentExists: current.exists,
          currentValue: clone(current.value),
          patchValue: clone(patch[field])
        });
      }
      return result;
    }, []);

    const mergedEntity = clone(currentEntity);
    if (!conflicts.length) {
      changedFields.forEach(field => {
        mergedEntity[field] = clone(patch[field]);
      });
    }

    return {
      ok: conflicts.length === 0,
      code: conflicts.length ? 'FIELD_CONFLICT' : '',
      mergedEntity,
      conflicts,
      changedFields
    };
  }

  function requireIdentity(name, value) {
    if (value == null || value === '') throw new TypeError(`EditSession ${name} is required`);
    return clone(value);
  }

  function sameIdentity(left, right) {
    return equalValues(left.candidateKey, right.candidateKey)
      && equalValues(left.editorKind, right.editorKind)
      && equalValues(left.entityRef, right.entityRef);
  }

  function createManager() {
    let activeSession = null;

    function refreshDirty() {
      if (!activeSession) return false;
      activeSession.dirty = Boolean(activeSession.started)
        || changedPatchFields(
          activeSession.baselineFields,
          activeSession.patch,
          activeSession.allowedFields
        ).length > 0;
      return activeSession.dirty;
    }

    function snapshot() {
      if (!activeSession) return null;
      refreshDirty();
      return clone(activeSession);
    }

    function normalizeSession(options = {}) {
      const allowedFields = normalizeAllowedFields(options.allowedFields);
      return {
        candidateKey: requireIdentity('candidateKey', options.candidateKey),
        editorKind: requireIdentity('editorKind', options.editorKind),
        entityRef: requireIdentity('entityRef', options.entityRef),
        allowedFields,
        baselineFields: selectAllowedFields(options.baselineFields, allowedFields),
        patch: selectAllowedFields(options.patch, allowedFields),
        dirty: false,
        canApply: options.canApply !== false,
        started: Boolean(options.started),
        focusTarget: clone(options.focusTarget == null ? null : options.focusTarget)
      };
    }

    function open(options = {}) {
      const nextSession = normalizeSession(options);
      const ignoredFields = ignoredPatchFields(options.patch, nextSession.allowedFields);
      if (activeSession && refreshDirty() && !sameIdentity(activeSession, nextSession)) {
        return {
          ok: false,
          code: 'ACTIVE_EDIT_SESSION',
          reused: false,
          ignoredFields,
          session: snapshot()
        };
      }
      if (activeSession && refreshDirty() && sameIdentity(activeSession, nextSession)) {
        return {
          ok: true,
          code: '',
          reused: true,
          ignoredFields,
          session: snapshot()
        };
      }
      activeSession = nextSession;
      refreshDirty();
      return {
        ok: true,
        code: '',
        reused: false,
        ignoredFields,
        session: snapshot()
      };
    }

    function get(query = null) {
      const current = snapshot();
      if (!current || !query) return current;
      if (typeof query !== 'object') return equalValues(current.candidateKey, query) ? current : null;
      const fields = ['candidateKey', 'editorKind', 'entityRef'];
      return fields.every(field => !hasOwn(query, field) || equalValues(current[field], query[field]))
        ? current
        : null;
    }

    function updatePatch(values = {}, options = {}) {
      if (!activeSession) return { ok: false, code: 'NO_ACTIVE_SESSION', ignoredFields: [], session: null };
      const ignoredFields = ignoredPatchFields(values, activeSession.allowedFields);
      const allowedPatch = selectAllowedFields(values, activeSession.allowedFields);
      Object.keys(allowedPatch).forEach(field => {
        activeSession.patch[field] = clone(allowedPatch[field]);
      });
      if (hasOwn(options, 'started')) activeSession.started = Boolean(options.started);
      refreshDirty();
      return { ok: true, code: '', ignoredFields, session: snapshot() };
    }

    function replacePatch(values = {}, options = {}) {
      if (!activeSession) return { ok: false, code: 'NO_ACTIVE_SESSION', ignoredFields: [], session: null };
      const ignoredFields = ignoredPatchFields(values, activeSession.allowedFields);
      activeSession.patch = selectAllowedFields(values, activeSession.allowedFields);
      if (hasOwn(options, 'started')) activeSession.started = Boolean(options.started);
      refreshDirty();
      return { ok: true, code: '', ignoredFields, session: snapshot() };
    }

    function isDirty(candidateKey) {
      if (!activeSession) return false;
      if (arguments.length && !equalValues(activeSession.candidateKey, candidateKey)) return false;
      return refreshDirty();
    }

    function canApply(candidateKey) {
      if (!activeSession) return false;
      if (arguments.length && !equalValues(activeSession.candidateKey, candidateKey)) return false;
      return Boolean(activeSession.canApply);
    }

    function setCanApply(value) {
      if (!activeSession) return null;
      activeSession.canApply = Boolean(value);
      return snapshot();
    }

    function setStarted(value) {
      if (!activeSession) return null;
      activeSession.started = Boolean(value);
      refreshDirty();
      return snapshot();
    }

    function mergeCurrentEntity(currentEntity) {
      if (!activeSession) {
        return {
          ok: false,
          code: 'NO_ACTIVE_SESSION',
          mergedEntity: clone(currentEntity),
          conflicts: [],
          changedFields: []
        };
      }
      if (!activeSession.canApply) {
        return {
          ok: false,
          code: 'SESSION_NOT_APPLICABLE',
          mergedEntity: clone(currentEntity),
          conflicts: [],
          changedFields: changedPatchFields(
            activeSession.baselineFields,
            activeSession.patch,
            activeSession.allowedFields
          )
        };
      }
      return mergeAllowedPatch({
        currentEntity,
        baselineFields: activeSession.baselineFields,
        patch: activeSession.patch,
        allowedFields: activeSession.allowedFields
      });
    }

    function discard() {
      const discarded = snapshot();
      activeSession = null;
      return discarded;
    }

    function reset() {
      activeSession = null;
      return null;
    }

    return Object.freeze({
      open,
      get,
      updatePatch,
      replacePatch,
      isDirty,
      canApply,
      setCanApply,
      setStarted,
      mergeCurrentEntity,
      discard,
      reset
    });
  }

  return Object.freeze({ clone, equalValues, mergeAllowedPatch, createManager });
}));
