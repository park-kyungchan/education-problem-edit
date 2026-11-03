"""PDF extraction only. Called with the already installed PyMuPDF runtime.
Grid-aware row extraction retains page/bbox provenance and unresolved declarations.
It is not a Hancom execution/availability validator.
"""
from pathlib import Path
import json, re, hashlib
from html.parser import HTMLParser
import fitz

ROOT = Path(__file__).resolve().parent.parent / 'research/hancom/2026-10-22'
OUT = ROOT / 'index'
OUT.mkdir(exist_ok=True)
CAPTURE = json.loads((ROOT / 'capture.json').read_text())
RECEIPTS = {r['id']: r for r in CAPTURE['receipts'] if r['state'] == 'captured'}

def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def lines(page):
    return [line for b in page.get_text('dict')['blocks'] for line in b.get('lines', [])]

def text_in(page, box):
    selected = []
    for line in lines(page):
        spans = [s for s in line['spans'] if box[0] <= (s['bbox'][0]+s['bbox'][2])/2 < box[2]
                 and box[1] <= (s['bbox'][1]+s['bbox'][3])/2 < box[3]]
        if spans:
            selected.append(''.join(s['text'] for s in spans))
    return '\n'.join(selected).strip()

def horizontal_rules(page):
    values = [round(d['rect'].y0, 2) for d in page.get_drawings()
              if d['type'] == 's' and d['rect'].width > 500 and d['rect'].height < 1]
    return sorted(set(values))

def locator(docid, page, bbox=None):
    r = RECEIPTS[docid]
    return {'documentId': docid, 'physicalPage': page+1, 'url': r['url']+'#page='+str(page+1),
            'sourceSha256': r['sha256'], 'bboxPoints': bbox}

documents, pages = [], []
pdfs = {}
for docid, receipt in RECEIPTS.items():
    if not receipt['file'].endswith('.pdf'):
        continue
    doc = fitz.open(ROOT / receipt['localPath'])
    pdfs[docid] = doc
    documents.append({'id': docid, 'pages': len(doc), 'url': receipt['url'], 'sha256': receipt['sha256'],
                      'localPath': receipt['localPath'], 'toc': doc.get_toc()})
    for i, page in enumerate(doc):
        text = page.get_text()
        path = OUT / 'pages' / docid / f'{i+1:04}.txt'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        pages.append({'id': f'{docid}:p{i+1}', 'documentId': docid, 'page': i+1,
                      'text': text, 'localPath': str(path.relative_to(ROOT)), 'evidence': locator(docid, i)})

actions, unresolved_rows = [], []
doc = pdfs['ActionTable_2504']
for pno in range(1, 49):
    page = doc[pno]
    ys = horizontal_rules(page)
    for y0, y1 in zip(ys, ys[1:]):
        raw = text_in(page, [86,y0,258,y1])
        if not raw or raw in ['Action ID','ActionID']:
            continue
        compact = re.sub(r'\s+', '', raw)
        if not re.match(r'^[A-Za-z]', compact):
            unresolved_rows.append({'page':pno+1,'raw':raw});continue
        parameter = text_in(page,[258,y0,389,y1])
        description = text_in(page,[389,y0,637,y1])
        note = text_in(page,[637,y0,756,y1])
        spans=[s for line in lines(page) for s in line['spans'] if s['bbox'][0]<258 and y0<sum(s['bbox'][1::2])/2<y1]
        red = any(((s['color']>>16)&255)>180 and ((s['color']>>8)&255)<80 and (s['color']&255)<80 for s in spans)
        actions.append({'id':compact,'printedId':raw,'kind':'action-declaration',
          'declarationKind':'range' if '~' in compact else 'single',
          'parameterSetRaw':parameter,'parameterSet':re.sub(r'[\s*]+','',parameter) if parameter not in ['-','+',''] else None,
          'requiresExplicitParameterSet':'*' in parameter,'parameterSetExposure':'none' if parameter=='-' else 'not-exposed' if parameter=='+' else 'documented' if parameter else 'unspecified',
          'description':description,'notes':note,'redTextHint':red,'executionState':'documented-unverified',
          'warning':'May be a dummy/internal action; inspect original red underline before execution.' if red else 'Documentation is not proof of runtime availability.',
          'evidence':locator('ActionTable_2504',pno,[86,y0,756,y1])})

params=[]
doc=pdfs['ParameterSetTable_2504']
toc=doc.get_toc()
sections=[]
for level,title,page in toc:
    match=re.match(r'(\d+)\)\s*([A-Za-z][\w]*(?:\s*/\s*[A-Za-z][\w]*)*)\s*[:：]\s*(.*)',title)
    if match and 1<=int(match[1])<=141:
        names=[s.strip() for s in match[2].split('/')]
        sections.append({'ordinal':int(match[1]),'id':names[0],'aliases':names[1:],'description':match[3],'page':page})
for i, section in enumerate(sections):
    start=section['page']-1
    end=(sections[i+1]['page']-1) if i+1<len(sections) else 170
    # Sections normally start on separate pages; same-page boundaries remain a documented parsing limit.
    selected_pages=list(range(start,max(start+1,end)))
    fields=[]
    for pno in selected_pages:
        page=doc[pno]
        headers=[l for l in lines(page) if ''.join(s['text'] for s in l['spans']).strip()=='Item ID']
        header_y=headers[0]['bbox'][1] if headers else -1
        if header_y<0:continue
        ys=sorted(set([y for y in horizontal_rules(page) if y>header_y]+[545.0]))
        for y0,y1 in zip(ys,ys[1:]):
            name=text_in(page,[112,y0,231,y1]);typ=text_in(page,[231,y0,327,y1]);subtype=text_in(page,[327,y0,430,y1]);desc=text_in(page,[430,y0,756,y1])
            if not name or not re.match(r'^[A-Za-z]',name) or not typ.startswith('PIT_'):continue
            fields.append({'id':re.sub(r'\s+','',name),'printedId':name,'type':typ,'subType':subtype,'description':desc,
                           'evidence':locator('ParameterSetTable_2504',pno,[112,y0,756,y1])})
    params.append({**section,'kind':'parameter-set','pageRange':[start+1,max(selected_pages)+1],
                   'fields':fields,'executionState':'documented-unverified','evidence':locator('ParameterSetTable_2504',start)})

members=[]
doc=pdfs['HwpAutomation_2504']
for pno,page in enumerate(doc):
    for line in lines(page):
        left=''.join(s['text'] for s in line['spans'] if s['bbox'][0]<247)
        for name,kind in re.findall(r'([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(Method|Property|Event)\s*\)',left,re.I):
            members.append({'id':name,'kind':kind.lower(),'owner':'IHwpObject-or-collection-see-source-page',
                            'executionState':'documented-unverified','evidence':locator('HwpAutomation_2504',pno,list(line['bbox']))})

save('documents.json',documents)
save('actions.json',actions)
save('parameter-sets.json',params)
save('api-members.json',members)
class PlainText(HTMLParser):
    def __init__(self):
        super().__init__();self.parts=[];self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ['script','style']:self.skip+=1
        elif tag in ['p','div','tr','h1','h2','h3','li','br']:self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ['script','style']:self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip:self.parts.append(data)
def plain(html):
    parser=PlainText();parser.feed(html)
    return re.sub(r'\n\s*\n+','\n',''.join(parser.parts)).strip()
web_documents=[]
for docid,receipt in RECEIPTS.items():
    path=ROOT/receipt['localPath']
    if path.suffix=='.html':
        text=plain(path.read_text())
        web_documents.append({'id':docid,'text':text,'sourceSha256':receipt['sha256'],'url':receipt['url'],'localPath':receipt['localPath'],'surface':'web' if docid=='web-api' else 'reference'})
    elif docid in ['desktop-web-boundary','hwpx-saveblock']:
        data=json.loads(path.read_text())
        for post in data.get('post_stream',{}).get('posts',[]):
            web_documents.append({'id':docid+':post'+str(post['post_number']),'text':plain(post['cooked']),
              'sourceSha256':receipt['sha256'],'url':receipt['url'].replace('.json','')+'/'+str(post['post_number']),
              'author':post.get('username'),'staff':post.get('staff',False),'localPath':receipt['localPath'],'surface':'reference'})
save('web-documents.json',web_documents)
(OUT/'pages.jsonl').write_text('\n'.join(json.dumps(p,ensure_ascii=False) for p in pages)+'\n')
summary={'schema':'hancom.document-index.v1','actionDeclarations':len(actions),'uniqueActionIds':len({a['id'] for a in actions}),
  'parameterSets':len(params),'extractedParameterFields':sum(len(p['fields']) for p in params),'apiMemberOccurrences':len(members),'pdfPages':len(pages),
  'unresolvedRows':unresolved_rows,'limitations':['All records are documentation-level, not execution-qualified.',
  'Action ranges remain ranges; wrapped/printed identifiers are retained separately from whitespace-normalized lookup IDs.',
  'Red text is a dummy/internal hint; inspect the original underline before execution.',
  'Parameter field extraction is best effort; full page text and exact source pages remain authoritative.',
  'HwpAutomation and WebHwp/HwpCtrl are distinct surfaces. Installed typelib may expose members absent from manuals.']}
save('summary.json',summary)
print(json.dumps(summary,ensure_ascii=False))
