"""Native HWPX adapter. Measurement is read-only; emission uses the Bun layout plan.

No source interpretation, model calls, human approval or target-native qualification.
"""
import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

from hwpx import HwpxDocument
from hwpx.equation import estimate_equation_size, latex_to_eqedit
from PIL import Image, ImageFont

HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"


def need(condition, code):
    if not condition:
        raise ValueError(f"production_{code}@packages/native-production/compose.py:1")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def check_pins(batch):
    for pin in batch["inputPins"]:
        need(digest(pin["path"]) == pin["sha256"], "input_changed")


def group_decorated_bases(script):
    """Group a complete accent operand before external scripts, respecting quotes/braces.

    Internal powers and already-grouped bases remain unchanged. Work on token
    positions rather than replacing payload strings or stripping accepted rm forms.
    """
    tokens = list(re.finditer(r'"(?:\\.|[^"\\])*"|[A-Za-z]+|[^\s]', script))
    insertions = []
    for i, token in enumerate(tokens):
        if token[0] not in ("overline", "bar", "arch", "vec", "hat") or i+1 >= len(tokens) or tokens[i+1][0] != "{":
            continue
        depth = 0
        for end in range(i+1, len(tokens)):
            depth += (tokens[end][0] == "{") - (tokens[end][0] == "}")
            if depth == 0:
                if end+1 < len(tokens) and tokens[end+1][0] in ("^", "_"):
                    insertions.extend([(token.start(), "{"), (tokens[end].end(), "}")])
                break
    for offset, value in sorted(insertions, reverse=True):
        script = script[:offset] + value + script[offset:]
    return script


def finish_script(script):
    """Preserve valid syntax/quotes; lexical command separators are not display spaces."""
    need(isinstance(script, str) and script.strip(), "empty_equation")
    # Uppercase admitted inequality commands only outside quoted literal payloads.
    script = re.sub(r'"(?:\\.|[^"\\])*"|\b(?:leq|geq|neq)\b',
                    lambda m: m[0] if m[0].startswith('"') else m[0].upper(), script)
    masked = re.sub(r'"(?:\\.|[^"\\])*"', '""', script)
    need(not re.search(r"\barc\b", masked), "unsupported_arc_use_arch")
    level = 0
    for char in masked:
        level += (char == "{") - (char == "}")
        need(level >= 0, "unbalanced_equation")
    need(level == 0 and masked.count('"') % 2 == 0, "unbalanced_equation")
    script = group_decorated_bases(script).rstrip()
    return script if script.endswith("~") else script + "~"


def check_output(batch, output):
    out, root = Path(output), Path(batch["runRoot"]).resolve()
    need(out.resolve().is_relative_to(root) and out.resolve() != root, "output_outside_root")
    need(not out.exists() and not out.is_symlink(), "output_exists_use_new_version")
    return out


def validate_settings(s):
    for key in ("profile", "paperMm", "pageMarginsMm", "contentWidth", "font", "equationBaseUnit", "lineSpacingPercent", "paragraphAfter", "blockGap", "questionGap", "measurementSafetyWidth", "inlineEquationMargin", "attachedPostpositions", "questionLabelSuffix", "scorePrefix", "scoreSuffix", "choiceLabelPrefix", "choiceLabelSuffix", "box", "choice"):
        need(key in s, "setting_missing:" + key)
    need(s.get("profile") == "reference-single-column", "unsupported_profile")
    positive = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x > 0
    nonnegative = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0
    need(len(s["paperMm"]) == 2 and all(map(positive, s["paperMm"])), "paper")
    need(all(nonnegative(s["pageMarginsMm"][k]) for k in ("left", "right", "top", "bottom")), "page_margins")
    for k in ("contentWidth", "equationBaseUnit", "lineSpacingPercent"):
        need(positive(s[k]), "setting_" + k)
    for k in ("contentWidth", "equationBaseUnit"):
        need(isinstance(s[k], int) and not isinstance(s[k], bool), "integer_" + k)
    for k in ("paragraphAfter", "blockGap", "questionGap", "measurementSafetyWidth", "inlineEquationMargin"):
        need(nonnegative(s[k]), "setting_" + k)
    need(s["pageMarginsMm"]["top"] + s["pageMarginsMm"]["bottom"] < s["paperMm"][1], "page_height")
    need(s["contentWidth"] <= round((s["paperMm"][0] - s["pageMarginsMm"]["left"] - s["pageMarginsMm"]["right"]) * 7200 / 25.4), "page_width")
    need(positive(s["font"]["points"]) and isinstance(s["font"]["name"], str) and s["font"]["name"], "font")
    need(all(isinstance(s[k], str) for k in ("questionLabelSuffix", "scorePrefix", "scoreSuffix", "choiceLabelPrefix", "choiceLabelSuffix")), "label_settings")
    need(isinstance(s["attachedPostpositions"], list) and all(isinstance(x, str) for x in s["attachedPostpositions"]), "postpositions")
    for kind in ("box", "choice"):
        need(isinstance(s[kind]["labelCellWidth"], int) and not isinstance(s[kind]["labelCellWidth"], bool) and s[kind]["labelCellWidth"] > 0, kind + "_label_width")
        need(all(isinstance(s[kind]["cellPadding"][k], int) and not isinstance(s[kind]["cellPadding"][k], bool) and s[kind]["cellPadding"][k] >= 0 for k in ("left", "right", "top", "bottom")), kind + "_padding")


def measure(batch):
    need(batch["schema"] == "problem-edit.native-batch.v1" and not batch["holds"], "source_interview_required")
    check_pins(batch)
    s = batch["settings"]
    validate_settings(s)
    font = ImageFont.truetype(s["font"]["path"], round(s["font"]["points"] * 100))
    templates = {}
    for t in batch["templates"]:
        raw = t["override"]["script"] if "override" in t else latex_to_eqedit(t["converterLatex"])
        script = finish_script(raw)
        width, height = estimate_equation_size(script, base_unit=s["equationBaseUnit"])
        templates[t["id"]] = {**t, "script": script, "scriptBeforeTerminalSpacing": raw,
                              "width": width, "height": height, "nativeHancomStatus": "unknown"}
    figures = {}
    for f in batch["figures"]:
        svg = ET.fromstring(Path(f["svg"]["path"]).read_bytes())
        need(svg.tag == "{http://www.w3.org/2000/svg}svg", "figure_svg")
        need(isinstance(f["width"], int) and f["width"] > 0 and f["width"] <= s["contentWidth"], "figure_width")
        with Image.open(f["png"]["path"]) as im:
            im = im.convert("RGB")
            need(im.width > 8 and im.height > 8, "figure_canvas")
            # The domain contract requires four entirely white pixels inside every edge.
            for box in [(0, 0, im.width, 4), (0, im.height-4, im.width, im.height), (0, 0, 4, im.height), (im.width-4, 0, im.width, im.height)]:
                need(im.crop(box).getextrema() == ((255, 255),) * 3, "figure_white_border")
            figures[f["id"]] = {**f, "height": math.ceil(f["width"] * im.height / im.width)}
    def paragraph(atoms, location):
        result = []
        for a in atoms:
            if a["kind"] == "text":
                for part in re.findall(r"\S+|\s+", a["text"]):
                    result.append({"kind": "text", "text": part,
                                   "width": math.ceil(font.getlength(part)) + s["measurementSafetyWidth"],
                                   "height": s["font"]["points"] * 100,
                                   "breakBefore": part[0] not in ".,)]}?!:;>%" and part not in s["attachedPostpositions"],
                                   "breakAfter": part[-1] not in "([{<"})
            else:
                e = templates[a["templateId"]]
                result.append({**a, "width": e["width"] + s["inlineEquationMargin"], "height": e["height"], "breakBefore": True, "breakAfter": True})
        need(result, "empty_paragraph:" + location)
        return {"kind": "paragraph", "location": location, "atoms": [{**a, "key": f"a{i}"} for i, a in enumerate(result)]}
    text = lambda value: [{"kind": "text", "text": value}]
    questions = []
    for q in batch["packets"]:
        blocks = []
        last = max(b["index"] for b in q["blocks"] if b["kind"] == "paragraph")
        for bi, b in enumerate(q["blocks"]):
            loc = f'{q["questionId"]}/block-{bi}'
            if b["kind"] == "paragraph":
                prefix = text(q["printedLabel"] + s["questionLabelSuffix"]) if b["index"] == 0 else []
                suffix = text(s["scorePrefix"] + format(q["score"], "g") + s["scoreSuffix"]) if b["index"] == last and q["score"] is not None else []
                blocks.append(paragraph(prefix + b["atoms"] + suffix, loc))
            elif b["kind"] in ("statement-box", "box"):
                blocks.append({"kind": b["kind"], "id": b["id"], "location": loc,
                               "title": paragraph(b["titleAtoms"], loc + "/title") if b["titleAtoms"] else None,
                               "items": [{"label": paragraph(text(i["label"]), loc + f"/item-{n}/label") if i["label"] is not None else None,
                                          "content": paragraph(i["atoms"], loc + f"/item-{n}/content")} for n, i in enumerate(b["items"])]})
            elif b["kind"] == "figure":
                blocks.append({"kind": "figure", **figures[b["id"]], "location": loc})
            elif b["kind"] == "choices":
                blocks.append({"kind": "choices", "location": loc,
                               "items": [{"number": i["number"],
                                          "label": paragraph(text(s["choiceLabelPrefix"] + str(i["number"]) + s["choiceLabelSuffix"]), loc + f'/choice-{i["number"]}/label'),
                                          "content": paragraph(i["atoms"], loc + f'/choice-{i["number"]}/content')} for i in b["items"]]})
        questions.append({"questionId": q["questionId"], "blocks": blocks})
    return {**batch, "questions": questions, "equations": list(templates.values())}


def emit(plan, output):
    need(plan["schema"] == "problem-edit.native-layout.v1" and not plan["holds"], "layout_schema")
    check_pins(plan)
    out = check_output(plan, output)
    s = plan["settings"]
    validate_settings(s)
    doc = HwpxDocument.new()
    doc.page.setup(width_mm=s["paperMm"][0], height_mm=s["paperMm"][1], margins_mm=s["pageMarginsMm"])
    header = doc._root.headers[0]
    styles, borders = {}, {}
    equations = {e["id"]: e for e in plan["equations"]}
    emissions, tables, images = [], [], []

    def style(kind="body", alignment="LEFT", keep=True):
        key = (kind, alignment, keep)
        if key not in styles:
            styles[key] = header.ensure_paragraph_format(alignment=alignment, line_spacing_percent=100 if kind == "choice" else s["lineSpacingPercent"],
                margins={"prev": 0, "next": 0 if kind == "choice" else s["paragraphAfter"], "left": 0, "right": 0, "intent": 0},
                break_setting={"keep_lines": True, "keep_with_next": keep})
        return styles[key]

    def paragraph(parent=None, kind="body", alignment="LEFT", keep=True):
        p = doc.add_paragraph("", include_run=False) if parent is None else parent.add_paragraph("")
        p.text = ""
        p.para_pr_id_ref = style(kind, alignment, keep)
        return p

    def lines(spec, parent=None, kind="body", alignment="LEFT", first=None):
        amap = {a["key"]: a for a in spec["atoms"]}
        for n, keys in enumerate(spec["lines"]):
            p = first if first is not None and n == 0 else paragraph(parent, kind, alignment, parent is None)
            p.text = ""; p.para_pr_id_ref = style(kind, alignment, parent is None)
            for key in keys:
                a = amap[key]
                if a["kind"] == "text":
                    p.add_run(a["text"], font=s["font"]["name"], size=s["font"]["points"])
                else:
                    e = equations[a["templateId"]]
                    need(e["script"].endswith("~"), "missing_terminal_space")
                    o = doc.shapes.add_equation(e["script"], paragraph=p, base_unit=s["equationBaseUnit"], size=(e["width"], e["height"]))
                    emissions.append({"occurrenceId": a["occurrenceId"], "templateId": a["templateId"], "objectId": o.element.get("id"), "script": e["script"]})

    def cell(table, row, col, width, height, pad, sides):
        c = table.cell(row, col)
        c.set_margins(**pad); c.set_size(width=width, height=math.ceil(height))
        c.element.find(HP + "subList").set("vertAlign", "CENTER")
        # Cache each outer-edge pattern. Internal row/label dividers stay invisible.
        key = tuple(sides)
        if key not in borders:
            borders[key] = header.ensure_border_fill(active_borders=list(sides), border_type="SOLID", border_color="#000000")
        c.element.set("borderFillIDRef", borders[key])
        return c

    for q in plan["questions"]:
        start = len(doc.sections[0].element)
        for b in q["blocks"]:
            if b["kind"] == "paragraph":
                lines(b)
            elif b["kind"] in ("box", "statement-box"):
                rows = len(b["rowHeights"]); columns = 2 if b["labelWidth"] else 1
                anchor = paragraph(); t = anchor.add_table(rows, columns, width=s["contentWidth"], height=math.ceil(b["height"]))
                t.element.set("pageBreak", "NONE")
                widths = [b["labelWidth"], s["contentWidth"]-b["labelWidth"]] if columns == 2 else [s["contentWidth"]]
                t.set_column_widths(widths)
                title = bool(b["title"])
                for ri in range(rows):
                    item = None if title and ri == 0 else b["items"][ri-int(title)]
                    merged = columns == 2 and (item is None or item["label"] is None)
                    if merged: t.merge_cells(ri, 0, ri, 1)
                    for ci in range(1 if merged else columns):
                        sides = (["left"] if ci == 0 else []) + (["right"] if merged or ci == columns-1 else []) + (["top"] if ri == 0 else []) + (["bottom"] if ri == rows-1 else [])
                        c = cell(t, ri, ci, s["contentWidth"] if merged else widths[ci], b["rowHeights"][ri], s["box"]["cellPadding"], sides)
                        spec = b["title"] if item is None else item["label"] if columns == 2 and not merged and ci == 0 else item["content"]
                        lines(spec, c, alignment="CENTER" if item is None else "LEFT", first=c.paragraphs[0])
                tables.append({"kind": b["kind"], "location": b["location"], "objectId": t.element.get("id"), "rows": rows, "columns": columns})
            elif b["kind"] == "choices":
                grid = b["grid"]
                for row in grid["rows"]:
                    cols = len(row["numbers"])*2
                    t = paragraph().add_table(1, cols, width=(grid["labelCellWidth"]+grid["contentCellWidth"])*len(row["numbers"]), height=math.ceil(row["height"]))
                    t.element.set("pageBreak", "NONE"); t.set_column_widths([grid["labelCellWidth"], grid["contentCellWidth"]]*len(row["numbers"]))
                    for ci, number in enumerate(row["numbers"]):
                        item = next(i for i in b["items"] if i["number"] == number)
                        for j, (name, width) in enumerate([("label",grid["labelCellWidth"]),("content",grid["contentCellWidth"])]):
                            c = cell(t, 0, ci*2+j, width, row["height"], s["choice"]["cellPadding"], [])
                            lines(item[name], c, "choice", first=c.paragraphs[0])
                    tables.append({"kind": "choices", "location": b["location"], "objectId": t.element.get("id"), "rows": 1, "columns": cols})
            elif b["kind"] == "figure":
                bid = doc.media.add_image(Path(b["png"]["path"]).read_bytes(), "png")
                p = paragraph(alignment="CENTER")
                p.add_picture(str(bid), width=b["width"], height=b["height"], treat_as_char=True)
                images.append({"location": b["location"], "binaryItemIDRef": str(bid), "sha256": b["png"]["sha256"]})
        nodes = list(doc.sections[0].element)[start:]
        need(nodes, "empty_question")
        if q["pageBreak"]: nodes[0].set("pageBreak", "1")
        nodes[-1].set("paraPrIDRef", style(keep=False))
    # No write occurs until all admission, measurement, fitting and object construction pass.
    out.mkdir(parents=True, exist_ok=False)
    document = out / "document.hwpx"
    doc.save_to_path(document)
    record = {"schema": "problem-edit.native-composition.v1", "documentSha256": digest(document), "sourceSha256": plan["sourceSha256"], "questions": [q["questionId"] for q in plan["questions"]],
              "equations": emissions, "tables": tables, "images": images, "inputPins": plan["inputPins"], "nativeHancomStatus": "unknown", "humanAcceptance": "not-granted", "independentRenderRequired": True}
    def save(name, value):
        with (out / name).open("x") as f: json.dump(value, f, ensure_ascii=False, indent=2); f.write("\n")
    save("composition.json", record); save("layout.json", plan); save("unit-seeds.json", plan["unitSeeds"])
    (out / "packets").mkdir()
    for p in plan["packets"]: save("packets/" + p["questionId"] + ".json", p)
    from inspect_saved import inspect_saved
    checked = inspect_saved(document, record)
    save("structural-checks.json", checked)
    check_pins(plan)
    return {"output": str(out), "documentSha256": digest(document), "questions": len(plan["questions"]), "equationOccurrences": len(emissions), "nativeTables": len(tables), "plannedPages": plan["plannedPages"], "structuralChecks": len(checked["checks"]), "nativeHancomStatus": "unknown", "humanAcceptance": "not-granted"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", required=True, choices=["measure", "emit"])
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    try:
        value = json.load(sys.stdin)
        check_output(value, args.out)
        print(json.dumps(measure(value) if args.phase == "measure" else emit(value, args.out), ensure_ascii=False))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
