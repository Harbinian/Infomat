(function attachProcessDataAvailability(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProcessDataAvailability = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createProcessDataAvailability() {
  'use strict';

  // Pure V9 analysis. It proves declared existence before an action; it neither
  // selects a business record by name/order nor evaluates free-text conditions.
  const text = value => typeof value === 'string' ? value.trim() : '';
  const list = value => Array.isArray(value) ? value : [];
  const validModels = new Set(['single_instance', 'record_collection']);
  const readScopes = new Set(['current_instance', 'prior_records', 'collection_metadata']);
  const readPresence = new Set(['required', 'if_exists']);

  function dataFlowConsistencyDetails(documentValue) {
    const document = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const behaviors = list(document.behaviors);
    const behaviorByRef = new Map(behaviors.map(item => [text(item.behavior_ref), item]));
    const behaviorRefs = new Set(behaviorByRef.keys());
    const relations = list(document.flow_relations).filter(item =>
      ['sequence', 'condition', 'parallel', 'loop'].includes(item.relation_type)
      && behaviorRefs.has(text(item.from_behavior_ref)) && behaviorRefs.has(text(item.to_behavior_ref)));
    const adjacency = new Map([...behaviorRefs].map(ref => [ref, new Set()]));
    const incomingByBehavior = new Map([...behaviorRefs].map(ref => [ref, []]));
    relations.forEach(relation => {
      adjacency.get(text(relation.from_behavior_ref)).add(text(relation.to_behavior_ref));
      incomingByBehavior.get(text(relation.to_behavior_ref)).push({ kind: 'relation', relation });
    });
    const entries = [...new Set(list(document.process?.entry_behavior_refs).map(text))];
    const entriesResolved = entries.length > 0 && entries.every(ref => behaviorRefs.has(ref));

    function pathTo(starts, destination, stopAfter = new Set(), options = {}) {
      const queue = starts.filter(ref => behaviorRefs.has(ref)).map(ref => [ref]);
      const seen = new Set();
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const path = queue[cursor], current = path[path.length - 1];
        if (current === destination) return path;
        if (seen.has(current) || stopAfter.has(current) || options.stopBefore?.has(current)) continue;
        seen.add(current);
        (adjacency.get(current) || []).forEach(next => queue.push(path.concat(next)));
      }
      return null;
    }
    const canReach = (fromRef, toRef) => {
      const next = [...(adjacency.get(text(fromRef)) || [])];
      return Boolean(pathTo(next, text(toRef)));
    };
    const reachable = new Set();
    const queue = entriesResolved ? [...entries] : [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      if (reachable.has(current)) continue;
      reachable.add(current);
      (adjacency.get(current) || []).forEach(next => queue.push(next));
    }

    // A parallel edge is not an ordering proof. Recognize only disjoint fork
    // regions with explicit parallel inputs at one common join; otherwise keep
    // the ordinary all-path result and report that it could not prove a value.
    const parallelBarriers = [];
    for (const split of behaviors.filter(item => item.node_type === 'parallel_split')) {
      const splitRef = text(split.behavior_ref);
      const outgoing = relations.filter(item => text(item.from_behavior_ref) === splitRef);
      const targets = [...new Set(outgoing.map(item => text(item.to_behavior_ref)))];
      if (targets.length < 2 || outgoing.some(item => item.relation_type !== 'parallel')) continue;
      for (const join of behaviors.filter(item => item.node_type === 'parallel_join')) {
        const joinRef = text(join.behavior_ref);
        const incoming = relations.filter(item => text(item.to_behavior_ref) === joinRef);
        if (incoming.length < 2 || incoming.some(item => item.relation_type !== 'parallel')) continue;
        if (!targets.every(target => pathTo([target], joinRef))) continue;
        const regions = targets.map(target => {
          const region = new Set(), pending = [target];
          for (let cursor = 0; cursor < pending.length; cursor += 1) {
            const current = pending[cursor];
            if (current === joinRef || current === splitRef || region.has(current)) continue;
            region.add(current);
            (adjacency.get(current) || []).forEach(next => pending.push(next));
          }
          return region;
        });
        if (regions.some((region, index) => [...region].some(ref => regions.some((other, n) => n !== index && other.has(ref))))) continue;
        if (regions.some(region => [...region].some(ref => relations.some(edge =>
          text(edge.to_behavior_ref) === ref && !region.has(text(edge.from_behavior_ref)) && text(edge.from_behavior_ref) !== splitRef)))) continue;
        const branchInputs = regions.map(region => incoming.filter(edge => region.has(text(edge.from_behavior_ref))));
        if (branchInputs.some(branch => !branch.length) || branchInputs.flat().length !== incoming.length) continue;
        // An independent entry inside a branch or at the join is a bypass, not
        // completion of the fork. Do not infer a barrier for that graph.
        if (entries.some(ref => ref === joinRef || regions.some(region => region.has(ref)))) continue;
        parallelBarriers.push({ splitRef, joinRef, targets, regions, branchInputs });
      }
    }

    function proofBefore(consumerRef, mandatoryProducers, requiredSources, hasRequiredStart) {
      if (!entriesResolved) return { guaranteed: false, reason: 'entry_unknown', counterexample: null };
      if (!reachable.has(consumerRef)) return { guaranteed: false, reason: 'consumer_unreachable', counterexample: null };
      if (hasRequiredStart || requiredSources.has(consumerRef)) return { guaranteed: true, counterexample: null };
      const blockers = new Set([...mandatoryProducers, ...requiredSources]);
      // Derived barriers are producers of availability, never business records.
      // A branch must itself guarantee the record before its join on every route.
      let changed = true;
      while (changed) {
        changed = false;
        for (const barrier of parallelBarriers) {
          if (blockers.has(barrier.joinRef)) continue;
          const branchGuarantees = barrier.targets.some(target => {
            if (target === barrier.joinRef) return false;
            return !pathTo([target], barrier.joinRef, blockers, { stopBefore: new Set([barrier.splitRef]) });
          });
          if (branchGuarantees) { blockers.add(barrier.joinRef); changed = true; }
        }
      }
      // A producer on the consumer itself cannot satisfy its input. pathTo
      // checks the destination before stopping after producer actions.
      const counterexample = pathTo(entries, consumerRef, blockers);
      return { guaranteed: !counterexample, counterexample,
        reason: counterexample ? 'required_not_guaranteed' : '' };
    }

    const dataDetails = list(document.data_objects).map((item, dataIndex) => {
      const dataRef = text(item.data_ref), label = text(item.data_name) || dataRef;
      const links = list(item.behavior_links);
      const creates = links.filter(link => link.operation === 'create');
      const producerRefs = [...new Set(creates.map(link => text(link.behavior_ref)))];
      const consumerRefs = [...new Set(links.filter(link => link.operation === 'use').map(link => text(link.behavior_ref)))];
      const metadataFields = new Set(list(item.collection_field_refs).map(text));
      const sources = list(item.source_relations);
      const requiredSources = new Set(sources.filter(source => source.presence === 'required' && source.availability_mode === 'at_behavior')
        .map(source => text(source.available_from_behavior_ref)).filter(ref => behaviorRefs.has(ref)));
      const availableAtProcessStart = sources.some(source => source.presence === 'required' && source.availability_mode === 'process_start');
      const mandatoryProducers = new Set(creates.filter(link => link.record_scope === 'new_instance' && link.presence === 'required')
        .map(link => text(link.behavior_ref)).filter(ref => behaviorRefs.has(ref)));
      const issues = [];
      const add = (reason, message, link, extra = {}) => issues.push({ reason, dataRef, dataIndex,
        producerRefs, producerRef: producerRefs.length === 1 ? producerRefs[0] : '', consumerRef: text(link?.behavior_ref),
        linkRef: text(link?.link_ref), message, suggestions: ['按实际业务明确记录粒度、来源存在性及读取范围；保留真实新增和历史记录，不用删除关系消除提示。'], ...extra });
      if (!validModels.has(item.record_model)) add('record_model_pending', `${label}的实例或记录集合粒度待确认。`);
      if (!entriesResolved) add('entry_unknown', `${label}的数据先后核验缺少明确有效的流程入口；入口待确认，不能推断记录已经形成。`);
      if (sources.some(source => !['required', 'if_exists'].includes(source.presence))) add('source_presence_pending', `${label}的来源是否确有记录待确认。`);
      const objectResolved = validModels.has(item.record_model);
      const proofs = new Map();
      for (const link of links) {
        const scope = link.record_scope, presence = link.presence;
        if (!behaviorRefs.has(text(link.behavior_ref))) continue;
        if (link.operation === 'create') {
          if (scope !== 'new_instance' || !['required', 'conditional'].includes(presence)) add('creation_semantics_pending', `${label}的新增实例范围或实际产生条件待确认。`, link);
          continue;
        }
        if (!['use', 'update'].includes(link.operation) || !readScopes.has(scope) || !readPresence.has(presence)) {
          add('record_access_pending', `${label}在“${text(behaviorByRef.get(link.behavior_ref)?.behavior_name) || link.behavior_ref}”的记录读取或更新范围及存在要求待确认。`, link);
          continue;
        }
        if (scope === 'prior_records' && item.record_model !== 'record_collection') {
          add('prior_records_requires_collection', `${label}尚未确认为记录集合，不能按此前记录集合读取或更新。`, link);
          continue;
        }
        if (scope === 'collection_metadata') {
          if (item.record_model !== 'record_collection' || !metadataFields.size) {
            add('collection_metadata_unresolved', `${label}未明确集合及索引字段，不能按集合元数据办理。`, link);
            continue;
          }
          if (link.operation === 'update') {
            if (!list(link.updated_field_refs).length || list(link.updated_field_refs).some(ref => !metadataFields.has(ref))) {
              add('mixed_update_granularity', `${label}的集合索引更新混入记录实例字段，必须按已声明字段粒度分别保留更新关系。`, link);
            }
            // Updating a defined collection's metadata does not manufacture a
            // record row. A collection can be empty and still have an index.
            continue;
          }
          const fieldProofs = [...metadataFields].map(fieldRef => {
            const writers = new Set(links.filter(other => other.operation === 'update'
              && other.record_scope === 'collection_metadata' && other.presence === 'required'
              && list(other.updated_field_refs).includes(fieldRef)).map(other => text(other.behavior_ref)));
            return proofBefore(text(link.behavior_ref), writers, new Set(), false);
          });
          const failed = fieldProofs.find(proof => !proof.guaranteed);
          proofs.set(link.link_ref, failed || { guaranteed: true });
          if (presence === 'required' && failed) add(failed.reason, `${label}的集合索引在本行为开始前并非每条路径均已形成。`, link, failed);
          continue;
        }
        if (link.operation === 'update' && list(link.updated_field_refs).some(ref => metadataFields.has(ref))) {
          add('mixed_update_granularity', `${label}的记录实例更新混入集合索引字段，必须按已声明字段粒度分别保留更新关系。`, link);
          continue;
        }
        const proof = proofBefore(text(link.behavior_ref), mandatoryProducers, requiredSources, availableAtProcessStart);
        proofs.set(link.link_ref, proof);
        if (presence === 'required' && objectResolved && !proof.guaranteed) {
          const behaviorLabel = text(behaviorByRef.get(link.behavior_ref)?.behavior_name) || link.behavior_ref;
          add(proof.reason, `${label}在“${behaviorLabel}”开始前不能证明每条路径都有所需的既有记录；同一动作的新输出、可选产生或仅可能经过的并行路线不能充当前序必需输入。`, link, proof);
        }
      }
      return { data: item, dataRef, dataIndex, canonicalProducerRef: producerRefs.length === 1 ? producerRefs[0] : '',
        producerRefs, effectiveProducerRef: producerRefs.length === 1 ? producerRefs[0] : '', canonicalConsumerRefs: consumerRefs,
        legacyConsumerRefs: [], consumerRefs, availabilityStarts: [...requiredSources], availableAtProcessStart,
        issues, proofs, objectResolved, mandatoryProducers, requiredSources };
    });
    const issues = dataDetails.flatMap(detail => detail.issues);
    const consumerIssue = (dataRef, behaviorRef) => dataDetails.find(detail => detail.dataRef === text(dataRef))?.issues
      .find(issue => issue.consumerRef === text(behaviorRef)) || null;
    function isAvailableBeforeBehavior(dataRef, behaviorRef) {
      const detail = dataDetails.find(item => item.dataRef === text(dataRef));
      if (!detail?.objectResolved || !behaviorRefs.has(text(behaviorRef))) return false;
      if (detail.issues.some(issue => ['source_presence_pending', 'creation_semantics_pending', 'record_model_pending', 'entry_unknown'].includes(issue.reason))) return false;
      return proofBefore(text(behaviorRef), detail.mandatoryProducers, detail.requiredSources, detail.availableAtProcessStart).guaranteed;
    }
    return { adjacency, incomingByBehavior, canReach, dataDetails, issues, consumerIssue,
      isConsumerAvailable: (dataRef, behaviorRef) => {
        const detail = dataDetails.find(item => item.dataRef === text(dataRef));
        return Boolean(detail?.objectResolved && entriesResolved && reachable.has(text(behaviorRef))
          && !detail.issues.some(issue => !issue.consumerRef || issue.consumerRef === text(behaviorRef))
          && detail.consumerRefs.includes(text(behaviorRef)));
      }, isAvailableBeforeBehavior, entryBehaviorRefs: entries, entriesResolved,
      parallelBarriers: parallelBarriers.map(({ splitRef, joinRef }) => ({ splitRef, joinRef })) };
  }

  return Object.freeze({ dataFlowConsistencyDetails });
}));
