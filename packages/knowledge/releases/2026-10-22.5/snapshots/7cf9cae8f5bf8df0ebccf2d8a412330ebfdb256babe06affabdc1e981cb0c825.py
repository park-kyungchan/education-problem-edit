"""Finite native HWPX serializer using the existing pinned python-hwpx engine.
Reuses admitted EqEdit normalization and editable table layout techniques.
"""
from pathlib import Path
from copy import deepcopy
import json, re, sys, importlib.util, zipfile, hashlib
from lxml import etree as E
from hwpx import HwpxDocument
from hwpx.equation import estimate_equation_size

ROOT=Path(__file__).resolve().parent
HP='{http://www.hancom.co.kr/hwpml/2011/paragraph}'
HH='{http://www.hancom.co.kr/hwpml/2011/head}'
HC='{http://www.hancom.co.kr/hwpml/2011/core}'
old=Path('/home/palantirkc/operations/math-problem-editing-20261020/feedback-revision/native-equations/patch_equations.py')
spec=importlib.util.spec_from_file_location('admitted_equations',old)
admitted=importlib.util.module_from_spec(spec);spec.loader.exec_module(admitted)
data=json.loads((ROOT/'content.json').read_text())
metrics=json.loads((ROOT/'native-equation-metrics.actual.json').read_text())['metrics']
alignment=json.loads((ROOT/'alignment.json').read_text())
page_template=json.loads((ROOT/'page-template.json').read_text())
local_layout=json.loads((ROOT/'question-layout.json').read_text())
active_underlines=[]
question_bindings=[]
figures={x['id']:x for x in json.loads((ROOT/'figures/manifest.json').read_text())}
doc=HwpxDocument.new()
doc.page.setup(paper_size='A4',margin_left_mm=13,margin_right_mm=13,margin_top_mm=12,margin_bottom_mm=12)
for section in doc.sections:
    for margin in section.element.iter(HP+'margin'):
        if 'header' in margin.attrib:
            margin.set('header','0');margin.set('footer','0')
header=doc._root.headers[0].element
paras=header.find('.//'+HH+'paraProperties')
styles={}
def style(name,align='LEFT',line=140,after=0,before=0,keep=False):
    p=deepcopy(paras[0]);sid=str(max(int(c.get('id')) for c in paras)+1);p.set('id',sid)
    p.find(HH+'align').set('horizontal',align)
    p.find(HH+'breakSetting').set('keepLines','1' if keep else '0')
    for x in p.iter():
        if x.tag==HH+'lineSpacing':x.set('value',str(line))
        elif x.tag in [HC+'intent',HC+'left',HC+'right',HC+'prev',HC+'next']:
            x.set('value',str(after if x.tag==HC+'next' else before if x.tag==HC+'prev' else 0))
    paras.append(p);paras.set('itemCnt',str(len(paras)));styles[name]=sid
    return sid
style('body',line=135,after=180)
style('choice',line=137,after=70)
style('center',align='CENTER',line=100,after=230)
style('title',align='CENTER',line=120,after=300)
style('meta',align='CENTER',line=125,after=250)
style('gap',line=100,after=0)
style('proof',line=133,after=85)
style('footer',align='CENTER',line=100,after=0)
style('anchor',line=100)

border_parent=header.find('.//'+HH+'borderFills')
def border(sides=''):
    p=deepcopy(border_parent[0]);sid=str(max(int(c.get('id')) for c in border_parent)+1);p.set('id',sid)
    for key,name in [('L','left'),('R','right'),('T','top'),('B','bottom')]:
        x=p.find(HH+name+'Border');x.set('type','SOLID' if key in sides else 'NONE');x.set('width','0.12 mm');x.set('color','#333333')
    for c in list(p):
        if c.tag==HC+'fillBrush':p.remove(c)
    border_parent.append(p);border_parent.set('itemCnt',str(len(border_parent)));return sid
no_border=border();mid_border=border('R');box_border=border('LRTB')
equations=[]
def clean(p,sty):
    controls=[deepcopy(c) for r in p.element.findall(HP+'run') for c in r if c.tag in [HP+'secPr',HP+'ctrl']]
    for x in list(p.element):p.element.remove(x)
    if controls:
        run=E.SubElement(p.element,HP+'run',charPrIDRef='0')
        run.extend(controls)
    p.element.set('paraPrIDRef',styles[sty]);p.element.set('styleIDRef','0')
    return p
def text(p,s,size=10,bold=False):
    pattern='('+'|'.join(re.escape(u) for u in active_underlines)+')' if active_underlines else None
    for part in re.split(pattern,s) if pattern else [s]:
        if part:p.add_run(part,font='맑은 고딕',size=size,bold=bold,underline=part in active_underlines)

def measured_equation(p,script,size):
    unit=round(size*100);key=f'{unit}:{script}'
    if key not in metrics:raise ValueError(f'Missing exact native metric: {key}')
    m=metrics[key];width=int(m['size']['width']);height=int(m['size']['height'])
    obj=doc.shapes.add_equation(script,paragraph=p,base_unit=unit,size=(width,height))
    obj.element.set('baseLine',m['baseLine'])
    margin=obj.element.find(HP+'outMargin')
    for k,v in m['margin'].items():margin.set(k,v)
    equations.append({'script':script,'width':width,'height':height,'baseUnit':unit,'baseLine':m['baseLine'],'metricKey':key,'controlId':obj.element.get('id'),'measurement':'native-equation-create'})
    return obj

def atoms(p,s,size=10,bold=False):
    for i,part in enumerate(s.split('$')):
        if not part:continue
        if i%2==0:text(p,part,size,bold)
        else:
            # Independent inline math chunks can wrap after commas inside the original formula.
            pieces=part.split(',~')
            for j,script in enumerate(pieces):
                if j:text(p,', ',size)
                script=admitted.normalize_script(script).replace('DEG','^{circ}')
                measured_equation(p,script,size)
def para(cell,s='',sty='body',size=10,bold=False):
    p=cell.add_paragraph('') if cell else doc.add_paragraph('',include_run=False)
    clean(p,sty);atoms(p,s,size,bold);return p
def image(cell,q):
    f=figures[q];p=para(cell,'','center')
    w=local_layout['figureWidthMm'].get(str(q),local_layout['defaultFigureMm'])
    h=w*f['height']/f['width']
    item=doc.media.add_image((ROOT/f'figures/q{q}.png').read_bytes(),'png')
    p.add_picture(str(item),width=round(w*7200/25.4),height=round(h*7200/25.4))
def clear_cell(cell,padding=0):
    sub=cell.element.find(HP+'subList')
    for c in list(sub):sub.remove(c)
    sub.set('vertAlign','TOP')
    margins=cell.element.find(HP+'cellMargin')
    for side in ['left','right','top','bottom']:margins.set(side,str(padding))
    return cell

def inline_blank(cell,p,label):
    tbl=cell.add_table(1,1,width=2050,height=1250,border_fill_id_ref=box_border)
    tbl.element.set('pageBreak','NONE')
    tc=clear_cell(tbl.cell(0,0),70)
    para(tc,label,'center',8.8)
    tbl.element.find(HP+'pos').set('treatAsChar','1')
    # Move the table control from its auto-created anchor paragraph into the proof line.
    anchor=tbl.paragraph.element
    for run in list(anchor.findall(HP+'run')):
        if tbl.element in list(run):
            anchor.remove(run);p.element.append(run)
    anchor.getparent().remove(anchor)

def proof_line(cell,line):
    p=para(cell,'','proof',8.8)
    for part in re.split(r'(\[ \([가-마]\) \])',line):
        if re.fullmatch(r'\[ \([가-마]\) \]',part):inline_blank(cell,p,part[2:-2])
        else:atoms(p,part,8.8)

def box(cell,lines,proof=False):
    tbl=cell.add_table(1,1,width=page_template['frameWidth'],height=1800,border_fill_id_ref=box_border)
    tbl.element.set('pageBreak','NONE');tbl.paragraph.element.set('paraPrIDRef',styles['anchor'])
    tc=clear_cell(tbl.cell(0,0),200)
    if proof:
        image(tc,18)
        for line in lines:proof_line(tc,line)
    else:
        para(tc,'<보기>','center',9.5)
        p=para(tc,'','center',9.2)
        measured_equation(p,alignment['q17'],9.2)


first=doc.paragraphs[0]
for page in range(1,7):
    if page==1:
        clean(first,'title');text(first,'2026학년도 2학기 중간고사',15,True)
        para(None,'대치중학교  |  2학년 수학  |  코드 번호: 04','meta',10)
        para(None,'실시일  9월 29일 2교시    ·    선택형 24문항 / 총 100점','meta',9)
        para(None,'※ 다음 문제를 읽고 정답을 OMR-시트지에 정확히 표기하시오.','body',9)
    else:
        title=para(None,f'2026학년도 2학기 중간고사  ·  2학년 수학','meta',10,True)
        title.element.set('pageBreak','1')
    height=round((222 if page==1 else 247)*7200/25.4)
    tbl=doc.add_table(1,2,width=52150,height=height,border_fill_id_ref=no_border)
    tbl.paragraph.element.set('paraPrIDRef',styles['anchor'])
    tbl.element.set('pageBreak','NONE');tbl.element.set('repeatHeader','0')
    for c in range(2):
        cell=tbl.cell(0,c);cell.element.set('borderFillIDRef',mid_border if c==0 else no_border)
        sub=cell.element.find(HP+'subList');sub.set('vertAlign','TOP')
        for x in list(sub):sub.remove(x)
        margin=cell.element.find(HP+'cellMargin')
        margin.set('left','450');margin.set('right','450');margin.set('top','200');margin.set('bottom','100')
        for slot,q in enumerate(data['problems'][(page-1)*4+c*2:(page-1)*4+c*2+2]):
            active_underlines=q.get('underline',[])
            minimum_mm=page_template['firstSlotMinMm'][str(page)][c] if slot==0 else 5
            qt=cell.add_table(1,1,width=page_template['questionWidth'],height=round(minimum_mm*7200/25.4),border_fill_id_ref=no_border)
            qt.element.set('pageBreak','NONE');qt.element.set('repeatHeader','0')
            qt.element.find(HP+'pos').set('treatAsChar','1')
            qt.paragraph.element.set('paraPrIDRef',styles['anchor'])
            desc=qt.element.find(HP+'shapeComment')
            if desc is None:desc=E.SubElement(qt.element,HP+'shapeComment')
            desc.text=f"Daechi Question {q['id']:02d}: complete editable question container"
            qc=clear_cell(qt.cell(0,0),0)
            p=para(qc,'','body',10)
            text(p,f"{q['id']}. ",10,True);atoms(p,q['stem'],local_layout['stemPointSize'].get(str(q['id']),10))
            text(p,f" ({q['points']}점)",9)
            if q.get('figure') and q['id']!=18:image(qc,q['figure'])
            if q.get('box'):box(qc,q['box'],q['id']==18)
            for i,ch in enumerate(q['choices']):para(qc,'①②③④⑤'[i]+' '+ch,'choice',9.5 if q['id'] in [4,13,14] else 10)
            question_bindings.append({'questionId':q['id'],'tableId':qt.element.get('id'),'page':page,'column':c,'slot':slot,'tableWidth':page_template['questionWidth'],'minimumHeightMm':minimum_mm,'pictures':len(list(qt.element.iter(HP+'pic'))),'equations':len(list(qt.element.iter(HP+'equation'))),'nestedTables':len(list(qt.element.iter(HP+'tbl')))-1})
            active_underlines=[]
    footer=f'(2학년 수학)  {page}/6    이 시험문제의 저작권은 대치중학교에 있습니다.'
    para(None,footer,'footer',7.5)
out=ROOT/'output/대치중_2026_2학년_2학기_중간고사_개선_v2.hwpx'
doc.save_to_path(out)
with zipfile.ZipFile(out) as z:
    assert z.testzip() is None
    section=E.fromstring(z.read('Contents/section0.xml'))
    actual=len(list(section.iter(HP+'equation')))
    assert actual==len(equations)
    assert len(list(section.iter(HP+'pic')))==21
    for filename in z.namelist():
        if filename.endswith(('.xml','.hpf')):E.fromstring(z.read(filename))
assert [q['id'] for q in data['problems']]==list(range(1,25))
assert sum(q['points'] for q in data['problems'])==100
result={'output':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'problems':24,'choices':120,'equations':len(equations),'cleanDiagrams':21,'allPoints':100,'logicalPages':6,'packageCheck':'passed','nativeRender':'pending','newPaidCalls':0,'accepted':None}
(ROOT/'equation-bindings.actual.json').write_text(json.dumps(equations,ensure_ascii=False,indent=2))
(ROOT/'question-bindings.actual.json').write_text(json.dumps(question_bindings,ensure_ascii=False,indent=2))
(ROOT/'build.actual.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False))
