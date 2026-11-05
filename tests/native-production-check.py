"""Independent E2E assertions and mutation checks on the synthetic saved HWPX."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZipFile

root = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("saved_oracle", Path(__file__).parents[1]/"packages/native-production/inspect_saved.py")
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
hp = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
record = json.loads((root/"composition.json").read_text())
with ZipFile(root/"document.hwpx") as z:
    data = {n: z.read(n) for n in z.namelist()}
section_name = next(n for n in data if n.startswith("Contents/section") and n.endswith(".xml"))
s = ET.fromstring(data[section_name])
page_margin = next(x for x in s.iter() if x.tag==hp+"margin")
assert all(page_margin.get(k)=="0" for k in ("header","footer","gutter"))
tables = list(s.iter(hp+"tbl"))
assert len(tables) == 3
title = tables[0].find(hp+"tr/"+hp+"tc")
assert title.find(hp+"cellSpan").get("colSpan") == "2"
assert "".join(x.text or "" for x in title.iter(hp+"t")) == "보기"
rows = list(tables[0].iter(hp+"tr"))
assert len(rows) == 3
assert "".join(x.text or "" for x in rows[1].find(hp+"tc").iter(hp+"t")) == "A)"
assert "".join(x.text or "" for x in rows[2].find(hp+"tc").iter(hp+"t")) == "B)"
assert "".join(x.text or "" for x in s.iter(hp+"t")) == "37. Find  and .보기A) is given.B)Another row.A separate condition with .1)2)No such value"
assert len(list(s.iter(hp+"equation"))) == 5
assert all(e.find(hp+"pos").get("affectLSpacing")=="1" for e in s.iter(hp+"equation"))
assert rows[1].findall(hp+'tc')[0].find(hp+'subList').get('vertAlign')=='CENTER'
assert rows[1].findall(hp+'tc')[1].find(hp+'subList').get('vertAlign')=='TOP'
assert len(list(tables[-1].iter(hp+"equation"))) == 1
assert sum(1 for e in s.iter(hp+"equation") if (e.findtext(hp+"script") or "").startswith("{overline")) == 2
module.inspect_saved(root/"document.hwpx", record)
with tempfile.TemporaryDirectory() as temp:
    mutated = Path(temp)/"bad.hwpx"
    e = next(s.iter(hp+"equation")); e.find(hp+"script").text = "x"
    data[section_name] = ET.tostring(s)
    with ZipFile(mutated,"w") as z:
        for name, value in data.items(): z.writestr(name, value)
    try: module.inspect_saved(mutated)
    except ValueError as err: assert "terminal_display_space" in str(err)
    else: raise AssertionError("saved missing spacing was accepted")
    e.find(hp+"script").text = 'overline{rm "AB"}^2`'
    data[section_name] = ET.tostring(s)
    with ZipFile(mutated,"w") as z:
        for name, value in data.items(): z.writestr(name, value)
    try: module.inspect_saved(mutated)
    except ValueError as err: assert "decorated_external_scope" in str(err)
    else: raise AssertionError("saved ungrouped decorated base was accepted")
compose_spec = importlib.util.spec_from_file_location("native_compose", Path(__file__).parents[1]/"packages/native-production/compose.py")
compose = importlib.util.module_from_spec(compose_spec); compose_spec.loader.exec_module(compose)
for original, expected in [
    ("x", "x`"), ("x~", "x`"), ("x~  ", "x`"), ('"x~"', '"x~"`'),
    ("x`", "x`"), ("x~~``  ", "x`"), ("x~y~", "x~y`"), ('"x`"', '"x`"`'),
    ('overline{rm "AB"}^2', '{overline{rm "AB"}}^2`'),
    ('{overline{rm "AB"}}^2', '{overline{rm "AB"}}^2`'),
    ('overline{x^2}', 'overline{x^2}`'),
    ('bar{arch{x}^2}_n', '{bar{{arch{x}}^2}}_n`'),
    ('"bar{x}^2"', '"bar{x}^2"`'),
    ('x leq y + "leq"', 'x LEQ y + "leq"`'),
]:
    actual = compose.finish_script(original)
    assert actual == expected, (original, actual, expected)
    assert compose.finish_script(actual) == actual
for bad in ('x}', '{x', '"unterminated', 'arc{AB}'):
    try: compose.finish_script(bad)
    except ValueError: pass
    else: raise AssertionError("malformed script accepted: " + bad)
settings = {"choiceLabelPrefix":"", "choiceLabelSuffix":"", "choiceNumberStyle":"circled", "scorePrefix":" [", "scoreSuffix":"]", "scoreDecimalPlaces":1}
assert [compose.choice_label(n, settings) for n in (1, 5, 20)] == ["①", "⑤", "⑳"]
assert compose.score_label(7, settings) == " [7.0]"
assert compose.score_label(4.3, settings) == " [4.3]"
for call in (lambda: compose.choice_label(21, settings), lambda: compose.score_label(4.35, settings)):
    try: call()
    except ValueError: pass
    else: raise AssertionError("unsupported ordinal or lossy score precision was accepted")
layout=json.loads((root/"layout.json").read_text())
first=layout['equations'][0]
layout['equationMeasurements']={'baseUnit':layout['settings']['equationBaseUnit'],'entries':[{'scriptSha256':__import__('hashlib').sha256(first['script'].encode()).hexdigest(),'width':first['width']+20,'height':4000,'baselineHwpUnits':2000}]}
batch=__import__('copy').deepcopy(layout);batch['schema']='problem-edit.native-batch.v1'
measured=compose.measure(batch)
assert measured['equations'][0]['height']==4000 and measured['equations'][0]['baselinePercent']==50
layout['equations'][0]['requiresMeasurement']=True;layout['equations'][0]['measurement']=None
with tempfile.TemporaryDirectory(dir=layout['runRoot']) as temp:
    output=Path(temp)/'unmeasured-cases'
    try:compose.emit(layout,output)
    except ValueError as err:assert 'cases_render_measurement_required' in str(err)
    else:raise AssertionError('unqualified cases measurement was accepted')
    assert not output.exists()
print(json.dumps({"native_tables":3,"equation_occurrences":5,"saved_mutation_rejected":True,"nativeHancomStatus":"unknown"}))
