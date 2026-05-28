"""Generate a norms snapshot with content metrics extracted from mapping documents.

Usage:
    python generate_snapshot.py              # Create new snapshot
    python generate_snapshot.py --compare    # Compare latest two snapshots
    python generate_snapshot.py --compare S1 S2  # Compare two specific snapshots
"""

import os, sys, json, hashlib, datetime, re

NORMS_DIR = r'E:\CA001\Infomat\docs\norms'
SNAPSHOT_DIR = r'E:\CA001\Infomat\snapshots'
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

DEPT_NAMES = ['经营发展部', '物资保障部', '行政人事部', '运维安环部', '财务部', '项目管理部']


def extract_mapping_metrics(mapping_path):
    """Parse a mapping MD file and extract L1/L2/L3/A1 counts."""
    try:
        with open(mapping_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return None

    result = {
        'L1_count': 0,
        'L2_count': 0,
        'L3_count': 0,
        'A1_count': 0,
        'has_A1_section': '业务行为（A1）映射（BBM增补）' in content,
        'system_mapping': {'ERP': 0, 'OA': 0, 'MES': 0, 'PLM': 0},
    }

    # --- Method 1: Extract from 统计汇总 / 业务行为（A1）统计汇总 table ---
    # These tables have explicit totals and are present in all mapping docs
    stats_patterns = [
        r'## 统计汇总.*?\n\n(.*?)(?=\n## |\n---|\Z)',
        r'## 汇总统计.*?\n\n(.*?)(?=\n## |\n---|\Z)',
        r'## 业务行为（A1）统计汇总.*?\n\n(.*?)(?=\n## |\n---|\Z)',
    ]
    for pat in stats_patterns:
        stats_section = re.search(pat, content, re.DOTALL)
        if stats_section:
            text = stats_section.group(1)
            for line in text.strip().split('\n'):
                line = line.strip()
                if '|' not in line:
                    continue
                # Look for key: value pairs like "| 能力域（L1） | 4 |"
                m = re.match(r'\|\s*(.+?)\s*\|\s*(\d+)\s*\|', line)
                if m:
                    key = m.group(1).strip()
                    val = int(m.group(2))
                    if '能力域（L1）' in key or 'L1' in key:
                        if result['L1_count'] == 0:
                            result['L1_count'] = val
                    elif '业务能力（L2）' in key or 'L2' in key:
                        if result['L2_count'] == 0:
                            result['L2_count'] = val
                    elif '业务流程（L3）' in key or 'L3' in key:
                        if result['L3_count'] == 0:
                            result['L3_count'] = val
                    elif '业务行为（A1）' in key or 'A1' in key:
                        result['A1_count'] = max(result['A1_count'], val)
            break

    # --- Method 2: Count A1 rows directly from BBM table ---
    # Match patterns like | CW-L3-01-A01 |, | 0101-A01 |, | L3-01-A01 |, etc.
    a1_ids = set()
    for m in re.finditer(r'\|\s*([A-Za-z0-9-]+-A\d+)\s*\|', content):
        a1_ids.add(m.group(1))
    if len(a1_ids) > result['A1_count']:
        result['A1_count'] = len(a1_ids)

    # --- Method 3: Count L3 from DCM mapping table (before BBM section) ---
    # Table rows in the DCM section: start with "| digit | dept | domain | capability | process |"
    dcm_section_end = content.find('## 业务行为（A1）映射')
    if dcm_section_end < 0:
        dcm_section_end = content.find('---', content.find('## 业务能力—流程—系统映射表'))
    if dcm_section_end < 0:
        dcm_section_end = len(content)
    dcm_content = content[:dcm_section_end]

    # Count DCM table rows (L3 rows)
    l3_rows = set()
    for m in re.finditer(r'^\|\s*(\d+)\s*\|\s*(.+?)\s*\|', dcm_content, re.MULTILINE):
        row_num = m.group(1)
        if row_num.isdigit():
            l3_rows.add(row_num)
    if len(l3_rows) > result['L3_count']:
        result['L3_count'] = len(l3_rows)

    # --- System mapping: from 应用系统（S1）覆盖 table ---
    sys_section = re.search(r'## 应用系统（S1）覆盖.*?(?=\n## |\n---|\Z)', content, re.DOTALL)
    if sys_section:
        for sys_name in ['ERP', 'OA', 'MES', 'PLM']:
            m = re.search(rf'\|\s*{sys_name}\s*\|\s*(\d+)\s*\|', sys_section.group(0))
            if m:
                result['system_mapping'][sys_name] = int(m.group(1))

    # Fallback: count system mentions in DCM table system column
    if sum(result['system_mapping'].values()) == 0 and len(l3_rows) > 0:
        for m in re.finditer(r'^\|\s*\d+\s*\|', dcm_content, re.MULTILINE):
            line = m.string[m.start():].split('\n')[0]
            parts = line.split('|')
            if len(parts) >= 8:
                sys_cell = parts[-2].strip() if len(parts) > 8 else parts[-3].strip()
                for sys_name in ['ERP', 'OA', 'MES', 'PLM']:
                    if sys_name in sys_cell:
                        result['system_mapping'][sys_name] += 1

    return result


def collect_files():
    """Walk norms dir and collect file metadata."""
    entries = []
    for root, dirs, files in os.walk(NORMS_DIR):
        for f in files:
            if f.startswith('~'):
                continue
            ext = os.path.splitext(f)[1].lower()
            if ext not in ('.md', '.html', '.docx', '.xlsx', '.pdf'):
                continue
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, NORMS_DIR).replace('\\', '/')
            size_kb = round(os.path.getsize(fp) / 1024, 1)
            mtime = datetime.datetime.fromtimestamp(os.path.getmtime(fp)).strftime('%Y-%m-%dT%H:%M:%S')
            with open(fp, 'rb') as fh:
                h = hashlib.sha256(fh.read()).hexdigest()[:16]
            entries.append({
                'path': rel, 'name': f, 'size_kb': size_kb,
                'modified': mtime, 'sha256_short': h
            })
    entries.sort(key=lambda x: x['path'])
    return entries


def analyze_departments(entries):
    """Analyze each department's state including content metrics."""
    departments = {}
    for dept in DEPT_NAMES:
        dept_entries = [e for e in entries if dept in e['path']]
        canon = {}
        mapping_full_path = None
        for e in dept_entries:
            if '映射关系.md' in e['name']:
                canon['mapping'] = e['name']
                mapping_full_path = os.path.join(NORMS_DIR, e['path'])
            if '桑基图.html' in e['name']:
                canon['sankey'] = e['name']
            if 'MDM建设要求.md' in e['name']:
                canon['mdm'] = e['name']

        # Extract content metrics from mapping file
        metrics = None
        if mapping_full_path:
            metrics = extract_mapping_metrics(mapping_full_path)

        source_count = len([e for e in dept_entries if '业务资料' in e['path']])
        canon_count = len(canon)

        has_a1 = metrics['has_A1_section'] if metrics else False
        stage = '未开始'
        if canon_count >= 3:
            stage = 'DCM完成'
        if has_a1:
            stage = 'BBM完成'

        departments[dept] = {
            'stage': stage,
            'canonical_files': canon_count,
            'source_files': source_count,
            'has_A1': has_a1,
            'canonical': canon,
            'metrics': {
                'L1_count': metrics['L1_count'] if metrics else 0,
                'L2_count': metrics['L2_count'] if metrics else 0,
                'L3_count': metrics['L3_count'] if metrics else 0,
                'A1_count': metrics['A1_count'] if metrics else 0,
                'system_mapping': metrics['system_mapping'] if metrics else {},
            } if metrics else None
        }
    return departments


def generate_snapshot():
    """Create a new snapshot."""
    ts = datetime.datetime.now().strftime('%Y-%m-%d_%H%M')
    entries = collect_files()
    departments = analyze_departments(entries)

    snapshot = {
        'generated_at': datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
        'snapshot_id': ts,
        'base_directory': 'docs/norms/',
        'summary': {
            'total_files': len(entries),
            'departments_mapped': sum(1 for d in departments.values() if d['stage'] != '未开始'),
            'departments_with_A1': sum(1 for d in departments.values() if d['has_A1']),
            'source_docx': sum(1 for e in entries if e['name'].endswith('.docx')),
            'source_pdf': sum(1 for e in entries if e['name'].endswith('.pdf')),
            'deliverables_md': sum(1 for e in entries if e['name'].endswith('.md') and '业务资料' not in e['path']),
            'deliverables_html': sum(1 for e in entries if e['name'].endswith('.html')),
            'total_L3': sum(d['metrics']['L3_count'] for d in departments.values() if d['metrics']),
            'total_A1': sum(d['metrics']['A1_count'] for d in departments.values() if d['metrics']),
        },
        'departments': {k: {sk: sv for sk, sv in v.items() if sk != 'canonical'}
                        for k, v in departments.items()},
        'files': entries
    }

    # Write JSON
    json_path = os.path.join(SNAPSHOT_DIR, f'norms-snapshot-{ts}.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)

    # Write Markdown
    md_path = os.path.join(SNAPSHOT_DIR, f'norms-snapshot-{ts}.md')
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write('# Norms Snapshot\n\n')
        f.write(f'**Generated:** {snapshot["generated_at"]} | **ID:** {ts}\n\n')

        f.write('## Department Growth Metrics\n\n')
        f.write('| Department | Stage | L1 | L2 | L3 | A1 | ERP | OA | MES | PLM | Sources |\n')
        f.write('|------------|-------|----|----|----|----|-----|----|-----|-----|--------|\n')
        for dept in sorted(departments.keys()):
            d = departments[dept]
            m = d.get('metrics') or {}
            sm = m.get('system_mapping', {})
            f.write(f'| {dept} | {d["stage"]} | {m.get("L1_count",0)} | {m.get("L2_count",0)} | '
                    f'{m.get("L3_count",0)} | {m.get("A1_count",0)} | '
                    f'{sm.get("ERP",0)} | {sm.get("OA",0)} | {sm.get("MES",0)} | {sm.get("PLM",0)} | '
                    f'{d["source_files"]} |\n')

        f.write('\n## Totals\n\n')
        s = snapshot['summary']
        f.write(f'- **总L3:** {s["total_L3"]} | **总A1:** {s["total_A1"]}\n')
        f.write(f'- **文件:** {s["total_files"]} | **已映射:** {s["departments_mapped"]}/{len(departments)} | **含A1:** {s["departments_with_A1"]}\n\n')

        f.write('## All Files (SHA256 first 16)\n\n')
        f.write('| File | SizeKB | Modified | SHA256 |\n')
        f.write('|------|--------|----------|--------|\n')
        for e in entries:
            f.write(f'| {e["path"]} | {e["size_kb"]} | {e["modified"]} | {e["sha256_short"]} |\n')

    # Update LATEST pointer
    with open(os.path.join(SNAPSHOT_DIR, 'LATEST.txt'), 'w', encoding='utf-8') as f:
        f.write(f'LATEST_SNAPSHOT={ts}\n')
        f.write(f'GENERATED_AT={snapshot["generated_at"]}\n')

    return snapshot, json_path, md_path


def compare_snapshots(path_a, path_b):
    """Compare two snapshot JSON files and produce a growth report."""
    with open(path_a, 'r', encoding='utf-8') as f:
        a = json.load(f)
    with open(path_b, 'r', encoding='utf-8') as f:
        b = json.load(f)

    id_a = os.path.basename(path_a).replace('norms-snapshot-', '').replace('.json', '')
    id_b = os.path.basename(path_b).replace('norms-snapshot-', '').replace('.json', '')

    lines = []
    lines.append('# Growth Comparison Report')
    lines.append('')
    lines.append(f'**{id_a}**  →  **{id_b}**')
    lines.append('')

    # Department-level comparison
    lines.append('## Department Progress')
    lines.append('')
    lines.append('| Department | Stage (A) | Stage (B) | L3 Δ | A1 Δ | ERP Δ | OA Δ | MES Δ |')
    lines.append('|------------|-----------|-----------|------|------|-------|-------|-------|')
    for dept in DEPT_NAMES:
        da = a['departments'].get(dept, {})
        db = b['departments'].get(dept, {})
        ma = da.get('metrics') or {}
        mb = db.get('metrics') or {}
        sma = ma.get('system_mapping', {}) if ma else {}
        smb = mb.get('system_mapping', {}) if mb else {}

        stage_a = da.get('stage', '?')
        stage_b = db.get('stage', '?')
        stage_str = f'{stage_a} → {stage_b}'
        if stage_a != stage_b:
            stage_str = f'**{stage_a} → {stage_b}**'

        def delta(mb_val, ma_val):
            d = (mb_val or 0) - (ma_val or 0)
            if d > 0:
                return f'+{d}'
            elif d < 0:
                return str(d)
            return '0'

        lines.append(f'| {dept} | {stage_a} | {stage_b} | '
                     f'{delta(mb.get("L3_count"), ma.get("L3_count"))} | '
                     f'{delta(mb.get("A1_count"), ma.get("A1_count"))} | '
                     f'{delta(smb.get("ERP"), sma.get("ERP"))} | '
                     f'{delta(smb.get("OA"), sma.get("OA"))} | '
                     f'{delta(smb.get("MES"), sma.get("MES"))} |')

    lines.append('')
    lines.append('## Totals')
    lines.append('')
    sa = a['summary']
    sb = b['summary']

    def total_delta(key):
        da = sa.get(key, 0) or 0
        db = sb.get(key, 0) or 0
        d = db - da
        return f'+{d}' if d > 0 else str(d)

    lines.append('| Metric | Before | After | Δ |')
    lines.append('|--------|--------|-------|---|')
    for key, label in [('total_files', 'Total files'), ('total_L3', 'Total L3'),
                        ('total_A1', 'Total A1'), ('departments_mapped', 'Mapped depts'),
                        ('departments_with_A1', 'Depts with A1')]:
        lines.append(f'| {label} | {sa.get(key, "?")} | {sb.get(key, "?")} | {total_delta(key)} |')

    # Changed files
    lines.append('')
    lines.append('## Changed / New / Removed Files')
    lines.append('')
    files_a = {e['path']: e['sha256_short'] for e in a['files']}
    files_b = {e['path']: e['sha256_short'] for e in b['files']}

    new_files = set(files_b.keys()) - set(files_a.keys())
    removed_files = set(files_a.keys()) - set(files_b.keys())
    changed_files = {p for p in set(files_a.keys()) & set(files_b.keys())
                     if files_a[p] != files_b[p]}

    if new_files:
        lines.append(f'**New ({len(new_files)}):**')
        for p in sorted(new_files):
            lines.append(f'- + {p}')
        lines.append('')
    if removed_files:
        lines.append(f'**Removed ({len(removed_files)}):**')
        for p in sorted(removed_files):
            lines.append(f'- - {p}')
        lines.append('')
    if changed_files:
        lines.append(f'**Changed ({len(changed_files)}):**')
        for p in sorted(changed_files):
            lines.append(f'- ~ {p}')
        lines.append('')
    if not (new_files or removed_files or changed_files):
        lines.append('No file changes detected.')
        lines.append('')

    report = '\n'.join(lines)
    report_path = os.path.join(SNAPSHOT_DIR, f'growth-{id_a}-to-{id_b}.md')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report)
    return report, report_path


def find_latest_snapshots():
    """Return sorted list of snapshot JSON files (newest first)."""
    jsons = sorted(
        [f for f in os.listdir(SNAPSHOT_DIR) if f.startswith('norms-snapshot-') and f.endswith('.json')],
        reverse=True
    )
    return [os.path.join(SNAPSHOT_DIR, f) for f in jsons]


if __name__ == '__main__':
    if '--compare' in sys.argv:
        jsons = find_latest_snapshots()
        if len(jsons) < 2:
            print('Need at least 2 snapshots to compare. Run without --compare first.')
            sys.exit(1)

        args = [a for a in sys.argv[1:] if a != '--compare']
        if len(args) >= 2:
            # specific IDs
            path_a = os.path.join(SNAPSHOT_DIR, f'norms-snapshot-{args[0]}.json')
            path_b = os.path.join(SNAPSHOT_DIR, f'norms-snapshot-{args[1]}.json')
        else:
            path_a = jsons[1]  # older
            path_b = jsons[0]  # newer

        if not os.path.exists(path_a):
            print(f'Snapshot not found: {path_a}')
            sys.exit(1)
        if not os.path.exists(path_b):
            print(f'Snapshot not found: {path_b}')
            sys.exit(1)

        report, report_path = compare_snapshots(path_a, path_b)
        print(report)
        print(f'\nReport saved: {report_path}')

    else:
        snapshot, json_path, md_path = generate_snapshot()
        print(f'Snapshot saved:')
        print(f'  JSON: {json_path}')
        print(f'  MD:   {md_path}')
        print()
        print('=== Department Growth Metrics ===')
        print(f'{"Department":<10} {"Stage":<10} {"L1":>3} {"L2":>3} {"L3":>4} {"A1":>4} {"ERP":>4} {"OA":>4} {"MES":>4} {"PLM":>4}')
        print('-' * 70)
        for dept in sorted(snapshot['departments'].keys()):
            d = snapshot['departments'][dept]
            m = d.get('metrics') or {}
            sm = m.get('system_mapping', {}) if m else {}
            print(f'{dept:<10} {d["stage"]:<10} {m.get("L1_count",0):>3} {m.get("L2_count",0):>3} '
                  f'{m.get("L3_count",0):>4} {m.get("A1_count",0):>4} '
                  f'{sm.get("ERP",0):>4} {sm.get("OA",0):>4} {sm.get("MES",0):>4} {sm.get("PLM",0):>4}')
        s = snapshot['summary']
        print('-' * 70)
        print(f'{"TOTAL":<10} {"":<10} {"":>3} {"":>3} {s["total_L3"]:>4} {s["total_A1"]:>4}')
