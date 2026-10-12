import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Campaign, Mission } from '../types';
import { shipRadomePlacements } from '../content/shipDetails';
import { createHullPatch, createShipHull, type ShipHullSurface } from './shipHull';
import { createShipDeck } from './shipDeck';
import { createShipLightLayout } from './shipLayout';

// Bow is -Z; the ship marker anchors geometry, with landing guides offset along +Z.
// Dimensions are metres. See docs/ship-geometry-references.md for the evidence limits.
// Flight physics uses y=0 at the aircraft's origin. Its four tyres reach
// y≈-2.52, so the visible deck must meet those tyres rather than the fuselage.
const DECK = -2.55;
const mat = (color: string, metalness = .12, roughness = .82) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
// A small deterministic paint map gives the large, close-up surfaces seams and
// irregular weathering without depending on downloaded photography.
function hullPaintMaps(base: string) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  let seed = 4003;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  for (let i = 0; i < 1850; i++) {
    const pale = random() > .5, alpha = .004 + random() * .013;
    ctx.fillStyle = pale ? `rgba(235,239,233,${alpha})` : `rgba(8,17,21,${alpha})`;
    const x = random() * w, y = random() * h;
    ctx.fillRect(x, y, 1 + random() * 20, 1 + random() * 21);
  }
  {
    // Weld seams and short salt streaks are scale cues on the broad hull sides.
    ctx.strokeStyle = 'rgba(10,19,23,.045)'; ctx.lineWidth = 2;
    for (let x = 65; x < w; x += 95) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(3,11,16,.035)';
    for (let y = 35; y < h; y += 75) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    // Tiny, weathered weld fasteners sit on the plate joins and soften into
    // the hull texture at distance rather than reading as decorative dots.
    ctx.fillStyle = 'rgba(209,214,207,.13)';
    for (let x=65;x<w;x+=95) for(let y=22;y<h;y+=38) { ctx.beginPath();ctx.arc(x,y,1.15,0,Math.PI*2);ctx.fill(); }
    for (let i=0; i<90; i++) {
      const x=random()*w,y=random()*h;
      ctx.fillStyle='rgba(14,24,27,.045)'; ctx.fillRect(x,y,2+random()*5,5+random()*26);
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const normalCanvas = document.createElement('canvas'); normalCanvas.width = 512; normalCanvas.height = 128;
  const normalCtx = normalCanvas.getContext('2d');
  const aoCanvas = document.createElement('canvas'); aoCanvas.width = 512; aoCanvas.height = 128;
  const aoCtx = aoCanvas.getContext('2d');
  const roughCanvas = document.createElement('canvas'); roughCanvas.width = 256; roughCanvas.height = 96;
  const roughCtx = roughCanvas.getContext('2d');
  if (!normalCtx || !aoCtx || !roughCtx) return { map: texture };
  normalCtx.fillStyle = '#8080ff'; normalCtx.fillRect(0,0,normalCanvas.width,normalCanvas.height);
  aoCtx.fillStyle = '#f2f2f2'; aoCtx.fillRect(0,0,aoCanvas.width,aoCanvas.height);
  roughCtx.fillStyle = '#d8d8d8'; roughCtx.fillRect(0,0,roughCanvas.width,roughCanvas.height);
  {
    // Hull plating follows the longitudinal UV axis with subtle relief and seams.
    normalCtx.strokeStyle = '#8580ff'; normalCtx.lineWidth = 1;
    aoCtx.strokeStyle = '#929292'; aoCtx.lineWidth = 1.2;
    roughCtx.strokeStyle = '#c8c8c8'; roughCtx.lineWidth = 1;
    for (let x=32;x<normalCanvas.width;x+=48) {
      normalCtx.beginPath();normalCtx.moveTo(x,0);normalCtx.lineTo(x,normalCanvas.height);normalCtx.stroke();
      aoCtx.beginPath();aoCtx.moveTo(x,0);aoCtx.lineTo(x,aoCanvas.height);aoCtx.stroke();
      const roughX=x*roughCanvas.width/normalCanvas.width;
      roughCtx.beginPath();roughCtx.moveTo(roughX,0);roughCtx.lineTo(roughX,roughCanvas.height);roughCtx.stroke();
    }
    for (let y=18;y<normalCanvas.height;y+=36) {
      normalCtx.beginPath();normalCtx.moveTo(0,y);normalCtx.lineTo(normalCanvas.width,y);normalCtx.stroke();
      aoCtx.beginPath();aoCtx.moveTo(0,y);aoCtx.lineTo(aoCanvas.width,y);aoCtx.stroke();
    }
  }
  const normalMap = new THREE.CanvasTexture(normalCanvas); normalMap.anisotropy=2;
  const aoMap = new THREE.CanvasTexture(aoCanvas); aoMap.anisotropy=2;
  const roughnessMap = new THREE.CanvasTexture(roughCanvas); roughnessMap.anisotropy=2;
  return { map: texture, normalMap, aoMap, roughnessMap };
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
function hullNumeral(g: THREE.Group, surface: ShipHullSurface, value: string, side: -1 | 1, z: number, y: number, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.max(128, Math.round(512 * height / width));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e6e9e4';
  ctx.font = `bold ${Math.round(canvas.height * .82)}px Arial`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(value, canvas.width / 2, canvas.height * .52, canvas.width * .9);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const paint = new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: .96, metalness: 0, side: THREE.DoubleSide });
  g.add(createHullPatch(surface, { side, zMin: z - width / 2, zMax: z + width / 2, yMin: y - height / 2, yMax: y + height / 2 }, paint));
}
function hullPanel(g: THREE.Group, surface: ShipHullSurface, side: -1 | 1, z: number, y: number, width: number, height: number, material: THREE.Material, offset = .018) {
  g.add(createHullPatch(surface, { side, zMin: z - width / 2, zMax: z + width / 2, yMin: y - height / 2, yMax: y + height / 2 }, material, offset));
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
  // Open, folded horizontal frames with crossed cable mesh. No filled slabs.
  const y = DECK - .28;
  for (const side of [-1, 1]) {
    const inner = side * (B / 2 + .08), outer = side * (B / 2 + 1.12);
    for (let z = start; z < end; z += 5) {
      const far = Math.min(z + 5, end), length = far - z;
      for (const x of [inner, outer]) box(g, .055, .06, length, x, y, (z + far) / 2, steel);
      for (const edge of [z, far]) box(g, Math.abs(outer - inner), .06, .055, (inner + outer) / 2, y, edge, steel);
      const cells = 4;
      for (let i = 0; i < cells; i++) {
        const a = z + i * length / cells, b = z + (i + 1) * length / cells;
        rod(g, new THREE.Vector3(inner, y, a), new THREE.Vector3(outer, y, b), .022, steel);
        rod(g, new THREE.Vector3(outer, y, a), new THREE.Vector3(inner, y, b), .022, steel);
      }
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
    if(!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshStandardMaterial) || child.userData.shipSurfaceDecal) continue;
    child.updateMatrix(); let geo=child.geometry.clone().applyMatrix4(child.matrix);
    if (geo.index) { const flat=geo.toNonIndexed(); geo.dispose(); geo=flat; }
    // Keep UVs for the authored paint maps; solid fittings shed theirs so
    // different primitive attribute sets can still be merged by material.
    if (child.material.map || child.material.normalMap || child.material.roughnessMap || child.material.aoMap) {
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
  const stern=japanese?40:35, s=(fraction:number)=>stern-L+fraction*L;
  const lightLayout = createShipLightLayout(campaign);
  const steel=mat(japanese?'#858d8e':'#626d70',.18,.9), light=mat('#aab1af',.12,.77), dark=mat('#273239',.08,.86);
  const { surface: deck, markings } = createShipDeck(campaign);
  const white=mat('#d8dcd5',.02,.9), black=mat('#22282b',.08,.92), red=mat('#754e44',.08,.92);
  const hullPaint=mat('#ffffff',.12,.9);
  Object.assign(hullPaint,hullPaintMaps(japanese?'#727b7c':'#566164'));
  hullPaint.normalScale.set(.18,.18); hullPaint.aoMapIntensity=.43;
  const hullSurface = createShipHull(g,L,B,stern,japanese,hullPaint,black,red,deck);
  markings.userData.shipSurfaceDecal = true;
  markings.castShadow = false;
  g.add(markings);
  // Closed well-dock gate; no false open void or see-through transom.
  box(g,B*.71,6.8,.2,0,-6.3,stern+.06,dark);
  box(g,B*.68,6.4,.22,0,-6.3,stern+.2,steel);
  for(let x=-B*.3;x<=B*.3;x+=B*.15)box(g,.09,6.4,.06,x,-6.3,stern+.33,dark);
  safetyNets(g,B,-30,stern-3,steel);
  for(const side of [-1,1] as const) {
    // Hull numbers, separate painted numerals rather than a billboard with a ship name.
    hullNumeral(g,hullSurface,japanese?'4003':'209',side,s(.20),-5.35,japanese?7:7.4,2.4);
    if(!japanese) hullNumeral(g,hullSurface,'209',side,s(.967),-5.4,4.8,1.75);
    for(let z=s(.21);z<s(.43);z+=5) {
      box(g,.07,.95,.07,side*B*.48,DECK+.5,z,steel);
      box(g,.07,.07,5,side*B*.48,DECK+.96,z+2.5,steel);
    }
    for(let z=0;z<stern-5;z+=9) { box(g,.18,.18,.55,side*(B/2-.5),DECK+.14,z,white); }
    // Recessed rectangular openings down the aft hull, a defining LPD feature.
    for(let z=-16;z<stern-3;z+=6) hullPanel(g,hullSurface,side,z,-4.7,2.1,.7,dark);
  }
  if(japanese) {
    // Kunisaki's starboard island occupies the middle of the ship; aft half is clear.
    const ix=B*.27, iz=s(.47);
    house(g,B*.39,6.2,L*.245,ix,DECK,iz,steel,.55,.55);
    house(g,B*.34,3.5,15,ix,DECK+6.2,s(.392),steel,.3,-.3);
    box(g,B*.40,.27,16,ix,DECK+9.83,s(.392),light);
    // Pale bridge-roof radomes are prominent in Kunisaki's official photos.
    for (const dome of shipRadomePlacements(campaign)) {
      box(g, dome.radius * 2 + .05, .18, dome.radius * 2 + .05, dome.x, DECK + 10.08, dome.z, light);
      sphere(g, dome.radius, dome.x, dome.y, dome.z, white);
    }
    // Glazing sits on the actual sloped front and wraps around bridge wings.
    box(g,B*.31,1.05,.12,ix,DECK+8.9,s(.392)-7.48,dark);
    for(const side of [-1,1])box(g,.12,1.0,11,ix+side*(B*.17-.2),DECK+8.9,s(.39),dark);
    for(let x=ix-B*.145;x<ix+B*.15;x+=1.2)box(g,.12,1.1,.16,x,DECK+8.9,s(.392)-7.54,steel);
    for(const side of [-1,1])for(let z=s(.36);z<s(.42);z+=2)box(g,.16,1.05,.13,ix+side*(B*.17-.16),DECK+8.9,z,steel);
    house(g,6.8,2.8,14,ix,DECK+6.2,s(.48),steel,.35,.1);
    for(const side of [-1,1] as const) {
      const x=ix+side*B*.185;
      for(let z=s(.36);z<s(.60);z+=2.7) {
        box(g,.055,.8,.055,x,DECK+6.6,z,steel);
        box(g,.055,.055,2.7,x,DECK+7,z+1.35,steel);
      }
    }
    // Funnel and 15t crane behind the mast, on the island, away from the rotor spot.
    house(g,4.5,7,6,ix,DECK+6.2,s(.52),steel,.38,.25);
    box(g,4.3,.7,5.8,ix,DECK+13.2,s(.52),black);
    for(const side of [-1,1])for(let z=s(.49);z<s(.54);z+=1.5)box(g,.08,1.2,.13,ix+side*2.22,DECK+11.5,z,dark);
    house(g,3.1,3.5,3.2,ix-1,DECK+6.2,s(.445),steel,.3,0);
    mast(g,ix-1,s(.445),DECK+9.7,14,steel,dark);
    // A compact broad array above the bridge distinguishes this radar tier.
    box(g,5.2,.42,.38,ix-1,DECK+20.2,s(.445),light);
    box(g,4.4,.22,.14,ix-1,DECK+20.45,s(.445)-.28,dark);
    box(g,1.2,5,1.2,ix+3,DECK+8.7,s(.56),light);
    rod(g,new THREE.Vector3(ix+3,DECK+11.2,s(.56)),new THREE.Vector3(ix-3,DECK+12.4,s(.53)),.32,light);
    rod(g,new THREE.Vector3(ix-3,DECK+12.4,s(.53)),new THREE.Vector3(ix-3,DECK+7,s(.53)),.045,dark);
    house(g,5,1.8,6,ix,DECK,s(.325),steel,.15,0);
    ciws(g,ix,s(.325),DECK+1.8,steel,dark,white);ciws(g,ix,s(.59),DECK+6.3,steel,dark,white);
    for(const side of [-1,1] as const) {
      hullPanel(g,hullSurface,side,s(.47),-5.5,7.5,4.9,dark);
      hullPanel(g,hullSurface,side,s(.47),-5.5,7.1,4.5,steel,.035);
    }
    // Windlass and short chain leads stay low and within the clear foredeck.
    const windlassZ = s(.115);
    for(const side of [-1,1]) {
      const x=side*1.18, chainStart=s(.052), chainEnd=s(.105);
      box(g,.16,.07,chainEnd-chainStart,x,DECK+.09,(chainStart+chainEnd)/2,dark);
      for(let z=chainStart+.25;z<chainEnd;z+=.65)box(g,.34,.075,.075,x,DECK+.14,z,black);
      box(g,.8,.3,.85,side*2.0,DECK+.16,windlassZ,steel);
    }
    rod(g,new THREE.Vector3(-2.0,DECK+.55,windlassZ),new THREE.Vector3(2.0,DECK+.55,windlassZ),.32,dark);
  } else {
    // Endurance: full-width forward bridge and central hangar, flanked by boat bays.
    house(g,B*.63,7.6,33,0,DECK,s(.375),steel,.8,1);
    // Full forward face supports the bridge wings; the previous bridge floated over the bow.
    house(g,B*.73,7.6,16,0,DECK,s(.292),steel,.55,.4);
    house(g,B*.83,4.3,16,0,DECK+7.6,s(.292),steel,.55,.4);
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
  }
  // Sparse foredeck bollards and hawse details; no cargo placed in helicopter workspace.
  for(const side of [-1,1]) {box(g,.8,.55,2,side*B*.22,DECK+.28,s(.12),dark);sphere(g,.32,side*B*.32,-1.8,s(.15),black);}
  const housing=lightLayout.deckFlood.housing;
  box(g,.46,.24,.42,housing.x,housing.y,housing.z,steel);
  batch(g); g.position.set(mission.ship.x,0,mission.ship.z); g.rotation.y = mission.shipHeading; scene.add(g);return g;
}
