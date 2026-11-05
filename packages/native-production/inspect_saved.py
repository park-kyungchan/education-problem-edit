"""Read saved ZIP/XML independently of python-hwpx; structural coverage only."""
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"


def inspect_saved(document, expected=None):
    checks = []
    def check(name, condition):
        if not condition:
            raise ValueError(f"production_saved_{name}@packages/native-production/inspect_saved.py:1")
        checks.append({"name": name, "status": "passed"})
    with ZipFile(document) as z:
        check("zip_crc", z.testzip() is None)
        sections = [ET.fromstring(z.read(n)) for n in z.namelist() if n.startswith("Contents/section") and n.endswith(".xml")]
        check("sections_present", bool(sections))
        equations = [e for s in sections for e in s.iter(HP+"equation")]
        check("unique_equation_ids", len({e.get("id") for e in equations}) == len(equations))
        for e in equations:
            script = e.findtext(HP+"script") or ""
            check("terminal_display_space_"+e.get("id"), script.endswith("`"))
            tokens = re.findall(r'"(?:\\.|[^"\\])*"|[A-Za-z]+|[^\s]', script)
            check("single_terminal_half_space_"+e.get("id"), len(tokens)>1 and tokens[-2] not in ("~","`"))
            for i, token in enumerate(tokens):
                if token not in ("overline", "bar", "arch", "vec", "hat") or tokens[i+1:i+2] != ["{"]: continue
                depth = 0
                for end in range(i+1, len(tokens)):
                    depth += (tokens[end] == "{") - (tokens[end] == "}")
                    if depth == 0:
                        check("decorated_external_scope_"+e.get("id")+"_"+str(i), tokens[end+1:end+2] not in (["^"], ["_"]))
                        break
        tables = [t for s in sections for t in s.iter(HP+"tbl")]
        check("unique_table_ids", len({t.get("id") for t in tables}) == len(tables))
        for t in tables:
            check("unsplit_table_"+t.get("id"), t.get("pageBreak") == "NONE")
            for i, c in enumerate(t.iter(HP+"tc")):
                check(f"explicit_cell_margins_{t.get('id')}_{i}", c.get("hasMargin") == "1" and c.find(HP+"cellMargin") is not None)
                size, margin = c.find(HP+"cellSz"), c.find(HP+"cellMargin")
                check(f"positive_cell_size_{t.get('id')}_{i}", size is not None and int(size.get("width")) > 0 and int(size.get("height")) > 0)
                for e in c.iter(HP+"equation"):
                    eqsize = e.find(HP+"sz")
                    check("equation_cell_fit_"+e.get("id"), eqsize is not None and int(eqsize.get("width")) <= int(size.get("width"))-int(margin.get("left"))-int(margin.get("right")) and int(eqsize.get("height")) <= int(size.get("height"))-int(margin.get("top"))-int(margin.get("bottom")))
        if expected:
            check("document_hash", hashlib.sha256(Path(document).read_bytes()).hexdigest() == expected["documentSha256"])
            check("equation_count", len(equations) == len(expected["equations"]))
            check("occurrence_ids", len({e["occurrenceId"] for e in expected["equations"]}) == len(equations))
            for e, exp in zip(equations, expected["equations"]):
                check("script_binding_"+exp["occurrenceId"], e.get("id") == exp["objectId"] and e.findtext(HP+"script") == exp["script"])
                if "limitChecks" in exp:
                    # Independently reopen actual saved group scopes; no authoring imports.
                    tokens = re.findall(r'"(?:\\.|[^"\\])*"|[A-Za-z]+|[^\s]', e.findtext(HP+"script") or "")
                    clauses = []
                    for i, token in enumerate(tokens):
                        if token != "lim": continue
                        check("limit_subscript_"+exp["occurrenceId"]+"_"+str(i), tokens[i+1:i+3] == ["_","{"])
                        depth = 1; end = i+3
                        while end < len(tokens) and depth:
                            depth += (tokens[end] == "{") - (tokens[end] == "}"); end += 1
                        check("limit_balanced_"+exp["occurrenceId"]+"_"+str(i), depth == 0)
                        clauses.append(tokens[i:end])
                    wanted = [re.findall(r'"(?:\\.|[^"\\])*"|[A-Za-z]+|[^\s]', a["eqeditClause"]) for a in exp["limitChecks"]]
                    check("limit_meaning_and_sign_position_"+exp["occurrenceId"],clauses == wanted)
            check("table_count", len(tables) == len(expected["tables"]))
            for t, exp in zip(tables, expected["tables"]):
                check("table_binding_"+exp["objectId"], t.get("id") == exp["objectId"] and int(t.get("rowCnt")) == exp["rows"] and int(t.get("colCnt")) == exp["columns"])
            images = [hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith("BinData/")]
            for exp in expected["images"]: check("embedded_asset_"+exp["location"], exp["sha256"] in images)
    return {"checks": checks, "native": {"status": "unknown"}, "coverage": "Saved object IDs, equation script bindings/terminal spacing, native table dimensions/margins and embedded bytes. Source meaning, visual layout, SVG/PNG semantic parity and target Hancom are not certified."}


if __name__ == "__main__":
    try:
        # A review oracle can use the structural-only default. Operation-specific
        # source/render checks must be supplied separately and pinned by that operation.
        print(json.dumps(inspect_saved(sys.argv[1])))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
