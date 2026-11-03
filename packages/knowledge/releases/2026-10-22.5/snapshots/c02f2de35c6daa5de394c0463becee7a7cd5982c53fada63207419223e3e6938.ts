/** Deterministic clean geometry assets. Coordinates are presentation parameters;
 * centers, feet, intersections and folds are constructed from their incidences. */
type V=[number,number];
const add=(a:V,b:V):V=>[a[0]+b[0],a[1]+b[1]], sub=(a:V,b:V):V=>[a[0]-b[0],a[1]-b[1]], mul=(a:V,k:number):V=>[a[0]*k,a[1]*k];
const dot=(a:V,b:V)=>a[0]*b[0]+a[1]*b[1], len=(a:V)=>Math.hypot(...a), mix=(a:V,b:V,t=.5)=>add(a,mul(sub(b,a),t));
const foot=(p:V,a:V,b:V)=>add(a,mul(sub(b,a),dot(sub(p,a),sub(b,a))/dot(sub(b,a),sub(b,a))));
const cross=(a:V,b:V)=>a[0]*b[1]-a[1]*b[0];
const intersect=(a:V,b:V,c:V,d:V)=>add(a,mul(sub(b,a),cross(sub(c,a),sub(d,c))/cross(sub(b,a),sub(d,c))));
const incenter=(a:V,b:V,c:V):V=>{const x=len(sub(b,c)),y=len(sub(a,c)),z=len(sub(a,b));return mul(add(add(mul(a,x),mul(b,y)),mul(c,z)),1/(x+y+z));};
const circumcenter=(a:V,b:V,c:V):V=>{const m=mix(a,b),n=mix(a,c),v=sub(b,a),w=sub(c,a);return intersect(m,add(m,[-v[1],v[0]]),n,add(n,[-w[1],w[0]]));};
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
class Scene{
 out:string[]=[]; constructor(public width=360,public height=235){}
 line(a:V,b:V,dash=false,w=1.7){this.out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#111" stroke-width="${w}" ${dash?'stroke-dasharray="5 4"':''}/>`);}
 poly(ps:V[],fill='none',close=true){this.out.push(`<${close?'polygon':'polyline'} points="${ps.map(p=>p.join(',')).join(' ')}" fill="${fill}" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/>`);}
 label(p:V,s:string,dx=0,dy=0,size=19,italic=true){this.out.push(`<text x="${p[0]+dx}" y="${p[1]+dy}" font-family="Times New Roman, Liberation Serif, serif" font-size="${size}" font-style="${italic?'italic':'normal'}" fill="#111" text-anchor="middle">${esc(s)}</text>`);}
 point(p:V){this.out.push(`<circle cx="${p[0]}" cy="${p[1]}" r="2.7" fill="#111"/>`);}
 ticks(a:V,b:V,count=1,t=.5){const p=mix(a,b,t),v=mul(sub(b,a),1/len(sub(b,a))),n:V=[-v[1],v[0]];for(let i=0;i<count;i++){const q=add(p,mul(v,(i-(count-1)/2)*4));this.line(add(q,mul(n,4)),add(q,mul(n,-4)),false,1.3);}}
 right(a:V,o:V,b:V,size=9){const u=mul(sub(a,o),size/len(sub(a,o))),v=mul(sub(b,o),size/len(sub(b,o)));this.poly([add(o,u),add(add(o,u),v),add(o,v)],'none',false);}
 arc(a:V,o:V,b:V,r=22,label?:string){let x=Math.atan2(a[1]-o[1],a[0]-o[0]),y=Math.atan2(b[1]-o[1],b[0]-o[0]);let delta=y-x;while(delta>Math.PI)delta-=2*Math.PI;while(delta< -Math.PI)delta+=2*Math.PI;const p:V=[o[0]+r*Math.cos(x),o[1]+r*Math.sin(x)],q:V=[o[0]+r*Math.cos(x+delta),o[1]+r*Math.sin(x+delta)];this.out.push(`<path d="M ${p} A ${r} ${r} 0 0 ${delta>0?1:0} ${q}" fill="none" stroke="#111" stroke-width="1.1"/>`);if(label){const z=x+delta/2;this.label([o[0]+(r+12)*Math.cos(z),o[1]+(r+12)*Math.sin(z)],label,0,5,17);}}
 arrow(a:V,b:V,t=.5){const p=mix(a,b,t),v=mul(sub(b,a),1/len(sub(b,a))),n:V=[-v[1],v[0]];this.poly([add(add(p,mul(v,-4)),mul(n,3)),add(p,mul(v,4)),add(add(p,mul(v,-4)),mul(n,-3))],'#111');}
 svg(){return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><rect width="100%" height="100%" fill="white"/>${this.out.join('')}</svg>`;}
}
const scenes=new Map<number,Scene>();
function tri(s:Scene,A:V,B:V,C:V,fill='none'){s.poly([A,B,C],fill);s.label(A,'A',0,-10);s.label(B,'B',-13,8);s.label(C,'C',14,8);}
function quad(s:Scene,A:V,B:V,C:V,D:V,fill='none'){s.poly([A,B,C,D],fill);s.label(A,'A',-12,-5);s.label(B,'B',-13,12);s.label(C,'C',14,12);s.label(D,'D',13,-5);}
{
 const s=new Scene(),A:V=[180,30],B:V=[45,200],C:V=[315,200],D=mix(B,C);tri(s,A,B,C,'#f2f2f2');s.line(A,D,true);s.ticks(A,B,2);s.ticks(A,C,2);s.arc(B,A,D,23);s.arc(D,A,C,23);s.point([174,55]);s.point([186,55]);s.label(D,'D',0,22);scenes.set(1,s);
}
{
 const s=new Scene(),A:V=[180,200-125*Math.tan(52*Math.PI/180)],B:V=[55,200],C:V=[305,200];tri(s,A,B,C,'#f4f4f4');s.arc(A,B,C,21,'52°');s.arc(B,C,A,21,'52°');s.label([96,115],'2x − 1',-19,-5,17);s.label([264,115],'x + 1',24,-5,17);scenes.set(2,s);
}
{
 const s=new Scene(310,335),A:V=[155,25],B:V=[65,302],C:V=[245,302],D=mix(A,C,180/len(sub(C,A)));tri(s,A,B,C,'#f2f2f2');s.line(B,D);s.ticks(A,D,2);s.ticks(B,D,2);s.ticks(B,C,2);s.label(D,'D',17,0);scenes.set(3,s);
}
{
 const s=new Scene(360,220),A:V=[190,175],B:V=[50,91],C:V=[274,35],D:V=[50,175],E:V=[274,175];tri(s,A,B,C);s.line([20,175],[335,175]);s.line(B,D,true);s.line(C,E,true);s.right(B,D,A,9);s.right(A,E,C,9);s.right(B,A,C,12);s.label(D,'D',0,21);s.label(E,'E',0,21);s.label([327,171],'l',0,-3,18);scenes.set(5,s);
}
{
 const s=new Scene(320,265),A:V=[70,25],B:V=[70,225],C:V=[220,225],D=mix(B,C,len(sub(A,B))/(len(sub(A,B))+len(sub(A,C)))),E=foot(D,A,C);tri(s,A,B,C);s.line(A,D);s.line(D,E,true);s.right(A,B,C);s.right(D,E,C);s.arc(B,A,D,24);s.arc(D,A,C,24);s.label(D,'D',0,21);s.label(E,'E',16,0);s.label(mix(A,C),'15cm',25,-16,17);s.label(mix(B,D),'4cm',0,26,17);scenes.set(6,s);
}
{
 const s=new Scene(),B:V=[35,195],C:V=[325,195],A:V=[130.41,58.74],M=mix(B,C);tri(s,A,B,C);s.line(A,M);s.right(B,A,C,11);s.ticks(B,M,2);s.ticks(M,C,2);s.arc(A,C,B,30,'35°');s.label(M,'M',0,23);scenes.set(7,s);
}
{
 const s=new Scene(),A:V=[160,25],B:V=[45,200],C:V=[315,200],I=incenter(A,B,C),D=intersect(A,B,I,add(I,[100,0])),E=intersect(A,C,I,add(I,[100,0]));tri(s,A,B,C);s.line(A,I);s.line(B,I);s.line(C,I);s.line(D,E);s.arrow(D,E,.7);s.arrow(B,C,.7);s.arc(A,B,I,25);s.arc(I,B,C,25);s.arc(B,C,I,25);s.arc(I,C,A,25);s.label(D,'D',-15,0);s.label(E,'E',15,0);s.point(I);s.label(I,'I',0,23);scenes.set(8,s);
}
{
 const s=new Scene(360,255),A:V=[120,218-165*Math.tan(48*Math.PI/180)],B:V=[40,218],C:V=[285,218],I=incenter(A,B,C);tri(s,A,B,C);s.line(A,I);s.line(B,I);s.line(C,I);s.point(I);s.label(I,'I',5,25);s.arc(A,I,B,23);s.label(I,'114°',-61,-24,17);s.arc(A,C,I,44,'x');scenes.set(9,s);
}
{
 const s=new Scene(),on=(deg:number):V=>[188+130*Math.cos(deg*Math.PI/180),130+130*Math.sin(deg*Math.PI/180)],A=on(230),B=on(150),C=on(30),O=circumcenter(A,B,C);tri(s,A,B,C);s.line(O,A);s.line(O,B);s.line(O,C);s.point(O);s.label(O,'O',-3,22);scenes.set(10,s);
}
{
 const s=new Scene(360,260),B:V=[40,225],C:V=[310,225],h=270/(1/Math.tan(Math.PI/3)+1/Math.tan(52*Math.PI/180)),A:V=[40+h/Math.tan(Math.PI/3),225-h],I=incenter(A,B,C);tri(s,A,B,C);for(const p of [A,B,C])s.line(p,I);s.point(I);s.label(I,'I',-17,0);s.arc(B,I,C,24,'124°');s.arc(A,I,C,25,'y');s.arc(A,B,I,29,'x');s.arc(A,C,I,28);s.label(C,'26°',-9,-55,17);scenes.set(11,s);
}
{
 const s=new Scene(360,220),A:V=[40,50],B:V=[40,175],C:V=[40+125*Math.tan(65*Math.PI/180),175],I=incenter(A,B,C),O=mix(A,C);tri(s,A,B,C);s.line(A,I);s.line(B,I);s.line(C,I);s.line(B,O);s.right(A,B,C);s.arc(B,A,C,29,'65°');s.point(I);s.point(O);s.label(I,'I',-4,-12);s.label(O,'O',0,-12);scenes.set(12,s);
}
{
 const s=new Scene(),A:V=[100,35],B:V=[45,200],C:V=[260,200],D:V=[315,35],E=foot(A,B,D),F=foot(C,B,D);quad(s,A,B,C,D);s.line(B,D);s.line(A,E);s.line(C,F);s.line(A,F);s.line(C,E);s.right(A,E,D,9);s.right(C,F,B,9);s.label(E,'E',-8,22);s.label(F,'F',8,-9);scenes.set(14,s);
}
{
 const s=new Scene(290,255),A:V=[50,30],B:V=[50,220],C:V=[240,220],D:V=[240,30],E=intersect(A,add(A,[Math.cos(Math.PI/5),Math.sin(Math.PI/5)]),B,D);quad(s,A,B,C,D);s.line(B,D);s.line(A,E);s.line(C,E);s.arc(D,A,E,26,'36°');s.arc(B,C,E,27,'x');s.label(E,'E',1,-13);scenes.set(15,s);
}
{
 const s=new Scene(),A:V=[105,40],B:V=[40,195],C:V=[255,195],D:V=[320,40],E=mix(B,C,.47),F=intersect(C,D,E,add(E,sub(D,B)));quad(s,A,B,C,D);for(const [x,y] of [[B,D],[E,F],[A,E],[A,F],[B,F],[E,D]] as [V,V][])s.line(x,y);s.arrow(B,D,.57);s.arrow(E,F,.57);s.label(E,'E',0,23);s.label(F,'F',17,5);scenes.set(16,s);
}
{
 const side=Math.hypot(75,130),s=new Scene(320,185),A:V=[125,25],B:V=[50,155],C:V=[50+side,155],D:V=[125+side,25],O=intersect(A,C,B,D);quad(s,A,B,C,D);s.line(A,C);s.line(B,D);s.right(A,O,D,9);s.label(O,'O',0,24);scenes.set(18,s);
}
{
 const s=new Scene(),A:V=[114,35],B:V=[65,200],C:V=[300,200],D:V=[114+235*2/3,35],O=intersect(A,C,B,D);quad(s,A,B,C,D,'#ededed');s.line(A,C);s.line(B,D);s.label(O,'O',0,24);scenes.set(19,s);
}
{
 const s=new Scene(290,255),A:V=[50,30],B:V=[50,220],C:V=[240,220],D:V=[240,30],u=15*Math.PI/180,v=mul([-Math.sin(u),-Math.cos(u)],2*190*Math.sin(u)),E=add(C,v);quad(s,A,B,C,D);s.line(A,E);s.line(B,E);s.line(C,E);s.ticks(B,C,2);s.ticks(B,E,2);s.arc(B,A,E,27,'x');s.arc(E,C,D,30);s.label(C,'15°',-31,-54,17);s.label(E,'E',15,-6);scenes.set(20,s);
}
{
 const s=new Scene(),A:V=[125,35],B:V=[40,200],C:V=[230,200],D:V=[220,35],P:V=[325,200];quad(s,A,B,C,D);s.poly([A,C,D],'#e5e5e5');s.line(D,P);s.line(C,P);s.arrow(A,C,.56);s.arrow(D,P,.56);s.label(P,'P',14,10);scenes.set(21,s);
}
{
 const s=new Scene(),A:V=[115,40],B:V=[40,195],C:V=[255,195],D:V=[330,40],O=intersect(A,C,B,D),E=mix(A,D,.22),F=intersect(E,O,B,C);quad(s,A,B,C,D);s.poly([A,O,E],'#e5e5e5');s.poly([B,O,F],'#e5e5e5');s.line(A,C);s.line(B,D);s.line(E,F);s.label(O,'O',-17,2);s.label(E,'E',0,-10);s.label(F,'F',0,23);scenes.set(22,s);
}
{
 const s=new Scene(360,235),A:V=[50,35],B:V=[50,175],C:V=[310,175],D:V=[310,35];
 // Reflect original D in fold AE. A rectangular corner makes the two 70-degree angles exact.
 const E:V=[310,35+260*Math.tan(20*Math.PI/180)],H=foot(D,A,E),Dp=sub(mul(H,2),D),P=intersect(A,Dp,B,C),Q=intersect(E,Dp,B,C);
 s.poly([A,B,C,E],'#ededed');s.line(A,D,true);s.line(D,E,true);s.poly([A,E,Dp],'#d0d0d0');s.line(A,E);s.label(A,'A',-14,-4);s.label(B,'B',-13,9);s.label(C,'C',14,10);s.label(D,'D',14,-5);s.label(E,'E',17,0);s.label(Dp,"D′",2,23);s.label(P,'P',-10,20);s.label(Q,'Q',10,20);s.arc(A,E,Dp,27,'70°');scenes.set(23,s);
}
{
 const s=new Scene(),shift=163/Math.tan(76*Math.PI/180),A:V=[48+shift,37],B:V=[48,200],C:V=[275,200],D:V=[275+shift,37],U=add(mul(sub(B,C),1/len(sub(B,C))),mul(sub(D,C),1/len(sub(D,C)))),E=intersect(C,add(C,U),A,D),P=foot(B,C,E);quad(s,A,B,C,D);s.line(C,E);s.line(B,P);s.right(B,P,C,9);s.arc(B,C,P,30,'52°');s.arc(P,C,D,30);s.label(E,'E',0,-11);s.label(P,'P',17,-6);scenes.set(24,s);
}
for(const [id,scene] of scenes)await Bun.write(new URL(`./figures/q${id}.svg`,import.meta.url),scene.svg());
await Bun.write(new URL('./figures/manifest.json',import.meta.url),JSON.stringify([...scenes].map(([id,s])=>({id,svg:`q${id}.svg`,width:s.width,height:s.height,source:'Printed diagram; handwritten marks excluded',geometry:'Constructed incidence and presentation coordinates'})),null,2));
