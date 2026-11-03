"""Bounded, byte-preserving native HWPX equation feedback patcher (stdlib only).

Run A before layout lane B. B may import normalize_script for new native equations.
Only script text plus the exactly bound GPT Q11 paragraph/note may change.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
import zipfile

HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
NS = {"hp": HP}
DATASETS = ("gpt-6.1-sol-ultra", "argon-high")
OLD_NOTE = "mc11-choice3 [ambiguous] Choice ③ numeral is not reliably legible. / Candidate: ③ 33°"
NEW_NOTE = "mc11-choice3 [user-confirmed] Choice ③ 33° confirmed by user input-037. / Scope: choice3 only; OAI=23° is unchanged; O/I topology and angle C are not resolved by this confirmation."
# Quoted literals are one token and are returned untouched. The negative lookbehind
# also prevents accidental conversion of LaTeX commands supplied to this native API.
TOKENS = re.compile(r'"(?:[^"\\]|\\.)*(?:"|$)|(?<![\w\\])(?:perp|cong)(?!\w)')


def normalize_script(text: str) -> str:
    """Normalize only admitted native command tokens; preserve quoted literals."""
    return TOKENS.sub(lambda m: {"perp": "BOT", "cong": "=="}.get(m[0], m[0]), text)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def paragraph_text(p: ET.Element) -> str:
    return "".join(t.text or "" for t in p.findall(".//hp:t", NS))


def prefix_for(xml: str) -> str:
    found = [prefix for _, (prefix, uri) in ET.iterparse(io.StringIO(xml), events=("start-ns",)) if uri == HP]
    require(len(set(found)) == 1 and bool(found[0]), "Expected one explicit paragraph namespace prefix")
    return found[0]


def patterns(prefix: str):
    q = re.escape(prefix)
    return {name: re.compile(rf'<{q}:{name}\b[^>]*>.*?</{q}:{name}>', re.S) for name in ("equation", "script", "p", "t")}


def raw_element(xml: str, tag: str, object_id: str, prefix: str) -> re.Match:
    # Paragraph binding is intentionally restricted to the simple, non-nested Q11
    # paragraphs. Never use this regex to rewrite table structure.
    q = re.escape(prefix)
    pat = re.compile(rf'<{q}:{tag}\b(?=[^>]*\bid="{re.escape(object_id)}")[^>]*>.*?</{q}:{tag}>', re.S)
    matches = list(pat.finditer(xml))
    require(len(matches) == 1, f"Expected exactly one {tag} id={object_id}; got {len(matches)}")
    return matches[0]


def q11_context(root: ET.Element, dataset: str):
    ps = root.findall(".//hp:p", NS)
    starts = [i for i, p in enumerate(ps) if paragraph_text(p) == "객관식 11"]
    ends = [i for i, p in enumerate(ps) if paragraph_text(p) == "객관식 12"]
    require(len(starts) == len(ends) == 1 and starts[0] < ends[0], "Q11/Q12 headings are missing or ambiguous")
    section = ps[starts[0] + 1:ends[0]]
    pid = "1096640331" if dataset == DATASETS[0] else "438896118"
    choices = [p for p in section if p.get("id") == pid]
    require(len(choices) == 1, "Frozen Q11 choice3 paragraph binding missing within Q11")
    choice = choices[0]
    require(paragraph_text(choice) in ("③ [33°?]", "③ "), "Unexpected bound Q11 choice3 text")
    scripts = [e.find("hp:script", NS).text for p in section for e in p.findall(".//hp:equation", NS)]
    require(any("OAI" in s and "23" in s for s in scripts), "Required OAI=23° guard is missing")
    return section, choice


def patch_section(xml: str, dataset: str, member: str, all_ids: set[str]):
    root = ET.fromstring(xml)
    prefix = prefix_for(xml)
    pats = patterns(prefix)
    changes, equations, notes = [], [], []
    parent = {c: p for p in root.iter() for c in p}
    eq_by_id = {}
    for eq in root.findall(".//hp:equation", NS):
        eid = eq.get("id")
        require(eid is not None and eid not in eq_by_id, "Missing or duplicate native equation control ID")
        p = parent.get(eq)
        while p is not None and p.tag != f"{{{HP}}}p":
            p = parent.get(p)
        eq_by_id[eid] = (eq, p.get("id") if p is not None else None)
    for m in pats["equation"].finditer(xml):
        tag = m[0].split(">", 1)[0]
        eid = re.search(r'\bid="([^"]+)"', tag)[1]
        eq, pid = eq_by_id[eid]
        script = eq.find("hp:script", NS)
        require(script is not None and len(script) == 0, "Unexpected equation script markup")
        before = script.text or ""
        after = normalize_script(before)
        if before == after:
            continue
        sm = list(pats["script"].finditer(m[0]))
        require(len(sm) == 1, "Equation must contain exactly one script")
        sm = sm[0]
        start = m.start() + sm.start() + sm[0].index(">") + 1
        end = m.start() + sm.end() - len(f"</{prefix}:script>")
        changes.append((start, end, escape(after)))
        changed_tokens = {match[0] for match in TOKENS.finditer(before)}
        equations.append({"member": member, "paragraphId": pid, "controlId": eid, "action": "replace-script-tokens", "before": before, "after": after, "feedbackIds": [fid for token, fid in [("perp", "F-PERP"), ("cong", "F-CONG")] if token in changed_tokens]})
    has_q11 = any(paragraph_text(p) == "객관식 11" for p in root.findall(".//hp:p", NS))
    binding = None
    if has_q11:
        section, choice = q11_context(root, dataset)
        pid = choice.get("id")
        existing = choice.findall(".//hp:equation", NS)
        if dataset == DATASETS[0]:
            note = [p for p in section if p.get("id") == "1378020313"]
            require(len(note) == 1, "Exact mc11-choice3 uncertainty-note binding missing")
            note = note[0]
            if existing:
                require(len(existing) == 1 and existing[0].find("hp:script", NS).text == "33 ^{circ}" and paragraph_text(choice) == "③ " and paragraph_text(note) == NEW_NOTE, "Unexpected already-patched GPT Q11 state")
                binding = {"status": "already-patched-no-op", "paragraphId": pid, "controlId": existing[0].get("id"), "script": "33 ^{circ}"}
            else:
                require(paragraph_text(choice) == "③ [33°?]" and paragraph_text(note) == OLD_NOTE, "Frozen GPT choice/note mismatch")
                require(len(list(choice)) == 1 and len(list(choice[0])) == 1, "Unexpected choice markup; refusing to discard formatting")
                template = [p for p in section if p.get("id") == "1554702981"]
                require(len(template) == 1, "Frozen adjacent choice2 template binding missing")
                template_eq = template[0].find(".//hp:equation", NS)
                require(template_eq is not None and template_eq.find("hp:script", NS).text == "32 ^{circ}", "Choice2 equation template differs")
                new_id = 2100000011
                while str(new_id) in all_ids:
                    new_id += 1
                all_ids.add(str(new_id))
                eqraw = raw_element(xml, "equation", template_eq.get("id"), prefix)[0]
                eqraw = eqraw.replace(f'id="{template_eq.get("id")}"', f'id="{new_id}"', 1)
                eqraw = eqraw.replace(f"<{prefix}:script>32 ^{{circ}}</{prefix}:script>", f"<{prefix}:script>33 ^{{circ}}</{prefix}:script>", 1)
                cm = raw_element(xml, "p", pid, prefix)
                tms = list(pats["t"].finditer(cm[0]))
                require(len(tms) == 1 and tms[0][0] == f"<{prefix}:t>③ [33°?]</{prefix}:t>", "Unexpected choice text XML")
                replacement = cm[0].replace(tms[0][0], f"<{prefix}:t>③ </{prefix}:t>")
                # Reuse the exact existing run attributes and sibling degree control
                # dimensions. Only the new control ID and degree value differ.
                opening = re.search(rf'<{re.escape(prefix)}:run\b[^>]*>', cm[0])[0]
                replacement = replacement[:-len(f"</{prefix}:p>")] + opening + eqraw + f"</{prefix}:run></{prefix}:p>"
                changes.append((cm.start(), cm.end(), replacement))
                nm = raw_element(xml, "p", "1378020313", prefix)
                require(escape(OLD_NOTE) in nm[0], "Unexpected note XML")
                pos = nm.start() + nm[0].index(escape(OLD_NOTE))
                changes.append((pos, pos + len(escape(OLD_NOTE)), escape(NEW_NOTE)))
                equations.append({"member": member, "paragraphId": pid, "controlId": str(new_id), "action": "insert-native-choice3-equation", "before": None, "after": "33 ^{circ}", "feedbackIds": ["F-Q11"], "templateParagraphId": "1554702981", "templateControlId": template_eq.get("id")})
                notes.extend([{"member": member, "paragraphId": pid, "action": "choice-text-to-native-math", "before": "③ [33°?]", "after": "③ ", "nativeScriptAfter": "33 ^{circ}", "sourceNodeId": "mc11-choice3"}, {"member": member, "paragraphId": "1378020313", "action": "user-confirmed-note", "before": OLD_NOTE, "after": NEW_NOTE, "sourceNodeId": "mc11-choice3"}])
                binding = {"status": "user-confirmed-choice3-only", "paragraphId": pid, "controlId": str(new_id), "script": "33 ^{circ}"}
        else:
            require(len(existing) == 1 and existing[0].get("id") == "1982223428" and existing[0].find("hp:script", NS).text == "33 ^{circ}" and paragraph_text(choice) == "③ ", "Frozen Argon 33° choice3 mismatch")
            binding = {"status": "verified-existing-33-degrees-no-op", "paragraphId": pid, "controlId": "1982223428", "script": "33 ^{circ}", "uncertaintyNotes": "preserved byte-for-byte; no additional source reading resolved"}
    ordered = sorted(changes)
    require(all(a[1] <= b[0] for a, b in zip(ordered, ordered[1:])), "Overlapping admitted edit spans")
    result = xml
    for start, end, replacement in reversed(ordered):
        result = result[:start] + replacement + result[end:]
    ET.fromstring(result)
    spans = [{"member": member, "startCharacter": s, "endCharacter": e, "before": xml[s:e], "after": a} for s, e, a in ordered]
    return result, equations, notes, binding, spans


def patch_package(input_path: Path, output_path: Path, dataset: str, report_path: Path) -> dict:
    require(dataset in DATASETS, f"Unsupported dataset: {dataset}")
    require(input_path.resolve() != output_path.resolve(), "Input must never be overwritten")
    require(len({input_path.resolve(), output_path.resolve(), report_path.resolve()}) == 3, "Input/output/report paths must differ")
    require(not output_path.exists() and not report_path.exists(), "Output/report already exists; choose new paths")
    source = input_path.read_bytes()
    members, equations, notes, bindings, spans = {}, [], [], [], []
    with zipfile.ZipFile(io.BytesIO(source)) as zin:
        require(len(zin.namelist()) == len(set(zin.namelist())), "Duplicate ZIP members rejected")
        all_ids = set()
        for name in zin.namelist():
            if name.endswith(".xml"):
                all_ids.update(e.get("id") for e in ET.fromstring(zin.read(name)).iter() if e.get("id"))
        for info in zin.infolist():
            before = zin.read(info.filename)
            after = before
            if re.fullmatch(r"Contents/section\d+\.xml", info.filename):
                xml, eq, nt, binding, edits = patch_section(before.decode("utf-8"), dataset, info.filename, all_ids)
                after = xml.encode("utf-8")
                equations.extend(eq); notes.extend(nt); spans.extend(edits)
                if binding:
                    bindings.append(binding)
            members[info.filename] = (info, before, after)
        require(len(bindings) == 1, "Exactly one bound Q11 section required")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zout:
            zout.comment = zin.comment
            for info, before, after in members.values():
                zout.writestr(info, after)
    output_bytes = buffer.getvalue() if spans else source
    with zipfile.ZipFile(io.BytesIO(output_bytes)) as z:
        require(z.namelist() == list(members), "ZIP inventory changed")
        for name, (info, before, after) in members.items():
            require(z.read(name) == after, f"ZIP readback mismatch: {name}")
    report = {"schema": "math-editing.native-equations-patch-report.v1", "taskId": "T-NATIVE-EQUATION-FEEDBACK", "dataset": dataset, "input": str(input_path.resolve()), "inputSha256": sha(source), "output": str(output_path.resolve()), "outputSha256": sha(output_bytes), "equationChanges": equations, "textNoteChanges": notes, "q11Binding": bindings[0], "admittedRawSpans": spans, "members": [{"path": n, "beforeSha256": sha(b), "afterSha256": sha(a), "changed": b != a} for n, (_, b, a) in members.items()], "nativeRender": "not-executed-by-this-module; Lead owns final composed native render", "acceptanceDecision": None}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("xb") as f:
        f.write(output_bytes)
    with report_path.open("x", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2); f.write("\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dataset", choices=DATASETS, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = patch_package(args.input, args.output, args.dataset, args.report)
    except (ValueError, OSError, ET.ParseError, zipfile.BadZipFile) as error:
        parser.exit(2, f"Equation patch rejected: {error}\n")
    print(json.dumps({"dataset": args.dataset, "output": report["output"], "report": str(args.report.resolve()), "equationChanges": len(report["equationChanges"]), "textNoteChanges": len(report["textNoteChanges"]), "outputSha256": report["outputSha256"]}))


if __name__ == "__main__":
    main()
