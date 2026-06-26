const assert = require('assert');

const { makeProcessGovernanceMysqlRepository } = require('../server/processGovernanceMysqlRepository');

function limitFromSql(normalizedSql, fallback = 500) {
  const match = normalizedSql.match(/\bLIMIT\s+(\d+)\b/i);
  return match ? Number(match[1]) : fallback;
}

function makeFakePool() {
  const state = {
    snapshots: [],
    nodes: [],
    edges: [],
    a1Items: [],
    sourceFiles: [],
    mdmRequirements: [],
    evidenceRefs: [],
    risks: [],
    chains: [],
    qualityFindings: [],
    qualityCases: [],
    qualityCaseEvents: [],
    mappingRecords: [],
    mappingTodos: [],
    mappingTodoEvents: [],
    statements: [],
    nextSnapshotId: 1
  };

  return {
    state,
    async execute(sql, params = []) {
      state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      if (normalizedSql.includes('LIMIT ?')) {
        const error = new Error('Incorrect arguments to mysqld_stmt_execute');
        error.code = 'ER_WRONG_ARGUMENTS';
        throw error;
      }

      if (normalizedSql.startsWith('CREATE TABLE')) return [[], undefined];

      if (normalizedSql === "UPDATE process_governance_snapshots SET status='archived' WHERE status='active'") {
        for (const snapshot of state.snapshots) {
          if (snapshot.status === 'active') snapshot.status = 'archived';
        }
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_governance_snapshots')) {
        const [source_json_path, source_hash, generated_at, imported_by, stats_json, note] = params;
        const id = state.nextSnapshotId++;
        state.snapshots.push({
          id,
          source_json_path,
          source_hash,
          generated_at,
          imported_by,
          stats_json,
          note,
          status: 'active',
          imported_at: '2026-06-16 00:00:00'
        });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_governance_nodes')) {
        const [
          snapshot_id,
          node_key,
          node_type,
          name,
          domain_name,
          dept_name,
          parent_key,
          source_file,
          sort_order
        ] = params;
        state.nodes.push({ snapshot_id, node_key, node_type, name, domain_name, dept_name, parent_key, source_file, sort_order, id: state.nodes.length + 1 });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_governance_edges')) {
        const [snapshot_id, source_key, target_key, edge_type, value, source_file] = params;
        state.edges.push({ snapshot_id, source_key, target_key, edge_type, value, source_file, id: state.edges.length + 1 });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_a1_items')) {
        const [
          snapshot_id,
          a1_code,
          dept_name,
          l3_name,
          behavior,
          execution_role,
          approval_type,
          input_source_dept,
          output_target_dept,
          suggested_systems,
          verification_note,
          source_file
        ] = params;
        state.a1Items.push({
          snapshot_id,
          a1_code,
          dept_name,
          l3_name,
          behavior,
          execution_role,
          approval_type,
          input_source_dept,
          output_target_dept,
          suggested_systems,
          verification_note,
          source_file,
          id: state.a1Items.length + 1
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_source_files')) {
        const [
          snapshot_id,
          file_key,
          file_path,
          dept_name,
          asset_type,
          file_no,
          revision,
          size_bytes,
          mtime,
          sha256,
          process_status,
          process_reason
        ] = params;
        state.sourceFiles.push({
          snapshot_id,
          file_key,
          file_path,
          dept_name,
          asset_type,
          file_no,
          revision,
          size_bytes,
          mtime,
          sha256,
          process_status,
          process_reason,
          id: state.sourceFiles.length + 1
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_mdm_requirement_items')) {
        const [
          snapshot_id,
          requirement_key,
          dept_name,
          master_data_object,
          source_l2,
          key_fields,
          responsible_dept,
          system_boundary,
          governance_requirement,
          source_file
        ] = params;
        state.mdmRequirements.push({
          snapshot_id,
          requirement_key,
          dept_name,
          master_data_object,
          source_l2,
          key_fields,
          responsible_dept,
          system_boundary,
          governance_requirement,
          source_file,
          id: state.mdmRequirements.length + 1
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_evidence_refs')) {
        const [
          snapshot_id,
          ref_key,
          ref_type,
          dept_name,
          l3_name,
          a1_code,
          master_data_object,
          evidence_type,
          source_file,
          citation,
          note
        ] = params;
        state.evidenceRefs.push({
          snapshot_id,
          ref_key,
          ref_type,
          dept_name,
          l3_name,
          a1_code,
          master_data_object,
          evidence_type,
          source_file,
          citation,
          note,
          id: state.evidenceRefs.length + 1
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_cross_dept_interactions')) {
        const [snapshot_id, source_dept, target_dept, a1_code, refs, risk_level, confirm_status, description, source_report] = params;
        state.risks.push({ snapshot_id, source_dept, target_dept, a1_code, refs, risk_level, confirm_status, description, source_report, id: state.risks.length + 1 });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_interaction_chains')) {
        const [snapshot_id, name, status, breaks_json, source_report] = params;
        state.chains.push({ snapshot_id, name, status, breaks_json, source_report, id: state.chains.length + 1 });
        return [{ affectedRows: 1 }, undefined];
      }

      if (
        normalizedSql.includes("FROM process_governance_snapshots WHERE status='active'") ||
        normalizedSql.includes("FROM process_governance_snapshots s WHERE s.status='active'")
      ) {
        const rows = state.snapshots
          .filter(snapshot => snapshot.status === 'active')
          .sort((left, right) => {
            const leftHasA1 = state.a1Items.some(item => item.snapshot_id === left.id) ? 1 : 0;
            const rightHasA1 = state.a1Items.some(item => item.snapshot_id === right.id) ? 1 : 0;
            return rightHasA1 - leftHasA1 || right.id - left.id;
          })
          .slice(0, 1);
        return [rows, undefined];
      }

      if (normalizedSql.includes('FROM process_governance_snapshots') && normalizedSql.includes('ORDER BY imported_at DESC, id DESC')) {
        return [[...state.snapshots]
          .sort((left, right) => right.id - left.id)
          .map(snapshot => ({
            id: snapshot.id,
            source_json_path: snapshot.source_json_path,
            source_hash: snapshot.source_hash,
            generated_at: snapshot.generated_at,
            imported_at: snapshot.imported_at,
            status: snapshot.status,
            note: snapshot.note
          })), undefined];
      }

      if (normalizedSql.includes('FROM process_governance_quality_findings')) {
        const snapshotId = params[0];
        let rows = state.qualityFindings.filter(item => item.snapshot_id === snapshotId);
        let paramIndex = 1;
        if (normalizedSql.includes('severity=?')) {
          rows = rows.filter(item => item.severity === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('area=?')) {
          rows = rows.filter(item => item.area === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('dept_name=?')) {
          rows = rows.filter(item => item.dept_name === params[paramIndex]);
        }
        if (normalizedSql.includes('GROUP BY severity')) {
          const grouped = new Map();
          for (const item of rows) grouped.set(item.severity, (grouped.get(item.severity) || 0) + 1);
          return [[...grouped.entries()].map(([severity, count]) => ({ severity, count })), undefined];
        }
        return [rows.sort((left, right) => left.id - right.id), undefined];
      }

      if (normalizedSql.includes('FROM process_governance_nodes')) {
        const snapshotId = params[0];
        return [state.nodes
          .filter(node => node.snapshot_id === snapshotId)
          .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id)
          .map(node => ({
            name: node.node_key,
            label: node.name,
            node_type: node.node_type,
            domain_name: node.domain_name,
            dept_name: node.dept_name,
            parent_key: node.parent_key,
            source_file: node.source_file
          })), undefined];
      }

      if (normalizedSql.includes('FROM process_governance_edges')) {
        const snapshotId = params[0];
        return [state.edges
          .filter(edge => edge.snapshot_id === snapshotId)
          .sort((left, right) => left.id - right.id)
          .map(edge => ({ source: edge.source_key, target: edge.target_key, value: edge.value })), undefined];
      }

      if (normalizedSql.includes('FROM process_a1_items')) {
        const snapshotId = params[0];
        let rows = state.a1Items.filter(item => item.snapshot_id === snapshotId);
        let paramIndex = 1;
        if (normalizedSql.includes('dept_name=?')) {
          rows = rows.filter(item => item.dept_name === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('l3_name=?')) {
          rows = rows.filter(item => item.l3_name === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('suggested_systems LIKE ?')) {
          const system = String(params[paramIndex] || '').replace(/[%"]/g, '');
          rows = rows.filter(item => String(item.suggested_systems || '').includes(system));
        }
        return [rows.sort((left, right) =>
          left.dept_name.localeCompare(right.dept_name, 'zh-CN') ||
          left.l3_name.localeCompare(right.l3_name, 'zh-CN') ||
          left.a1_code.localeCompare(right.a1_code, 'zh-CN') ||
          left.id - right.id
        ), undefined];
      }

      if (normalizedSql.includes('FROM process_source_files')) {
        const snapshotId = params[0];
        let rows = state.sourceFiles.filter(file => file.snapshot_id === snapshotId);
        let paramIndex = 1;
        if (normalizedSql.includes('dept_name=?')) {
          rows = rows.filter(file => file.dept_name === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('process_status=?')) {
          rows = rows.filter(file => file.process_status === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('asset_type=?')) {
          rows = rows.filter(file => file.asset_type === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('GROUP BY process_status, asset_type')) {
          const grouped = new Map();
          for (const file of rows) {
            const key = `${file.process_status}|${file.asset_type}`;
            grouped.set(key, (grouped.get(key) || 0) + 1);
          }
          return [[...grouped.entries()].map(([key, count]) => {
            const [process_status, asset_type] = key.split('|');
            return { process_status, asset_type, count };
          }), undefined];
        }
        return [rows
          .sort((left, right) =>
            left.dept_name.localeCompare(right.dept_name, 'zh-CN') ||
            left.process_status.localeCompare(right.process_status, 'zh-CN') ||
            left.asset_type.localeCompare(right.asset_type, 'zh-CN') ||
            left.file_path.localeCompare(right.file_path, 'zh-CN')
          )
          .slice(0, limitFromSql(normalizedSql, params[params.length - 1]))
          .map(({ snapshot_id, file_key, id, ...file }) => file), undefined];
      }

      if (normalizedSql.includes('FROM process_mdm_requirement_items')) {
        const snapshotId = params[0];
        let rows = state.mdmRequirements.filter(item => item.snapshot_id === snapshotId);
        let paramIndex = 1;
        if (normalizedSql.includes('dept_name=?')) {
          rows = rows.filter(item => item.dept_name === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('master_data_object=?')) {
          rows = rows.filter(item => item.master_data_object === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('GROUP BY dept_name')) {
          const grouped = new Map();
          for (const item of rows) grouped.set(item.dept_name, (grouped.get(item.dept_name) || 0) + 1);
          return [[...grouped.entries()].map(([dept_name, count]) => ({ dept_name, count })), undefined];
        }
        return [rows
          .sort((left, right) =>
            left.dept_name.localeCompare(right.dept_name, 'zh-CN') ||
            left.source_l2.localeCompare(right.source_l2, 'zh-CN') ||
            left.master_data_object.localeCompare(right.master_data_object, 'zh-CN') ||
            left.id - right.id
          )
          .slice(0, limitFromSql(normalizedSql, params[params.length - 1]))
          .map(({ snapshot_id, requirement_key, id, ...item }) => item), undefined];
      }

      if (normalizedSql.includes('FROM process_evidence_refs')) {
        const snapshotId = params[0];
        let rows = state.evidenceRefs.filter(ref => ref.snapshot_id === snapshotId);
        let paramIndex = 1;
        if (normalizedSql.includes('dept_name=?')) {
          rows = rows.filter(ref => ref.dept_name === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('l3_name=?')) {
          rows = rows.filter(ref => ref.l3_name === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes("a1_code=? OR (ref_type='L3'")) {
          const a1Code = params[paramIndex];
          rows = rows.filter(ref => ref.a1_code === a1Code || (ref.ref_type === 'L3' && !ref.a1_code));
          paramIndex += 1;
        } else if (normalizedSql.includes('a1_code=?')) {
          rows = rows.filter(ref => ref.a1_code === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('master_data_object=?')) {
          rows = rows.filter(ref => ref.master_data_object === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('ref_type=?')) {
          rows = rows.filter(ref => ref.ref_type === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('GROUP BY ref_type')) {
          const grouped = new Map();
          for (const ref of rows) grouped.set(ref.ref_type, (grouped.get(ref.ref_type) || 0) + 1);
          return [[...grouped.entries()].map(([ref_type, count]) => ({ ref_type, count })), undefined];
        }
        const refOrder = { L3: 0, A1: 1, MDM: 2 };
        return [rows
          .sort((left, right) =>
            refOrder[left.ref_type] - refOrder[right.ref_type] ||
            left.dept_name.localeCompare(right.dept_name, 'zh-CN') ||
            left.l3_name.localeCompare(right.l3_name, 'zh-CN') ||
            left.a1_code.localeCompare(right.a1_code, 'zh-CN') ||
            left.master_data_object.localeCompare(right.master_data_object, 'zh-CN') ||
            left.id - right.id
          )
          .slice(0, limitFromSql(normalizedSql, params[params.length - 1]))
          .map(({ snapshot_id, ref_key, id, ...ref }) => ref), undefined];
      }

      if (normalizedSql.startsWith('UPDATE process_governance_quality_cases')) {
        const caseId = params[params.length - 1];
        const item = state.qualityCases.find(row => row.id === caseId);
        if (item) {
          if (normalizedSql.includes("status='assigned'")) {
            item.owner_user_id = params[0] || item.owner_user_id;
            item.owner_person_id = params[1] || item.owner_person_id;
            item.owner_dept_id = params[2] || item.owner_dept_id;
            item.priority = params[3];
            item.due_date = params[4];
            item.status = 'assigned';
          } else if (normalizedSql.includes("status='submitted'")) {
            item.status = 'submitted';
          } else if (normalizedSql.includes("status='closed'")) {
            item.status = 'closed';
            item.closed_by = params[0];
            item.closed_by_person_id = params[1];
            item.closure_note = params[2];
          } else if (normalizedSql.includes("status='reopened'")) {
            item.status = 'reopened';
            item.reopened_count += item.status === 'reopened' ? 0 : 1;
          } else if (normalizedSql.includes('SET status=?')) {
            item.status = params[0];
          }
        }
        return [{ affectedRows: item ? 1 : 0 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_governance_quality_case_events')) {
        const [case_id, event_type, actor_user_id, actor_person_id, note, payload_json] = params;
        state.qualityCaseEvents.push({
          id: state.qualityCaseEvents.length + 1,
          case_id,
          event_type,
          actor_user_id,
          actor_person_id,
          note,
          payload_json
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM process_governance_quality_case_events')) {
        const caseId = params[0];
        return [state.qualityCaseEvents.filter(event => event.case_id === caseId), undefined];
      }

      if (normalizedSql.includes('FROM process_governance_quality_cases')) {
        let rows = [...state.qualityCases];
        if (normalizedSql.includes('WHERE id=?')) {
          rows = rows.filter(item => item.id === params[0]);
        } else {
          let paramIndex = 0;
          if (normalizedSql.includes('severity=?')) rows = rows.filter(item => item.severity === params[paramIndex++]);
          if (normalizedSql.includes('status=?')) rows = rows.filter(item => item.status === params[paramIndex++]);
          if (normalizedSql.includes('area=?')) rows = rows.filter(item => item.area === params[paramIndex++]);
          if (normalizedSql.includes('dept_name=?')) rows = rows.filter(item => item.dept_name === params[paramIndex++]);
          if (normalizedSql.includes('owner_user_id=?')) rows = rows.filter(item => item.owner_user_id === params[paramIndex++]);
          if (normalizedSql.includes('latest_snapshot_id=?')) rows = rows.filter(item => item.latest_snapshot_id === params[paramIndex++]);
        }
        return [rows, undefined];
      }

      if (normalizedSql.startsWith('UPDATE process_mapping_todos')) {
        const todoId = params[params.length - 1];
        const item = state.mappingTodos.find(row => row.id === todoId);
        if (item) {
          if (normalizedSql.includes("status='assigned'")) {
            item.owner_user_id = params[0] || item.owner_user_id;
            item.owner_person_id = params[1] || item.owner_person_id;
            item.owner_dept_id = params[2] || item.owner_dept_id;
            item.priority = params[3];
            item.due_date = params[4];
            item.status = 'assigned';
          } else if (normalizedSql.includes("status='submitted'")) {
            item.status = 'submitted';
          } else if (normalizedSql.includes("status='closed'")) {
            item.status = 'closed';
            item.closed_by = params[0];
            item.closed_by_person_id = params[1];
            item.closure_note = params[2];
          } else if (normalizedSql.includes("status='reopened'")) {
            item.status = 'reopened';
          } else if (normalizedSql.includes('SET status=?')) {
            item.status = params[0];
          }
        }
        return [{ affectedRows: item ? 1 : 0 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO process_mapping_todo_events')) {
        const [todo_id, event_type, actor_user_id, actor_person_id, note, payload_json] = params;
        state.mappingTodoEvents.push({
          id: state.mappingTodoEvents.length + 1,
          todo_id,
          event_type,
          actor_user_id,
          actor_person_id,
          note,
          payload_json
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM process_mapping_todo_events')) {
        const todoId = params[0];
        return [state.mappingTodoEvents.filter(event => event.todo_id === todoId), undefined];
      }

      if (normalizedSql.includes('FROM process_mapping_records')) {
        let rows = [...state.mappingRecords];
        let paramIndex = 0;
        if (normalizedSql.includes('r.record_type=?')) rows = rows.filter(item => item.record_type === params[paramIndex++]);
        if (normalizedSql.includes('r.status=?')) rows = rows.filter(item => item.status === params[paramIndex++]);
        if (normalizedSql.includes('r.dept_name=?')) rows = rows.filter(item => item.dept_name === params[paramIndex++]);
        if (normalizedSql.includes('GROUP BY r.record_type, r.status')) {
          const grouped = new Map();
          for (const item of rows) {
            const key = `${item.record_type}|${item.status}`;
            grouped.set(key, (grouped.get(key) || 0) + 1);
          }
          return [[...grouped.entries()].map(([key, count]) => {
            const [record_type, status] = key.split('|');
            return { record_type, status, count };
          }), undefined];
        }
        return [rows.map(item => ({ ...item, parent_l3_name: null })), undefined];
      }

      if (normalizedSql.includes('FROM process_mapping_todos')) {
        let rows = [...state.mappingTodos];
        if (normalizedSql.includes('WHERE t.id=?')) {
          rows = rows.filter(item => item.id === params[0]);
        } else {
          let paramIndex = 0;
          if (normalizedSql.includes('t.todo_type=?')) rows = rows.filter(item => item.todo_type === params[paramIndex++]);
          if (normalizedSql.includes('t.status=?')) rows = rows.filter(item => item.status === params[paramIndex++]);
          if (normalizedSql.includes('(t.dept_name=? OR t.target_dept_name=?)')) {
            const dept = params[paramIndex];
            rows = rows.filter(item => item.dept_name === dept || item.target_dept_name === dept);
            paramIndex += 2;
          }
          if (normalizedSql.includes('t.owner_user_id=?')) rows = rows.filter(item => item.owner_user_id === params[paramIndex++]);
        }
        if (normalizedSql.includes('GROUP BY t.todo_type, t.status')) {
          const grouped = new Map();
          for (const item of rows) {
            const key = `${item.todo_type}|${item.status}`;
            grouped.set(key, (grouped.get(key) || 0) + 1);
          }
          return [[...grouped.entries()].map(([key, count]) => {
            const [todo_type, status] = key.split('|');
            return { todo_type, status, count };
          }), undefined];
        }
        return [rows.map(item => ({ ...item, record_type: 'a1', mapping_behavior: '接收订单并组织评审' })), undefined];
      }

      if (normalizedSql.includes('FROM process_cross_dept_interactions')) {
        const snapshotId = params[0];
        let rows = state.risks.filter(risk => risk.snapshot_id === snapshotId);
        let paramIndex = 1;
        if (normalizedSql.includes('risk_level=?')) {
          rows = rows.filter(risk => risk.risk_level === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('confirm_status=?')) {
          rows = rows.filter(risk => risk.confirm_status === params[paramIndex]);
          paramIndex += 1;
        }
        if (normalizedSql.includes('(source_dept=? OR target_dept=?)')) {
          const dept = params[paramIndex];
          rows = rows.filter(risk => risk.source_dept === dept || risk.target_dept === dept);
        }
        const order = { high: 0, medium: 1, low: 2 };
        if (normalizedSql.includes('source_dept AS source')) {
          return [rows
            .sort((left, right) => order[left.risk_level] - order[right.risk_level] || left.id - right.id)
            .map(risk => ({
              source: risk.source_dept,
              target: risk.target_dept,
              a1: risk.a1_code,
              refs: risk.refs,
              risk: risk.risk_level,
              status: risk.confirm_status,
              desc: risk.description,
              source_report: risk.source_report
            })), undefined];
        }
        return [rows
          .sort((left, right) => order[left.risk_level] - order[right.risk_level] || left.id - right.id)
        , undefined];
      }

      if (normalizedSql.includes('FROM process_interaction_chains')) {
        const snapshotId = params[0];
        return [state.chains
          .filter(chain => chain.snapshot_id === snapshotId)
          .sort((left, right) => left.id - right.id)
          .map(chain => ({
            name: chain.name,
            status: chain.status,
            breaks_json: chain.breaks_json,
            source_report: chain.source_report
          })), undefined];
      }

      throw new Error(`Unhandled SQL in fake pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const pool = makeFakePool();
  const repo = makeProcessGovernanceMysqlRepository(pool);

  await repo.initSchema();
  await repo.replaceActiveReadModel({
    source_json_path: 'docs/company-sankey-data.json',
    source_hash: 'hash-001',
    generated_at: '2026-06-16T00:00:00.000Z',
    imported_by: 7,
    note: 'fake import',
    stats: {
      mappings: 2,
      a1: 1,
      departmentsWithData: 1,
      departmentsEmpty: 0,
      crossDept: { highRisk: 1, mediumRisk: 0, lowRisk: 0 }
    },
    nodes: [
      { name: '经营发展部', label: '经营发展部', node_type: 'department', domain_name: '经营副总', dept_name: '经营发展部', sort_order: 1 },
      { name: '销售订单评审和执行管理', label: '销售订单评审和执行管理', node_type: 'l3', domain_name: '经营副总', dept_name: '经营发展部', parent_key: '经营发展部', source_file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md', sort_order: 2 },
      { name: 'OA', label: 'OA', node_type: 'system', sort_order: 3 },
      { name: 'ERP', label: 'ERP', node_type: 'system', sort_order: 4 }
    ],
    links: [
      { source: '经营发展部', target: '销售订单评审和执行管理', value: 1, edge_type: 'dept_l2', source_file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md' },
      { source: '销售订单评审和执行管理', target: 'ERP', value: '1.5', edge_type: 'l3_system' }
    ],
    a1Items: [
      {
        a1_code: 'JY-L3-01-A1-001',
        dept_name: '经营发展部',
        l3_name: '销售订单评审和执行管理',
        behavior: '接收订单并组织评审',
        execution_role: '合同管理员',
        approval_type: '审批',
        input_source_dept: '项目管理部',
        output_target_dept: '工程技术部',
        suggested_systems: ['OA', 'ERP'],
        verification_note: '核对技术条款输入',
        source_file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md'
      }
    ],
    sourceFiles: [
      {
        file_key: 'source-file-included',
        file_path: 'docs/norms/经营发展部业务资料/GLTX-JY-23-A销售订单评审和执行管理程序.docx',
        dept_name: '经营发展部',
        asset_type: 'procedure',
        file_no: 'GLTX-JY-23',
        revision: 'A',
        size_bytes: 12345,
        mtime: '2026-06-01T00:00:00.000Z',
        sha256: 'source-file-hash-1',
        process_status: '纳入',
        process_reason: '已作为销售订单评审流程依据'
      },
      {
        file_key: 'source-file-excluded',
        file_path: 'docs/norms/经营发展部业务资料/~$临时锁定文件.docx',
        dept_name: '经营发展部',
        asset_type: 'temp',
        file_no: '待分配编号',
        revision: '?',
        size_bytes: 10,
        mtime: '2026-06-01T00:00:00.000Z',
        sha256: 'source-file-hash-2',
        process_status: '排除',
        process_reason: 'Office 临时锁定文件不作为流程证据'
      }
    ],
    mdmRequirements: [
      {
        requirement_key: 'mdm-req-order',
        dept_name: '经营发展部',
        master_data_object: '客户订单',
        source_l2: '合同管理',
        key_fields: '订单号、客户名称、合同编号、状态',
        responsible_dept: '经营发展部',
        system_boundary: 'MDM治理对象；OA/ERP按流程消费或回写',
        governance_requirement: '统一订单编码、状态和跨系统引用口径。',
        source_file: 'docs/norms/经营发展部能力层与MDM建设要求.md'
      }
    ],
    evidenceRefs: [
      {
        ref_key: 'evidence-l3',
        ref_type: 'L3',
        dept_name: '经营发展部',
        l3_name: '销售订单评审和执行管理',
        a1_code: '',
        master_data_object: '',
        evidence_type: '制度依据',
        source_file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md',
        citation: 'GLTX-JY-23-A §5.1',
        note: 'DCM 映射总表制度依据'
      },
      {
        ref_key: 'evidence-a1',
        ref_type: 'A1',
        dept_name: '经营发展部',
        l3_name: '销售订单评审和执行管理',
        a1_code: 'JY-L3-01-A1-001',
        master_data_object: '',
        evidence_type: '原文明确-正文',
        source_file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md',
        citation: 'GLTX-JY-23-A §5.1.1',
        note: 'A1 制度依据'
      },
      {
        ref_key: 'evidence-mdm',
        ref_type: 'MDM',
        dept_name: '经营发展部',
        l3_name: '',
        a1_code: '',
        master_data_object: '客户订单',
        evidence_type: 'MDM建设要求',
        source_file: 'docs/norms/经营发展部能力层与MDM建设要求.md',
        citation: '主数据对象识别',
        note: 'MDM 要求表'
      }
    ],
    crossDept: {
      risks: [
        {
          source: '经营发展部',
          target: '财务部',
          a1: 'A1-001',
          refs: 2,
          risk: 'high',
          status: 'pending',
          desc: '跨部门交付物待确认',
          source_report: 'docs/reports/cross-dept.md'
        }
      ],
      interactionChains: [
        {
          name: '订单到回款',
          status: 'partial',
          breaks: ['财务确认节点缺证据'],
          source_report: 'docs/reports/cross-dept.md'
        }
      ]
    }
  });

  pool.state.qualityFindings.push({
    id: 1,
    snapshot_id: 1,
    severity: 'WARN',
    area: 'source',
    source_file: 'docs/norms/经营发展部.md',
    source_line: 32,
    message: '来源文件待复核',
    suggestion: '补充原文位置',
    dept_name: '经营发展部',
    imported_at: '2026-06-16 00:00:00'
  });
  pool.state.qualityCases.push({
    id: 11,
    finding_key: 'quality-source-001',
    first_snapshot_id: 1,
    latest_snapshot_id: 1,
    severity: 'WARN',
    area: 'source',
    source_file: 'docs/norms/经营发展部.md',
    source_line: 32,
    message: '来源文件待复核',
    suggestion: '补充原文位置',
    dept_name: '经营发展部',
    status: 'open',
    priority: 'medium',
    owner_user_id: null,
    owner_dept_id: null,
    reopened_count: 0
  });
  pool.state.mappingRecords.push({
    id: 31,
    mapping_key: 'mapping-a1-001',
    record_type: 'a1',
    status: 'active',
    dept_name: '经营发展部',
    l2_name: '合同管理',
    l3_name: '销售订单评审和执行管理',
    a1_code: 'JY-L3-01-A1-001',
    behavior: '接收订单并组织评审',
    suggested_systems: JSON.stringify(['OA', 'ERP'])
  });
  pool.state.mappingTodos.push({
    id: 21,
    todo_key: 'todo-cross-001',
    mapping_record_id: 31,
    todo_type: 'cross_dept',
    status: 'open',
    priority: 'high',
    dept_name: '经营发展部',
    target_dept_name: '财务部',
    message: '跨部门交付物待确认',
    suggestion: '补充确认对象',
    owner_user_id: null,
    owner_dept_id: null
  });

  const firstSankey = await repo.getActiveSankey();
  assert.deepStrictEqual(firstSankey.systems, ['ERP', 'OA']);
  assert.strictEqual(firstSankey.links[1].value, 1.5);
  assert.strictEqual(firstSankey.stats.crossDept.highRisk, 1);
  assert.strictEqual(firstSankey.crossDept.stats.highRisk, 1);
  assert.deepStrictEqual(firstSankey.crossDept.risks, [
    {
      source: '经营发展部',
      target: '财务部',
      a1: 'A1-001',
      refs: 2,
      risk: 'high',
      status: 'pending',
      desc: '跨部门交付物待确认'
    }
  ]);
  assert.deepStrictEqual(firstSankey.crossDept.interactionChains, [
    {
      name: '订单到回款',
      status: 'partial',
      breaks: ['财务确认节点缺证据'],
      source_report: 'docs/reports/cross-dept.md'
    }
  ]);
  assert.strictEqual(firstSankey.crossDept.source, 'docs/reports/cross-dept.md');

  const a1Items = await repo.getA1Items({ dept: '经营发展部' });
  assert.strictEqual(a1Items.length, 1);
  assert.strictEqual(a1Items[0].a1_code, 'JY-L3-01-A1-001');
  assert.deepStrictEqual(a1Items[0].suggested_systems, ['OA', 'ERP']);
  assert.strictEqual(a1Items[0].output_target_dept, '工程技术部');

  const erpItems = await repo.getA1Items({ system: 'ERP' });
  assert.strictEqual(erpItems.length, 1);
  const mesItems = await repo.getA1Items({ system: 'MES' });
  assert.strictEqual(mesItems.length, 0);

  const sourceFiles = await repo.getSourceFiles({ dept: '经营发展部', status: '纳入' });
  assert.strictEqual(sourceFiles.summary.total, 1);
  assert.strictEqual(sourceFiles.summary.returned, 1);
  assert.strictEqual(sourceFiles.summary.byStatus['纳入'], 1);
  assert.strictEqual(sourceFiles.summary.byAssetType.procedure, 1);
  assert.strictEqual(sourceFiles.items[0].file_no, 'GLTX-JY-23');

  const requirements = await repo.getMdmRequirements({ object: '客户订单' });
  assert.strictEqual(requirements.summary.total, 1);
  assert.strictEqual(requirements.summary.byDept['经营发展部'], 1);
  assert.strictEqual(requirements.items[0].system_boundary, 'MDM治理对象；OA/ERP按流程消费或回写');

  const evidenceRefs = await repo.getEvidenceRefs({ l3: '销售订单评审和执行管理', a1: 'JY-L3-01-A1-001' });
  assert.strictEqual(evidenceRefs.summary.total, 2);
  assert.strictEqual(evidenceRefs.summary.byType.L3, 1);
  assert.strictEqual(evidenceRefs.summary.byType.A1, 1);
  assert.deepStrictEqual(evidenceRefs.items.map(item => item.ref_type), ['L3', 'A1']);

  const chains = await repo.getInteractionChains();
  assert.strictEqual(chains.length, 1);
  assert.strictEqual(chains[0].name, '订单到回款');
  assert.deepStrictEqual(chains[0].breaks, ['财务确认节点缺证据']);

  const crossDept = await repo.getCrossDeptInteractions({ risk: 'high' });
  assert.strictEqual(crossDept.length, 1);
  assert.strictEqual(crossDept[0].risk_level, 'high');

  const quality = await repo.getQualityFindings({ severity: 'WARN' });
  assert.strictEqual(quality.summary.WARN, 1);
  assert.strictEqual(quality.items[0].message, '来源文件待复核');

  const qualityCases = await repo.getQualityCases({ status: 'open', canViewAll: true });
  assert.strictEqual(qualityCases.summary.total, 1);
  assert.strictEqual(qualityCases.items[0].status, 'open');

  const assignedCase = await repo.assignQualityCase(11, {
    priority: 'high',
    actor_user_id: 1,
    note: '转给责任部门处理'
  });
  assert.strictEqual(assignedCase.case.status, 'assigned');
  assert.strictEqual(assignedCase.case.priority, 'high');
  assert.strictEqual(assignedCase.events[0].event_type, 'assigned');

  const workspace = await repo.getMappingWorkspace({ type: 'a1', canViewAll: true });
  assert.strictEqual(workspace.summary.byType.a1, 1);
  assert.deepStrictEqual(workspace.items[0].suggested_systems, ['OA', 'ERP']);

  const todos = await repo.getMappingTodos({ type: 'cross_dept', canViewAll: true });
  assert.strictEqual(todos.summary.byType.cross_dept, 1);
  assert.strictEqual(todos.items[0].status, 'open');

  const submittedTodo = await repo.submitMappingTodo(21, {
    actor_user_id: 1,
    note: '已补充确认说明'
  });
  assert.strictEqual(submittedTodo.todo.status, 'submitted');
  assert.strictEqual(submittedTodo.events[0].event_type, 'submitted');

  await repo.replaceActiveReadModel({
    source_json_path: 'docs/company-sankey-data.json',
    source_hash: 'hash-002',
    stats: { mappings: 1, a1: 0 },
    nodes: [{ name: 'OA', label: 'OA', node_type: 'system', sort_order: 1 }],
    links: []
  });

  assert.strictEqual(pool.state.snapshots.filter(snapshot => snapshot.status === 'active').length, 1);
  assert.strictEqual(pool.state.snapshots[0].status, 'archived');

  const snapshots = await repo.listSnapshots();
  assert.deepStrictEqual(snapshots.map(snapshot => snapshot.status), ['active', 'archived']);
  assert.strictEqual(snapshots[0].source_hash, 'hash-002');

  const current = await repo.getCurrentSnapshot();
  assert.strictEqual(current.source_hash, 'hash-002');
  assert.deepStrictEqual(current.stats, {
    mappings: 1,
    a1: 0,
    departmentsWithData: 0,
    departmentsEmpty: 0
  });
  assert.deepStrictEqual(current.qualitySummary, { BLOCK: 0, WARN: 0, INFO: 0 });

  const sankey = await repo.getActiveSankey();
  assert.deepStrictEqual(sankey.nodes, [
    {
      name: 'OA',
      label: 'OA',
      node_type: 'system',
      domain_name: null,
      dept_name: null,
      parent_key: null,
      source_file: null
    }
  ]);
  assert.deepStrictEqual(sankey.links, []);
  assert.deepStrictEqual(sankey.systems, ['OA']);
  assert.strictEqual(sankey.stats.mappings, 1);
  assert.strictEqual(sankey.stats.a1, 0);
  assert.strictEqual(sankey.stats.departmentsWithData, 0);
  assert.strictEqual(sankey.stats.departmentsEmpty, 0);
  assert.deepStrictEqual(sankey.crossDept.stats, {});
  assert.deepStrictEqual(sankey.crossDept.risks, []);
  assert.deepStrictEqual(sankey.crossDept.interactionChains, []);

  const unsafeSql = pool.state.statements
    .map(entry => entry.sql)
    .join('\n');
  assert.ok(!unsafeSql.includes('sqlite_master'), 'repository must not use SQLite catalog tables');
  assert.ok(!unsafeSql.includes('PRAGMA'), 'repository must not use SQLite PRAGMA');
  assert.ok(!unsafeSql.includes('lastInsertRowid'), 'repository must not use SQLite lastInsertRowid');

  console.log('Process governance MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
