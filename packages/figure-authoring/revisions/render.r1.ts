/** Deterministic local SVG rasterization and exact original-evidence verification. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=import.meta.dir,op=root+'/../..';
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const index=json(root+'/scene-index.json'),freeze=json(op+'/production/source-ir/freeze.json');
for(const p of [...freeze.artifacts,...freeze.originalPages])if(sha(p.path)!==p.sha256)throw Error('SOURCE_PIN_CHANGED:'+p.path);
if(sha(root+'/scenes.ts')!==index.codeSha256)throw Error('SCENE_CODE_CHANGED');
const script=String.raw`
import fitz,json,os,hashlib
from PIL import Image,ImageDraw,ImageChops
r=os.environ['JUNGDONG_FIGURE_ROOT'];op=r+'/../..'
idx=json.load(open(r+'/scene-index.json'))
records=[]
ordered=[(s['figureId'],r+'/svg/'+s['figureId']+'.svg',r+'/restored/'+s['figureId']+'.png',False) for s in idx['scenes']]
ordered += [(a['figureId']+'-'+a['id'],a['path'],a['path'][:-4]+'.png',True) for a in idx['alternatives']]
for fid,svg,png,alt in ordered:
 if os.path.exists(png):raise RuntimeError('NO_SILENT_RENDER_OVERWRITE:'+png)
 doc=fitz.open(svg);pix=doc[0].get_pixmap(matrix=fitz.Matrix(2,2),alpha=False);pix.save(png);doc.close()
 im=Image.open(png).convert('RGB');assert im.getextrema()!=((255,255),(255,255),(255,255))
 records.append({'id':fid,'svgPath':svg,'pngPath':png,'widthPixels':im.width,'heightPixels':im.height,'scale':2,'alternativeOnly':alt,'renderer':'installed PyMuPDF '+fitz.VersionBind})
regs={a['id']:a for a in json.load(open(op+'/production/source-ir/regions.json'))['regions']}
ir=json.load(open(op+'/production/source-ir/problems.json'))
checks=[]
for p in ir['problems']:
 for f in p['figures']:
  reg=regs[f['regionId']];expected=Image.open(reg['imagePath']).convert('RGB').crop(reg['bboxPixels']);path=r+'/evidence/'+f['id']+'-original.png';actual=Image.open(path).convert('RGB');assert expected.size==actual.size
  equal=ImageChops.difference(expected,actual).getbbox() is None;assert equal
  checks.append({'figureId':f['id'],'sourceRegionId':reg['id'],'bboxPixels':reg['bboxPixels'],'cropSize':list(actual.size),'exactRGBPixelEquality':equal,'transform':'identity crop with half-open [left,top,right,bottom] integer edges; RGB conversion; no scaling, filtering, retouching or sharpening'})
# Review sheets display only this Task's newly rendered assets.
for k in range(0,len(records),6):
 canvas=Image.new('RGB',(1200,1260),'#eee');draw=ImageDraw.Draw(canvas)
 for i,rec in enumerate(records[k:k+6]):
  im=Image.open(rec['pngPath']).convert('RGB');im.thumbnail((555,365));x=(i%2)*600;y=(i//2)*420;draw.text((x+15,y+8),rec['id'],fill='black');canvas.paste(im,(x+20,y+40))
 canvas.save(r+'/review-render-'+str(k//6+1)+'.png')
result={'schema':'jungdong.figure-raster-readback.v1','records':records,'originalCropChecks':checks,'allExactOriginalCrops':all(c['exactRGBPixelEquality'] for c in checks),'sourceAccuracyAcceptance':None,'acceptanceDecision':None}
open(r+'/raster-readback.json','x').write(json.dumps(result,indent=2)+'\n')
print(json.dumps({'rendered':len(records),'primary':sum(not a['alternativeOnly'] for a in records),'alternatives':sum(a['alternativeOnly'] for a in records),'exactCrops':len(checks)}))
`;
const p=Bun.spawnSync(['python3','-c',script],{env:{...process.env,JUNGDONG_FIGURE_ROOT:root},stdout:'pipe',stderr:'pipe'});
const result={schema:'jungdong.local-render-command.v1',rendererCodePath:root+'/render.ts',rendererCodeSha256:sha(root+'/render.ts'),sceneCodeSha256:sha(root+'/scenes.ts'),exitCode:p.exitCode,stdout:p.stdout.toString(),stderr:p.stderr.toString(),at:new Date().toISOString(),acceptanceDecision:null};
writeFileSync(root+'/render-command-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
if(p.exitCode!==0)throw Error('LOCAL_RENDER_FAILED:'+p.stderr.toString());
console.log(result.stdout);
