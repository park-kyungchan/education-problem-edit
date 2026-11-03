/** Stage 1 authored geometry. Coordinates are layout choices, never solved readings. */
import { writeFile } from 'node:fs/promises';
export type Point = [number, number];
export type Primitive =
  | { kind: 'path'; points: Point[]; closed?: boolean; dash?: boolean; width?: number }
  | { kind: 'label'; at: Point; text: string; size?: number; italic?: boolean; anchor?: 'start'|'middle'|'end' }
  | { kind: 'dot'; at: Point; radius: number };
export type Scene = { id: string; width: number; height: number; primitives: Primitive[]; relations: string[]; sourceObservation: string; interpretation: string; unresolved: string[]; status: 'clean-replaced'|'unresolved-with-explicit-placeholder' };
const scenes: Scene[] = [];
let s: Scene;
function scene(id:string,w:number,h:number,observation:string,interpretation='Clean layout B; regularized edges and spacing; only directly admitted printed content.') {
  s={id,width:w,height:h,primitives:[],relations:[],sourceObservation:observation,interpretation,unresolved:[],status:'clean-replaced'};scenes.push(s);
}
function line(...points:Point[]) {s.primitives.push({kind:'path',points});}
function poly(...points:Point[]) {s.primitives.push({kind:'path',points,closed:true});}
function dash(...points:Point[]) {s.primitives.push({kind:'path',points,dash:true,width:1.5});}
function label(text:string,x:number,y:number,size=25,italic=false,anchor:'start'|'middle'|'end'='middle') {s.primitives.push({kind:'label',at:[x,y],text,size,italic,anchor});}
function dot(x:number,y:number,r=4) {s.primitives.push({kind:'dot',at:[x,y],radius:r});}
function tick(x:number,y:number,dx:number,dy:number) {line([x-dx,y-dy],[x+dx,y+dy]);}
function arc(v:Point,a:Point,b:Point,r:number) {
  let t0=Math.atan2(a[1]-v[1],a[0]-v[0]),t1=Math.atan2(b[1]-v[1],b[0]-v[0]);
  while(t1-t0>Math.PI)t1-=2*Math.PI;while(t1-t0< -Math.PI)t1+=2*Math.PI;
  const p:Point[]=[];for(let i=0;i<=24;i++){const t=t0+(t1-t0)*i/24;p.push([v[0]+r*Math.cos(t),v[1]+r*Math.sin(t)]);}s.primitives.push({kind:'path',points:p,width:1.5});
}
function right(v:Point,a:Point,b:Point,r=15) {
  const unit=(p:Point):Point=>{const d=Math.hypot(p[0]-v[0],p[1]-v[1]);return[(p[0]-v[0])/d,(p[1]-v[1])/d];};
  const u=unit(a),w=unit(b);line([v[0]+r*u[0],v[1]+r*u[1]],[v[0]+r*(u[0]+w[0]),v[1]+r*(u[1]+w[1])],[v[0]+r*w[0],v[1]+r*w[1]]);
}
function arrow(a:Point,b:Point,t=.5) {const x=a[0]+t*(b[0]-a[0]),y=a[1]+t*(b[1]-a[1]),d=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/d,uy=(b[1]-a[1])/d;line([x-8*ux-5*uy,y-8*uy+5*ux],[x,y],[x-8*ux+5*uy,y-8*uy-5*ux]);}
const A:Point=[110,70], B:Point=[110,340], C:Point=[500,340], D:Point=[500,70];
function rectDiagram(topology:'diagonals'|'M'='diagonals') {
 poly(A,B,C,D);if(topology==='diagonals'){line(A,C);line(B,D);}else{line(B,[305,70]);line(C,[305,70]);label('M',305,43);}
 label('A',89,60);label('B',89,354);label('C',519,354);label('D',519,60);
}
scene('mc01',500,380,'p1 [670,1110,960,1320]: ABC; 6 cm; x cm; y°, 53°, 53°. Pencil 74 omitted.');
{
 const a:Point=[250,65],b:Point=[85,310],c:Point=[415,310];poly(a,b,c);label('A',250,39);label('B',62,319);label('C',438,319);
 arc(a,b,c,28);arc(b,a,c,35);arc(c,a,b,35);label('y°',250,124,24,true);label('53°',151,287);label('53°',349,287);
 label('6 cm',88,175);label('x',394,175,25,true);label('cm',432,175,25);
 s.relations=['Three edges form triangle ABC; base labels are 53° at both vertices.'];
}
scene('mc02',610,420,'p1: rectangle ABCD; diagonals AC/BD; O; ∠BAC x°, ∠ADB y°, ∠BOC 110°.');
rectDiagram();label('O',305,183);arc(A,B,C,30);arc(D,A,B,40);arc([305,205],B,C,34);label('x°',141,127,25,true);label('y°',442,95,25,true);label('110°',305,266);
s.relations=['O is the intersection of AC and BD.'];
scene('mc03',820,420,'p1 [465,2300,1220,2730]: two printed right triangles; AB4 BC3 AC5 DF5; A37° F53°. DE4 and EF3 are pencil, excluded.');
{
 const a:Point=[100,75],b:Point=[100,330],c:Point=[290,330],d:Point=[480,315],e:Point=[735,315],f:Point=[735,125];poly(a,b,c);poly(d,e,f);right(b,a,c);right(e,d,f);
 for(const [t,x,y] of [['A',82,55],['B',80,346],['C',311,343],['D',461,328],['E',757,328],['F',755,109]] as [string,number,number][])label(t,x,y);
 arc(a,b,c,36);arc(f,d,e,36);label('37°',135,175);label('53°',689,199);
 dash([76,84],[66,195],[76,323]);label('4',43,205);dash([110,354],[199,365],[280,354]);label('3',199,394);
 dash([114,58],[229,175],[311,317]);label('5',241,171);dash([482,287],[580,195],[720,105]);label('5',586,166);
 s.relations=['Right angle at B; right angle at E; distinct triangles are not joined.'];
}
scene('mc04',440,440,'p1: triangle ABC, interior P, BP CP, A58°, unlabelled ∠BPC arc.');
{
 const a:Point=[220,65],b:Point=[60,365],c:Point=[380,365],p:Point=[220,265];poly(a,b,c);line(b,p,c);dot(...p,3);arc(a,b,c,33);arc(p,b,c,29);label('A',220,36);label('B',39,378);label('C',400,378);label('P',220,238);label('58°',220,137);
}
scene('mc05',580,420,'p1: parallelogram ABCD and diagonals with O, without numerical labels.');
{
 const a:Point=[170,75],b:Point=[65,340],c:Point=[410,340],d:Point=[515,75];poly(a,b,c,d);line(a,c);line(b,d);label('A',159,49);label('B',43,356);label('C',426,358);label('D',535,62);label('O',236,201);
}
scene('mc06',450,450,'p1: printed square, diagonals, O, one equality tick on each side, four right angle marks. Curved pencil dimensions and repeated 3 excluded.');
{
 const a:Point=[75,75],b:Point=[75,375],c:Point=[375,375],d:Point=[375,75];poly(a,b,c,d);line(a,c);line(b,d);right(a,b,d);right(b,a,c);right(c,b,d);right(d,a,c);tick(225,75,0,8);tick(225,375,0,8);tick(75,225,8,0);tick(375,225,8,0);
 label('A',54,59);label('B',54,391);label('C',397,391);label('D',397,59);label('O',225,185);
}
scene('mc08',400,580,'p2: diamond ABCD, AC and BD; O. Fine arcs overlap pencil; numeric 32 is in preserved native stem, not added to image.');
{
 const a:Point=[200,60],b:Point=[55,290],c:Point=[200,520],d:Point=[345,290];poly(a,b,c,d);line(a,c);line(b,d);label('A',200,33);label('B',30,298);label('C',200,551);label('D',369,298);label('O',222,315);
 s.unresolved=['Fine angle arcs cannot all be separated from pencil; doubtful arcs omitted, no numeric source label inferred.'];
 s.status='unresolved-with-explicit-placeholder';
}
scene('mc09',540,520,'p2: ABCD rectangle, E on AD, B-E-F, CD extension to F, EC and ∠CED arc. Pencil perpendicular from E and all numeric answers omitted.');
{
 const a:Point=[75,200],b:Point=[75,445],c:Point=[455,445],d:Point=[455,200],e:Point=[320,200],f:Point=[455,65];poly(a,b,c,d);line(b,f);line(d,f);line(e,c);right(a,b,d);right(c,b,d);arc(e,d,c,30);
 for(const[t,x,y]of[['A',51,192],['B',51,462],['C',478,462],['D',480,205],['E',302,169],['F',474,52]] as [string,number,number][])label(t,x,y);
 s.relations=['E lies on AD and BF; F lies on extension of CD.'];
}
scene('mc10',490,550,'p2: isosceles triangle; dashed folds AD and EF cross at P; solid BP and BF; 48° at BPD.');
{
 const a:Point=[245,65],b:Point=[65,470],c:Point=[425,470],d:Point=[245,470],e:Point=[151,276],f:Point=[378,364],p:Point=[245,312.44];poly(a,b,c);dash(a,d);dash(e,f);line(b,p);line(b,f);arc(p,b,d,33);label('48°',211,371);
 for(const[t,x,y]of[['A',245,37],['B',42,484],['C',447,484],['D',245,504],['E',128,267],['F',402,367],['P',266,302]] as [string,number,number][])label(t,x,y);
 s.relations=['P is intersection of dashed AD and EF; 48° is between PB and PD.'];
}
scene('mc11',680,480,'p2 [1510,1640,2000,2040]: outer ABC and 23° label are visible; interior O/I positions and ray assignments obscured. No angle C value established.');
{
 const a:Point=[500,65],b:Point=[65,395],c:Point=[575,395];poly(a,b,c);label('A',505,35);label('B',41,408);label('C',596,408);label('23°',595,123);line([568,132],[528,133]);
 dash([290,220],[475,220],[505,342],[195,342],[290,220]);label('O / I',367,270,25);label('내부 선·각 끝점 판독 보류',351,307,18);
 s.status='unresolved-with-explicit-placeholder';s.unresolved=['Exact O/I placement and interior connections cannot be recovered reliably. Dashed outline and Korean note are editorial placeholders, not source lines.','23° leader is preserved as a source label without inventing its hidden arc endpoints.','No extra ∠C condition or value is introduced.'];
}
scene('mc13',390,590,'p3: tall printed ABCD rectangle and AC/BD, O. Broad gray diamond and its diagonals are pencil and omitted.');
{
 const a:Point=[85,65],b:Point=[85,520],c:Point=[305,520],d:Point=[305,65];poly(a,b,c,d);line(a,c);line(b,d);label('A',62,51);label('B',62,538);label('C',328,538);label('D',328,51);label('O',216,305);
}
scene('mc14',720,420,'p3 [1350,810,1925,1150]: right isosceles ABC; A-I-D; I-C; D-P-E; right marks at A/E; equal BD/DC; ∠IPE arc. The small 45° near B has print-consistent type; C-side 45 is pencil.');
{
 const a:Point=[360,65],b:Point=[65,360],c:Point=[655,360],d:Point=[360,360],i:Point=[360,237.8],e:Point=[507.5,212.5],p:Point=[446.4,273.6];poly(a,b,c);line(a,d);line(i,c);line(d,e);right(a,b,c);right(e,a,d);tick(212.5,360,0,8);tick(507.5,360,0,8);arc(p,i,e,25);arc(b,a,c,34);label('45°',138,335,22);
 for(const[t,x,y]of[['A',360,36],['B',41,374],['C',679,374],['D',360,393],['E',531,207],['I',339,235],['P',453,305]] as [string,number,number][])label(t,x,y);
 s.relations=['P is intersection of IC and DE; E is perpendicular foot; BD and DC marked equal.'];
}
scene('mc16',610,420,'p4: rectangle ABCD with M on AD, BM and CM only. Inner triangle, braces and numeric pencil calculations omitted.');rectDiagram('M');
scene('cr01',740,440,'p4: ABCD parallelogram, interior E, four connecting segments, two filled dots at B and two crosses at C. Pencil dimensions excluded.');
{
 const a:Point=[180,65],b:Point=[65,365],c:Point=[560,365],d:Point=[675,65],e:Point=[395,169];poly(a,b,c,d);line(a,e);line(b,e);line(c,e);line(d,e);
 for(const[t,x,y]of[['A',167,37],['B',42,381],['C',575,383],['D',698,54],['E',395,207]] as [string,number,number][])label(t,x,y);
 dot(107,306,5);dot(132,344,5);label('×',509,343,25);label('×',555,298,25);
 s.relations=['Two dots indicate equal angles at B; two crosses indicate equal angles at C. No collinearity imposed across E.'];
}
scene('cr02',500,510,'p4: ABC, interior P, PA PB PC; perpendiculars PD PE PF with feet D E F; angle variables x,y,z.');
{
 const a:Point=[250,60],b:Point=[45,415],c:Point=[455,415],p:Point=[250,296.67],d:Point=[147.5,237.5],e:Point=[250,415],f:Point=[352.5,237.5];poly(a,b,c);line(a,p);line(b,p);line(c,p);line(p,d);line(p,e);line(p,f);right(d,a,p);right(e,b,p);right(f,a,p);dot(...p,3);
 arc(a,b,p,43);arc(b,p,c,43);arc(c,a,p,43);label('x',231,157,26,true);label('y',122,395,26,true);label('z',403,356,26,true);
 for(const[t,x,y]of[['A',250,32],['B',23,430],['C',478,430],['D',120,229],['E',250,450],['F',378,229],['P',278,261]] as [string,number,number][])label(t,x,y);
 s.relations=['PD perpendicular to AB; PE perpendicular to BC; PF perpendicular to AC. Rendered symmetric layout is a drawing choice, not a recovered metric claim.'];
}
scene('cr02-options-frame',1120,450,'p4 [1228,912,2080,1238]: complete printed <보기> rectangle, eight items in two columns, overbars on segment names; pencil notes excluded.','Complete printed source content restored inside frame. Parent refinement explicitly retains the review book native-text/image repetition; existing native choices remain unchanged.');
line([455,42],[30,42],[30,420],[1090,420],[1090,42],[665,42]);label('〈보기〉',560,55,32);
function segmentName(t:string,x:number,y:number) {label(t,x,y,32);line([x-23,y-32],[x+23,y-32]);}
for(const [idx,y]of [[1,127],[2,210]] as [number,number][]) {label(String.fromCodePoint(0x2460+idx-1),72,y,32);segmentName('BE',148,y);label('=',202,y,32);segmentName(idx===1?'BD':'CE',256,y);}
for(const [idx,y,v]of [[3,293,'x'],[4,376,'z']] as [number,number,string][]) {label(String.fromCodePoint(0x2460+idx-1),72,y,32);label('∠PAF = ∠',213,y,32);label(v,318,y,32,true);}
for(const [idx,y,words]of [[5,127,['PA','PB','PC']],[6,210,['PD','PE','PF']]] as [number,number,string[]][]) {label(String.fromCodePoint(0x2460+idx-1),595,y,32);words.forEach((w,k)=>{segmentName(w,675+k*123,y);if(k<2)label('=',735+k*123,y,32);});}
label('⑦',595,293,32);label('∠',656,293,32);label('x',687,293,32,true);label('= ∠',750,293,32);label('y',798,293,32,true);label('= ∠',861,293,32);label('z',909,293,32,true);
label('⑧',595,376,32);label('∠',640,376,32);label('x',670,376,32,true);label('+ ∠',724,376,32);label('y',771,376,32,true);label('+ ∠',825,376,32);label('z',872,376,32,true);label('= 90°',970,376,32);
s.relations=['Eight printed options restored; no internal grid invented; segment overbars and italic variables explicit.'];
scene('cr03',720,460,'p5: joined congruent triangles ABCE with A(F), C(D), common AC; printed angle arcs at A and C; no score added.');
{
 const a:Point=[290,75],b:Point=[70,375],c:Point=[415,375],e:Point=[635,75];poly(a,b,c,e);line(a,c);arc(a,c,e,35);arc(c,b,a,35);label('A(F)',290,41);label('B',44,390);label('C(D)',451,408);label('E',661,66);
}
function field(full:boolean) {
 const a:Point=[215,80],b:Point=[285,370],c:Point=[445,370],d:Point=[375,80];poly([65,80],[65,370],[645,370],[645,80]);poly(a,b,c,d);line(a,c);arrow(a,b);arrow(d,c);
 label('A',205,49);label('B',274,404);label('C',456,404);label('D',387,49);
 if(full){const o:Point=[330,225],e:Point=[330,80],f:Point=[330,370];line(b,d);line(e,f);right(e,a,f,12);right(f,b,e,12);label('E',326,49);label('F',330,404);label('O',354,223);s.relations=['AC, BD and EF intersect at O; E and F lie on outer horizontal sides.'];}
 else{const p:Point=[410,225];line(a,p,b);label('P',439,220);s.relations=['P lies on DC; AB parallel to DC; A-P-B is the bent boundary.'];}
}
scene('cr04-field1',710,450,'p5 [1790,752,2010,925]: outer field rectangle, A D above B C, P on DC, AB//DC arrows, AC and bent APB.','Source-grounded regularized topology; very small source segments remain low contrast.');field(false);s.unresolved=['Small example figure is low contrast; segment separation is interpreted from visible lines plus admitted printed labels, without repairing native AD/AC text disagreement.'];
scene('cr04-bogi',1220,510,'p5 [1280,730,2020,1020]: complete <보기> procedure and field example. Visible final boundary label reads AD in the scan; other dataset native text may differ and remains unchanged.','Complete printed procedure redrawn. The first segment label in step 3 remains C/D-ambiguous under a grading stroke; its uncertain glyph is explicitly marked. No mathematical correction is applied to the visible final AD.');
label('〈보기〉',55,56,30,false,'start');label('❶ 선분 AB를 그린다.',55,123,30,false,'start');label('❷ 점 P를 지나고 선분 AB에 평행한',55,194,30,false,'start');label('    선분 DC를 그린다.',55,249,30,false,'start');
label('❸ 선분 A□를 그리면 삼각형 ABP와 삼각형 ABC의 넓이가',55,341,30,false,'start');label('    같으므로 선분 AD를 새로운 경계선으로 만든다.',55,401,30,false,'start');label('□: 원본 글자 C/D 판독 보류',55,469,23,false,'start');
{
 const start=s.primitives.length;field(false);const added=s.primitives.splice(start);for(const p of added){if(p.kind==='path')p.points=p.points.map(([x,y])=>[830+x*.48,24+y*.48]);else p.at=[830+p.at[0]*.48,24+p.at[1]*.48];if(p.kind==='label')p.size=(p.size??25)*.75;}s.primitives.push(...added);
}
s.status='unresolved-with-explicit-placeholder';s.unresolved=['Step 3 first segment label is C/D-ambiguous under a grading stroke; rendered A□ with an explicit note. Final source AD is retained as observed, not solved or normalized to AC.'];
scene('cr04-field2',710,450,'p5 [1490,1560,1910,1880]: outer field rectangle; A,E,D upper; B,F,C lower; diagonals cross O; EF perpendicular; arrows AB//DC.','Neutral black on white. Uneven gray field tone is omitted because shading provenance cannot be separated from scan illumination/pencil. No shading meaning inferred.');field(true);s.unresolved=['Uneven field shading has uncertain provenance; restored as unfilled regions.'];
scene('cr04-proof-frame',1000,1000,'p5 [1310,1860,2100,2650]: complete printed proof frame; four numbered blanks and three separate equation references; dark occupied block [1505,2100,1755,2170].','Complete readable proof sentences redrawn inside frame with genuine blank boxes. Parent refinement retains native-text/image repetition. Dark block is visibly unresolved; no hidden condition is filled. Congruence signs use the admitted printed proof reading; existing native scripts are unchanged.');
poly([30,35],[30,980],[970,980],[970,35]);
label('□ABCD는',65,113,28,false,'start');poly([240,66],[240,129],[505,129],[505,66]);label('①',372,109,28);label('이므로 △ABO ≡ △CDO',525,113,27,false,'start');
label('△AOE와 △COF에서',65,205,28,false,'start');label('∠AEO = ∠CFO = 90°',105,279,28,false,'start');label('……①',810,279,27);
label('□ABCD는',65,374,28,false,'start');poly([240,325],[240,390],[535,390],[535,325]);label('원문 가림 · 판독 보류',388,366,24);label('이므로',555,374,28,false,'start');
poly([115,456],[115,520],[760,520],[760,456]);label('②',437,498,28);label('……②',844,506,27);
poly([115,583],[115,647],[760,647],[760,583]);label('③',437,625,28);label('……③',844,633,27);
label('①, ②, ③에서 △AOE ≡ △COF (',65,768,27,false,'start');poly([677,720],[677,785],[804,785],[804,720]);label('④',740,764,28);label('합동)',822,768,27,false,'start');
label('이므로 △AOE와 △COF의 넓이는 같다.',65,842,28,false,'start');label('마찬가지로 △DEO ≡ △BFO이므로,',65,913,28,false,'start');label('□ABFE = □EFCD이다.',65,961,28,false,'start');
s.status='unresolved-with-explicit-placeholder';s.unresolved=['Dark source block remains unreadable. Korean label replaces the occupied block without inventing its content or provenance.','Numbered blanks and equation references are separate printed objects. All readable proof content is rendered, with editable native text outside unchanged.'];

await writeFile(`${import.meta.dir}/scenes.json`,JSON.stringify({schema:'math-editing.controlled-scenes.v1',units:'authored-viewbox-units',defaultStroke:2.1,stage:'faithful-clean-restoration-only',constraintSolver:false,scenes},null,2));
console.log(`Authored ${scenes.length} reusable scenes.`);
