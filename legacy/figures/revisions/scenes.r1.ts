/** Fresh Task05 geometry, authored from original JPEG regions and frozen Task03 IR.
 * Coordinates are drawing coordinates, not recovered metric measurements.
 * No handwritten source mark, answer, or obscured proof content is generated.
 * Run with Bun; the separate renderer converts these SVGs with installed PyMuPDF.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
type P=[number,number];
type Scene={figureId:string;width:number;height:number;svg:string;interpretationStatus:string;notes:string[]};
const root=import.meta.dir,op=root+'/../..';
const digest=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const freeze=JSON.parse(readFileSync(op+'/production/source-ir/freeze.json','utf8'));
for(const pin of freeze.artifacts)if(digest(pin.path)!==pin.sha256)throw Error('FROZEN_SOURCE_CHANGED:'+pin.path);
const ir=JSON.parse(readFileSync(op+'/production/source-ir/problems.json','utf8'));
const regions=JSON.parse(readFileSync(op+'/production/source-ir/regions.json','utf8')).regions;
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
class Drawing {
 items:string[]=[];
 constructor(public width:number,public height:number){}
 line(a:P,b:P,dashed=false,weight=2){this.items.push(`<path d="M${a[0]},${a[1]} L${b[0]},${b[1]}" stroke="#111" stroke-width="${weight}" fill="none"${dashed?' stroke-dasharray="6 5"':''}/>`);}
 poly(...points:P[]){for(let i=0;i<points.length-1;i++)this.line(points[i],points[i+1]);}
 text(s:string,x:number,y:number,size=22){this.items.push(`<text x="${x}" y="${y}" text-anchor="middle" font-family="Times New Roman,serif" font-size="${size}" fill="#111">${esc(s)}</text>`);}
 dot(p:P,r=2.5){this.items.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="#111"/>`);}
 cross(p:P,r=4){this.line([p[0]-r,p[1]-r],[p[0]+r,p[1]+r],false,1.5);this.line([p[0]-r,p[1]+r],[p[0]+r,p[1]-r],false,1.5);}
 arc(v:P,a:P,b:P,r=20){let t1=Math.atan2(a[1]-v[1],a[0]-v[0]),t2=Math.atan2(b[1]-v[1],b[0]-v[0]);let dt=t2-t1;while(dt>Math.PI)dt-=2*Math.PI;while(dt< -Math.PI)dt+=2*Math.PI;t2=t1+dt;const p=(t:number):P=>[v[0]+r*Math.cos(t),v[1]+r*Math.sin(t)];let x=p(t1),y=p(t2);this.items.push(`<path d="M${x} A${r},${r} 0 0 ${dt>0?1:0} ${y}" fill="none" stroke="#111" stroke-width="1.4"/>`);}
 right(v:P,a:P,b:P,r=12){const u=unit(v,a),w=unit(v,b);this.poly(add(v,u,r),add(add(v,u,r),w,r),add(v,w,r));}
 tick(a:P,b:P,t=.5){const u=unit(a,b),m=lerp(a,b,t),n:P=[-u[1],u[0]];this.line(add(m,n,-6),add(m,n,6));}
 arrow(a:P,b:P,t=.5){const u=unit(a,b),m=lerp(a,b,t),n:P=[-u[1],u[0]];this.poly(add(add(m,u,-5),n,4),add(m,u,3),add(add(m,u,-5),n,-4));}
 svg(){return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><rect width="100%" height="100%" fill="white"/>${this.items.join('')}</svg>\n`;}
}
const unit=(a:P,b:P):P=>{const d=Math.hypot(b[0]-a[0],b[1]-a[1]);return [(b[0]-a[0])/d,(b[1]-a[1])/d];};
const add=(a:P,u:P,t:number):P=>[a[0]+u[0]*t,a[1]+u[1]*t];
const lerp=(a:P,b:P,t:number):P=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function intersection(a:P,b:P,c:P,d:P):P{const u:P=[b[0]-a[0],b[1]-a[1]],v:P=[d[0]-c[0],d[1]-c[1]],w:P=[c[0]-a[0],c[1]-a[1]];return add(a,u,(w[0]*v[1]-w[1]*v[0])/(u[0]*v[1]-u[1]*v[0]));}
function foot(p:P,a:P,b:P):P{const u=unit(a,b);return add(a,u,(p[0]-a[0])*u[0]+(p[1]-a[1])*u[1]);}
function quad(d:Drawing,A:P,B:P,C:P,D:P,diagonals=true){d.poly(A,B,C,D,A);if(diagonals){d.line(A,C);d.line(B,D);}d.text('A',A[0]-12,A[1]-10);d.text('B',B[0]-15,B[1]+20);d.text('C',C[0]+14,C[1]+20);d.text('D',D[0]+15,D[1]-8);}
function triangle(d:Drawing,A:P,B:P,C:P){d.poly(A,B,C,A);d.text('A',A[0],A[1]-13);d.text('B',B[0]-15,B[1]+17);d.text('C',C[0]+15,C[1]+17);}
const scenes:Scene[]=[];
function put(figureId:string,d:Drawing,interpretationStatus='source-supported',notes:string[]=[]){scenes.push({figureId,width:d.width,height:d.height,svg:d.svg(),interpretationStatus,notes});}

// MC01: source dimensions are external; arithmetic at the apex is excluded.
{const d=new Drawing(360,280),A:P=[180,45],B:P=[60,235],C:P=[300,235];triangle(d,A,B,C);d.text('6 cm',57,142);d.text('x cm',304,142);d.arc(A,B,C,31);d.text('y°',180,100);d.arc(B,A,C,27);d.arc(C,B,A,27);d.text('53°',104,223,20);d.text('53°',256,223,20);put('MC01-F1',d);}
{const d=new Drawing(430,300),A:P=[50,45],B:P=[50,255],C:P=[380,255],D:P=[380,45],O=intersection(A,C,B,D);quad(d,A,B,C,D);d.arc(A,B,C,28);d.text('x°',72,106);d.arc(D,A,B,32);d.text('y°',327,75);d.arc(O,B,C,27);d.text('110°',O[0],O[1]+56);d.text('O',O[0],O[1]-17);put('MC02-F1',d);}
{const d=new Drawing(650,330),A:P=[85,50],B:P=[85,270],C:P=[250,270],D:P=[365,270],E:P=[585,270],F:P=[585,105];triangle(d,A,B,C);d.poly(D,E,F,D);d.text('D',D[0]-15,D[1]+14);d.text('E',E[0]+15,E[1]+14);d.text('F',F[0]+12,F[1]-12);d.right(B,A,C,17);d.right(E,D,F,17);d.arc(A,B,C,38);d.text('37°',106,124,19);d.arc(F,D,E,36);d.text('53°',564,169,19);d.line([67,50],[67,270],true,1.3);d.text('4',45,167);d.line([85,292],[250,292],true,1.3);d.text('3',167,318);d.line([101,35],[270,261],true,1.3);d.text('5',203,143);d.line([354,250],[573,88],true,1.3);d.text('5',445,160);put('MC03-F1',d);}
{const d=new Drawing(350,290),A:P=[170,40],B:P=[45,250],C:P=[305,250],P:P=[176,187];triangle(d,A,B,C);d.line(B,P);d.line(C,P);d.dot(P);d.text('P',P[0],P[1]-12);d.arc(A,B,C,34);d.text('58°',170,101);d.arc(P,B,C,24);put('MC04-F1',d);}
{const d=new Drawing(410,300),A:P=[115,45],B:P=[45,255],C:P=[295,255],D:P=[365,45];quad(d,A,B,C,D);const O=intersection(A,C,B,D);d.text('O',O[0]-18,O[1]-7);put('MC05-F1',d);}
{const d=new Drawing(350,350),A:P=[60,45],B:P=[60,295],C:P=[310,295],D:P=[310,45];quad(d,A,B,C,D);for(const [v,a,b] of [[A,B,D],[B,A,C],[C,B,D],[D,A,C]] as [P,P,P][])d.right(v,a,b,17);for(const [a,b] of [[A,B],[B,C],[C,D],[D,A]] as [P,P][])d.tick(a,b);d.text('O',194,198);put('MC06-F1',d);}
{const d=new Drawing(340,440),A:P=[170,45],B:P=[45,220],C:P=[170,395],D:P=[295,220];d.poly(A,B,C,D,A);d.line(A,C);d.line(B,D);d.text('A',170,27);d.text('B',24,227);d.text('C',170,424);d.text('D',316,227);d.text('O',187,247);put('MC08-F1',d,'source-supported',['Interior pencil angles and uncertain small arcs are omitted; no new angle equality is asserted.']);}
{const d=new Drawing(420,410),A:P=[50,150],B:P=[50,350],C:P=[360,350],D:P=[360,150],F:P=[360,50],E=intersection(B,F,A,D);quad(d,A,B,C,D,false);d.line(B,F);d.line(C,F);d.line(E,C);d.text('E',E[0]-14,E[1]-15);d.text('F',F[0]+14,F[1]-12);d.right(A,B,D);d.right(C,B,D);d.right(D,A,C);put('MC09-F1',d);}
{const d=new Drawing(400,390),A:P=[190,45],B:P=[50,340],C:P=[350,340],D:P=[195,340],E=lerp(A,B,.46),F=lerp(A,C,.74),P=intersection(A,D,E,F);triangle(d,A,B,C);d.line(A,D,true);d.line(E,F,true);d.line(B,P);d.line(B,F);d.text('D',D[0],D[1]+27);d.text('E',E[0]-18,E[1]);d.text('F',F[0]+17,F[1]+7);d.text('P',P[0]+15,P[1]-13);d.arc(P,B,D,25);d.text('48°',P[0]-31,P[1]+49);put('MC10-F1',d);}
// MC11: no unreadable O/I identity enters the primary reconstruction.
function mc11(assignment?:'left-I'|'left-O'){const d=new Drawing(470,350),A:P=[345,45],B:P=[55,285],C:P=[405,285];triangle(d,A,B,C);d.text('23°',397,115);if(assignment){const L:P=[225,213],R:P=[286,228];for(const V of [A,B,C]){d.line(V,L,true,1.4);d.line(V,R,true,1.4);}d.dot(L);d.dot(R);d.text(assignment==='left-I'?'I':'O',L[0]-5,L[1]-10);d.text(assignment==='left-I'?'O':'I',R[0]+8,R[1]-10);}return d;}
put('MC11-F1',mc11(),'unresolved-alternatives',['Only clearly printed outer ABC and23° are in the primary asset. Interior topology is withheld. Two separate dashed schematic candidate files retain opposite O/I assignments and do not assert recovered source topology.']);
{const d=new Drawing(330,440),A:P=[80,45],B:P=[80,385],C:P=[270,385],D:P=[270,45];quad(d,A,B,C,D);d.text('O',194,225);put('MC13-F1',d,'source-supported',['Only printed rectangle and diagonals reconstructed. Outer pencil diamond and unestablished PQRS labels omitted.']);}
{const d=new Drawing(530,340),A:P=[265,55],B:P=[45,275],C:P=[485,275],D:P=[265,275],E:P=[375,165],I:P=[265,190],P=intersection(I,C,D,E);triangle(d,A,B,C);d.line(A,D);d.line(D,E);d.line(I,C);d.right(A,B,C,15);d.right(E,D,C,13);d.tick(B,D);d.tick(D,C);d.text('D',D[0],D[1]+27);d.text('E',E[0]+12,E[1]-10);d.text('I',I[0]-15,I[1]-5);d.text('P',P[0]+4,P[1]+24);put('MC14-F1',d);}
{const d=new Drawing(530,350),A:P=[60,55],B:P=[60,305],C:P=[475,305],D:P=[475,55],M:P=[267,55];quad(d,A,B,C,D,false);d.line(B,M);d.line(C,M);d.text('M',M[0],M[1]-15);put('MC16-F1',d,'source-supported',['The pencil inner triangle, shading, dimensions and unestablished EFG labels are omitted.']);}
{const d=new Drawing(650,350),A:P=[155,50],B:P=[55,295],C:P=[500,295],D:P=[600,50],E:P=[330,158];quad(d,A,B,C,D,false);for(const V of [A,B,C,D])d.line(V,E);d.text('E',E[0]-12,E[1]+27);d.dot([87,254],4);d.dot([112,278],4);d.cross([465,274]);d.cross([488,258]);put('CR01-F1',d);}
{const d=new Drawing(380,370),A:P=[180,40],B:P=[45,315],C:P=[335,315],D=foot(C,A,B),E=foot(A,B,C),F=foot(B,A,C),P=intersection(A,E,B,F);triangle(d,A,B,C);d.line(A,E);d.line(B,F);d.line(C,D);d.right(D,A,C,11);d.right(E,A,C,11);d.right(F,A,B,11);d.text('D',D[0]-19,D[1]-7);d.text('E',E[0],E[1]+28);d.text('F',F[0]+16,F[1]-8);d.text('P',P[0]+15,P[1]-10);d.dot(P);d.arc(A,B,P,38);d.text('x',A[0]-16,A[1]+80);d.arc(B,C,P,37);d.text('y',B[0]+60,B[1]-12);d.arc(C,A,P,38);d.text('z',C[0]-39,C[1]-55);put('CR02-F1',d);}
{const d=new Drawing(600,360),A:P=[220,55],B:P=[60,300],C:P=[360,300],E:P=[520,55];d.poly(A,B,C,E,A);d.line(A,C);d.text('A(F)',A[0]-5,A[1]-16);d.text('B',B[0]-19,B[1]+20);d.text('C(D)',C[0]+27,C[1]+25);d.text('E',E[0]+20,E[1]+1);put('CR03-F1',d,'unresolved-alternatives',['Primary omits uncertain small arcs at A(F) and C(D). A separate candidate with arcs retains the competing printed-mark interpretation.']);}
function plotOne(){const d=new Drawing(400,300),A:P=[133,55],B:P=[173,240],C:P=[250,240],D:P=[210,55],P=lerp(D,C,.47);d.poly([45,55],[350,55],[350,240],[45,240],[45,55]);d.line(A,B);d.line(D,C);d.line(A,C);d.line(A,P);d.line(P,B);d.arrow(A,B);d.arrow(D,C);d.text('A',A[0],A[1]-13);d.text('D',D[0],D[1]-13);d.text('B',B[0],B[1]+27);d.text('C',C[0],C[1]+27);d.text('P',P[0]+17,P[1]);return d;}
put('CR04-F1',plotOne(),'source-supported',['The AD/AC discrepancy is a source text uncertainty only; the diagram contains the observed AC diagonal and bent APB.']);
{const d=new Drawing(450,340),A:P=[152,60],B:P=[202,275],C:P=[295,275],D:P=[245,60],O=intersection(A,C,D,B),E:P=[O[0],60],F:P=[O[0],275];d.poly([45,60],[400,60],[400,275],[45,275],[45,60]);d.line(A,B);d.line(D,C);d.line(A,C);d.line(D,B);d.line(E,F);d.arrow(A,B);d.arrow(D,C);d.right(E,A,F,13);d.text('A',A[0],A[1]-15);d.text('D',D[0]+9,D[1]-15);d.text('E',E[0]-7,E[1]-15);d.text('B',B[0]-7,B[1]+28);d.text('F',F[0]+6,F[1]+28);d.text('C',C[0]+5,C[1]+28);d.text('O',O[0]+16,O[1]-4);put('CR04-F2',d);}

// Alternative candidates never replace the primary source-qualified asset.
const alternatives=[
 {figureId:'MC11-F1',id:'left-I-right-O',drawing:mc11('left-I'),status:'schematic-approximation',uncertaintyIds:['MC11-A02']},
 {figureId:'MC11-F1',id:'left-O-right-I',drawing:mc11('left-O'),status:'schematic-approximation',uncertaintyIds:['MC11-A02']},
 {figureId:'CR03-F1',id:'arcs-possibly-printed',drawing:(()=>{const d=new Drawing(600,360),A:P=[220,55],B:P=[60,300],C:P=[360,300],E:P=[520,55];d.poly(A,B,C,E,A);d.line(A,C);d.text('A(F)',215,39);d.text('B',41,320);d.text('C(D)',387,325);d.text('E',540,56);d.arc(A,E,C,25);d.arc(C,B,A,25);return d;})(),status:'unresolved-alternatives',uncertaintyIds:['CR03-A01']}
];
const printed=ir.problems.flatMap((p:any)=>p.figures).filter((f:any)=>f.geometry?.sourceRole!=='handwritten-only');
if(printed.length!==18||scenes.length!==18||new Set(scenes.map(s=>s.figureId)).size!==18)throw Error('EXACT_PRINTED_FIGURE_COUNT_REQUIRED');
for(const s of scenes){if(!printed.some((f:any)=>f.id===s.figureId))throw Error('UNKNOWN_FIGURE:'+s.figureId);const p=root+'/svg/'+s.figureId+'.svg';if(existsSync(p))throw Error('NO_SILENT_ASSET_OVERWRITE:'+p);writeFileSync(p,s.svg,{flag:'wx'});}
for(const a of alternatives){const p=root+'/alternatives/'+a.figureId+'-'+a.id+'.svg';if(existsSync(p))throw Error('NO_SILENT_ASSET_OVERWRITE:'+p);writeFileSync(p,a.drawing.svg(),{flag:'wx'});}
const metadata={schema:'jungdong.fresh-scene-index.v1',codePath:root+'/scenes.ts',codeSha256:digest(root+'/scenes.ts'),sourceIRSha256:freeze.sourceIRSha256,regionsSha256:freeze.regionsSha256,ambiguitiesSha256:freeze.ambiguitiesSha256,scenes:scenes.map(({svg,...s})=>s),alternatives:alternatives.map(({drawing,...a})=>({...a,path:root+'/alternatives/'+a.figureId+'-'+a.id+'.svg'})),excludedHandwritten:ir.problems.flatMap((p:any)=>p.figures).filter((f:any)=>f.geometry?.sourceRole==='handwritten-only').map((f:any)=>({figureId:f.id,sourceRegionId:f.regionId,reason:'handwritten-only; excluded by immutable source role and merge contract; no restored figure is generated'})),acceptanceDecision:null};
writeFileSync(root+'/scene-index.json',JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({freshPrintedSVGs:scenes.length,alternativeSVGs:alternatives.length,excludedHandwritten:metadata.excludedHandwritten.map((f:any)=>f.figureId),codeSha256:metadata.codeSha256}));
