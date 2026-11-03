"""Patch selected embedded PNG payloads without serializing HWPX XML/layout.
Stdlib only. Exact input/replacement pins and independent member readback required.
"""
from pathlib import Path
import sys,json,hashlib,zipfile,io,struct,time
from collections import Counter
from xml.etree import ElementTree as E
sha=lambda b:hashlib.sha256(b).hexdigest()
HP='{http://www.hancom.co.kr/hwpml/2011/paragraph}';HC='{http://www.hancom.co.kr/hwpml/2011/core}';OPF='{http://www.idpf.org/2007/opf/}'
def dims(b):
 if b[:8]!=b'\x89PNG\r\n\x1a\n' or b[12:16]!=b'IHDR':raise ValueError('Replacement must be PNG')
 return struct.unpack('>II',b[16:24])
def main(jobpath):
 started=time.perf_counter();job=json.loads(Path(jobpath).read_text());source=Path(job['input']['path']);original=source.read_bytes()
 assert sha(original)==job['input']['sha256'],'Source package pin drift'
 out=Path(job['output']);assert source.resolve()!=out.resolve(),'Versioned output must differ';assert not out.exists(),'Output already exists'
 patches={};bindings=[]
 with zipfile.ZipFile(io.BytesIO(original)) as zin:
  infos=zin.infolist();names=[i.filename for i in infos];assert len(set(names))==len(names),'Duplicate ZIP names'
  assert zin.testzip() is None
  payload={n:zin.read(n) for n in names};section=E.fromstring(payload['Contents/section0.xml']);manifest=E.fromstring(payload['Contents/content.hpf'])
  items={i.get('id'):i.get('href') for i in manifest.iter(OPF+'item')};tables={t.get('id'):t for t in section.iter(HP+'tbl')};refs=Counter(i.get('binaryItemIDRef') for i in section.iter(HC+'img'))
  for edit in job['edits']:
   table=tables[edit['questionTableId']];text=''.join(t.text or '' for t in table.iter(HP+'t'));assert text.startswith(str(edit['questionId'])+'. '),'Wrong question binding'
   pics=list(table.iter(HP+'pic'));assert len(pics)==1,'Explicit picture binding required for multi-image questions'
   pic=pics[0];assert pic.get('id')==edit['pictureControlId'],'Picture control drift'
   media=next(pic.iter(HC+'img')).get('binaryItemIDRef');assert refs[media]==1,'Shared media requires an XML-aware successor, not global payload replacement'
   member=items[media];assert member.startswith('BinData/') and member.endswith('.png') and member in payload
   assert member==edit['member'] and sha(payload[member])==edit['expectedOldSha256'],'Bound media drift'
   png=Path(edit['replacement']['path']).read_bytes();assert sha(png)==edit['replacement']['sha256'],'Replacement pin drift'
   assert dims(png)==dims(payload[member]),'Pixel dimensions changed: layout review required'
   assert member not in patches and png!=payload[member],'Duplicate or no-op edit'
   patches[member]=png;bindings.append({'questionId':edit['questionId'],'pictureControlId':pic.get('id'),'binaryItemId':media,'member':member,'oldSha256':sha(payload[member]),'newSha256':sha(png),'pixelSize':dims(png),'repair':edit['repair']})
  buffer=io.BytesIO()
  with zipfile.ZipFile(buffer,'w') as zout:
   zout.comment=zin.comment
   for info in infos:zout.writestr(info,patches.get(info.filename,payload[info.filename]))
  result=buffer.getvalue()
 with zipfile.ZipFile(io.BytesIO(result)) as check:
  assert check.testzip() is None;assert check.namelist()==names
  changed=[n for n in names if check.read(n)!=payload[n]];assert set(changed)==set(patches),'Unexpected member mutation'
  untouched=[n for n in names if n not in patches];assert all(check.read(n)==payload[n] for n in untouched)
  assert check.read('Contents/section0.xml')==payload['Contents/section0.xml']
 out.parent.mkdir(parents=True,exist_ok=True)
 with out.open('xb') as f:f.write(result)
 assert sha(out.read_bytes())==sha(result),'Output readback drift';assert sha(source.read_bytes())==job['input']['sha256'],'Input changed'
 report={'schema':'daechi.selected-image-patch.v1','input':job['input'],'output':{'path':str(out),'sha256':sha(result)},'bindings':bindings,'changedMembers':changed,'preservedMemberCount':len(untouched),'allNonTargetMembersByteIdentical':True,'allXmlAndEquationsAndTableLayoutByteIdentical':True,'unchangedPixelAndControlDimensions':True,'sourceUnchanged':True,'packagePatchWallMs':round((time.perf_counter()-started)*1000,3),'packageCheck':'passed','nativeRender':'pending','acceptanceDecision':None}
 Path(job['receipt']).write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main(sys.argv[1])
