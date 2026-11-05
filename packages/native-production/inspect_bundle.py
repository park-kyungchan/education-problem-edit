"""Independent saved-bundle/source readback. Standard library; no authoring imports."""
import hashlib
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile
from inspect_saved import inspect_saved, HP


def inspect_bundle(directory, root):
    root = Path(root).resolve(strict=True)
    directory = Path(directory).resolve(strict=True)
    def need(v, code):
        if not v: raise ValueError('production_bundle_'+code+'@packages/native-production/inspect_bundle.py:1')
    def bounded(p):
        p = Path(p).resolve(strict=True)
        need(p.is_relative_to(root) and p != root, 'outside_root')
        return p
    bounded(directory)
    def read(p): return json.loads(bounded(p).read_text())
    def sha(p): return hashlib.sha256(bounded(p).read_bytes()).hexdigest()
    document = bounded(directory/'document.hwpx')
    record, layout = read(directory/'composition.json'), read(directory/'layout.json')
    need(record['documentSha256'] == sha(document), 'document_changed')
    need(record['sourceSha256'] == layout['sourceSha256'], 'source_binding')
    need(record['inputPins'] == layout['inputPins'], 'input_pin_binding')
    sources = {}
    for p in record['inputPins']:
        path = bounded(p['path'])
        need(sha(path) == p['sha256'], 'input_changed')
        if path.suffix == '.json':
            data = json.loads(path.read_text())
            if data.get('schema') in ['problem-edit.source-question.v1','problem-edit.source-transcription.local.v1']:
                q = data['questionId']; need(q not in sources, 'duplicate_source_question'); sources[q] = data
    need(set(sources) == set(record['questions']), 'source_question_coverage')
    templates = {t['id']:t for t in layout['equations']}
    for t in templates.values():
        q = sources[t['questionId']]
        item = next((c for c in q['choices'] if t['id'] == q['questionId']+'::choice::choice-'+str(c['number'])),None) if t['role']=='choice' else next((m for m in q['math'] if m['id']==t['itemId']),None)
        need(item is not None and item['latex'] == t['latex'], 'source_equation_binding')
        for a in item.get('limitApproaches',[]):
            actual = t['limitApproaches'][a['occurrence']-1]
            need(a == actual, 'source_approach_binding')
    for e in record['equations']:
        t=templates[e['templateId']]
        need(e['script'] == t['script'] and e.get('limitChecks',[]) == t.get('limitChecks',[]), 'equation_evidence_binding')
    result = inspect_saved(document, record)
    checks = result['checks']
    def check(name,v): need(v,name); checks.append({'name':name,'status':'passed'})
    # Reconstruct only literal text from raw pinned sources, not producer paragraphs.
    s=layout['settings']; expected=''
    for qid in record['questions']:
        q=sources[qid]; last=max(b['index'] for b in q['contentOrder'] if b['kind']=='paragraph')
        for b in q['contentOrder']:
            if b['kind']=='paragraph':
                i=b['index']; expected+=(q['printedLabel']+s['questionLabelSuffix'] if i==0 else '')+q['paragraphs'][i]
                if i==last and q['score'] is not None:
                    value=format(q['score'],f'.{s["scoreDecimalPlaces"]}f') if 'scoreDecimalPlaces' in s else str(q['score'])
                    expected+=s['scorePrefix']+value+s['scoreSuffix']
            elif b['kind'] in ['box','statement-box']:
                box=q['statementBox'] if b['kind']=='statement-box' else next(x for x in q['boxes'] if x['id']==b['id'])
                expected+=box.get('title') or ''
                for item in box['items']:
                    label=item.get('label') or ''
                    if label and b['kind']=='statement-box':
                        if box['labelStyle']=='parenthesized':label='('+label+')'
                        elif box['labelStyle']=='consonant-with-period':label+='.'
                    expected+=label+item['body']
            elif b['kind']=='choices':
                for c in q['choices']:
                    number=chr(0x2460+c['number']-1) if s.get('choiceNumberStyle')=='circled' else str(c['number'])
                    expected+=s['choiceLabelPrefix']+number+s['choiceLabelSuffix']+(c['text'] if c['kind']=='text' else '')
    def plain(t): return re.sub(r'\s+','',re.sub(r'\{\{[^}]+\}\}','',t))
    with ZipFile(document) as z:
        sections=[ET.fromstring(z.read(n)) for n in z.namelist() if n.startswith('Contents/section') and n.endswith('.xml')]
        check('source_literal_text_order',plain(''.join(e.text or '' for sec in sections for e in sec.iter(HP+'t')))==plain(expected))
        actual={e.get('id'):e for sec in sections for e in sec.iter(HP+'equation')}
        for e in record['equations']:
            t=templates[e['templateId']]; x=actual[e['objectId']]; size=x.find(HP+'sz')
            check('measured_equation_dimensions_'+e['occurrenceId'],int(size.get('width'))==t['width'] and int(size.get('height'))==t['height'])
            if t['baselinePercent'] is not None:check('measured_baseline_'+e['occurrenceId'],int(x.get('baseLine'))==t['baselinePercent'])
    return {'schema':'problem-edit.bundle-readback.v1','documentSha256':sha(document),'sourceSha256':record['sourceSha256'],
            'counts':{'questions':len(sources),'equationTemplates':len(templates),'equationOccurrences':len(record['equations']),'nativeTables':len(record['tables']),'checksPassed':len(checks)},
            'verified':['Actual saved ZIP/XML scripts, single terminal half-space and declared limit approach clauses','Raw pinned source literal text/label/score/choice order','Measured dimensions/baselines, native table cells/margins and embedded-asset byte identity','Every input pin re-read; source equation/approach bindings'],
            'notCertified':['Original PDF reading and all mathematical meaning','Visual line flow, actual raster clipping and SVG/PNG semantic parity','Native Hancom display and human acceptance'],
            'native':{'status':'unknown'}}


if __name__=='__main__':
    try: print(json.dumps(inspect_bundle(sys.argv[1],sys.argv[2])))
    except Exception as e:
        print(str(e),file=sys.stderr);sys.exit(1)
