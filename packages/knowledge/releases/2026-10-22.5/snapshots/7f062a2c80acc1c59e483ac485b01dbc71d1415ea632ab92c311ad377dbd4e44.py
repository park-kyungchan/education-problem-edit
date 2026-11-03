"""Finite package layout adapter. Never transcribe or regenerate question content."""
from pathlib import Path
from zipfile import ZipFile
from copy import deepcopy
from lxml import etree as E
import json, hashlib

ROOT=Path(__file__).parent
REQUEST=json.loads(Path('/home/palantirkc/operations/math-editing-knowledge-20261022/hwp-layout-request.json').read_text())
HP='http://www.hancom.co.kr/hwpml/2011/paragraph'
HH='http://www.hancom.co.kr/hwpml/2011/head'
HC='http://www.hancom.co.kr/hwpml/2011/core'
NS={'hp':HP,'hh':HH,'hc':HC}
def hp(n):return '{'+HP+'}'+n
def sha(b):return hashlib.sha256(b).hexdigest()
def write(name,obj):(ROOT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def serialize(x):return E.tostring(x,encoding='UTF-8',xml_declaration=True,standalone=True)
def body_text(x):return [t.text or '' for t in x.findall('.//hp:t',NS)]
def subtree_hash(x):
 def tree(n):return [n.tag,sorted(n.attrib.items()),n.text,n.tail,[tree(c) for c in n]]
 return sha(json.dumps(tree(x),ensure_ascii=False,separators=(',',':')).encode())
def invariant(q):
 return {'text':body_text(q),'equations':[subtree_hash(x) for x in q.findall('.//hp:equation',NS)],
         'pictures':[subtree_hash(x) for x in q.findall('.//hp:pic',NS)],
         'nestedTables':[subtree_hash(x) for x in q.findall('.//hp:tbl',NS)],
         'choices':{c:''.join(body_text(q)).count(c) for c in '①②③④⑤'}}

source=Path(REQUEST['contentAuthority']['path'])
assert sha(source.read_bytes())==REQUEST['contentAuthority']['sha256']
with ZipFile(source) as src,ZipFile(ROOT/'reference.native.hwpx') as ref:
 section=E.fromstring(src.read('Contents/section0.xml'))
 header=E.fromstring(src.read('Contents/header.xml'))
 reference=E.fromstring(ref.read('Contents/section0.xml'))
 bindings=json.loads(Path('/home/palantirkc/operations/daechi-hwpx-20261022/feedback-20261022/question-bindings.actual.json').read_text())
 questions=[];coverage=[]
 for b in bindings:
  q=section.find('.//hp:tbl[@id="'+b['tableId']+'"]',NS)
  assert q is not None
  before=invariant(q)
  assert before['text'][0]==str(b['questionId'])+'. '
  assert all(v==1 for v in before['choices'].values())
  q=deepcopy(q)
  # Only the complete-question envelope changes. All descendants containing
  # equations, pictures, proof/example tables and choice content stay untouched.
  q.find('hp:sz',NS).set('width','30000')
  q.find('hp:sz',NS).set('height','100')
  for m in q.findall('./hp:inMargin',NS):
   for key in ['left','right','top','bottom']:m.set(key,'0')
  tc=q.find('./hp:tr/hp:tc',NS)
  tc.set('hasMargin','1')
  for key in ['left','right','top','bottom']:tc.find('hp:cellMargin',NS).set(key,'0')
  tc.find('hp:cellSz',NS).set('width','30000')
  tc.find('hp:cellSz',NS).set('height','100')
  assert invariant(q)==before
  questions.append(q)
  coverage.append({'question':b['questionId'],'tableId':b['tableId'],'preserved':before})
 # Reference section/page definition is the layout authority, not the old grid.
 secpr=deepcopy(reference.find('.//hp:secPr',NS))
 colpr=deepcopy(reference.find('.//hp:colPr',NS))
 old_initial=list(section)[:4]
 section.clear()
 for i,p in enumerate(old_initial):
  p=deepcopy(p)
  for tag in ['secPr','ctrl','linesegarray']:
   for x in p.findall('.//hp:'+tag,NS):x.getparent().remove(x)
  p.set('paraPrIDRef','30')
  p.set('pageBreak','0');p.set('columnBreak','0')
  for run in p.findall('hp:run',NS):run.set('charPrIDRef','9' if i else '10')
  if i==0:
   texts=p.findall('.//hp:t',NS);texts[0].text=REQUEST['title']
   run=E.Element(hp('run'),charPrIDRef='0');run.append(secpr)
   ctrl=E.SubElement(run,hp('ctrl'));ctrl.append(colpr);p.insert(0,run)
  section.append(p)
 # Header remains first-page body content; no running header/rule is invented.
 for n,q in enumerate(questions):
  p=E.SubElement(section,hp('p'),id=str(1900000000+n),paraPrIDRef='28',styleIDRef='0',pageBreak='0',columnBreak='0',merged='0')
  E.SubElement(p,hp('run'),charPrIDRef='0').append(q)
  if n<23:
   # Reference uses three empty 10pt / 160% paragraphs after each question.
   for k in range(3):
    p=E.SubElement(section,hp('p'),id=str(1950000000+3*n+k),paraPrIDRef='30',styleIDRef='0',pageBreak='0',columnBreak='0',merged='0')
    E.SubElement(E.SubElement(p,hp('run'),charPrIDRef='8'),hp('t'))
 # Body and choices adopt the observed reference 160% paragraph rhythm.
 for ident in ['20','21']:
  pp=header.find('.//hh:paraPr[@id="'+ident+'"]',NS)
  for x in pp.findall('.//hh:lineSpacing',NS):x.set('value','160')
  for x in pp.findall('.//hc:next',NS):x.set('value','0')
 # Keep picture dimensions exact, align their paragraph to the left as reference.
 pp=header.find('.//hh:paraPr[@id="22"]',NS)
 pp.find('hh:align',NS).set('horizontal','LEFT')
 for x in pp.findall('.//hc:left',NS):x.set('value','800')
 # A new style for simple first-page metadata and inter-question blank lines.
 pp=deepcopy(header.find('.//hh:paraPr[@id="20"]',NS));pp.set('id','30')
 collection=header.find('.//hh:paraProperties',NS);collection.append(pp);collection.set('itemCnt',str(len(collection)))
 payloads={i.filename:src.read(i.filename) for i in src.infolist()}
 payloads['Contents/section0.xml']=serialize(section)
 payloads['Contents/header.xml']=serialize(header)
 content=E.fromstring(payloads['Contents/content.hpf'])
 for t in content.findall('.//{http://www.idpf.org/2007/opf/}title'):t.text=REQUEST['title']
 payloads['Contents/content.hpf']=serialize(content)
 changed=[i.filename for i in src.infolist() if payloads[i.filename]!=src.read(i.filename)]
 dest=ROOT/'layout-r1.hwpx'
 assert not dest.exists()
 with ZipFile(dest,'w') as out:
  for i in src.infolist():out.writestr(i,payloads[i.filename])
 assert changed==['Contents/header.xml','Contents/section0.xml','Contents/content.hpf'] or set(changed)=={'Contents/header.xml','Contents/section0.xml','Contents/content.hpf'}
 media={p:sha(b) for p,b in payloads.items() if p.startswith('BinData/')}
 write('layout.actual.json',{'schema':'daechi.reference-layout.v1','referenceNativePages':12,'referenceQuestionOrder':[5,6,7,8,13,14,15,16,9,10,11,12,17,18,19,20,21,22,23,24],
  'observed':{'paperHwpUnits':dict(secpr.find('hp:pagePr',NS).attrib),'marginsHwpUnits':dict(secpr.find('hp:pagePr/hp:margin',NS).attrib),'columns':dict(colpr.attrib),'runningHeaders':0,'centerRule':False,'lineSpacingPercent':160,'choiceLayout':'one per paragraph','interQuestionBlankParagraphs':3},
  'adaptations':['Preserve v3 logical question order 1 through 24, rather than reference omissions and ordering.','Preserve complete question tables, preventing reference-style choice splitting.','Use 30000 HWPUNIT question flow width, remove obsolete two-column page tables and slot minimum heights.','Retain first-page v3 metadata as body text and set exact requested title.','Preserve equation/picture/nested-frame XML; do not imitate the reference equation metric defects.'],
  'outputPackage':str(dest),'sha256':sha(dest.read_bytes()),'changedMembers':changed,'media':media,'acceptanceDecision':None})
 write('package-coverage.actual.json',{'schema':'daechi.template-package-coverage.v1','questions':coverage,'allQuestionTextEquationPictureAndNestedFrameXmlPreserved':True,'mediaPayloadsPreserved':len(media),'equations':sum(len(x['preserved']['equations']) for x in coverage),'pictures':sum(len(x['preserved']['pictures']) for x in coverage),'choices':120})
 print(json.dumps({'output':str(dest),'changedMembers':changed,'questions':len(questions),'media':len(media)}))
