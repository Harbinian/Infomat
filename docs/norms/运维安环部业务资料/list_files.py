import os, sys

# Force UTF-8
sys.stdout.reconfigure(encoding='utf-8')

base = r"E:\CA001\Infomat\docs\norms\运维安环部业务资料"

# List all docx files
all_files = [f for f in os.listdir(base) if f.endswith('.docx') and not f.startswith('~$') and not f.startswith('附件') and not f.startswith('G-')]

# Print raw listing
print("=== RAW DIRECTORY LISTING ===")
for f in sorted(all_files):
    print(repr(f))

# Group by keywords
keywords = [
    ("申报", "P1_申报"),
    ("警示", "P1_警示"),
    ("告知", "P1_警示"),
    ("防护设施", "P2_防护设施"),
    ("劳动防护", "P2_劳防用品"),
    ("监测及评价", "P3_监测评价"),
    ("健康监护", "P3_健康监护"),
    ("健康档案", "P3_健康档案"),
    ("噪声聋", "P3_噪声聋"),
    ("目标指标", "P4_目标指标"),
    ("培训教育", "P4_培训教育"),
    ("风险管控", "P4_风险管控"),
    ("应急准备", "P4_应急准备"),
    ("监视与测量", "P4_监视测量"),
    ("安全改进", "P4_改进"),
    ("卫生管理规则", "REF_规则"),
    ("事故应急", "REF_事故应急"),
]

matches = {}
for f in all_files:
    matched = False
    for kw, tag in keywords:
        if kw in f:
            matches[tag] = f
            matched = True
            break
    if not matched:
        print(f"UNMATCHED: {repr(f)}")

print("\n=== MATCHED FILES ===")
for tag in sorted(matches.keys()):
    print(f"  [{tag}] => {matches[tag]}")
