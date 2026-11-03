#!/usr/bin/env python3
"""Independent native PDF proof metrics, with embedded-font outline ink bounds."""
from pathlib import Path
import hashlib
import io
import json
import math
import zipfile
import fitz
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from lxml import etree as E

HERE = Path(__file__).resolve().parent
RUN = HERE.parent / "lead/runs/2026-10-20T12-02-35-644Z-8d230e18"
PDF = RUN / "native/argon-high-feedback-r4-native.pdf"
HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
SELECTED = {"1800000037": (3240, 4264), "1800000044": (3240, 4264),
            "1800000066": (2700, 3800), "1800000067": (2700, 3800),
            "1800000071": (2700, 3800), "1800000072": (2700, 3800),
            "1800000074": (7560, 8200)}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def union(boxes):
    return [min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes)]


def main():
    plan_path = HERE.parent / "parent-verification/proof-inline-width-plan5.json"
    contract_path = HERE.parent / "lead/current-contract-reference.r5.json"
    plan = json.loads(plan_path.read_text())
    assert set(plan["finiteArgonControlIds"]) == set(SELECTED)
    layout_report = json.loads((RUN / "argon-high-layout.json").read_text())
    table_id = layout_report["proofMapping"]["tableId"]
    layout_hwpx = RUN / "argon-high-layout.hwpx"
    rendered_hwpx = RUN / "argon-high-body-square.hwpx"
    with zipfile.ZipFile(layout_hwpx) as z:
        section = E.fromstring(z.read("Contents/section0.xml"))
    table = next(t for t in section.iter(HP + "tbl") if t.get("id") == table_id)
    controls = list(table.iter(HP + "equation"))
    with zipfile.ZipFile(rendered_hwpx) as z:
        rendered = E.fromstring(z.read("Contents/section0.xml"))
    rendered_controls = {e.get("id"): e for e in rendered.iter(HP + "equation")}
    document = fitz.open(PDF)
    page = document[47]
    fonts = {}
    for xref, *_ in page.get_fonts(full=True):
        name, ext, typ, data = document.extract_font(xref)
        fonts[name.split("+")[-1]] = TTFont(io.BytesIO(data))
    trace = []
    for span in page.get_texttrace():
        if not 100 < span["bbox"][1] < 490:
            continue
        font = fonts[span["font"]]
        glyphs = font.getGlyphSet()
        for char in span["chars"]:
            if chr(char[0]).isspace():
                continue
            pen = BoundsPen(glyphs)
            glyphs[font.getGlyphOrder()[char[1]]].draw(pen)
            if pen.bounds is None:
                continue
            x0, y0, x1, y1 = pen.bounds
            scale = span["size"] / font["head"].unitsPerEm
            ox, oy = char[2]
            trace.append({"font": span["font"], "char": chr(char[0]), "origin": [ox, oy],
                          "glyphId": char[1], "inkBBox": [ox + x0 * scale, oy - y1 * scale,
                                                           ox + x1 * scale, oy - y0 * scale]})
    def char_ink(span, char):
        candidates = [t for t in trace if t["font"] == span["font"] and t["char"] == char["c"]]
        match = min(candidates, key=lambda t: abs(t["origin"][0] - char["origin"][0]) + abs(t["origin"][1] - char["origin"][1]))
        assert abs(match["origin"][0] - char["origin"][0]) + abs(match["origin"][1] - char["origin"][1]) < .03
        return match["inkBBox"]
    spans = [s for b in page.get_text("rawdict")["blocks"] if "lines" in b
             for line in b["lines"] for s in line["spans"] if 100 < s["bbox"][1] < 490]
    groups = []
    for i, span in enumerate(spans):
        if span["font"] not in ("HyhwpEQ", "Haansoft Batang"):
            continue
        if groups and groups[-1]["lastSpan"] == i - 1 and abs(groups[-1]["spans"][-1]["origin"][1] - span["origin"][1]) < 5:
            groups[-1]["spans"].append(span)
            groups[-1]["lastSpan"] = i
        else:
            groups.append({"spans": [span], "lastSpan": i})
    assert len(groups) == len(controls) == 11
    rows = []
    for control, group in zip(controls, groups):
        cid = control.get("id")
        size = control.find(HP + "sz")
        rendered_control = rendered_controls[cid]
        assert dict(size.attrib) == dict(rendered_control.find(HP + "sz").attrib)
        chars = [c for s in group["spans"] for c in s["chars"] if not c["c"].isspace()]
        box = union([c["bbox"] for c in chars])
        ink = union([char_ink(s, c) for s in group["spans"] for c in s["chars"] if not c["c"].isspace()])
        # Read the following source text in this exact native paragraph; do not
        # mistake a later row/cell or the next equation for a following glyph.
        paragraph = control.getparent().getparent()
        following = []
        seen = False
        for run in paragraph.findall(HP + "run"):
            for child in run:
                if child is control:
                    seen = True
                elif seen:
                    if child.tag == HP + "equation":
                        seen = False
                        break
                    if child.tag == HP + "t":
                        following.append(child.text or "")
            if following or (not seen and following):
                break
        following_text = "".join(following)
        row = {"controlId": cid, "section": "Contents/section0.xml", "paragraphId": paragraph.get("id"),
               "sourceBinding": layout_report["proofMapping"]["sourceBinding"],
               "bScript": control.findtext(HP + "script"), "renderedScript": rendered_control.findtext(HP + "script"),
               "pdfMathText": "".join(c["c"] for c in chars), "storedWidthHwp": int(size.get("width")),
               "heightHwp": int(size.get("height")), "font": control.get("font"),
               "mathNonspaceGlyphBBoxPt": box, "mathOutlineInkBBoxPt": ink,
               "followingSourceText": following_text, "selectedForRepair": cid in SELECTED}
        if following_text:
            following_span = spans[group["lastSpan"] + 1]
            actual = "".join(c["c"] for c in following_span["chars"])
            assert actual == following_text, (cid, actual, following_text)
            nonspace = [c for c in following_span["chars"] if not c["c"].isspace()]
            following_box = union([c["bbox"] for c in nonspace])
            following_ink = union([char_ink(following_span, c) for c in nonspace])
            row.update({"followingPdfSpanText": actual, "followingWholeSpanBBoxPt": list(following_span["bbox"]),
                        "followingNonspaceGlyphBBoxPt": following_box, "followingOutlineInkBBoxPt": following_ink,
                        "nonspaceGlyphBBoxGapPt": following_box[0] - box[2],
                        "outlineInkBBoxGapPt": following_ink[0] - ink[2],
                        "glyphBBoxOverlapConfirmed": following_box[0] < box[2],
                        "outlineInkBBoxOverlapConfirmed": following_ink[0] < ink[2]})
        else:
            row.update({"nonspaceGlyphBBoxGapPt": None, "outlineInkBBoxGapPt": None,
                        "glyphBBoxOverlapConfirmed": False, "outlineInkBBoxOverlapConfirmed": False})
        if cid in SELECTED:
            old, new = SELECTED[cid]
            assert row["storedWidthHwp"] == old
            assert row["glyphBBoxOverlapConfirmed"]
            predicted = row["nonspaceGlyphBBoxGapPt"] + (new - old) / 100
            assert predicted >= 2
            row.update({"oldWidthHwp": old, "newWidthHwp": new, "predictedFollowingNonspaceGapPt": predicted,
                        "qualification": "Confirmed nonspace glyph-bbox collision; finite Plan5 width repair. Final native gap must be independently remeasured."})
        rows.append(row)
    assert {r["controlId"] for r in rows if r["glyphBBoxOverlapConfirmed"]} == set(SELECTED)
    middle = next(r for r in rows if r["controlId"] == "1800000060")
    assert middle["nonspaceGlyphBBoxGapPt"] > 3 and not middle["selectedForRepair"]
    receipt = {"schema": "math-editing.native-layout-proof-inline-measurement.v1", "moduleRevision": 5,
               "dataset": "argon-high", "pdf": {"path": str(PDF), "sha256": digest(PDF), "pageOneBased": 48},
               "sourceLayout": {"path": str(layout_hwpx), "sha256": digest(layout_hwpx)},
               "renderedSource": {"path": str(rendered_hwpx), "sha256": digest(rendered_hwpx)},
               "sourceReport": {"path": str(RUN / 'argon-high-layout.json'), "sha256": digest(RUN / 'argon-high-layout.json')},
               "authority": {"path": str(plan_path), "sha256": digest(plan_path)},
               "currentContract": {"path": str(contract_path), "sha256": digest(contract_path)},
               "proofTableId": table_id, "method": "PyMuPDF rawdict nonspace character bboxes; actual embedded TTF glyph outline BoundsPen transformed from texttrace origins and font size; no COM",
               "rows": rows, "allProofInlineControlsMeasured": 11,
               "finiteCollisionControlIds": sorted(SELECTED), "excludedControlIds": plan["excludedControls"],
               "gapDistinction": "Seven occupied nonspace glyph bboxes overlap. Six outline ink bboxes overlap; final control74 has +0.463pt outline ink gap but -1.456pt occupied glyph gap. Control60 opening parenthesis has positive nonspace gap; leading whitespace is excluded.",
               "minimumRequiredFinalNativeGapPt": 2, "newNativeRender": "pending Lead; predicted gaps are placement arithmetic only", "acceptanceDecision": None}
    target = HERE / "proof-inline-measurement.r5.json"
    target.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    width_map = {"schema": "math-editing.native-layout-finite-width-map.v1", "moduleRevision": 5,
                 "dataset": "argon-high", "sceneId": "cr04-proof-frame", "sourcePlacementId": "argon-high-24",
                 "measurement": {"path": str(target), "sha256": digest(target)},
                 "authority": receipt["authority"], "minimumRequiredFinalNativeGapPt": 2,
                 "controls": [{k: row[k] for k in ("controlId", "bScript", "oldWidthHwp", "newWidthHwp", "heightHwp", "nonspaceGlyphBBoxGapPt", "outlineInkBBoxGapPt", "predictedFollowingNonspaceGapPt")}
                              for row in rows if row["selectedForRepair"]], "excludedControlIds": plan["excludedControls"], "acceptanceDecision": None}
    (HERE / "proof-inline-width-map.r5.json").write_text(json.dumps(width_map, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"measured": 11, "finiteCollisions": 7, "middle60NonspaceGapPt": middle["nonspaceGlyphBBoxGapPt"], "measurement": str(target)}))


if __name__ == "__main__":
    main()
