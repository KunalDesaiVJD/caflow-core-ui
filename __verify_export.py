"""
Verify CLAUDE_TEST_EXPORT.xlsx against expected values.
Checks: amounts, dates, placeholder cleanup, annotation removal.
"""
import openpyxl, sys, os

BASE = r"C:\Users\kvdes\OneDrive\Desktop\Audit\caflow-core-ui-main"
TEST = os.path.join(BASE, "Audit Report", "COMPARISION", "PVT LTD", "CLAUDE_TEST_EXPORT.xlsx")
TMPL = os.path.join(BASE, "Audit Report", "COMPARISION", "PVT LTD", "CAFlow_Audit_Pack_Corporate_AY2026-27.xlsx")

print("Loading test export...")
wb = openpyxl.load_workbook(TEST, data_only=True)
print(f"  Sheets: {wb.sheetnames}\n")

PASS = []
FAIL = []

def check(label, actual, expected):
    actual_str = str(actual).strip() if actual is not None else ""
    exp_str = str(expected).strip()
    if actual_str == exp_str:
        PASS.append(f"  PASS  {label}: '{actual_str}'")
    else:
        FAIL.append(f"  FAIL  {label}: got '{actual_str}' expected '{exp_str}'")

def check_not_contains(label, actual, bad_text):
    actual_str = str(actual).strip() if actual is not None else ""
    if bad_text.lower() not in actual_str.lower():
        PASS.append(f"  PASS  {label}: no '{bad_text}' in '{actual_str[:60]}'")
    else:
        FAIL.append(f"  FAIL  {label}: found '{bad_text}' in '{actual_str[:60]}'")

def check_numeric(label, actual, expected_val, tolerance=1):
    try:
        actual_num = float(actual) if actual is not None else 0
        expected_num = float(expected_val)
        if abs(actual_num - expected_num) <= tolerance:
            PASS.append(f"  PASS  {label}: {actual_num}")
        else:
            FAIL.append(f"  FAIL  {label}: got {actual_num} expected {expected_num}")
    except (TypeError, ValueError):
        FAIL.append(f"  FAIL  {label}: got '{actual}' (not numeric) expected {expected_val}")

# ─── BS sheet ───────────────────────────────────────────────────────────────
bs = wb["BS"]
print("=== BS Sheet ===")
# Date headers
check("BS E7 (CY date)", bs["E7"].value, "31st March, 2026")
check("BS F7 (PY date)", bs["F7"].value, "31st March, 2025")
# Share capital CY = 100000, PY = 100000
check_numeric("BS E12 Share Capital CY", bs["E12"].value, 100000)
check_numeric("BS F12 Share Capital PY", bs["F12"].value, 100000)
# Reserves CY ≈ 536933
check_numeric("BS E13 Reserves CY", bs["E13"].value, 536933)
# Note numbers
check_numeric("BS D12 Note No (Share Cap)", bs["D12"].value, 2)
check_numeric("BS D13 Note No (Reserves)", bs["D13"].value, 3)
check_numeric("BS D37 Note No (FA)", bs["D37"].value, 10)
# No AUTO remaining
check_not_contains("BS D12 no AUTO", bs["D12"].value, "AUTO")
check_not_contains("BS E7 no 20XX", bs["E7"].value, "20XX")
check_not_contains("BS F7 no 20XX", bs["F7"].value, "20XX")

# ─── PL sheet ───────────────────────────────────────────────────────────────
pl = wb["PL"]
print("\n=== PL Sheet ===")
# Date headers (G6:G7 merged, H6:H7 merged)
cy_header = pl["G6"].value
py_header = pl["H6"].value
check("PL G6 CY header", cy_header, "For the year ended 31st March, 2026")
check("PL H6 PY header", py_header, "For the year ended 31st March, 2025")
# Revenue from ops
check_numeric("PL G9 Revenue ops CY", pl["G9"].value, 2000000)
check_numeric("PL H9 Revenue ops PY", pl["H9"].value, 1800000)
# Employee expenses
check_numeric("PL G17 Emp exp CY", pl["G17"].value, 800000)
# Check no AUTO
check_not_contains("PL G6 no AUTO", cy_header, "AUTO")
check_not_contains("PL H6 no 20XX", py_header, "20XX")

# ─── 00_Cover sheet ─────────────────────────────────────────────────────────
cover = wb["00_Cover"]
print("\n=== 00_Cover Sheet ===")
# Scan all cells for entity name, AUTO remnants, annotation strings
entity_found = False
auto_found = []
annot_found = []
for row in cover.iter_rows():
    for cell in row:
        v = cell.value
        if v is None:
            continue
        # Handle rich text
        if hasattr(v, 'richText'):
            text = "".join(seg.get('text', '') if isinstance(seg, dict) else getattr(seg, 'text', '') for seg in v.richText)
        else:
            text = str(v)
        if "KWIKTEAM" in text.upper():
            entity_found = True
        if "_ AUTO" in text or (text.strip() == "AUTO"):
            auto_found.append(f"  {cell.coordinate}: '{text[:80]}'")
        for ann in ["Workflow Notes for Lovable", "Mode of valuation", "Old Format"]:
            if ann.lower() in text.lower():
                annot_found.append(f"  {cell.coordinate}: '{text[:80]}'")

if entity_found:
    PASS.append("  PASS  00_Cover: entity name 'KWIKTEAM' found")
else:
    FAIL.append("  FAIL  00_Cover: entity name 'KWIKTEAM' NOT found")
if not auto_found:
    PASS.append("  PASS  00_Cover: no '_ AUTO' remnants")
else:
    FAIL.append(f"  FAIL  00_Cover: _ AUTO remnants found:\n" + "\n".join(auto_found))
if not annot_found:
    PASS.append("  PASS  00_Cover: no annotation strings found")
else:
    FAIL.append(f"  FAIL  00_Cover: annotation strings found:\n" + "\n".join(annot_found))

# ─── Note BS-Liab sheet ─────────────────────────────────────────────────────
nbl = wb["Note BS-Liab"]
print("\n=== Note BS-Liab Sheet ===")
# Check for date in column headers - scan first 10 rows for date strings
cy_date_found = py_date_found = False
bad_date_found = []
for row in nbl.iter_rows(max_row=15):
    for cell in row:
        v = str(cell.value) if cell.value else ""
        if "31st March, 2026" in v:
            cy_date_found = True
        if "31st March, 2025" in v:
            py_date_found = True
        if "31st March, 2026" in v and "31st March, 2025" not in v:
            pass  # fine, CY column
        if "20XX" in v:
            bad_date_found.append(f"  {cell.coordinate}: '{v[:60]}'")
if cy_date_found:
    PASS.append("  PASS  Note BS-Liab: CY date '31st March, 2026' found")
else:
    FAIL.append("  FAIL  Note BS-Liab: CY date '31st March, 2026' NOT found")
if py_date_found:
    PASS.append("  PASS  Note BS-Liab: PY date '31st March, 2025' found")
else:
    FAIL.append("  FAIL  Note BS-Liab: PY date '31st March, 2025' NOT found")
if not bad_date_found:
    PASS.append("  PASS  Note BS-Liab: no '20XX' placeholders remaining")
else:
    FAIL.append("  FAIL  Note BS-Liab: 20XX placeholders remaining:\n" + "\n".join(bad_date_found))

# ─── Scan ALL sheets for _ AUTO and 20XX remnants ───────────────────────────
print("\n=== Global scan: _ AUTO and 20XX remnants across all sheets ===")
global_auto = []
global_20xx = []
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            v = cell.value
            if v is None: continue
            if hasattr(v, 'richText'):
                text = "".join(getattr(seg, 'text', '') for seg in v.richText)
            else:
                text = str(v)
            if "_AUTO" in text.replace(" ", "") or text.strip() == "AUTO":
                global_auto.append(f"  {ws.title}!{cell.coordinate}: '{text[:60]}'")
            if "20XX" in text:
                global_20xx.append(f"  {ws.title}!{cell.coordinate}: '{text[:60]}'")

if not global_auto:
    PASS.append("  PASS  Global: no '_ AUTO' remnants in any sheet")
else:
    FAIL.append(f"  FAIL  Global: _ AUTO remnants in {len(global_auto)} cells:\n" + "\n".join(global_auto[:10]))
if not global_20xx:
    PASS.append("  PASS  Global: no '20XX' placeholders in any sheet")
else:
    FAIL.append(f"  FAIL  Global: 20XX in {len(global_20xx)} cells:\n" + "\n".join(global_20xx[:10]))

# ─── Check red annotation cells are cleared ─────────────────────────────────
print("\n=== Red annotation check ===")
red_cells = []
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            if cell.value is None or str(cell.value).strip() == "":
                continue
            font = cell.font
            if font and font.color:
                argb = str(getattr(font.color, 'argb', '') or getattr(font.color, 'rgb', '') or "").upper()
                if argb.endswith("FF0000") and str(cell.value).strip():
                    red_cells.append(f"  {ws.title}!{cell.coordinate}: '{str(cell.value)[:50]}'")
if not red_cells:
    PASS.append("  PASS  Global: no red-font annotation cells with content")
else:
    FAIL.append(f"  FAIL  Global: {len(red_cells)} red-font cells still have content:\n" + "\n".join(red_cells[:5]))

# ─── Summary ────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print(f"RESULTS: {len(PASS)} passed, {len(FAIL)} failed")
print("="*60)
if PASS:
    print("\nPASSED:")
    for p in PASS: print(p)
if FAIL:
    print("\nFAILED:")
    for f in FAIL: print(f)

print("\n" + "="*60)
sys.exit(0 if not FAIL else 1)
