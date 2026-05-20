"""
Merge norms-formatter output files by document code.
Phase 1: Remove duplicate "English Version (unmatched sections)" from main docs.
Phase 2: Embed tables content, append FM forms, write one merged file per document code.
"""

import re
from pathlib import Path
from collections import defaultdict

SRC = Path(r"E:\CA001\Infomat\docs\norms")
OUT = Path(r"E:\CA001\Infomat\docs\norms\merged")
OUT.mkdir(parents=True, exist_ok=True)

# ── Phase 1: Scan & group files ──────────────────────────────────────────

all_files = list(SRC.glob("*.md"))
all_files = [f for f in all_files if f.name != "_report.md"]

groups = defaultdict(lambda: {"main": None, "tables": None, "fm": [], "attachments": []})

for fp in all_files:
    name = fp.stem
    parts = name.split("_")
    code = None
    code_idx = None
    for i, p in enumerate(parts):
        if re.match(r'^GL[A-Z]\d', p):
            code = p
            code_idx = i
            break
    if not code:
        print(f"WARN: cannot extract code from {fp.name}")
        continue

    rest = "_".join(parts[i+1:]) if code_idx is not None else name

    if "_tables" in rest:
        groups[code]["tables"] = fp
    elif re.search(r'FM[\s_]*\d', rest):
        groups[code]["fm"].append(fp)
    elif "附件" in rest:
        groups[code]["attachments"].append(fp)
    else:
        groups[code]["main"] = fp

print(f"Found {len(groups)} document groups")

# ── Phase 2: Helper functions ────────────────────────────────────────────

def remove_english_section(text: str) -> str:
    """Remove the standalone 'English Version (unmatched sections)' block."""
    pattern = r'\n*---\n+\n*## English Version \(unmatched sections\).*$'
    text = re.sub(pattern, '', text, flags=re.DOTALL)
    pattern2 = r'\n+## English Version \(unmatched sections\).*$'
    text = re.sub(pattern2, '', text, flags=re.DOTALL)
    return text.rstrip() + '\n'


def normalize_title(s: str) -> str:
    """Collapse all whitespace to single spaces for comparison."""
    return ' '.join(s.split())


def parse_tables_file(content: str) -> list:
    """Parse a _tables.md file into a list of (title, block) pairs.
    Uses list instead of dict to handle duplicate section headers.
    Title may span multiple lines after ## until the > marker or blank line."""
    tables = []
    blocks = content.split('\n---\n')
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        # Title: from ## to the > 位置 line (or end of block)
        gt_pos = block.find('\n>')
        title_section = block[:gt_pos] if gt_pos >= 0 else block
        title_match = re.match(r'## (.+)', title_section, re.DOTALL)
        if title_match:
            title = title_match.group(1).strip()
            tables.append((normalize_title(title), block))
    return tables


def find_table_block(tables: list, ref_title: str) -> str | None:
    """Find a table block by reference title.
    Tries: exact match -> prefix match -> substring match -> numeric prefix."""
    ref_norm = normalize_title(ref_title)

    # 1) Exact normalized match
    for t_norm, block in tables:
        if t_norm == ref_norm:
            return block

    # 2) ref_title is a prefix of the section header (e.g. "11 SAMC" matches "11 SAMC ...")
    for t_norm, block in tables:
        if t_norm.startswith(ref_norm):
            return block

    # 3) Section header contains ref_title
    for t_norm, block in tables:
        if ref_norm in t_norm:
            return block

    # 4) ref_title is a numeric prefix like "11.1", "8", "7 BF", "04-58.1"
    ref_prefix = ref_norm.rstrip('.').strip()
    for t_norm, block in tables:
        if t_norm.startswith(ref_prefix):
            return block

    return None


def embed_tables(main_text: str, tables_content: str) -> str:
    """Replace table reference links with actual table content.
    Handles multiline references (DOTALL mode)."""
    if not tables_content:
        return main_text

    tables = parse_tables_file(tables_content)

    # Pattern matches: > 表格参见：[title](filename.md)
    # With DOTALL, . matches newlines too — so multiline titles work.
    ref_pattern = re.compile(
        r'> 表格参见：\[(.*?)\]\((.*?\.md)\)',
        re.DOTALL
    )

    def replace_ref(match):
        ref_title = match.group(1).strip()
        block = find_table_block(tables, ref_title)
        if block is not None:
            return block
        # If no match found, keep original reference
        return match.group(0)

    return ref_pattern.sub(replace_ref, main_text)


def format_fm_appendix(fm_path: Path) -> str:
    """Format an FM form file as an appendix section."""
    content = fm_path.read_text(encoding='utf-8').strip()
    fm_name = fm_path.stem
    fm_match = re.search(r'(FM\s*\d+[\-\w]*)', fm_name)
    fm_id = fm_match.group(1) if fm_match else fm_name
    return f"\n\n## 附录：{fm_id}\n\n{content}\n"


# ── Phase 3: Process each group ──────────────────────────────────────────

stats = {"merged": 0, "skipped_no_main": 0, "no_tables": 0, "refs_remaining": 0}

for code, files in sorted(groups.items()):
    main_fp = files["main"]
    tables_fp = files["tables"]
    fm_fps = sorted(files["fm"], key=lambda x: x.name)
    attachment_fps = files["attachments"]

    if not main_fp:
        print(f"SKIP {code}: no main document found")
        stats["skipped_no_main"] += 1
        continue

    print(f"Processing {code}...", end=" ")
    main_text = main_fp.read_text(encoding='utf-8')

    # Step 1: Remove duplicate English section
    main_text = remove_english_section(main_text)

    # Step 2: Embed tables
    if tables_fp:
        tables_text = tables_fp.read_text(encoding='utf-8')
        main_text = embed_tables(main_text, tables_text)
    else:
        stats["no_tables"] += 1

    # Count remaining table references
    remaining = len(re.findall(r'> 表格参见：\[', main_text))
    if remaining > 0:
        stats["refs_remaining"] += remaining
        print(f"{remaining} unresolved refs", end=" ")

    # Step 3: Append FM forms as appendices
    for fm_fp in fm_fps:
        main_text += format_fm_appendix(fm_fp)

    # Step 4: Append other attachments
    for att_fp in sorted(attachment_fps, key=lambda x: x.name):
        att_content = att_fp.read_text(encoding='utf-8').strip()
        main_text += f"\n\n## 附件：{att_fp.stem}\n\n{att_content}\n"

    # Step 5: Determine output filename
    main_stem = main_fp.stem
    main_parts = main_stem.split("_")
    code_idx = None
    for i, p in enumerate(main_parts):
        if p == code:
            code_idx = i
            break
    if code_idx is not None and code_idx > 0:
        process = main_parts[0]
        if code_idx + 1 < len(main_parts):
            doc_name_parts = main_parts[code_idx+1:]
            # Last part might be a single-letter revision, skip it
            if len(doc_name_parts) > 1 and len(doc_name_parts[-1]) == 1 and doc_name_parts[-1].isascii() and doc_name_parts[-1].isalpha():
                doc_name_parts = doc_name_parts[:-1]
            doc_name = "_".join(doc_name_parts)
        else:
            doc_name = ""
        out_name = f"{process}_{code}_{doc_name}_merged.md"
    else:
        out_name = f"{code}_merged.md"

    out_path = OUT / out_name
    out_path.write_text(main_text, encoding='utf-8')
    print("-> done")
    stats["merged"] += 1

# ── Phase 4: Report ──────────────────────────────────────────────────────

print(f"\n{'='*60}")
print(f"Merge complete.")
print(f"  Merged files:     {stats['merged']}")
print(f"  Skipped (no main): {stats['skipped_no_main']}")
print(f"  Without tables:   {stats['no_tables']}")
print(f"  Unresolved refs:  {stats['refs_remaining']}")
print(f"  Output: {OUT}")
