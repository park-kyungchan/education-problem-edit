/** Q11-only schematic geometry; never computes B/C angles or a correct answer. */
import { join } from "node:path";

type Point = { x: number; y: number };
type Primitive =
  | { kind: "path"; id: string; points: Point[]; closed?: boolean; width: number }
  | { kind: "curve"; id: string; d: string; width: number }
  | { kind: "dot"; id: string; at: Point; radius: number }
  | { kind: "label"; id: string; at: Point; text: string; size: number };
const root = import.meta.dir;
const A: Point = { x: 500, y: 65 };
const B: Point = { x: 65, y: 395 };
const C: Point = { x: 575, y: 395 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function circumcenter(a: Point, b: Point, c: Point): Point {
  const d = 2 * (a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y));
  if (Math.abs(d) < 1e-9) throw new Error("Degenerate schematic triangle");
  const aa=a.x*a.x+a.y*a.y, bb=b.x*b.x+b.y*b.y, cc=c.x*c.x+c.y*c.y;
  return { x:(aa*(b.y-c.y)+bb*(c.y-a.y)+cc*(a.y-b.y))/d,
    y:(aa*(c.x-b.x)+bb*(a.x-c.x)+cc*(b.x-a.x))/d };
}
function incenter(a: Point, b: Point, c: Point): Point {
  const wa=distance(b,c), wb=distance(c,a), wc=distance(a,b), sum=wa+wb+wc;
  return {x:(wa*a.x+wb*b.x+wc*c.x)/sum, y:(wa*a.y+wb*b.y+wc*c.y)/sum};
}
const O=circumcenter(A,B,C), I=incenter(A,B,C);
const inside=(p:Point) => {
  const s=[cross(A,B,p),cross(B,C,p),cross(C,A,p)];
  return s.every(v=>v>0) || s.every(v=>v<0);
};
const acuteAt=(v:Point,a:Point,b:Point)=>(a.x-v.x)*(b.x-v.x)+(a.y-v.y)*(b.y-v.y)>0;
if (![acuteAt(A,B,C),acuteAt(B,A,C),acuteAt(C,A,B)].every(Boolean) || !inside(O) || !inside(I)) {
  throw new Error("Schematic must be acute with both centers inside");
}
// atan2 is used solely to draw the marker between AO and AI. No geometric angle
// is converted to a numeric source value; the 23° label is the given annotation.
const a0=Math.atan2(O.y-A.y,O.x-A.x), a1=Math.atan2(I.y-A.y,I.x-A.x);
const marker:Point[]=[];
for(let n=0;n<=20;n++){
  const t=a0+(a1-a0)*n/20;marker.push({x:A.x+58*Math.cos(t),y:A.y+58*Math.sin(t)});
}
const primitives:Primitive[]=[
  {kind:"path",id:"ABC",points:[A,B,C],closed:true,width:2.1},
  ...([['A',A],['B',B],['C',C]] as const).flatMap(([name,p]) => [
    {kind:"path" as const,id:`${name}-O`,points:[p,O],width:1.65},
    {kind:"path" as const,id:`${name}-I`,points:[p,I],width:1.65},
  ]),
  {kind:"path",id:"given-OAI-marker",points:marker,width:1.5},
  {kind:"curve",id:"given23-leader",d:"M 568 126 C 538 137 508 137 477 120",width:1.5},
  {kind:"dot",id:"O-center",at:O,radius:2.8},
  {kind:"dot",id:"I-center",at:I,radius:2.8},
  {kind:"label",id:"A-label",at:{x:505,y:35},text:"A",size:25},
  {kind:"label",id:"B-label",at:{x:41,y:408},text:"B",size:25},
  {kind:"label",id:"C-label",at:{x:596,y:408},text:"C",size:25},
  {kind:"label",id:"O-label",at:{x:O.x-19,y:O.y-10},text:"O",size:25},
  {kind:"label",id:"I-label",at:{x:I.x+23,y:I.y-10},text:"I",size:25},
  {kind:"label",id:"given23-label",at:{x:605,y:132},text:"23°",size:25},
];
const fmt=(n:number)=>n.toFixed(5);
const path=(points:Point[],closed=false)=>"M "+points.map(p=>`${fmt(p.x)},${fmt(p.y)}`).join(" L ")+(closed?" Z":"");
const esc=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const svg=[
  '<svg xmlns="http://www.w3.org/2000/svg" width="2304" height="1618" viewBox="0 0 680 480">',
  '<rect width="680" height="480" fill="white"/>',
  ...primitives.map(p=>{
    if(p.kind==="label")return `<text x="${fmt(p.at.x)}" y="${fmt(p.at.y)}" font-family="DejaVu Serif" font-size="${p.size}" text-anchor="middle" fill="black">${esc(p.text)}</text>`;
    if(p.kind==="dot")return `<circle cx="${fmt(p.at.x)}" cy="${fmt(p.at.y)}" r="${p.radius}" fill="black"/>`;
    return `<path d="${p.kind==="path"?path(p.points,p.closed):p.d}" fill="none" stroke="black" stroke-width="${p.width}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }), '</svg>',
].join("\n");
const scene={schema:"math-editing.q11-schematic-scene.v1",width:680,height:480,pixelDimensions:[2304,1618],points:{A,B,C,O,I},primitives};
const approximation={
  schema:"math-editing.q11-schematic-approximation.v1",taskId:"T-GPT-Q11-INTERIOR-APPROX",
  authorityInputs:["input-040","input-041"],sourcePage:2,sourceBox:[1540,1710,1960,2005],
  geometricRoles:{O:"Computed circumcenter of the chosen illustrative acute triangle only",I:"Computed incenter of the chosen illustrative acute triangle only"},
  points:{A,B,C,O,I},centerRoleChecks:{acuteByPositiveDotProducts:true,bothCentersInside:true},
  rays:["AO","BO","CO","AI","BI","CI"],
  approximation:"Source-shaped illustrative triangle. Coordinates are authored visual choices, not recovered source measurements or source truth. Six role-consistent spokes restore the visible interior structure under the actual user approximation authorization.",
  retainedUncertainty:["Original O/I pixel positions and assignment of obscured rays remain unresolved.","Printed versus pencil detail cannot be separated at every interior stroke.","Source 23° leader/arc endpoints are not fully recovered; the clean marker/leader is schematic."],
  givenOAI23:"23° is retained as the source given annotation, not a measured angle or a constraint used to solve the drawing. The approximate picture is not a to-scale claim.",
  choice3:"33° remains the separately confirmed native choice. No choices or native text/math are modified by this asset.",
  prohibitedInferences:["No B or C angle value is computed/reported","No correct option is selected","No handwritten27° or worked answers are copied","No new source acceptance or pilot03 release"],
  comparisonPolicy:"Original evidence remains inside BOTH future GPT copies. This asset replaces only the restored-controlled-geometry Q11 member.",
  imageText:["A","B","C","O","I","23°"],acceptanceDecision:null,
};
await Bun.write(join(root,"mc11-schematic.svg"),svg);
await Bun.write(join(root,"scene.json"),JSON.stringify(scene,null,2)+"\n");
await Bun.write(join(root,"approximation.json"),JSON.stringify(approximation,null,2)+"\n");
const render=Bun.spawnSync(["python3",join(root,"render-svg.py")],{cwd:root,env:{...process.env,PYTHONDONTWRITEBYTECODE:"1"}});
if(render.exitCode!==0)throw new Error(render.stderr.toString());
console.log(render.stdout.toString().trim());
