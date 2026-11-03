"""Generic new-document adapter. Reads only the new run's frozen source/native-content/figure data."""
from __future__ import annotations
import json,sys,hashlib,re,math,copy
from pathlib import Path
from PIL import Image
from hwpx import HwpxDocument
from hwpx.equation import latex_to_eqedit,estimate_equation_size

HP='{http://www.hancom.co.kr/hwpml/2011/paragraph}'
HH='{http://www.hancom.co.kr/hwpml/2011/head}'
HWP_PER_MM=7200/25.4
FONT='함초롬바탕'
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def units(mm):return round(float(mm)*HWP_PER_MM)

def main(job_path):
    job=json.loads(Path(job_path).read_text())
    for p in job['inputPins']:
        if digest(p['path'])!=p['sha256']:raise RuntimeError('INPUT_PIN_DRIFT:'+p['path'])
    out=Path(job['outputHwpx'])
    if out.exists():raise RuntimeError('NO_OUTPUT_OVERWRITE')
    content=json.loads(Path(job['nativeContentPath']).read_text())
    figures=json.loads(Path(job['figureAssetsPath']).read_text())
    frame_model=json.loads(Path(job['nativeFramesPath']).read_text()) if job.get('nativeFramesPath') else {}
    style_spans={}
    for span in frame_model.get('styleSpans',[]):style_spans.setdefault(span['runPointer'],[]).append(span)
    problems=content['problems']
    if len(problems)!=20 or len({p['id'] for p in problems})!=20:raise RuntimeError('FULL20_REQUIRED')
    asset_rows=figures.get('figures',figures.get('assets',[]))
    assets={r.get('figureId',r.get('id')):r for r in asset_rows}
    handwritten_only={f['id'] for p in problems for f in p.get('figures',[]) if f.get('geometry',{}).get('sourceRole')=='handwritten-only'}
    doc=HwpxDocument.new()
    doc.page.setup(paper_size='A4',margin_left_mm=22,margin_right_mm=22,margin_top_mm=17,margin_bottom_mm=17)
    first=doc.paragraphs[0];first.text=''
    report={'schema':'jungdong.new-composition-report.v1','sourceSha256':job['sourceSha256'],'problemIds':[],'equations':[],'imageRoles':[],'frames':[],'blanks':[],'underlines':[],'problemStarts':[],'inputPins':job['inputPins'],'acceptanceDecision':None}
    used_first=False
    def set_borders(table,row,column,visible_sides=(),color='#000000'):
        header=doc._root.headers[0];container=header._border_fills_element();cell=table.cell(row,column)
        base_id=cell.element.get('borderFillIDRef') or table.element.get('borderFillIDRef')
        base=next(e for e in container if e.get('id')==base_id);border=copy.deepcopy(base);border_id=header._allocate_border_fill_id(container);border.set('id',border_id)
        for side in ['leftBorder','rightBorder','topBorder','bottomBorder']:
            node=border.find(HH+side)
            if node is None:raise RuntimeError('COMPLETE_BORDER_STYLE_REQUIRED')
            node.set('type','SOLID' if side in visible_sides else 'NONE');node.set('color',color);node.set('width','0.15 mm')
        container.append(border);container.set('itemCnt',str(len(container)));cell.element.set('borderFillIDRef',border_id);header.mark_dirty()
    def paragraph(parent=None,*,page_break=False):
        nonlocal used_first
        if parent is not None:p=parent.add_paragraph('')
        elif not used_first:p=first;used_first=True
        else:p=doc.add_paragraph('',include_run=False)
        if page_break:p.element.set('pageBreak','1')
        return p
    def equation_script(run):
        if run.get('eqScript'):return run['eqScript']
        latex=run.get('latex','')
        script=latex_to_eqedit(latex)
        # Generic native syntax corrections, never source value/answer edits.
        script=re.sub(r'\bperp\b','BOT',script)
        script=re.sub(r'\bcong\b','==',script)
        script=re.sub(r'\bbox\b','□',script)
        return script
    def runs(p,items,problem_id,block_id,*,size=11,bold=False):
        for index,run in enumerate(items or []):
            kind=run.get('kind','text')
            if kind=='text':
                text=run.get('text','');native=run.get('native',{});pointer=native.get('sourceRef',{}).get('sourcePointer');spans=sorted(style_spans.get(pointer,[]),key=lambda s:s['start'])
                raw16=text.encode('utf-16-le');offset=0
                for span in spans:
                    prefix=raw16[offset*2:span['start']*2].decode('utf-16-le');marked=raw16[span['start']*2:span['end']*2].decode('utf-16-le')
                    if marked!=span['text']:raise RuntimeError('UNDERLINE_SOURCE_SPAN_DRIFT:'+str(pointer))
                    if prefix:p.add_run(prefix,font=FONT,size=size,bold=bold,expand_special_characters=True)
                    p.add_run(marked,font=FONT,size=size,bold=bool(span.get('bold',bold)),underline=bool(span.get('underline',False)),expand_special_characters=True)
                    report['underlines'].append({'sourcePointer':pointer,'problemId':problem_id,'text':marked,'start':span['start'],'end':span['end']})
                    offset=span['end']
                tail=raw16[offset*2:].decode('utf-16-le')
                if tail:p.add_run(tail,font=native.get('font',FONT),size=native.get('sizePt',size),bold=bool(native.get('bold',bold)),underline=bool(run.get('underline',False)),expand_special_characters=True)
            elif kind=='blank':
                native=run.get('native',{});width=native.get('widthMm',20);height=native.get('heightMm',6)
                table=p.add_table(1,1,width=units(width),height=units(height),border_fill_id_ref=doc._root.ensure_basic_border_fill())
                cell=table.cell(0,0);line=native.get('border',{}).get('lineType','NONE')
                if native.get('fill'):table.set_cell_shading(0,0,native['fill'])
                # Color-only shading deduplication must precede the complete per-cell border clone.
                set_borders(table,0,0,['leftBorder','rightBorder','topBorder','bottomBorder'] if line!='NONE' else [])
                cp=cell.paragraphs[0];cp.text='';display=native.get('displayText','')
                if display:cp.add_run(display,font=FONT,size=9)
                cp.para_pr_id_ref=doc._root.headers[0].ensure_paragraph_format(base_para_pr_id=cp.para_pr_id_ref,alignment=native.get('align','LEFT'))
                report['blanks'].append({'problemId':problem_id,'blockId':block_id,'blankId':run['id'],'role':native.get('blankRole'),'tableId':table.element.get('id'),'displayText':display,'metadataLabelPrinted':False,'widthMm':width,'heightMm':height})
                p.add_run(' ',font=FONT,size=size)
            elif kind=='math':
                script=equation_script(run)
                if not script.strip():raise RuntimeError('EMPTY_EQUATION:'+problem_id+':'+block_id)
                width,height=estimate_equation_size(script,base_unit=1100)
                width=math.ceil(width*1.18+240)
                obj=doc.shapes.add_equation(script,paragraph=p,base_unit=1100,size=(width,height))
                report['equations'].append({'problemId':problem_id,'blockId':block_id,'runIndex':index,'objectId':obj.element.get('id'),'script':script,'latex':run.get('latex'),'width':width,'height':height})
                # Explicit text space after an inline object prevents following Korean glyph collision.
                p.add_run(' ',font=FONT,size=size)
            else:raise RuntimeError('UNKNOWN_RUN_KIND:'+str(kind))
    def pair(asset,problem_id):
        originals=asset.get('originalPath') or asset.get('originalEvidencePath')
        restored=asset.get('restoredPath') or asset.get('pngPath') or asset.get('path')
        if not originals or not restored:raise RuntimeError('FIGURE_PAIR_PATH_REQUIRED:'+str(asset))
        pair_rows=[]
        for role,path in [('original-evidence',originals),('restored',restored)]:
            image=Image.open(path);w,h=image.size
            width_mm=75.0;height_mm=width_mm*h/w
            if height_mm>95:width_mm*=95/height_mm;height_mm=95
            pair_rows.append((role,path,width_mm,height_mm))
        height_mm=max(r[3] for r in pair_rows)+12
        table=doc.add_table(1,2,width=units(166),height=units(height_mm))
        table.set_column_widths([1,1])
        for ci,(role,path,width_mm,h_mm) in enumerate(pair_rows):
            cell=table.cell(0,ci)
            set_borders(table,0,ci,[])
            label=cell.paragraphs[0];label.text='';label.add_run('원본' if ci==0 else '복원본',font=FONT,size=9,bold=True)
            p=cell.add_paragraph('');bid=doc.media.add_image(Path(path).read_bytes(),Path(path).suffix.lower().lstrip('.').replace('jpg','jpeg'))
            obj=p.add_picture(str(bid),width=units(width_mm),height=units(h_mm))
            report['imageRoles'].append({'problemId':problem_id,'figureId':asset.get('figureId',asset.get('id')),'role':role,'path':path,'sha256':digest(path),'binaryItemIDRef':str(bid),'objectId':obj.element.get('id'),'widthMm':width_mm,'heightMm':h_mm,'tableId':table.element.get('id')})
        paragraph()
    def block(b,problem_id):
        kind=b.get('kind','paragraph');bid=b.get('id',kind)
        if kind=='figure':
            fid=b.get('figureId')
            if fid in handwritten_only:return
            asset=assets.get(fid)
            if asset is None:raise RuntimeError('MISSING_FIGURE_ASSET:'+str(fid))
            pair(asset,problem_id)
        elif kind=='choices':
            native=b.get('native',{});columns=int(native.get('columns',1));choices=b.get('choices',[]);rows=math.ceil(len(choices)/columns)
            table=doc.add_table(rows,columns,width=units(166),height=units(max(12,8*rows)))
            if columns>1:table.set_column_widths([1]*columns)
            for ri in range(rows):
                for ci in range(columns):
                    set_borders(table,ri,ci,[])
                    index=ri*columns+ci;cp=table.cell(ri,ci).paragraphs[0];cp.text=''
                    if index<len(choices):
                        choice=choices[index];cp.add_run(choice.get('label','')+' ',font=FONT,size=11);runs(cp,choice.get('runs',[]),problem_id,bid)
            report['frames'].append({'problemId':problem_id,'blockId':bid,'tableId':table.element.get('id'),'kind':'native-option-table','rows':rows,'columns':columns,'nativeEditable':True})
            paragraph()
        elif kind=='frame' or kind=='proof' and b.get('native',{}).get('nativeObject')=='hp:tbl':
            native=b.get('native',{});caption=b.get('runs',[]) if b.get('rows') else []
            if caption:
                cp=paragraph();runs(cp,caption,problem_id,bid+':caption')
                if native.get('captionPlacement')=='centered-before-frame-body':cp.para_pr_id_ref=doc._root.headers[0].ensure_paragraph_format(base_para_pr_id=cp.para_pr_id_ref,alignment='CENTER')
            rows=b.get('rows') or [b.get('runs',[])]
            columns=int(b.get('columns',1));per_column=math.ceil(len(rows)/columns)
            table=doc.add_table(1,columns,width=units(166),height=units(max(12,7*per_column)))
            if columns>1:table.set_column_widths([1]*columns)
            for ci in range(columns):
                cell=table.cell(0,ci)
                # Give each column its own exact outer-edge style; no internal grid is introduced.
                header=doc._root.headers[0];container=header._border_fills_element();base_id=cell.element.get('borderFillIDRef') or table.element.get('borderFillIDRef')
                base=next(e for e in container if e.get('id')==base_id);border=copy.deepcopy(base);border_id=header._allocate_border_fill_id(container);border.set('id',border_id)
                visible=native.get('outerBorder',{}).get('lineType','SOLID')!='NONE'
                for side in ['leftBorder','rightBorder','topBorder','bottomBorder']:
                    node=border.find(HH+side)
                    if node is None:raise RuntimeError('COMPLETE_BORDER_STYLE_REQUIRED')
                    outer=side in ['topBorder','bottomBorder'] or side=='leftBorder' and ci==0 or side=='rightBorder' and ci==columns-1
                    node.set('type','SOLID' if visible and outer else 'NONE');node.set('color','#000000');node.set('width','0.15 mm')
                container.append(border);container.set('itemCnt',str(len(container)));cell.element.set('borderFillIDRef',border_id);header.mark_dirty()
                if b.get('shading'):table.set_cell_shading(0,ci,b['shading'])
                for ri,row in enumerate(rows[ci*per_column:(ci+1)*per_column]):
                    if ri==0:p=cell.paragraphs[0];p.text=''
                    else:p=cell.add_paragraph('')
                    runs(p,row,problem_id,bid+':'+str(ci*per_column+ri))
            report['frames'].append({'problemId':problem_id,'blockId':bid,'tableId':table.element.get('id'),'nativeEditable':True})
            paragraph()
        elif kind in ('paragraph','proof'):
            p=paragraph();runs(p,b.get('runs',[]),problem_id,bid)
            for ri,row in enumerate(b.get('rows',[])):runs(paragraph(),row,problem_id,bid+':row'+str(ri))
        else:raise RuntimeError('UNKNOWN_BLOCK_KIND:'+kind)
    if job.get('documentMetadataPath'):
        meta=json.loads(Path(job['documentMetadataPath']).read_text())
        for text in meta.get('printedHeader',[]):runs(paragraph(),[{'kind':'text','text':text}],'HEADER','source-header',bold=True)
        score=meta.get('scoreTable',{});rows=[score.get('columns',[])]+score.get('rows',[])
        if rows and rows[0]:
            table=doc.add_table(len(rows),len(rows[0]),width=units(166),height=units(7*len(rows)))
            for ri,row in enumerate(rows):
                for ci,text in enumerate(row):cp=table.cell(ri,ci).paragraphs[0];cp.text='';cp.add_run(str(text),font=FONT,size=10)
        for text in meta.get('printedChecks',[]):runs(paragraph(),[{'kind':'text','text':text}],'HEADER','source-check')
        paragraph()
    for b in content.get('examHeader',[]):block(b,'HEADER')
    for index,problem in enumerate(problems):
        problem_id=problem['id'];p=paragraph(page_break=index>0)
        title=('객관식 ' if problem_id.startswith('MC') else '서술형 ')+str(problem['number'])
        p.add_run(title,font=FONT,size=13,bold=True)
        report['problemStarts'].append({'problemId':problem_id,'paragraphId':p.element.get('id'),'title':title})
        seen=set()
        for b in problem['blocks']:
            block(b,problem_id)
            if b.get('kind')=='figure':seen.add(b.get('figureId'))
        for f in problem.get('figures',[]):
            if f['id'] not in seen and f['id'] not in handwritten_only:pair(assets[f['id']],problem_id)
        report['problemIds'].append(problem_id)
    out.parent.mkdir(parents=True,exist_ok=True)
    doc.save_to_path(out)
    doc.close()
    report['outputPath']=str(out);report['outputSha256']=digest(out)
    report['excludedHandwrittenOnlyFigures']=sorted(handwritten_only)
    Path(job['reportPath']).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'outputPath':str(out),'sha256':report['outputSha256'],'problems':len(problems),'nativeEquations':len(report['equations']),'images':len(report['imageRoles']),'frames':len(report['frames'])},ensure_ascii=False))
if __name__=='__main__':main(sys.argv[1])
