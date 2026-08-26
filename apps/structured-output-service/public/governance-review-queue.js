(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GovernanceReviewQueue = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createGovernanceReviewQueueApi() {
  'use strict';

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).reduce((result, key) => {
      result[key] = clone(value[key]);
      return result;
    }, {});
  }

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function firstText(...values) {
    return values.map(text).find(Boolean) || '';
  }

  function issueIdentity(issue = {}) {
    const ruleCode = firstText(issue.ruleCode, issue.rule_code, issue.code);
    if (!ruleCode) throw new TypeError('Governance review issue ruleCode is required');

    const stableRef = firstText(
      issue.stableRef,
      issue.stable_ref,
      issue.targetRef,
      issue.target_ref,
      issue.entityRef,
      issue.entity_ref,
      issue.focusRef,
      issue.focus_ref,
      issue.ref
    );
    const focusPaths = Array.isArray(issue.focusPaths)
      ? issue.focusPaths.map(text).filter(Boolean)
      : Array.isArray(issue.focus_paths)
        ? issue.focus_paths.map(text).filter(Boolean)
        : [];
    const path = firstText(
      issue.path,
      issue.focusPath,
      issue.focus_path,
      issue.fieldPath,
      issue.field_path,
      focusPaths.length ? JSON.stringify(focusPaths) : '',
      [issue.stepId, issue.editorSection, issue.processSection, issue.tableId, issue.rowId, issue.column]
        .map(text)
        .filter(Boolean)
        .join('/')
    );
    return { ruleCode, stableRef, path };
  }

  function stableIssueKey(issue = {}) {
    const identity = issueIdentity(issue);
    return JSON.stringify([identity.ruleCode, identity.stableRef, identity.path]);
  }

  function normalizeIssues(issues) {
    const seen = new Set();
    return (Array.isArray(issues) ? issues : []).reduce((result, issue) => {
      if (!issue || typeof issue !== 'object') return result;
      const queueKey = stableIssueKey(issue);
      if (seen.has(queueKey)) {
        const identity = issueIdentity(issue);
        throw new Error(
          `Governance review issue identity conflict: ${identity.ruleCode}`
          + ` / ${identity.stableRef || '(no stable ref)'}`
          + ` / ${identity.path || '(no path)'}`
        );
      }
      seen.add(queueKey);
      result.push({ ...clone(issue), queueKey });
      return result;
    }, []);
  }

  function candidateId(candidateKey) {
    const value = text(candidateKey);
    if (!value) throw new TypeError('GovernanceReviewQueue candidateKey is required');
    return value;
  }

  function emptyEntry() {
    return {
      issues: [],
      cursorKey: '',
      skippedKeys: new Set(),
      stale: false,
      checkedAtRevision: null,
      staleSinceRevision: null,
      changes: { retainedKeys: [], resolvedKeys: [], addedKeys: [] }
    };
  }

  function orderedIssues(entry) {
    const active = entry.issues.filter(issue => !entry.skippedKeys.has(issue.queueKey));
    const skipped = entry.issues.filter(issue => entry.skippedKeys.has(issue.queueKey));
    return active.concat(skipped);
  }

  function ensureCursor(entry) {
    if (entry.issues.some(issue => issue.queueKey === entry.cursorKey)) return entry.cursorKey;
    entry.cursorKey = orderedIssues(entry)[0]?.queueKey || '';
    return entry.cursorKey;
  }

  function publicState(entry) {
    ensureCursor(entry);
    const ordered = orderedIssues(entry);
    const currentIndex = ordered.findIndex(issue => issue.queueKey === entry.cursorKey);
    return {
      issues: entry.issues.map(issue => ({
        ...clone(issue),
        skipped: entry.skippedKeys.has(issue.queueKey)
      })),
      orderedKeys: ordered.map(issue => issue.queueKey),
      cursorKey: entry.cursorKey,
      currentIssue: currentIndex >= 0 ? clone(ordered[currentIndex]) : null,
      currentIndex: currentIndex >= 0 ? currentIndex + 1 : 0,
      total: entry.issues.length,
      skippedKeys: entry.issues
        .filter(issue => entry.skippedKeys.has(issue.queueKey))
        .map(issue => issue.queueKey),
      stale: entry.stale,
      checkedAtRevision: clone(entry.checkedAtRevision),
      staleSinceRevision: clone(entry.staleSinceRevision),
      changes: clone(entry.changes)
    };
  }

  function nextRetainedKey(previousIssues, cursorKey, nextKeys) {
    if (!previousIssues.length || !nextKeys.size) return '';
    const currentIndex = Math.max(0, previousIssues.findIndex(issue => issue.queueKey === cursorKey));
    for (let offset = 1; offset <= previousIssues.length; offset += 1) {
      const issue = previousIssues[(currentIndex + offset) % previousIssues.length];
      if (nextKeys.has(issue.queueKey)) return issue.queueKey;
    }
    return '';
  }

  function createManager() {
    const entries = new Map();

    function entryFor(candidateKey, create = true) {
      const key = candidateId(candidateKey);
      if (!entries.has(key) && create) entries.set(key, emptyEntry());
      return entries.get(key) || emptyEntry();
    }

    function get(candidateKey) {
      return publicState(entryFor(candidateKey, false));
    }

    function snapshot(candidateKey, issues, options = {}) {
      const key = candidateId(candidateKey);
      const normalized = normalizeIssues(issues);
      const entry = emptyEntry();
      entry.issues = normalized;
      entry.cursorKey = normalized[0]?.queueKey || '';
      entry.checkedAtRevision = clone(options.revision == null ? null : options.revision);
      entry.changes.addedKeys = normalized.map(issue => issue.queueKey);
      entries.set(key, entry);
      return publicState(entry);
    }

    function markStale(candidateKey, options = {}) {
      const entry = entryFor(candidateKey);
      entry.stale = entry.checkedAtRevision != null;
      entry.staleSinceRevision = clone(options.revision == null ? null : options.revision);
      return publicState(entry);
    }

    function reconcile(candidateKey, issues, options = {}) {
      const entry = entryFor(candidateKey);
      const previousIssues = entry.issues.slice();
      const previousKeys = new Set(previousIssues.map(issue => issue.queueKey));
      const nextIssues = normalizeIssues(issues);
      const nextKeys = new Set(nextIssues.map(issue => issue.queueKey));
      const previousCursor = entry.cursorKey;

      entry.issues = nextIssues;
      entry.skippedKeys = new Set([...entry.skippedKeys].filter(key => nextKeys.has(key)));
      entry.stale = false;
      entry.checkedAtRevision = clone(options.revision == null ? null : options.revision);
      entry.staleSinceRevision = null;
      entry.changes = {
        retainedKeys: nextIssues.filter(issue => previousKeys.has(issue.queueKey)).map(issue => issue.queueKey),
        resolvedKeys: previousIssues.filter(issue => !nextKeys.has(issue.queueKey)).map(issue => issue.queueKey),
        addedKeys: nextIssues.filter(issue => !previousKeys.has(issue.queueKey)).map(issue => issue.queueKey)
      };

      if (nextKeys.has(previousCursor)) entry.cursorKey = previousCursor;
      else entry.cursorKey = nextRetainedKey(previousIssues, previousCursor, nextKeys);
      ensureCursor(entry);
      return publicState(entry);
    }

    function select(candidateKey, queueKey) {
      const entry = entryFor(candidateKey);
      const normalizedKey = text(queueKey);
      if (!entry.issues.some(issue => issue.queueKey === normalizedKey)) return publicState(entry);
      entry.cursorKey = normalizedKey;
      return publicState(entry);
    }

    function move(candidateKey, direction) {
      const entry = entryFor(candidateKey);
      const ordered = orderedIssues(entry);
      if (!ordered.length) return publicState(entry);
      ensureCursor(entry);
      const currentIndex = Math.max(0, ordered.findIndex(issue => issue.queueKey === entry.cursorKey));
      const offset = direction < 0 ? -1 : 1;
      entry.cursorKey = ordered[(currentIndex + offset + ordered.length) % ordered.length].queueKey;
      return publicState(entry);
    }

    function next(candidateKey) {
      return move(candidateKey, 1);
    }

    function previous(candidateKey) {
      return move(candidateKey, -1);
    }

    function skipCurrent(candidateKey) {
      const entry = entryFor(candidateKey);
      ensureCursor(entry);
      if (!entry.cursorKey) return publicState(entry);

      const currentKey = entry.cursorKey;
      const currentIndex = Math.max(0, entry.issues.findIndex(issue => issue.queueKey === currentKey));
      entry.skippedKeys.add(currentKey);
      const remaining = entry.issues.filter(issue => !entry.skippedKeys.has(issue.queueKey));
      if (remaining.length) {
        let nextIssue = null;
        for (let offset = 1; offset <= entry.issues.length; offset += 1) {
          const candidate = entry.issues[(currentIndex + offset) % entry.issues.length];
          if (!entry.skippedKeys.has(candidate.queueKey)) {
            nextIssue = candidate;
            break;
          }
        }
        entry.cursorKey = nextIssue?.queueKey || remaining[0].queueKey;
      } else if (entry.issues.length > 1) {
        entry.cursorKey = entry.issues[(currentIndex + 1) % entry.issues.length].queueKey;
      }
      return publicState(entry);
    }

    function clear(candidateKey) {
      if (candidateKey == null) entries.clear();
      else entries.delete(candidateId(candidateKey));
    }

    return Object.freeze({
      get,
      snapshot,
      markStale,
      reconcile,
      select,
      next,
      previous,
      skipCurrent,
      clear
    });
  }

  return Object.freeze({ clone, issueIdentity, stableIssueKey, normalizeIssues, createManager });
}));
