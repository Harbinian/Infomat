"""Review processing/stock-flow facts from one frozen batch, without SQL or writes.

Inputs are the fixed SOURCES below plus their successful audit and frozen query
hashes. Output is a new processing-checks directory with a report and NDJSON.
Activation dates are scheduling facts, not actual processing start dates. Only
the operation's own uniquely linked inspection can currently prove processing.
No deadline, stock-source substitution, unit conversion or quantity is guessed.
Run the isolated regression suite in the processing-flow-20261112 artifacts.
"""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path

SOURCES = ['mes-operation-events', 'mes-inspection-events', 'u8-production',
           'u8-production-links', 'u8-allocations', 'u8-product-receipts',
           'u8-material-issues', 'u8-parts', 'u8-quantity-enums']
KINDS = {
    'processing_trigger_pending': '实际加工触发依据不足',
    'operation_reference_pending': '工序与生产明细对应待核查',
    'receipt_missing': '合格完工未见对应入库单据',
    'receipt_pending_audit': '合格完工已有入库单据待审核',
    'receipt_shortfall': '合格完工对应已审核入库净量不足',
    'receipt_reference_pending': '完工入库凭据引用待核查',
    'receipt_quantity_pending': '完工入库数量或单位依据不足',
    'completion_basis_pending': '末工序合格完工依据不足',
    'issue_missing': '已有实际加工证据但未见应领材料出库',
    'issue_pending_audit': '已有实际加工证据且材料出库待审核',
    'issue_shortfall': '实际加工对应已审核材料出库净量不足',
    'issue_reference_pending': '材料出库凭据引用待核查',
    'issue_quantity_pending': '实际加工领料数量或单位依据不足',
    'allocation_basis_pending': '实际加工对应订单用料依据不足',
    'special_flow_pending': '特殊供料或流转方式适用待核查',
    'upstream_issue_missing': '母件已加工但未见对应子件领用出库',
    'upstream_issue_pending_audit': '母件已加工且子件领用单据待审核',
    'upstream_issue_shortfall': '母件实际加工对应子件领用净量不足',
    'upstream_supply_pending': '上下级供料及流转依据不足',
}
LABELS = {'confirmed_issue': '已确认记录缺口', 'pending_evidence': '依据不足待核查'}
BOUNDARY = ('按实际加工及末工序合格事实核对当前出入库记录；缺口不直接认定实际缺料、'
            '历史错误或责任。不设逾期时限；不同源为独立读取窗口。库存或其他批次供料'
            '须有有效凭据，配套子件自身合格完工仍独立核对入库。')
COLUMNS = ['分类', '核查项目', '核查链', '核查环节', '销售订单', '生产订单', 'BOM行号',
           '是否重点子件', '产品编码', '物料编码', '应完成数量', '已审核净量', '缺口数量',
           '实际加工数量', '有效合格完工数量', '数量单位', '数量计算依据', '触发时间',
           '时间口径', '单据数量', '未审核单据数量', '关联子件生产订单', '关联子件BOM行号', '关联核查项',
           '记录事实', '判断依据', '待核查依据', '生产明细内部编号', '完整证据JSON']
CANCELLED = {'取消', '已取消', '作废', '已作废', 'cancelled', 'canceled', 'void'}
SUPPORTED_STATUS = {'待加工', '进行中', '已完成', '报废'}
PASS = {'合格', 'passed'}
INSPECTED = PASS | {'不合格', 'failed'}
FALSE = {'0', 'False', 'false'}
TRUE = {'1', 'True', 'true'}


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def num(value):
    if value is None or not re.fullmatch(r'[+-]?\d+(?:\.\d+)?', str(value)):
        return None
    return Fraction(str(value))


def ident(value):
    if value is None or not re.fullmatch(r'\d+', str(value).strip()):
        return None
    return str(int(str(value)))


def text(value):
    return '' if value is None else str(value)


def shown(value):
    if value is None:
        return None
    if value.denominator == 1:
        return str(value.numerator)
    with localcontext() as context:
        context.prec = 60
        return format(Decimal(value.numerator) / Decimal(value.denominator), 'f').rstrip('0').rstrip('.')


def exact(value):
    return None if value is None else {'numerator': str(value.numerator), 'denominator': str(value.denominator)}


def valid_time(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?)?', value):
        return None
    try:
        return value if datetime.fromisoformat(value).year >= 1900 else None
    except ValueError:
        return None


def joined(values):
    return '；'.join(dict.fromkeys(text(value) for value in values if value is not None and value != ''))


def index(rows, key, numeric=False):
    result = defaultdict(list)
    for row in rows:
        value = ident(row.get(key)) if numeric else text(row.get(key))
        result[value].append(row)
    return result


def source_ref(dataset, rows, key):
    return {'dataset': dataset, 'file': dataset + '.ndjson', 'keyField': key,
            'keys': [row.get(key) for row in rows], 'count': len(rows)}


def analyze_data(batch, data, manifest, row_sink=None):
    # Keep source rows once in indexes. Per-item evidence stores exact identifiers
    # and the audited source manifest instead of replicating large source tables.
    all_production = index(data['u8-production-links'], 'MoDId', True)
    production = index(data['u8-production'], 'MoDId', True)
    allocations = index(data['u8-allocations'], 'MoDId', True)
    receipt_rows = list(data['u8-product-receipts'])
    issue_rows = list(data['u8-material-issues'])
    receipts = index(receipt_rows, 'ProductionDetailId', True)
    issues = index(issue_rows, 'AllocationId', True)
    receipt_business, issue_business, replacements = defaultdict(list), defaultdict(list), defaultdict(list)
    for r in receipt_rows:
        receipt_business[(r.get('cmocode'), ident(r.get('imoseq')), r.get('cInvCode'))].append(r)
    for r in issue_rows:
        issue_business[(r.get('cmocode'), ident(r.get('imoseq')), r.get('cInvCode'))].append(r)
        original = ident(r.get('isupersedempoids'))
        if original and original != '0':
            replacements[original].append(r)
    parts = index(data['u8-parts'], 'InvCode')
    enums = list(data['u8-quantity-enums'])
    variable_confirmed = any(row.get('enum_type') == 'BO.FVFlag' and row.get('field_code') == '1'
                             and row.get('caption') == '否' for row in enums)
    part_to_pid = defaultdict(set)
    child_links = defaultdict(list)
    for pid, group in all_production.items():
        for p in group:
            if pid and p.get('MoCode') and num(p.get('SortSeq')) is not None:
                part_to_pid[text(p['MoCode']) + text(p['SortSeq'])].add(pid)
            aid = ident(p.get('PAllocateId'))
            if aid and aid != '0':
                child_links[aid].append(p)
    operations = defaultdict(list)
    operation_ids = Counter()
    retained_operation_ids = set()
    coverage = Counter({'productionRows': sum(len(group) for group in production.values()),
                        'productionDetails': len(production), 'componentProductionDetails': 0,
                        'noOperationEvidence': 0, 'processingObserved': 0,
                        'qualifiedCompletionObserved': 0, 'processingUnknown': 0,
                        'operationRows': 0, 'inspectionRows': 0, 'unmatchedOperationRows': 0,
                        'ambiguousOperationRows': 0, 'unmatchedInspectionRows': 0,
                        'componentItems': 0, 'upstreamMaterialChecks': 0,
                        'upstreamRelationUnknownMaterials': 0})
    for op in data['mes-operation-events']:
        coverage['operationRows'] += 1
        oid = text(op.get('OperationId'))
        if oid:
            operation_ids[oid] += 1
        candidates = part_to_pid.get(text(op.get('PartNumber')), set())
        direct = ident(op.get('ProductionDetailId'))
        if direct:
            # A direct identifier from an unscoped MES source cannot establish
            # account 333 by itself. Its explicit part identity must also agree.
            candidates = {direct} if candidates == {direct} else candidates | {direct}
        if len(candidates) == 1:
            pid = next(iter(candidates))
            if pid in production:
                target = production[pid][0]
                if not op.get('ProductionNumber') or not target.get('Define25') or op['ProductionNumber'] != target['Define25']:
                    op['_contextConflict'] = True
                operations[pid].append(op)
                if oid:
                    retained_operation_ids.add(oid)
            else:
                coverage['unmatchedOperationRows'] += 1
        elif candidates:
            coverage['ambiguousOperationRows'] += 1
            for pid in candidates:
                if pid in production:
                    operations[pid].append({**op, '_associationConflict': True})
                    if oid:
                        retained_operation_ids.add(oid)
        else:
            coverage['unmatchedOperationRows'] += 1
    inspections = defaultdict(list)
    inspection_ids = Counter()
    orphan_inspections = defaultdict(list)
    for record in data['mes-inspection-events']:
        coverage['inspectionRows'] += 1
        inspection_ids[text(record.get('InspectionId'))] += 1
        oid = text(record.get('OperationId'))
        if not oid or operation_ids[oid] != 1:
            coverage['unmatchedInspectionRows'] += 1
            candidates = part_to_pid.get(text(record.get('PartNumber')), set())
            for candidate in candidates:
                if candidate in production:
                    orphan_inspections[candidate].append(record)
        if oid in retained_operation_ids:
            inspections[oid].append(record)
    rows = []
    emitted_ids, emitted_orders, emitted_sales = set(), set(), set()
    category_counts, classifications = Counter(), Counter()
    component_items = 0

    def material_unit(code):
        found = {text(p.get('cComUnitCode')) for p in parts.get(code, []) if p.get('cComUnitCode')}
        return next(iter(found)) if len(found) == 1 else None

    def unit_matches(unit, code):
        expected = material_unit(code)
        if not unit or not expected:
            return False
        names = {p.get('cComUnitName') for p in parts.get(code, []) if p.get('cComUnitCode') == expected}
        return unit == expected or unit in names

    def emit(p, category, classification='pending_evidence', chain='self', material=None,
             required=None, net=None, trigger=None, fact='', pending='', refs=None,
             extra=None, children=None, related=None, token=''):
        nonlocal component_items
        pid = ident(p.get('MoDId')) or text(p.get('MoDId'))
        material = text(material if material is not None else p.get('InvCode'))
        seed = '\0'.join([text(pid), chain, material, token])
        rid = category + ':' + hashlib.sha256(seed.encode()).hexdigest()[:32]
        trigger = trigger or {}
        children = children or []
        orders = list(dict.fromkeys(value for value in [text(p.get('MoCode'))] +
                                   [text(child.get('MoCode')) for child in children] if value))
        component_basis = [{'productionDetailId': p.get('MoDId'), 'bomLine': p.get('SortSeq'), 'role': 'anchor'}]
        component_basis += [{'productionDetailId': child.get('MoDId'), 'bomLine': child.get('SortSeq'), 'role': 'related-child'} for child in children]
        component = any((num(item['bomLine']) or Fraction(0)) > 1 for item in component_basis)
        step = '上下级供料与领用' if chain == 'upstream' else '完工入库' if category.startswith(('receipt_', 'completion_')) else '领料出库' if category.startswith(('issue_', 'allocation_', 'special_')) else '加工证据'
        difference = required - net if required is not None and net is not None and required > net else None
        evidence = {'production': p, 'trigger': trigger, 'sourceReferences': refs or [],
                    'relatedProduction': children, 'componentBasis': component_basis, 'calculation': {'required': exact(required),
                    'auditedNet': exact(net), 'shortfall': exact(difference)},
                    'sharedFactId': 'P:' + text(pid) + ':material:' + material if step in ['领料出库', '上下级供料与领用'] else 'P:' + text(pid) + ':receipt',
                    'relatedChecks': related or [], 'sourceManifestRef': 'review.json#sourceManifest',
                    'limits': [BOUNDARY, '空缺数量不补零；无单位依据不发布确定数量不足。',
                               '工序激活日期不等于实际开工；检验时间仅为加工已发生的证据时间。']}
        if extra:
            evidence.update(extra)
        values = {'分类': LABELS[classification], '核查项目': KINDS[category],
                  '核查链': '上下级流转' if chain == 'upstream' else '自身加工', '核查环节': step,
                  '销售订单': text(p.get('OrderCode')) if p.get('OrderType') == '1' else '',
                  '生产订单': text(p.get('MoCode')), 'BOM行号': p.get('SortSeq'),
                  '是否重点子件': '是' if component else '否', '产品编码': p.get('InvCode'),
                  '物料编码': material, '应完成数量': shown(required), '已审核净量': shown(net),
                  '缺口数量': shown(difference), '实际加工数量': trigger.get('inputQty'),
                  '有效合格完工数量': trigger.get('qualifiedQty'), '数量单位': trigger.get('unit'),
                  '数量计算依据': trigger.get('calculation'), '触发时间': trigger.get('time'),
                  '时间口径': trigger.get('timeBasis', '实际开工时间未知；本项不判逾期。'),
                  '单据数量': (extra or {}).get('documentCount'),
                  '未审核单据数量': (extra or {}).get('unauditedCount'),
                  '关联子件生产订单': joined(child.get('MoCode') for child in children),
                  '关联子件BOM行号': joined(child.get('SortSeq') for child in children),
                  '关联核查项': joined(related or []), '记录事实': fact,
                  '判断依据': trigger.get('basis', '按同批冻结的明确引用及已确认业务口径核对。'),
                  '待核查依据': pending, '生产明细内部编号': pid}
        # The CLI keeps one complete evidence object. CSV/API materialize the
        # trace column from it, avoiding a second identical multi-GB string.
        if row_sink is None:
            values['完整证据JSON'] = json.dumps(evidence, ensure_ascii=False, separators=(',', ':'))
        row = {'id': rid, 'classification': classification, 'category': category,
               'categoryLabel': KINDS[category], 'productionDetailId': text(pid),
               'productionOrder': text(p.get('MoCode')), 'salesOrder': values['销售订单'],
               'productionOrders': orders, 'bomLine': p.get('SortSeq'), 'component': component,
               'chain': chain, 'values': values, 'evidence': evidence}
        if rid in emitted_ids:
            raise ValueError('PROCESSING_RESULT_ID_CONFLICT')
        emitted_ids.add(rid)
        emitted_orders.update(orders)
        if row['salesOrder']:
            emitted_sales.add(row['salesOrder'])
        category_counts[category] += 1
        classifications[classification] += 1
        component_items += int(component)
        if row_sink:
            row_sink(row)
        else:
            rows.append(row)
        return rid

    def inspection_for(op):
        oid = text(op.get('OperationId'))
        records = inspections.get(oid, []) if oid else []
        reasons = []
        if op.get('_associationConflict'):
            reasons.append('工序零件引用不能唯一定位生产明细')
        if op.get('_contextConflict'):
            reasons.append('工序生产编号与目标生产明细缺少一致的范围上下文')
        if op.get('Account') not in [None, '', '333']:
            reasons.append('工序明确账套与目标账套不一致')
        if op.get('Status') not in SUPPORTED_STATUS:
            reasons.append('当前工序状态缺失或不在已核对的状态范围')
        if op.get('CancelledAt') and op.get('Status') not in CANCELLED:
            reasons.append('工序取消日期与当前有效状态并存，恢复适用依据不足')
        if not op.get('LocalPartNumber') or num(op.get('Sequence')) is None:
            reasons.append('工序原复合标识不完整')
        if not oid or operation_ids[oid] != 1:
            reasons.append('工序与检验关联标识缺失或不唯一')
        if len(records) > 1:
            reasons.append('同一工序对应多条当前检验记录，无法判定是否重复检验')
        record = records[0] if len(records) == 1 else None
        if record:
            iid = text(record.get('InspectionId'))
            if not iid or inspection_ids[iid] != 1:
                reasons.append('检验标识缺失或不唯一')
            if record.get('PartNumber') != op.get('PartNumber') or num(record.get('Sequence')) != num(op.get('Sequence')):
                reasons.append('检验与工序的零件或工序号不一致')
            for field in ['QualifiedQty', 'Result']:
                operation_value = op.get('InspectionResult') if field == 'Result' else op.get(field)
                if operation_value is not None and record.get(field) is not None and operation_value != record[field]:
                    if field != 'QualifiedQty' or num(operation_value) != num(record[field]):
                        reasons.append('工序与检验的' + {'QualifiedQty': '合格数量', 'Result': '检验意见'}[field] + '原值不一致')
            if record.get('ReworkOf') or text(record.get('SourceObject')).split('.')[-1] == '返工返修工序检验_主表' or record.get('ReworkPartNumber'):
                # A current operation inspection is a snapshot, not an additive
                # event stream. A historical/rework record needs explicit scope.
                reasons.append('返工检验对应的实物及原检验适用范围未核实')
            if record.get('OutsourcedFlag') in {'是', '1', 'True', 'true'} or record.get('ParallelGroup') not in [None, '', '0', 'False', 'false', '否', '串行']:
                reasons.append('检验存在并行或委外线索，普通工序适用关系未核实')
        return record, reasons

    def trigger_for(op, record, completion=False):
        # 投产数量 is a plan/snapshot amount in the current source. A quantity
        # explicitly established as actual input is required for proportional
        # material consumption; a passing inspection alone cannot supply it.
        input_qty = num(record.get('ActualInputQty'))
        input_unit = record.get('UnitCode') if input_qty is not None else None
        if input_qty is None:
            input_qty = num(op.get('ActualInputQty'))
            input_unit = op.get('UnitCode') if input_qty is not None else None
        qualified = num(record.get('QualifiedQty'))
        qualified_unit = record.get('UnitCode')
        return {'operation': op, 'inspection': record, 'inputQty': shown(input_qty),
                'qualifiedQty': shown(qualified), 'inputUnit': input_unit,
                'qualifiedUnit': qualified_unit, 'unit': qualified_unit if completion else input_unit,
                'time': valid_time(record.get('InspectedAt')),
                'timeBasis': '末工序检验日期' if completion else '首工序检验日期，仅为加工已发生的证据时间；实际开工时间未知。',
                'basis': '唯一关联的末道有效工序检验明确合格且合格数量为正。' if completion else '首道有效工序有唯一关联的本工序检验记录、明确检验意见及正检验数量，证明加工已发生。',
                'calculation': '按有效合格完工数量核对。' if completion else '实际投入量需独立依据，合格量不替代全部投入量。'}

    for pid, group in production.items():
        p = group[0]
        if (num(p.get('SortSeq')) or Fraction(0)) > 1:
            coverage['componentProductionDetails'] += 1
        ops = operations.get(pid, [])
        orphaned = orphan_inspections.get(pid, [])
        if orphaned:
            emit(p, 'operation_reference_pending', fact='检验记录不能唯一关联到当前工序，保留检验原值并待核查。',
                 refs=[source_ref('mes-inspection-events', orphaned, 'InspectionId')],
                 extra={'orphanInspections': orphaned}, token='orphan-inspection')
        if not pid or len(group) != 1 or len(all_production.get(pid, [])) != 1:
            emit(p, 'operation_reference_pending', fact='生产明细标识缺失或重复，未发布确定的加工触发。')
            coverage['processingUnknown'] += 1
            continue
        if not ops:
            coverage['noOperationEvidence'] += 1
            continue
        effective = [op for op in ops if op.get('Status') not in CANCELLED and text(op.get('Cancelled')) not in TRUE]
        if not effective:
            coverage['cancelledOnly'] += 1
            continue
        special_ops = [op for op in effective if op.get('ReworkPartNumber') or op.get('ReworkOf')
                       or op.get('OutsourcedFlag') in {'是', '1', 'True', 'true'}
                       or any(word in text(op.get('FlowCardType')) for word in ['返工', '返修', '直转', '倒冲'])
                       or op.get('ParallelGroup') not in [None, '', '0', 'False', 'false', '否', '串行']]
        if special_ops:
            emit(p, 'special_flow_pending', fact='存在返工、并行、委外或特殊流转线索，首末工序及实物数量适用关系待核实。',
                 extra={'operations': special_ops})
            coverage['processingUnknown'] += 1
            continue
        sequences = [num(op.get('Sequence')) for op in effective]
        if any(value is None for value in sequences):
            emit(p, 'operation_reference_pending', fact='工序顺序存在缺失或不可计算原值，首末工序未确定。')
            coverage['processingUnknown'] += 1
            continue
        first = [op for op in effective if num(op.get('Sequence')) == min(sequences)]
        last = [op for op in effective if num(op.get('Sequence')) == max(sequences)]
        start_trigger = None
        if len(first) != 1:
            emit(p, 'operation_reference_pending', fact='当前首道工序存在多个候选，实际加工归属待核查。')
        else:
            op = first[0]
            record, problems = inspection_for(op)
            positive = record and any((num(record.get(field)) or Fraction(0)) > 0 for field in ['QualifiedQty', 'UnqualifiedQty', 'NonQualifiedQty', 'ScrapQty', 'ActualInputQty'])
            if problems:
                emit(p, 'operation_reference_pending', fact='；'.join(problems), extra={'operation': op, 'inspections': inspections.get(text(op.get('OperationId')), [])})
            elif record and record.get('Result') in INSPECTED and positive and text(record.get('Cancelled')) not in TRUE:
                start_trigger = trigger_for(op, record)
            else:
                emit(p, 'processing_trigger_pending', fact='已取得工序或激活线索，尚无首工序本身的明确正数量检验事实证明实际加工。',
                     pending='工序启动日期可来自上道检验；实际开工时点及投入数量待核实。',
                     extra={'operation': op, 'inspection': record})
        if start_trigger:
            coverage['processingObserved'] += 1
        else:
            coverage['processingUnknown'] += 1
        # Receipt obligation is independent of the first-operation trigger.
        if len(last) == 1:
            op = last[0]
            record, problems = inspection_for(op)
            qualified = num(record.get('QualifiedQty')) if record else None
            if problems:
                emit(p, 'completion_basis_pending', fact='末工序检验归属存在冲突，未确认合格完工触发。', pending='；'.join(problems), extra={'operation': op, 'inspection': record})
            elif record and record.get('Result') in PASS and qualified is not None and qualified > 0 and text(record.get('Cancelled')) not in TRUE:
                coverage['qualifiedCompletionObserved'] += 1
                trigger = trigger_for(op, record, True)
                rr = list(receipts.get(pid, []))
                rr += [r for r in receipt_business.get((p.get('MoCode'), ident(p.get('SortSeq')), p.get('InvCode')), []) if ident(r.get('ProductionDetailId')) != pid]
                conflicts = [r for r in rr if r.get('HeaderMissing') != '0' or ident(r.get('ProductionDetailId')) != pid or r.get('cmocode') != p.get('MoCode')
                             or ident(r.get('imoseq')) != ident(p.get('SortSeq')) or r.get('cInvCode') != p.get('InvCode')
                             or r.get('bRdFlag') != '1']
                duplicate_ids = len({text(r.get('ReceiptLineId')) for r in rr}) != len(rr) or any(not r.get('ReceiptLineId') for r in rr)
                audited = [r for r in rr if r.get('HasAuditHandler') == '1']
                unknown = any(num(r.get('iQuantity')) is None for r in audited)
                net = None if not audited or unknown else sum((num(r['iQuantity']) for r in audited), Fraction(0))
                receipt_refs = [source_ref('u8-product-receipts', rr, 'ReceiptLineId')]
                extra = {'documentCount': len(rr), 'unauditedCount': len(rr) - len(audited), 'receiptReferenceConflicts': conflicts}
                quantity_known = unit_matches(trigger['unit'], p.get('InvCode'))
                required = qualified if quantity_known else None
                if conflicts or duplicate_ids:
                    emit(p, 'receipt_reference_pending', trigger=trigger, fact='入库单据的生产、行号、产品、方向或单据标识存在冲突。', refs=receipt_refs, extra=extra)
                elif not rr:
                    emit(p, 'receipt_missing', 'confirmed_issue', required=required, trigger=trigger,
                         fact='末工序已有明确正数量合格检验，当前冻结范围未见该生产明细对应产品入库单据。', refs=receipt_refs, extra=extra,
                         pending='' if quantity_known else '检验数量单位尚未取得，应入库数量留空。')
                elif len(audited) != len(rr):
                    emit(p, 'receipt_pending_audit', required=required, net=net, trigger=trigger, fact='已有对应入库单据，部分或全部缺少审核人依据。', refs=receipt_refs, extra=extra)
                elif not quantity_known or unknown:
                    emit(p, 'receipt_quantity_pending', net=net, trigger=trigger, fact='已有入库凭据，检验量与凭据数量的单位或数值依据不足。', refs=receipt_refs, extra=extra)
                elif net < qualified:
                    emit(p, 'receipt_shortfall', 'confirmed_issue', required=qualified, net=net, trigger=trigger,
                         fact='对应已审核入库有符号净量小于有效合格完工数量，已保留红字抵扣。', refs=receipt_refs, extra=extra)
            elif record and (record.get('Result') in PASS or (qualified is not None and qualified > 0)):
                emit(p, 'completion_basis_pending', fact='末工序合格意见与正合格数量未同时取得。', extra={'operation': op, 'inspection': record})
        else:
            emit(p, 'completion_basis_pending', fact='末道工序存在多个当前候选，无法判定合格完工数量。')
        if not start_trigger:
            continue
        aa = allocations.get(pid, [])
        if not aa:
            emit(p, 'allocation_basis_pending', trigger=start_trigger, fact='已有实际加工证据，但没有对应订单用料行。')
            continue
        by_material = index(aa, 'InvCode')
        for material, am in by_material.items():
            aids = {ident(a.get('AllocateId')) for a in am}
            ii = [r for aid in aids for r in issues.get(aid, [])]
            seen_objects = {id(r) for r in ii}
            for r in issue_business.get((p.get('MoCode'), ident(p.get('SortSeq')), material), []) + [r for aid in aids for r in replacements.get(aid, [])]:
                if id(r) not in seen_objects:
                    ii.append(r)
                    seen_objects.add(id(r))
            children = [child for aid in aids for child in child_links.get(aid, []) if child.get('InvCode') == material]
            refs = [source_ref('u8-allocations', am, 'AllocateId'), source_ref('u8-material-issues', ii, 'IssueLineId')]
            trigger = {**start_trigger}
            special_reasons = []
            if any(a.get('WIPType') != '3' or a.get('ByproductFlag') not in FALSE for a in am):
                special_reasons.append('订单供应类型或联副产品属性适用依据不足')
            if any(r.get('bsupersede') in TRUE or ident(r.get('isupersedempoids')) not in [None, '0'] for r in ii):
                special_reasons.append('出库记录存在替代标志或替代引用线索')
            if any(a.get('InvAlloeFlag') not in [None, *FALSE] for a in am):
                special_reasons.append('订单领料方式标志存在需核实的原值')
            special = bool(special_reasons)
            positive_required = all(num(a.get('Qty')) is not None and num(a['Qty']) >= 0 for a in am) and any(num(a.get('Qty')) > 0 for a in am if num(a.get('Qty')) is not None)
            quantity_known = variable_confirmed and unit_matches(trigger['unit'], p.get('InvCode')) and num(trigger.get('inputQty')) is not None and num(trigger['inputQty']) > 0
            quantity_known = quantity_known and all(a.get('FVFlag') == '1' and num(a.get('BaseQtyN')) is not None and num(a['BaseQtyN']) > 0
                                                     and num(a.get('BaseQtyD')) is not None and num(a['BaseQtyD']) > 0
                                                     and num(a.get('ParentScrap')) == 0 and num(a.get('CompScrap')) == 0
                                                     and num(a.get('ReplenishQty')) == 0 for a in am)
            required = sum((num(a['BaseQtyN']) / num(a['BaseQtyD']) * num(trigger['inputQty']) for a in am), Fraction(0)) if quantity_known else None
            if quantity_known:
                trigger['calculation'] = '各订单用料行基本用量分子／分母 × 有明确单位的实际投入数量，逐行精确相加；无损耗、补料或固定量例外。'
            conflicts = [r for r in ii if r.get('HeaderMissing') != '0' or ident(r.get('AllocationId')) not in aids or ident(r.get('MoDId')) != pid or r.get('cInvCode') != material
                         or r.get('AllocationMaterial') != material or r.get('VerifiedProductionCode') != p.get('MoCode')
                         or r.get('cmocode') != p.get('MoCode') or ident(r.get('imoseq')) != ident(p.get('SortSeq'))]
            duplicate_ids = len({text(r.get('IssueLineId')) for r in ii}) != len(ii) or any(not r.get('IssueLineId') for r in ii) or None in aids or len(aids) != len(am)
            audited = [r for r in ii if r.get('HasAuditHandler') == '1']
            unknown = any(num(r.get('iQuantity')) is None for r in audited)
            net = None if not audited or unknown else sum((num(r['iQuantity']) for r in audited), Fraction(0))
            extra = {'documentCount': len(ii), 'unauditedCount': len(ii) - len(audited),
                     'issueReferenceConflicts': conflicts, 'specialFlowReasons': special_reasons}
            quantity_values = [num(a.get('Qty')) for a in am]
            order_required = None if any(value is None for value in quantity_values) else sum(quantity_values, Fraction(0))
            document_fact = ('未见对应材料出库单据。' if not ii else
                             '已见' + str(len(ii)) + '条对应材料出库，其中' + str(len(ii) - len(audited)) + '条缺少审核人依据；' +
                             ('可计算的已审核有符号净量为' + shown(net) + '。' if net is not None else '已审核净量依据不足。'))
            document_fact += '订单应领原量为' + (shown(order_required) if order_required is not None else '未知') + '。'
            category = None
            classification = 'pending_evidence'
            fact = ''
            if conflicts or duplicate_ids:
                category, fact = 'issue_reference_pending', '材料出库引用、物料或单据标识存在冲突，未发布确定净量缺口。'
            elif special:
                category, fact = 'special_flow_pending', document_fact + '；'.join(special_reasons) + '。'
            elif not positive_required:
                category, fact = 'allocation_basis_pending', '订单应领数量缺失、非正或含负数，领用必要量依据不足。'
            elif not ii:
                category, fact, classification = 'issue_missing', '首工序已有实际加工证据，正常正应领物料未见对应材料出库单据。', 'confirmed_issue'
            elif len(audited) != len(ii):
                category, fact = 'issue_pending_audit', '已有对应材料出库单据，部分或全部缺少审核人依据。'
            elif required is None or unknown:
                category, fact = 'issue_quantity_pending', '已有领料凭据，实际投入量、单位或订单用量换算依据不足。'
            elif net < required:
                category, fact, classification = 'issue_shortfall', '已审核材料出库有符号净量小于实际加工对应需求，已抵扣红字和退料。', 'confirmed_issue'
            related = []
            if category:
                related = [emit(p, category, classification, material=material, required=required, net=net, trigger=trigger, fact=fact, refs=refs, extra=extra)]
            if children and category:
                upper = {'issue_missing': 'upstream_issue_missing', 'issue_pending_audit': 'upstream_issue_pending_audit', 'issue_shortfall': 'upstream_issue_shortfall'}.get(category, 'upstream_supply_pending')
                emit(p, upper, classification if upper != 'upstream_supply_pending' else 'pending_evidence', chain='upstream', material=material,
                     required=required, net=net, trigger=trigger, fact=fact, refs=refs, extra=extra, children=children, related=related,
                     pending='同一领用缺口与自身加工项关联，不能作为两个独立缺失事实；库存或其他批次有效供料可满足母件领用。')
            if positive_required:
                coverage['upstreamMaterialChecks'] += 1
                if not children:
                    coverage['upstreamRelationUnknownMaterials'] += 1
                    emit(p, 'upstream_supply_pending', chain='upstream', material=material,
                         required=required, net=net, trigger=trigger,
                         fact=document_fact + '现有生产引用不能建立该物料对应的上下级子生产关系。',
                         refs=refs, extra=extra, related=related,
                         pending='需核实供料来源及上下级对应关系；允许已有库存或其他批次有效供料。未将同物料生产单自动绑定为配套子单，也未据此认定子件缺入库。')
    coverage['componentItems'] = component_items
    summary = {'total': len(emitted_ids), 'confirmed': classifications['confirmed_issue'], 'pending': classifications['pending_evidence'],
               'productionOrders': len(emitted_orders), 'salesOrders': len(emitted_sales), 'componentItems': component_items}
    report = {'version': 1, 'batchId': batch, 'status': 'available', 'createdAt': datetime.now(timezone.utc).isoformat(),
              'boundary': BOUNDARY, 'sourceManifest': manifest, 'summary': summary, 'categories': dict(category_counts),
              'categoryLabels': KINDS, 'coverage': dict(coverage), 'columns': COLUMNS,
              'limits': ['未取得工序证据的生产明细单列覆盖数量，不视为加工正常或无缺口。',
                         '实际开工日期和工序数量单位缺失时保持未知；工序激活不证明实际开工。',
                         '当前检验按唯一工序快照核对，不累计相同实物的多次检验。']}
    return report, rows


def checked_rows(path, audit):
    count = 0
    with path.open(encoding='utf-8-sig') as stream:
        for line in stream:
            if not line.strip():
                continue
            row = json.loads(line, object_pairs_hook=intern_fields)
            count += 1
            if row.get('_expectedCount') != str(audit['count']):
                raise ValueError('PROCESSING_SOURCE_COUNT_MISMATCH')
            yield row
    if count != audit['count']:
        raise ValueError('PROCESSING_SOURCE_COUNT_MISMATCH')


ENUM_FIELDS = {'SourceObject', 'Status', 'Result', 'InspectionResult', 'Cancelled', 'ScrapState',
               'UnitCode', 'WIPType', 'FVFlag', 'ByproductFlag', 'HasAuditHandler', 'HeaderMissing',
               'bRdFlag', 'FlowCardType', 'OutsourcedFlag', '_expectedCount'}


def intern_fields(pairs):
    return {sys.intern(key): sys.intern(value) if key in ENUM_FIELDS and isinstance(value, str) else value
            for key, value in pairs}


def run(root):
    context = json.loads((root / 'quantity-inputs.json').read_text(encoding='utf-8'))
    manifest, data = [], {}
    for key in SOURCES:
        path = root / (key + '.ndjson')
        audit = json.loads((root / (key + '.ndjson.audit.json')).read_text(encoding='utf-8-sig'))
        if audit['status'] != 'succeeded' or sha(path) != audit['sha256'] or audit['querySha256'] != context['queryHashes'][key]:
            raise ValueError('PROCESSING_SOURCE_MISMATCH')
        data[key] = checked_rows(path, audit)
        manifest.append({**audit, 'dataset': key})
    folder = root / 'processing-checks'
    folder.mkdir(exist_ok=False)
    with (folder / 'rows.ndjson').open('w', encoding='utf-8', newline='\n') as stream:
        def output(row):
            stream.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
        report, _ = analyze_data(context['batchId'], data, manifest, row_sink=output)
    report['rows'] = {'file': 'rows.ndjson', 'count': report['summary']['total'], 'sha256': sha(folder / 'rows.ndjson')}
    (folder / 'review.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'batchId': report['batchId'], 'summary': report['summary']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage')
    run(Path(parser.parse_args().stage))
