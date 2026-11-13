"""Audit reviewed local extracts only; exact decimal/rational arithmetic, no SQL connection."""
import argparse
import collections
import csv
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import re


def number(value):
    if value is None or not re.fullmatch(r'[+-]?\d+(?:\.\d+)?', str(value)):
        return None
    return Fraction(Decimal(str(value)))


def shown(value):
    if value is None:
        return ''
    if value.denominator == 1:
        return str(value.numerator)
    with localcontext() as context:
        context.prec = 40
        decimal = Decimal(value.numerator) / Decimal(value.denominator)
        return format(decimal, 'f').rstrip('0').rstrip('.')


def identity(value):
    return str(int(value)) if value is not None and re.fullmatch(r'\s*\+?\d+\s*', str(value)) else None


def grouped(rows, key):
    result = collections.defaultdict(list)
    for row in rows:
        result[key(row)].append(row)
    return result


def one_index(rows, key):
    result = grouped(rows, key)
    if any(k is None or len(v) != 1 for k, v in result.items()):
        raise ValueError('NON_UNIQUE_SOURCE_ID')
    return {k: v[0] for k, v in result.items()}


def main(root):
    audits = []
    context_path=root/'quantity-inputs.json'
    context=json.loads(context_path.read_text(encoding='utf-8')) if context_path.exists() else None
    aliases=context['aliases'] if context else {}
    verified={}

    def file_hash(path):
        digest=hashlib.sha256()
        with path.open('rb') as handle:
            for chunk in iter(lambda:handle.read(1024*1024),b''):
                digest.update(chunk)
        return digest.hexdigest()

    def load(name,stream=False):
        name=aliases.get(name,name)
        path = root / (name + '.ndjson')
        audit = json.loads(path.with_suffix('.ndjson.audit.json').read_text(encoding='utf-8-sig'))
        if audit['status'] != 'succeeded' or file_hash(path) != audit['sha256']:
            raise ValueError('SOURCE_HASH_MISMATCH:' + name)
        if context and audit['querySha256']!=context['queryHashes'].get(name):
            raise ValueError('SOURCE_QUERY_HASH_MISMATCH:' + name)
        if name not in verified:
            audits.append({**audit,'dataset':name})
            verified[name]=audit
        def rows():
            count=0
            with path.open(encoding='utf-8-sig') as handle:
                for line in handle:
                    if not line.strip():continue
                    row=json.loads(line);count+=1
                    if ('_expectedCount' in row and int(row['_expectedCount'])!=audit['count']) or (context and '_expectedCount' not in row):
                        raise ValueError('SOURCE_COUNT_MISMATCH:' + name)
                    yield row
            if count!=audit['count']:
                raise ValueError('SOURCE_COUNT_MISMATCH:' + name)
        return rows() if stream else list(rows())

    sales = one_index(load('quantity-sales'), lambda r: identity(r['iSOsID']))
    production = one_index(load('quantity-production'), lambda r: identity(r['MoDId']))
    boms = one_index(load('quantity-bom'), lambda r: identity(r['BomId']))
    components = one_index(load('quantity-components'), lambda r: identity(r['OpComponentId']))
    parts = one_index(load('quantity-parts'), lambda r: identity(r['PartId']))
    options = one_index(load('review-quantity-component-options'), lambda r: identity(r['OptionsId']))
    substitutes = load('review-quantity-substitutes')
    allocations = load('quantity-allocations',stream=True)
    allocation_count=verified[aliases.get('quantity-allocations','quantity-allocations')]['count']
    mes = load('quantity-mes')
    kfu = load('quantity-kfu')
    tasks = load('quantity-tasks')
    history_sources={name:load(name,stream=True) for name in context['historyDatasets']} if context else {}
    history = [{'object_name':context['objects'][name],'row_count':str(verified[name]['count'])} for name in history_sources] if context else load('u8-bom-counts')
    history_coverage = [] if context else load('bom-history-coverage')
    outline_changes = load('investigate-outline-quantity-changes')
    if not context:load('investigate-mes-change-objects')
    enums=load('bom-quantity-enums')
    variable_quantity_confirmed=any(r.get('enum_type')=='BO.FVFlag' and r.get('field_code')=='1' and r.get('caption')=='否' for r in enums)
    # Nonempty history, substitutions and changes are evidence to retain, not a
    # technical collection failure or authorization to apply the latest BOM.
    history_nonempty = [r for r in history if any(token in str(r).lower() for token in ['history', 'ecn_', 'orderbom']) and int(r.get('record_count', r.get('row_count', r.get('rows', 0))))]
    def matched_sale(prod):
        if identity(prod.get('OrderType')) != '1':
            return None
        sale = sales.get(identity(prod['OrderDId']))
        if sale and prod.get('OrderCode') and prod['OrderCode'] != sale['cSOCode']:
            return None
        return sale

    by_sales = grouped(production.values(), lambda r: identity(matched_sale(r)['iSOsID']) if matched_sale(r) else None)
    by_bom = grouped(components.values(), lambda r: identity(r['BomId']))
    by_number = grouped(sales.values(), lambda r: r['cDefine25'])
    kfu_by_prod = grouped(kfu, lambda r: identity(r['U8AUTOID']))
    task_sales = collections.defaultdict(set)
    for task in tasks:
        candidates = by_number.get(task['U8生产编号'], [])
        if task['账套号'] == '333' and len(candidates) == 1 and (not task['订单号'] or task['订单号'] == candidates[0]['cSOCode']):
            task_sales[task['生产编号']].add(identity(candidates[0]['iSOsID']))
    output = root / ('quantity' if context else 'report')
    output.mkdir(exist_ok=not bool(context))
    counts = collections.defaultdict(collections.Counter)
    sample_candidates = collections.defaultdict(list)
    writers, handles, files = {}, [], {}
    columns = {
        'sales': ['销售订单','销售行号','销售明细编号','生产编号','物料编码','销售数量','同物料生产数量合计','生产明细编号','数值比较','说明'],
        'mes': ['生产订单','生产行号','生产明细编号','销售订单','物料编码','勤哲记录编号','勤哲行号','用友生产数量','勤哲投产数量','用友销售数量','勤哲数量','用友物料单位','勤哲单位','投产数值比较','销售数值比较','说明'],
        'bom': ['生产订单','生产行号','生产明细编号','物料编码','订单采用BOM编号','BOM版本','BOM生效日期','BOM失效日期','订单审核日期','BOM审核日期','BOM修改日期','记录更新计数（不代表业务变更次数）','核查结果'],
        'allocation': ['生产订单','生产明细编号','用料明细编号','子件编码','BOM子件行编号','生产数量','订单用量分子','订单用量分母','订单应领数量','精确理论用量','理论用量分数','订单算术比较','当前BOM对照','说明'],
        'demand': ['销售订单','销售明细编号','生产编号','子件编码','子件物料编号','BOM需求数量','需求数量分数','用友生产数量合计','用友生产明细编号','数值比较','勤哲投产数量合计','勤哲与BOM数值比较','计算路径','限制'],
        'changes': ['制造大纲编号','当前大纲版次','变更版次','更改时间','适用批架次','更改描述','记录编号','明细编号','核查结论'],
    }
    names = {'sales':'销售与组件生产数量','mes':'勤哲数量传递','bom':'订单采用BOM及变更依据','allocation':'订单子件用料数量','demand':'销售按BOM展开的子件需求','changes':'勤哲大纲更改线索'}
    if context:
        columns['scope']=['资料类别','来源记录编号','销售订单','销售明细编号','生产订单','生产明细编号','核查结论','原始资料（追溯用）']
        names['scope']='数量核查范围及关联待核查'
        columns['history']=['资料类别','来源记录编号','关联BOM编号','变更单编号','记录日期','核查结论','原始资料（追溯用）']
        names['history']='BOM历史与变更依据待核查'
    for category, header in columns.items():
        path = output / (category + '.csv')
        handle = path.open('w', encoding='utf-8-sig', newline='')
        handles.append(handle)
        writers[category] = csv.writer(handle)
        writers[category].writerow(header)
        files[category] = {'label': names[category], 'file': path.name, 'rows': 0}
        counts[category]

    def emit(category, values, state, interesting=False):
        assert len(values) == len(columns[category]), (category, len(values))
        writers[category].writerow(["'" + str(v) if str(v).startswith(('=', '+', '-', '@', '\t', '\r')) else v for v in values])
        files[category]['rows'] += 1
        counts[category][state] += 1
        if interesting:
            priority=0 if state in ['数值不同','存在数值差异'] else 1
            sample_candidates[category].append((priority,files[category]['rows'],dict(zip(columns[category], values))))
            sample_candidates[category]=sorted(sample_candidates[category],key=lambda item:item[:2])[:12]

    def compare(left, right):
        if left is None or right is None:
            return '数量缺失或格式待核查'
        return '数值相同' if left == right else '数值不同'

    mes_by_prod = collections.defaultdict(list)
    excluded_mes = collections.Counter()
    def excluded(row, ordinal, reason, prod=None):
        excluded_mes[reason]+=1
        if context:
            emit('scope',['mes-intermediate',str(ordinal),prod.get('OrderCode','') if prod else '',prod.get('OrderDId','') if prod else '',prod.get('MoCode','') if prod else '',prod.get('MoDId','') if prod else '',reason,json.dumps(row,ensure_ascii=False,separators=(',',':'))],reason,True)
    for ordinal,row in enumerate(mes,1):
        prod = production.get(identity(row['u8autoid']))
        if prod is None or identity(row['u8id']) != identity(prod['MoId']):
            excluded(row,ordinal,'未取得唯一用友主单及明细引用',prod)
            continue
        interfaces = [k for k in kfu_by_prod.get(prod['MoDId'], []) if k['账套号'] == '333' and identity(k['U8ID']) == identity(prod['MoId']) and k['BOM编号'] and k['BOM编号'] == row['生产订单表编号']]
        task_refs = task_sales.get(row['生产编号'], set())
        if not interfaces and not task_refs:
            excluded(row,ordinal,'未取得333账套范围证据',prod)
            continue
        sale = matched_sale(prod)
        if task_refs and (not sale or task_refs != {identity(sale['iSOsID'])}):
            excluded(row,ordinal,'勤哲任务与用友销售来源冲突',prod)
            continue
        mes_by_prod[prod['MoDId']].append(row)

    demand_covered=set()
    for sid, sale in sales.items():
        group = by_sales.get(sid, [])
        roots = [p for p in group if p['InvCode'] == sale['cInvCode']]
        valid = roots and all(number(p['Qty']) is not None for p in roots)
        total = sum((number(p['Qty']) for p in roots), Fraction()) if valid else None
        state = compare(number(sale['iQuantity']), total) if roots else '未取得同物料生产明细'
        notes = ['按销售明细引用与物料编码核对；分批、取消或非标准生产的适用范围仍需核实']
        if len(roots) > 1:
            notes.append('存在多条同物料生产明细，逐条保留后合计')
        if any(p['MoClass'] != '1' for p in roots):
            notes.append('含非标准生产订单，不据此判超产或少产')
        emit('sales', [sale['cSOCode'],sale['iRowNo'],sid,sale['cDefine25'],sale['cInvCode'],sale['iQuantity'],shown(total),'、'.join(p['MoDId'] for p in roots),state,'；'.join(notes)],state,state!='数值相同')

    for pid, prod in production.items():
        sale = matched_sale(prod)
        part = parts.get(identity(prod['PartId']))
        matches = mes_by_prod.get(pid, [])
        if not matches:
            emit('mes',[prod['MoCode'],prod['SortSeq'],pid,prod['OrderCode'],prod['InvCode'],'','',prod['Qty'],'',sale['iQuantity'] if sale else '', '',part['cComUnitName'] if part else '', '', '待核查','待核查','未取得无冲突的勤哲对应记录，不判漏传'], '未取得可核对记录',True)
        for row in matches:
            unit = part['cComUnitName'] if part else None
            left = compare(number(prod['Qty']), number(row['投产数量']))
            right = compare(number(sale['iQuantity']) if sale else None, number(row['数量']))
            notes = ['按主单、明细引用及333范围核对；勤哲重复记录逐条比较，不相加']
            if not sale:
                notes.append('销售来源类型、明细引用或单号待核查，未建立销售数量基准')
            if len(matches)>1:
                notes.append('同一生产明细有多条勤哲记录')
            if not unit or unit != row['单位']:
                notes.append('单位名称不同或缺失，不据数值相同判业务数量一致')
            if row['零件代码'] != prod['InvCode']:
                notes.append('勤哲零件代码未与用友物料编码一致，保留源引用关联')
            state = '存在数值差异' if '数值不同' in [left,right] else '数值相同但需核实单位及单据范围' if left==right=='数值相同' else '待核查'
            emit('mes',[prod['MoCode'],prod['SortSeq'],pid,prod['OrderCode'],prod['InvCode'],row['ExcelServerRCID'],row['ExcelServerRN'],prod['Qty'],row['投产数量'],sale['iQuantity'] if sale else '',row['数量'],unit or '',row['单位'],left,right,'；'.join(notes)],state,state!='数值相同但需核实单位及单据范围')

    bom_issues = {}
    for pid, prod in production.items():
        bom = boms.get(identity(prod['BomId']))
        issues = []
        if not bom:
            issues.append('订单引用的BOM未取得')
        else:
            if identity(bom['ParentId']) != identity(prod['PartId']):
                issues.append('BOM母件与订单物料引用不同')
            date = (prod['RelsDate'] or '')[:10]
            if not date:
                issues.append('订单审核日期缺失')
            if date and bom['ModifyDate'] and bom['ModifyDate'][:10] > date:
                issues.append('BOM修改日期晚于订单审核日期')
            if date and bom['RelsDate'] and bom['RelsDate'][:10] > date:
                issues.append('当前BOM审核日期晚于订单审核日期')
            if not bom['VersionEffDate'] or not bom['VersionEndDate'] or not date or not bom['VersionEffDate'][:10] <= date <= bom['VersionEndDate'][:10]:
                issues.append('BOM日期适用范围待核查')
            if bom['Status'] != '3':
                issues.append('当前BOM非审核状态')
        if prod['MoClass'] != '1':
            issues.append('非标准生产订单适用规则待核查')
        bom_issues[pid] = issues
        state = '；'.join(issues) if issues else '当前记录未发现日期或母件引用冲突'
        emit('bom',[prod['MoCode'],prod['SortSeq'],pid,prod['InvCode'],prod['BomId'],bom['Version'] if bom else '',bom['VersionEffDate'] if bom else '',bom['VersionEndDate'] if bom else '',prod['RelsDate'],bom['RelsDate'] if bom else '',bom['ModifyDate'] if bom else '',bom['UpdCount'] if bom else '',state+'；未取得完整变更单及适用范围，历史有效性待核查'],state,bool(issues))

    for row in allocations:
        prod = production.get(identity(row['MoDId']))
        if not prod:
            emit('allocation',['',row['MoDId'],row['AllocateId'],row['InvCode'],row['OpComponentId'],'',row['BaseQtyN'],row['BaseQtyD'],row['Qty'],'','','生产明细引用待核查','未取得本次生产明细','来源按窗口读取，未猜测补齐生产记录'],'生产明细引用待核查',True)
            counts['allocation_current']['未取得本次生产明细']+=1
            continue
        numerator, denominator, quantity = number(row['BaseQtyN']), number(row['BaseQtyD']), number(row['Qty'])
        valid = numerator is not None and denominator is not None and denominator > 0 and number(prod['Qty']) is not None
        valid = valid and variable_quantity_confirmed and row['FVFlag'] == '1' and number(row['ParentScrap']) == 0 and number(row['CompScrap']) == 0 and row['ByproductFlag'] == 'False'
        expected = number(prod['Qty']) * numerator / denominator if valid else None
        state = compare(expected, quantity) if valid else '用量规则待核查'
        if state == '数值不同' and abs(expected-quantity) <= Fraction(1,2000000):
            state = '精度或取整待核查'
        current = components.get(identity(row['OpComponentId']))
        if not current:
            relation = '当前BOM找不到原子件行'
        elif current['BomId'] != prod['BomId']:
            relation = '子件行位于其他BOM，嵌套或变更待核查'
        elif current['ComponentId'] != row['ComponentId']:
            relation = '当前BOM子件物料不同'
        elif number(current['BaseQtyN']) != numerator or number(current['BaseQtyD']) != denominator or current['FVFlag'] != row['FVFlag']:
            relation = '当前BOM用量与订单用料明细不同'
        else:
            relation = '当前子件行及基本用量相同'
        notes = '使用订单保留的用量计算，不用当前BOM覆盖；精确分数比较，未擅自设允差；当前用料明细不等于完整历史变更单'
        emit('allocation',[prod['MoCode'],prod['MoDId'],row['AllocateId'],row['InvCode'],row['OpComponentId'],prod['Qty'],row['BaseQtyN'],row['BaseQtyD'],row['Qty'],shown(expected),str(expected) if expected is not None else '',state,relation,notes],state,state not in ['数值相同','精度或取整待核查'])
        counts['allocation_current'][relation] += 1

    # Expand only the BOM explicitly referenced by this sales line's production orders.
    # No latest-version selection; unbound subassemblies stop and remain visible.
    for sid, sale in sales.items():
        group = by_sales.get(sid, [])
        roots = [p for p in group if p['InvCode'] == sale['cInvCode']]
        by_part = grouped(group, lambda r: identity(r['PartId']))
        expected = collections.defaultdict(Fraction)
        paths = collections.defaultdict(list)
        limits = set()
        sale_qty = number(sale['iQuantity'])
        root_total = sum((number(p['Qty']) or Fraction() for p in roots),Fraction())
        if not roots or sale_qty is None or any(number(p['Qty']) is None for p in roots) or (len(roots)>1 and root_total!=sale_qty):
            counts['demand_scope']['未取得唯一可展开的母件数量分配'] += 1
            if context:
                emit('scope',['u8-sales',sid,sale['cSOCode'],sid,'、'.join(p['MoCode'] for p in roots),'、'.join(p['MoDId'] for p in roots),'未取得唯一可展开的母件数量分配',json.dumps({'sales':sale,'rootProduction':roots},ensure_ascii=False,separators=(',',':'))],'未取得唯一可展开的母件数量分配',True)
            continue

        def walk(bom_id, parent_qty, date, trail, visited):
            bom = boms.get(bom_id)
            if not bom or bom_id in visited or len(visited)>30:
                limits.add('BOM缺失、循环或层级过深，展开不完整')
                return
            for component in by_bom.get(bom_id, []):
                begin,end = component['EffBegDate'],component['EffEndDate']
                if not date or not begin or not end:
                    limits.add('子件有效日期缺失，展开不完整')
                    continue
                if not begin[:10] <= date <= end[:10]:
                    limits.add('存在不在订单审核日生效的当前子件，历史范围待核查')
                    continue
                opt=options.get(component['OptionsId'])
                num,den=number(component['BaseQtyN']),number(component['BaseQtyD'])
                if not variable_quantity_confirmed or component['FVFlag']!='1' or num is None or den is None or den<=0 or number(component['CompScrap'])!=0 or number(bom['ParentScrap'])!=0 or component['ByproductFlag']!='False' or not opt or opt['OptionalFlag']!='False' or number(opt['PlanFactor'])!=100 or opt['FeatureRel']!='False':
                    limits.add('固定用量、损耗、选配或其他用量规则待核查')
                    continue
                qty=parent_qty*num/den
                part_id=component['ComponentId']
                expected[part_id]+=qty
                path=trail+[component['OpComponentId']]
                paths[part_id].append('/'.join(path))
                child_orders=by_part.get(part_id,[])
                child_boms={p['BomId'] for p in child_orders if p['BomId'] in boms}
                if child_orders and len(child_boms)==1:
                    walk(next(iter(child_boms)),qty,date,path,visited|{bom_id})
                elif child_orders:
                    limits.add('子件订单采用BOM不唯一或缺失，后续层级未展开')

        for prod in roots:
            walk(prod['BomId'],sale_qty if len(roots)==1 else number(prod['Qty']), (prod['RelsDate'] or '')[:10], [prod['BomId']], set())
        if any(bom_issues[p['MoDId']] for p in group):
            limits.add('订单引用BOM存在日期、母件或生产类型待核查项')
        limits.add('未取得变更单及历史适用范围，当前结构计算只作核查线索')
        if context and not expected:
            emit('scope',['u8-sales',sid,sale['cSOCode'],sid,'、'.join(p['MoCode'] for p in roots),'、'.join(p['MoDId'] for p in roots),'未展开出可计算子件，BOM或适用规则待核查',json.dumps({'sales':sale,'rootProduction':roots,'limits':sorted(limits)},ensure_ascii=False,separators=(',',':'))],'未展开出可计算子件，BOM或适用规则待核查',True)
        for part_id, qty in expected.items():
            matches=by_part.get(part_id,[])
            demand_covered.update(p['MoDId'] for p in matches)
            part=parts.get(part_id,{})
            actual=sum((number(p['Qty']) for p in matches),Fraction()) if matches and all(number(p['Qty']) is not None for p in matches) else None
            state=compare(qty,actual) if matches else '未取得对应生产明细，不据此判缺件'
            mes_matches=[mes_by_prod.get(p['MoDId'],[]) for p in matches]
            unique_mes=bool(matches) and all(len(v)==1 and number(v[0]['投产数量']) is not None and part.get('cComUnitName') and v[0]['单位']==part['cComUnitName'] for v in mes_matches)
            mes_total=sum((number(v[0]['投产数量']) for v in mes_matches),Fraction()) if unique_mes else None
            mes_state=compare(qty,mes_total) if unique_mes else '关联、重复记录或单位待核查，未合计'
            counts['demand_mes'][mes_state]+=1
            emit('demand',[sale['cSOCode'],sid,sale['cDefine25'],part.get('InvCode',''),part_id,shown(qty),str(qty),shown(actual),'、'.join(p['MoDId'] for p in matches),state,shown(mes_total),mes_state,'；'.join(paths[part_id]),'；'.join(sorted(limits))],state,state=='数值不同')

    # Reverse coverage: actual child orders absent from the current expansion remain
    # visible. They may belong to an older BOM; they are not automatically extra parts.
    for sid,group in by_sales.items():
        sale=sales.get(sid)
        if not sale:
            for prod in group:
                emit('demand',[prod['OrderCode'],prod['OrderDId'],prod['Define25'],prod['InvCode'],prod['PartId'],'','',prod['Qty'],prod['MoDId'],'销售来源待核查','','未取得需求基准','','销售来源类型、明细引用或单号待核查，不根据生产编号猜测归属'],'销售来源待核查',True)
                counts['demand_mes']['未取得需求基准']+=1
            continue
        unresolved=[p for p in group if p['MoDId'] not in demand_covered and p['InvCode']!=sale['cInvCode']]
        for part_id,orders in grouped(unresolved,lambda r:r['PartId']).items():
            actual=sum((number(p['Qty']) for p in orders),Fraction()) if all(number(p['Qty']) is not None for p in orders) else None
            state='现有子件生产未在当前BOM展开中定位'
            emit('demand',[sale['cSOCode'],sid,sale['cDefine25'],orders[0]['InvCode'],part_id,'','',shown(actual),'、'.join(p['MoDId'] for p in orders),state,'','未取得需求基准','','历史版本或层级依据待核查，不据此判多生产'],state,True)
            counts['demand_mes']['未取得需求基准']+=1

    for row in outline_changes:
        note='大纲更改线索；尚未取得其对应BOM、子件用量前后值及订单适用范围，不自动用于改算历史订单'
        emit('changes',[row['制造大纲编号'],row['制造大纲版次'],row['版次'],row['更改时间'],row['适用批架次'],row['描述'],row['ExcelServerRCID'],row['明细主键'],note], '变更适用关系待核查', '数量' in row['描述'] or '用量' in row['描述'])

    if context:
        history_labels={'u8-bom-history':'BOM历史','u8-component-history':'BOM子件历史','u8-order-bom':'订单BOM关联','u8-ecn':'工程变更单','u8-ecn-details':'工程变更明细','u8-ecn-bom':'工程变更BOM','u8-ecn-components':'工程变更子件','u8-ecn-notes':'工程变更通知','u8-bom-log':'BOM及生产操作日志','u8-substitutes':'替代子件'}
        for name,rows in {**history_sources,'u8-substitutes':substitutes}.items():
            for row in rows:
                raw={k:v for k,v in row.items() if k!='_expectedCount'}
                emit('history',[history_labels[name],next((str(row[k]) for k in ['HistoryId','AutoId','ApplyDId','ApplyId','NoteId','ComponentSubId','OpComponentId','EBomId','Id'] if row.get(k) is not None),''),row.get('BomId',row.get('EBomId','')),row.get('DocCode',row.get('BillNo','')),row.get('DocDate',row.get('Time',row.get('ModifyDate',row.get('VersionEffDate','')))),'适用范围或用量前后关系待核查，不自动改算历史订单',json.dumps(raw,ensure_ascii=False,separators=(',',':'))],'适用依据待核查',True)

    for handle in handles:
        handle.flush();os.fsync(handle.fileno())
        handle.close()
    for category, file in files.items():
        file['sha256']=file_hash(output/file['file'])
        file['columns']=columns[category]
    bom_part_groups=grouped(boms.values(),lambda r:r['ParentId'])
    summary={
        'sales':len(sales),'production':len(production),'mesRead':len(mes),'mesLinked':sum(map(len,mes_by_prod.values())),
        'mesExcluded':dict(excluded_mes),'mesRepeatedProduction':sum(len(v)>1 for v in mes_by_prod.values()),
        'bomHeaders':len(boms),'bomComponents':len(components),'orderAllocations':allocation_count,
        'bomParentsWithMultipleVersions':sum(len(v)>1 for v in bom_part_groups.values()),
        'bomChangedAfterOrder':sum('BOM修改日期晚于订单审核日期' in v for v in bom_issues.values()),
        'bomMissing':sum('订单引用的BOM未取得' in v for v in bom_issues.values()),
        'nonstandardProduction':sum(p['MoClass']!='1' for p in production.values()),
        'outlineChangeCandidates':len(outline_changes),'outlineQuantityMentions':sum('数量' in r['描述'] or '用量' in r['描述'] for r in outline_changes),
        'historyRecords':sum(int(r['row_count']) for r in history) if context else sum(int(r.get('row_count',0)) for r in history_nonempty),'substituteRecords':len(substitutes),'quantityEnumConfirmed':variable_quantity_confirmed,
    }
    report={
        'version':2 if context else 1,'reviewId':context['batchId'] if context else 'quantity-bom-20261105','generatedAt':datetime.now(timezone.utc).isoformat(),
        'analysisSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'status':'待核查','basis':'按订单采用的BOM及变更单明确的适用范围核对；依据不足单列待核查。',
        'boundary':'本结果随本次盘点冻结保存。数值相同仅表示本项算术相同；BOM历史及变更适用范围不足的继续待核查，不表示历史数量已通过业务验收。' if context else '本次为独立只读数量核查，未改写已有盘点结果。数值相同仅表示本项算术相同；未取得完整BOM变更单及适用范围，不表示历史数量已通过业务验收。',
        'scope':'用友333当前库的已审核销售、审核或关闭生产；勤哲按用友主单及明细引用、333转换记录或任务范围关联；跨系统分窗口读取。',
        'summary':summary,'counts':{k:dict(v) for k,v in counts.items()},'files':files,'examples':{k:[item[2] for item in v] for k,v in sample_candidates.items()},'reads':audits,
        'historyEvidence':history,'historyLogCoverage':history_coverage,
        'limitations':[
            f'本次保留BOM历史、工程变更、订单BOM关联及相关日志{summary["historyRecords"]}条，替代子件{len(substitutes)}条；记录为空不证明没有变更，有记录也不自动证明适用于本订单。',
            '现存多版本BOM按订单明确引用区分，未选用最新版本替代；同日修改和审核不能仅凭日期判先后。',
            '勤哲制造大纲版次记录已检出数量等更改线索，完整保留在更改线索明细；不能自动替代BOM变更单，尚未取得其对子件用量及订单的明确适用关系。',
            '子件需求按基本用量除以基础数量逐层计算，保留精确分数；仅展开本销售来源生产单明确采用的BOM，未绑定层级不猜版本。',
            '生产用料是应领材料，与勤哲下达的子件生产单不构成一一关系；未下达生产单的材料不直接判漏件。',
            '分批投产、非标准生产、替代、虚拟件、选配、损耗、单位换算及取整缺少明确依据时保留待核查；重复勤哲记录不累加。',
        ],
    }
    if context:
        report['batchId']=context['batchId'];report['ruleVersion']=context['ruleVersion']
        report['sourceManifest']=[{**verified[name],'dataset':name,'file':name+'.ndjson'} for name in verified]
    with (output/'review.json').open('w',encoding='utf-8') as handle:
        handle.write(json.dumps(report,ensure_ascii=False,indent=2));handle.flush();os.fsync(handle.fileno())
    print(json.dumps({'summary':summary,'counts':report['counts'],'files':{k:v['rows'] for k,v in files.items()}},ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('extract_directory',type=Path)
    args=parser.parse_args()
    main(args.extract_directory.resolve())
