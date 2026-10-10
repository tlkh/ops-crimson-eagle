import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Campaign, Mission } from '../types';
import { shipLandingLocalZ } from '../sim/shipLanding';

// Bow is -Z; the ship marker anchors geometry, with landing guides offset along +Z.
// Dimensions are metres. See docs/ship-geometry-references.md for the evidence limits.
// Flight physics uses y=0 at the aircraft's origin. Its four tyres reach
// y≈-2.52, so the visible deck must meet those tyres rather than the fuselage.
const DECK = -2.55;
const mat = (color: string, metalness = .12, roughness = .82) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
// A small deterministic paint map gives the large, close-up surfaces seams and
// irregular weathering without depending on downloaded photography.
function paintMap(base: string, flightDeck: boolean) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = flightDeck ? 1024 : 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  let seed = flightDeck ? 2198 : 4003;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < (flightDeck ? 3100 : 1850); i++) {
    const pale = random() > .5, alpha = flightDeck ? .006 + random() * .022 : .004 + random() * .013;
    ctx.fillStyle = pale ? `rgba(235,239,233,${alpha})` : `rgba(8,17,21,${alpha})`;
    const x = random() * w, y = random() * h;
    ctx.fillRect(x, y, flightDeck ? 1 + random() * 34 : 1 + random() * 20, flightDeck ? 1 + random() * 8 : 1 + random() * 21);
  }
  if (flightDeck) {
    // Non-slip plate joins, faint enough that landing paint stays legible.
    ctx.strokeStyle = 'rgba(19,29,32,.12)'; ctx.lineWidth = 2;
    for (let y = 44; y < h; y += 80) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    for (let x = 70; x < w; x += 168) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  } else {
    // Weld seams and short salt streaks are scale cues on the broad hull sides.
    ctx.strokeStyle = 'rgba(10,19,23,.045)'; ctx.lineWidth = 2;
    for (let x = 65; x < w; x += 95) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(3,11,16,.035)';
    for (let y = 35; y < h; y += 75) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    for (let i=0; i<90; i++) {
      const x=random()*w,y=random()*h;
      ctx.fillStyle='rgba(14,24,27,.045)'; ctx.fillRect(x,y,2+random()*5,5+random()*26);
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
function box(g: THREE.Group, w: number, h: number, l: number, x: number, y: number, z: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
  mesh.position.set(x, y, z); g.add(mesh); return mesh;
}
function rod(g: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, radius: number, m: THREE.Material) {
  const d = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d.length(), 6), m);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(mesh);
}
function sphere(g: THREE.Group, r: number, x: number, y: number, z: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), m); mesh.position.set(x, y, z); g.add(mesh);
}
function house(g:THREE.Group,w:number,h:number,l:number,x:number,bottom:number,z:number,m:THREE.Material,roofInset=.7,roofShift=.5) {
  const v:THREE.Vector3[]=[];
  for(const y of [bottom,bottom+h]) for(const zz of [-1,1]) for(const xx of [-1,1]) {
    const top=y>bottom, ww=w/2-(top?roofInset:0),ll=l/2-(top?roofInset:0);
    v.push(new THREE.Vector3(x+xx*ww,y,z+zz*ll+(top?roofShift:0)));
  }
  const faces=[[0,1,2],[1,3,2],[4,6,5],[5,6,7], [0,4,1],[1,4,5], [2,3,6],[3,7,6], [0,2,4],[2,6,4], [1,5,3],[3,5,7]];
  const p:number[]=[];for(const face of faces)for(const i of face)p.push(v[i].x,v[i].y,v[i].z);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.computeVertexNormals();g.add(new THREE.Mesh(geo,m));
}
function text(g: THREE.Group, value: string, x: number, y: number, z: number, w: number, h: number, deck = false, side = 1) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = Math.max(64, Math.round(512 * h / w));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#e9ece6'; ctx.font = `bold ${Math.round(canvas.height * .85)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Match canvas and plane aspect ratios so pennants stay legible without
  // stretching their glyphs into the broad lettering of the old fixed canvas.
  ctx.fillText(value, canvas.width / 2, canvas.height * .54, canvas.width * .92);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  mesh.position.set(x, y, z);
  if (deck) mesh.rotation.set(-Math.PI / 2, 0, Math.PI); else mesh.rotation.y = side * Math.PI / 2;
  g.add(mesh);
}
// Each station has a flared upper side, a narrow waterline boot stripe and a
// tucked-in lower hull. The real dimensions and the flat usable deck stay fixed.
function hull(g: THREE.Group, L: number, B: number, stern: number, japanese: boolean, material: THREE.Material, boot: THREE.Material, below: THREE.Material, deck: THREE.Material) {
  const stations = japanese
    ? [[0,.11], [.035,.54], [.10,.84], [.19,.98], [.30,1], [.91,1], [1,.98]]
    : [[0,.10], [.045,.55], [.12,.87], [.22,.98], [.34,1], [.91,1], [1,.96]];
  type Point = [number,number,number];
  const surfaces = new Map<THREE.Material,{p:number[],uv:number[]}>();
  const add = (m:THREE.Material, a:Point,b:Point,c:Point,ua:[number,number],ub:[number,number],uc:[number,number]) => {
    const out=surfaces.get(m) ?? {p:[],uv:[]}; surfaces.set(m,out);
    out.p.push(...a,...b,...c);out.uv.push(...ua,...ub,...uc);
  };
  const quad = (m:THREE.Material,a:Point,b:Point,c:Point,d:Point,uvA:[number,number],uvB:[number,number],uvC:[number,number],uvD:[number,number]) => {
    add(m,a,b,c,uvA,uvB,uvC);add(m,b,d,c,uvB,uvD,uvC);
  };
  const levels = [DECK,DECK-.75,-8.8,-9.22,-9.46,-13.2];
  const factors = [1,.99,.85,.83,.82,.70];
  const point=(i:number,j:number,side:number):Point=> {
    const [f,width]=stations[i], z=stern-L+f*L;
    // The stem retreats underwater: a vertical cut-off nose loses both classes' silhouette.
    const rake=(1-f)*Math.max(0,1-f/.19)*[0,.35,5.8,6.1,6.3,8][j];
    const sheer=j<2 ? (japanese ? (f<.035?-1.65:0) : Math.max(0,1-f/.29)*3.2) : 0;
    return [side*width*B*.5*factors[j],levels[j]+sheer,z+rake];
  };
  for(let i=0;i<stations.length-1;i++) {
    const u0=stations[i][0],u1=stations[i+1][0];
    for(const side of [-1,1]) for(let j=0;j<levels.length-1;j++) {
      const m=j<3?material:j===3?boot:below;
      const a=point(i,j,side),b=point(i+1,j,side),c=point(i,j+1,side),d=point(i+1,j+1,side);
      const v0=j/(levels.length-1),v1=(j+1)/(levels.length-1);
      if(side>0)quad(m,a,b,c,d,[u0,v0],[u1,v0],[u0,v1],[u1,v1]);
      else quad(m,b,a,d,c,[u1,v0],[u0,v0],[u1,v1],[u0,v1]);
    }
    const a=point(i,0,1),b=point(i,0,-1),c=point(i+1,0,1),d=point(i+1,0,-1);
    const topA:Point=[a[0],a[1]+.025,a[2]],topB:Point=[b[0],b[1]+.025,b[2]],topC:Point=[c[0],c[1]+.025,c[2]],topD:Point=[d[0],d[1]+.025,d[2]];
    quad(deck,topA,topB,topC,topD,[(a[0]/B)+.5,u0],[(b[0]/B)+.5,u0],[(c[0]/B)+.5,u1],[(d[0]/B)+.5,u1]);
  }
  // Cap the raked bow, flat transom and submerged keel; back faces use hull paint.
  for(const i of [0,stations.length-1]) for(let j=0;j<levels.length-1;j++) {
    const m=j<3?material:j===3?boot:below;
    const a=point(i,j,-1),b=point(i,j,1),c=point(i,j+1,-1),d=point(i,j+1,1);
    if(i===0)quad(m,a,b,c,d,[0,j/5],[1,j/5],[0,(j+1)/5],[1,(j+1)/5]);
    else quad(m,b,a,d,c,[1,j/5],[0,j/5],[1,(j+1)/5],[0,(j+1)/5]);
  }
  for(let i=0;i<stations.length-1;i++)quad(below,point(i+1,5,-1),point(i,5,-1),point(i+1,5,1),point(i,5,1),[1,0],[0,0],[1,1],[0,1]);
  for(const [m,{p,uv}] of surfaces) {
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();g.add(new THREE.Mesh(geo,m));
  }
}
function ring(g: THREE.Group, x: number, z: number, r: number, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(r-.14,r,48),material); mesh.rotation.x=-Math.PI/2; mesh.position.set(x,DECK+.07,z); g.add(mesh);
}
function outline(g: THREE.Group, x: number, z: number, w: number, l: number, material: THREE.Material) {
  for(const s of [-1,1]) { box(g,.13,.03,l,x+s*w/2,DECK+.05,z,material); box(g,w,.03,.13,x,DECK+.05,z+s*l/2,material); }
}
function mast(g: THREE.Group, x: number, z: number, base: number, height: number, steel: THREE.Material, dark: THREE.Material) {
  house(g,2.3,height,2.6,x,base,z,steel,.83,.25);
  for(const t of [.45,.72]) {
    box(g,7,.15,.38,x,base+height*t,z,steel);
    rod(g,new THREE.Vector3(x-3.4,base+height*t,z),new THREE.Vector3(x,base+height*(t+.17),z),.065,steel);
    rod(g,new THREE.Vector3(x+3.4,base+height*t,z),new THREE.Vector3(x,base+height*(t+.17),z),.065,steel);
  }
  box(g,4.6,1.3,.28,x,base+height*.62,z-1.1,dark);
  // Open radar yard, ladders and small platforms read as naval fittings, not a cross.
  for(const t of [.45,.72]) {
    box(g,2.8,.16,2.7,x,base+height*t,z,steel);
    for(const xx of [-3.3,0,3.3])rod(g,new THREE.Vector3(x+xx,base+height*t,z),new THREE.Vector3(x+xx,base+height*t+.75,z),.035,steel);
    box(g,6.6,.055,.055,x,base+height*.72+.75,z,steel);
  }
  for(let y=base+1;y<base+height;y+=.65)box(g,.5,.05,.06,x, y,z+1.1,steel);
  box(g,3,.25,.3,x,base+height*.87,z,steel);
  rod(g,new THREE.Vector3(x,base+height,z),new THREE.Vector3(x,base+height+3,z),.07,steel);
}
function safetyNets(g: THREE.Group, B: number, start: number, end: number, steel: THREE.Material) {
  // Folded outboard nets keep the entire rotor clearance envelope open.
  for(const side of [-1,1]) {
    const x=side*(B/2+.6);
    for(let z=start;z<end;z+=4) {
      box(g,1.1,.08,3.65,x,DECK-.3,z+1.8,steel);
      for(let j=0;j<3;j++) box(g,.035,.045,3.7,x-.4+j*.4,DECK-.23,z+1.8,steel);
    }
  }
}
function ciws(g: THREE.Group,x:number,z:number,y:number,steel:THREE.Material,dark:THREE.Material,white:THREE.Material) {
  box(g,1.4,1.2,1.5,x,y+.6,z,steel); sphere(g,.65,x,y+2.05,z,white);
  box(g,.8,1.2,.8,x,y+1.6,z,white); box(g,.45,.4,2.3,x,y+1.1,z-1,dark);
}
// Merge repeated static parts by material: detailed silhouette without hundreds of draw calls.
function batch(g: THREE.Group) {
  const byMaterial=new Map<THREE.Material,THREE.BufferGeometry[]>();
  for(const child of [...g.children]) {
    if(!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshStandardMaterial)) continue;
    child.updateMatrix(); let geo=child.geometry.clone().applyMatrix4(child.matrix);
    if (geo.index) { const flat=geo.toNonIndexed(); geo.dispose(); geo=flat; }
    // Keep UVs for the authored paint maps; solid fittings shed theirs so
    // different primitive attribute sets can still be merged by material.
    if (child.material.map) {
      if (!geo.hasAttribute('uv')) geo.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count*2),2));
    } else geo.deleteAttribute('uv');
    const list=byMaterial.get(child.material)??[]; list.push(geo); byMaterial.set(child.material,list); g.remove(child); child.geometry.dispose();
  }
  for(const [material,geometries] of byMaterial) {
    const merged=mergeGeometries(geometries,false); for(const geo of geometries)geo.dispose();
    if(merged) {const mesh=new THREE.Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);}
  }
}

export function createShip(scene: THREE.Scene, campaign: Campaign, mission: Mission) {
  const g=new THREE.Group(); g.name=campaign.shipName;
  const japanese=campaign.id==='jp_ketapang_2026_09', L=campaign.shipLength, B=campaign.shipWidth;
  const aftLandingZ=shipLandingLocalZ(campaign);
  const stern=japanese?40:35, s=(fraction:number)=>stern-L+fraction*L;
  const steel=mat(japanese?'#858d8e':'#626d70',.18,.9), light=mat('#aab1af',.12,.77), dark=mat('#273239',.08,.86);
  const deck=mat('#ffffff',.04,.96), white=mat('#d8dcd5',.02,.9), black=mat('#22282b',.08,.92), red=mat('#754e44',.08,.92);
  const hullPaint=mat('#ffffff',.12,.9);
  hullPaint.map=paintMap(japanese?'#727b7c':'#566164',false);
  deck.map=paintMap(japanese?'#737979':'#4d585a',true);
  hull(g,L,B,stern,japanese,hullPaint,black,red,deck);
  // Closed well-dock gate; no false open void or see-through transom.
  box(g,B*.71,6.8,.2,0,-6.3,stern+.06,dark);
  box(g,B*.68,6.4,.22,0,-6.3,stern+.2,steel);
  for(let x=-B*.3;x<=B*.3;x+=B*.15)box(g,.09,6.4,.06,x,-6.3,stern+.33,dark);
  safetyNets(g,B,-30,stern-3,steel);
  for(const side of [-1,1]) {
    // Hull numbers, separate painted numerals rather than a billboard with a ship name.
    text(g,japanese?'4003':'209',side*B*.487,-5.35,s(.20),japanese?7:7.4,2.4,false,side);
    for(let z=s(.21);z<s(.43);z+=5) {
      box(g,.07,.95,.07,side*B*.48,DECK+.5,z,steel);
      box(g,.07,.07,5,side*B*.48,DECK+.96,z+2.5,steel);
    }
    for(let z=0;z<stern-5;z+=9) { box(g,.18,.18,.55,side*(B/2-.5),DECK+.14,z,white); }
    // Recessed rectangular openings down the aft hull, a defining LPD feature.
    for(let z=-16;z<stern-3;z+=6) box(g,.035,.7,2.1,side*(B/2-.12),-4.7,z,dark);
  }
  if(japanese) {
    // Kunisaki's starboard island occupies the middle of the ship; aft half is clear.
    const ix=B*.27, iz=s(.47);
    house(g,B*.39,6.2,L*.245,ix,DECK,iz,steel,.55,.55);
    house(g,B*.34,3.5,15,ix,DECK+6.2,s(.392),steel,.3,-.3);
    box(g,B*.40,.27,16,ix,DECK+9.83,s(.392),light);
    // Glazing sits on the actual sloped front and wraps around bridge wings.
    box(g,B*.31,1.05,.12,ix,DECK+8.9,s(.392)-7.48,dark);
    for(const side of [-1,1])box(g,.12,1.0,11,ix+side*(B*.17-.2),DECK+8.9,s(.39),dark);
    for(let x=ix-B*.145;x<ix+B*.15;x+=1.2)box(g,.12,1.1,.16,x,DECK+8.9,s(.392)-7.54,steel);
    for(const side of [-1,1])for(let z=s(.36);z<s(.42);z+=2)box(g,.16,1.05,.13,ix+side*(B*.17-.16),DECK+8.9,z,steel);
    house(g,6.8,2.8,14,ix,DECK+6.2,s(.48),steel,.35,.1);
    for(const side of [-1,1]) {
      const x=ix+side*B*.185;
      for(let z=s(.36);z<s(.60);z+=2.7) {
        box(g,.055,.8,.055,x,DECK+6.6,z,steel);
        box(g,.055,.055,2.7,x,DECK+7,z+1.35,steel);
      }
    }
    // Two elevator outlines, as labelled in Kunisaki's official appearance diagram.
    outline(g,-3,s(.24),10.5,15,dark); outline(g,-3,s(.59),10.5,12,dark);
    // Funnel and 15t crane behind the mast, on the island, away from the rotor spot.
    house(g,4.5,7,6,ix,DECK+6.2,s(.52),steel,.38,.25);
    box(g,4.3,.7,5.8,ix,DECK+13.2,s(.52),black);
    for(const side of [-1,1])for(let z=s(.49);z<s(.54);z+=1.5)box(g,.08,1.2,.13,ix+side*2.22,DECK+11.5,z,dark);
    house(g,3.1,3.5,3.2,ix-1,DECK+6.2,s(.445),steel,.3,0);
    mast(g,ix-1,s(.445),DECK+9.7,14,steel,dark);
    box(g,1.2,5,1.2,ix+3,DECK+8.7,s(.56),light);
    rod(g,new THREE.Vector3(ix+3,DECK+11.2,s(.56)),new THREE.Vector3(ix-3,DECK+12.4,s(.53)),.32,light);
    rod(g,new THREE.Vector3(ix-3,DECK+12.4,s(.53)),new THREE.Vector3(ix-3,DECK+7,s(.53)),.045,dark);
    house(g,5,1.8,6,ix,DECK,s(.325),steel,.15,0);
    ciws(g,ix,s(.325),DECK+1.8,steel,dark,white);ciws(g,ix,s(.59),DECK+6.3,steel,dark,white);
    for(const side of [-1,1]) {box(g,.07,4.9,7.5,side*B*.501,-5.5,s(.47),dark);box(g,.09,4.5,7.1,side*B*.506,-5.5,s(.47),steel);}
    // White landing guides on the aft flight deck: hollow outlines, never solid discs.
    for(const z of [-12,aftLandingZ]) {
      outline(g,0,z,B*.78,22,white);
      box(g,B*.76,.035,.18,0,DECK+.09,z,white);
      for(const side of [-1,1]) { const a=new THREE.Vector3(side*B*.37,DECK+.1,z-10),b=new THREE.Vector3(0,DECK+.1,z);rod(g,a,b,.07,white); }
    }
    box(g,.19,.035,65,0,DECK+.08,3,white);
    text(g,'03',0,DECK+.1,stern-5,5.8,3.4,true);
  } else {
    // Endurance: full-width forward bridge and central hangar, flanked by boat bays.
    house(g,B*.63,7.6,33,0,DECK,s(.375),steel,.8,1);
    // Full forward face supports the bridge wings; the previous bridge floated over the bow.
    house(g,B*.73,7.6,16,0,DECK,s(.292),steel,.55,.4);
    house(g,B*.83,4.3,16,0,DECK+7.6,s(.292),light,.55,.4);
    box(g,B*.88,.35,17,0,DECK+12,s(.292),steel);
    box(g,B*.76,1.3,.12,0,DECK+10.6,s(.292)-7.30,dark);
    for(const side of [-1,1])box(g,.1,1.35,10,side*(B*.415-.38),DECK+10.6,s(.292),dark);
    for(let x=-B*.36;x<B*.36;x+=1.65)box(g,.11,1.3,.14,x,DECK+10.6,s(.292)-7.38,steel);
    for(const side of [-1,1])for(let z=s(.27);z<s(.34);z+=2)box(g,.13,1.22,.09,side*(B*.415-.32),DECK+10.6,z,steel);
    for(const side of [-1,1]) {
      for(const z of [s(.27),s(.31)]) {
        box(g,.05,1.7,.85,side*B*.358,DECK+3.3,z,dark);
        box(g,.07,1.55,.72,side*B*.36,DECK+3.3,z,steel);
      }
    }
    for(const side of [-1,1]) {
      const x=side*B*.30;
      for(let z=s(.34);z<s(.48);z+=2.5) {
        box(g,.055,.8,.055,x,DECK+8,z,steel);
        box(g,.055,.055,2.5,x,DECK+8.4,z+1.25,steel);
      }
    }
    // Hangar aft face just forward of the 70m flight deck, shutter represented closed.
    house(g,B*.61,6.3,12,0,DECK,-40.5,steel,.25,0);
    box(g,B*.48,5.6,.1,0,DECK+2.8,-34.44,dark);
    for(let y=DECK+.4;y<DECK+5.7;y+=.38) box(g,B*.47,.05,.08,0,y,-34.37,steel);
    for(const side of [-1,1]) {
      const bx=side*B*.42;
      box(g,.12,8.8,24,bx-side*1.42,DECK+4.4,s(.40),dark);
      box(g,3.4,.6,25,bx,DECK+9.1,s(.40),steel);
      for(const z of [s(.345),s(.455)]) {
        rod(g,new THREE.Vector3(bx-side*1.55,DECK+8.8,z),new THREE.Vector3(bx+side*.35,DECK+1.1,z+3.2),.17,light);
        box(g,.35,8.8,.5,bx-side*1.45,DECK+4.4,z,steel);
      }
      // Stowed boat and diagonal davit frame on each side.
      house(g,2.6,1.05,8.8,bx,DECK+.5,s(.395),light,.45,-.3);
      box(g,1.8,.6,4.4,bx,DECK+1.8,s(.405),steel);
      for(const z of [s(.345),s(.455)])rod(g,new THREE.Vector3(bx,DECK,z),new THREE.Vector3(bx-side*.7,DECK+8.8,z+1),.22,steel);
      house(g,2.9,11.5,4.7,bx,DECK,s(.485),steel,.45,-.9);box(g,2.1,.65,3.7,bx,DECK+11.65,s(.485)-.9,black);
    }
    house(g,4.8,9.1,5,0,DECK+7.6,s(.332),steel,.65,.6);
    box(g,4.4,.7,1.2,0,DECK+17.1,s(.332),dark);
    house(g,3.4,2.4,3.8,0,DECK+7.6,s(.395),steel,.25,0);
    mast(g,0,s(.395),DECK+10,17,steel,dark);
    sphere(g,1.35,2.8,DECK+13.4,s(.30),white);sphere(g,.65,-3,DECK+12.7,s(.285),white);
    // Bow 76mm mount, explicitly identified by the RSN equipment page.
    house(g,3.1,2.0,3.3,0,DECK+1.5,s(.16),steel,.55,0);
    rod(g,new THREE.Vector3(0,DECK+2.9,s(.16)-1),new THREE.Vector3(0,DECK+3.3,s(.16)-6.4),.15,dark);
    for(const z of [-16,aftLandingZ]) {ring(g,0,z,5.5,white);box(g,B*.82,.035,.16,0,DECK+.08,z,white);}
    for(const side of [-1,1])box(g,.2,.035,65,side*B*.44,DECK+.08,0,white);
    box(g,.2,.035,65,0,DECK+.08,0,white);
    // Parallel ASIST tracks and the actual 209 stern marking are visible in 2022 photos.
    for(const x of [-.34,.34])box(g,.055,.025,61,x,DECK+.095,-1,dark);
    text(g,'1',1.5,DECK+.11,-16,1.7,2.1,true);text(g,'2',1.5,DECK+.11,17,1.7,2.1,true);
    text(g,'209',0,DECK+.11,29,6.5,2.6,true);
  }
  // Sparse foredeck bollards and hawse details; no cargo placed in helicopter workspace.
  for(const side of [-1,1]) {box(g,.8,.55,2,side*B*.22,DECK+.28,s(.12),dark);sphere(g,.32,side*B*.32,-1.8,s(.15),black);}
  batch(g); g.position.set(mission.ship.x,0,mission.ship.z);scene.add(g);return g;
}
