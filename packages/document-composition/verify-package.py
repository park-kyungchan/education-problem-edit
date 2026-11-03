"""Independent exact-package reader; structural/source conservation only, never model quality or acceptance."""
import json,sys,hashlib,re,posixpath,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
HP='{http://www.hancom.co.kr/hwpml/2011/paragraph}'
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(value):
    if isinstance(value,list):return [canonical(v) for v in value]
    if not isinstance(value,dict):return value
    keys={'id','kind','number','page','regionId','blocks','runs','choices','label','text','latex','rows','figureId','sourceUncertainties'}
    return {k:canonical(v) for k,v in value.items() if k in keys}
def all_runs(value):
    if isinstance(value,list):
        for v in value:yield from all_runs(v)
    elif isinstance(value,dict):
        if value.get('kind') in ('text','math','blank'):yield value
        else:
            for v in value.values():yield from all_runs(v)
def main(job_path):
    job=json.loads(Path(job_path).read_text());source=json.loads(Path(job['sourceIrPath']).read_text());content=json.loads(Path(job['nativeContentPath']).read_text());composition=json.loads(Path(job['compositionReportPath']).read_text())
    package=Path(job['hwpxPath']);raw=package.read_bytes();checks=[]
    def check(name,passed,detail):checks.append({'id':name,'state':'passed' if passed else 'failed','detail':detail})
    check('new-package-sha256-matches-composition',sha(raw)==composition['outputSha256'],{'actual':sha(raw),'expected':composition['outputSha256']})
    check('source-native-content-full20-identities',[p['id'] for p in source['problems']]==[p['id'] for p in content['problems']] and len(source['problems'])==20,{ 'sourceIds':[p['id'] for p in source['problems']]})
    changed=[]
    for s,c in zip(source['problems'],content['problems']):
        if canonical(s)!=canonical(c):changed.append(s['id'])
    check('native-styling-does-not-change-frozen-source-fields',not changed,{'changedProblemIds':changed,'ignoredOnly':'native styles/scripts/metadata; source text/LaTeX/choices/blocks/rows remain exact'})
    with zipfile.ZipFile(package) as z:
        names=z.namelist();check('unique-package-members',len(names)==len(set(names)),{'memberCount':len(names)})
        check('standard-mimetype',z.read('mimetype').decode().strip()=='application/hwp+zip',{'actual':z.read('mimetype').decode().strip()})
        xml={};xml_errors=[]
        for n in names:
            if n.endswith(('.xml','.hpf')):
                try:xml[n]=ET.fromstring(z.read(n))
                except Exception as e:xml_errors.append({'member':n,'error':str(e)})
        check('all-xml-parses',not xml_errors,{'count':len(xml),'errors':xml_errors})
        sections=[v for k,v in xml.items() if re.search(r'/section\d+\.xml$',k)]
        equations=[e for s in sections for e in s.iter(HP+'equation')];pictures=[e for s in sections for e in s.iter(HP+'pic')];tables=[e for s in sections for e in s.iter(HP+'tbl')]
        scripts=[e.findtext(HP+'script','') for e in equations]
        check('native-equation-scripts-exact',scripts==[e['script'] for e in composition['equations']],{'xmlEquationCount':len(scripts),'compositionEquationCount':len(composition['equations'])})
        src_runs=[r for p in source['problems'] for r in all_runs(p.get('blocks',[]))]
        source_math_count=sum(r['kind']=='math' for r in src_runs)
        header_math_count=sum(r['kind']=='math' for r in all_runs(content.get('examHeader',[])))
        check('every-source-math-run-native',len(equations)==source_math_count+header_math_count,{'sourceBodyMathRuns':source_math_count,'headerMathRuns':header_math_count,'nativeEquationCount':len(equations)})
        text=''.join(''.join(e.itertext()) for s in sections for e in s.iter(HP+'t'));flat=re.sub(r'\s+','',text)
        missing=[]
        for p in source['problems']:
            for run in all_runs(p.get('blocks',[])):
                if run['kind']=='text':
                    fragment=re.sub(r'\s+','',run.get('text',''))
                    if fragment and fragment not in flat:missing.append({'problemId':p['id'],'text':run.get('text')})
        check('printed-text-fragments-preserved-in-native-xml',not missing,{'missing':missing,'nativeTextCharacters':len(text)})
        member_hashes={sha(z.read(n)):n for n in names if n.startswith('BinData/')}
        missing_assets=[]
        for role in composition['imageRoles']:
            if role['sha256'] not in member_hashes:missing_assets.append(role)
        check('exact-original-and-restored-image-member-bytes',not missing_assets,{'expectedRoles':len(composition['imageRoles']),'packagePictureCount':len(pictures),'missing':missing_assets})
        check('image-control-count-matches-role-map',len(pictures)==len(composition['imageRoles']),{'pictures':len(pictures),'roles':len(composition['imageRoles'])})
        check('native-frame-controls-present',len(tables)>=len(composition['frames']),{'xmlTables':len(tables),'declaredNativeFrames':len(composition['frames'])})
        href_errors=[]
        for n,tree in xml.items():
            if not n.endswith('content.hpf'):continue
            for item in tree.iter():
                href=item.get('href')
                if href and '://' not in href and not href.startswith('#'):
                    candidates=[posixpath.normpath(posixpath.join(posixpath.dirname(n),href)),posixpath.normpath(href)]
                    if not any(v in names for v in candidates):href_errors.append({'manifest':n,'href':href,'resolved':candidates})
        check('manifest-references-reachable',not href_errors,{'errors':href_errors})
    report={'schema':'jungdong.independent-package-readback.v1','hwpxPath':str(package),'hwpxSha256':sha(raw),'sourceIrPath':job['sourceIrPath'],'sourceIrSha256':sha(Path(job['sourceIrPath']).read_bytes()),'state':'passed' if all(c['state']=='passed' for c in checks) else 'failed','checks':checks,'nativeCounts':{'equations':len(equations),'pictures':len(pictures),'tables':len(tables)},'sourceAccuracyAcceptance':None,'modelQualityEvaluation':False,'acceptanceDecision':None}
    Path(job['outputReport']).parent.mkdir(parents=True,exist_ok=True);Path(job['outputReport']).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'state':report['state'],'checks':len(checks),'failures':[c['id'] for c in checks if c['state']=='failed'],'report':job['outputReport']}))
    return 0 if report['state']=='passed' else 1
if __name__=='__main__':sys.exit(main(sys.argv[1]))
