import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { Campaign } from '../types';
import { createAircraftLightMounts } from './aircraftLighting';

const TAU = Math.PI * 2;
type P = [number, number, number];
const mat = (color: string, roughness = .78, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, p: P = [0, 0, 0]) {
  const m = new THREE.Mesh(geometry, material); m.position.set(...p); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function box(parent: THREE.Object3D, size: P, p: P, material: THREE.Material) { return mesh(parent, new THREE.BoxGeometry(...size), material, p); }
function ellipsoid(parent: THREE.Object3D, scale: P, p: P, material: THREE.Material) {
  const m = mesh(parent, new THREE.SphereGeometry(1, 20, 12), material, p); m.scale.set(...scale); return m;
}
function cylinder(parent: THREE.Object3D, r: number, length: number, p: P, material: THREE.Material, axis: 'x' | 'y' | 'z' = 'y') {
  const m = mesh(parent, new THREE.CylinderGeometry(r, r, length, 16), material, p);
  if (axis === 'z') m.rotation.x = Math.PI / 2; if (axis === 'x') m.rotation.z = Math.PI / 2; return m;
}
function brace(parent: THREE.Object3D, from: P, to: P, radius: number, material: THREE.Material) {
  const a=new THREE.Vector3(...from), b=new THREE.Vector3(...to), direction=b.clone().sub(a);
  const part=mesh(parent,new THREE.CylinderGeometry(radius,radius,direction.length(),10),material);
  part.position.copy(a.add(b).multiplyScalar(.5));
  part.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
  return part;
}
// Stations [longitudinal Z, half-width, floor Y, roof Y]. Nose faces -Z.
function loft(stations: [number, number, number, number][], material: THREE.Material, parent: THREE.Object3D, options: { uvRange?: [number,number]; frontCapUv?: [number,number,number,number]; rearCapUv?: [number,number,number,number] } = {}) {
  const points: number[] = [], uv: number[] = [], index: number[] = [];
  const rings = 64, sides = 32, stride = sides + 1;
  for (let j = 0; j <= rings; j++) {
    const z = THREE.MathUtils.lerp(stations[0][0], stations.at(-1)![0], j / rings);
    let k = 0; while (k < stations.length - 2 && z > stations[k + 1][0]) k++;
    const a = stations[k], b = stations[k + 1], t = (z - a[0]) / (b[0] - a[0]);
    const w = THREE.MathUtils.lerp(a[1], b[1], t), floor = THREE.MathUtils.lerp(a[2], b[2], t), roof = THREE.MathUtils.lerp(a[3], b[3], t);
    for (let i = 0; i <= sides; i++) {
      const angle = i * TAU / sides, c = Math.cos(angle), sn = Math.sin(angle);
      points.push(Math.sign(c) * Math.abs(c) ** .63 * w, (floor + roof) / 2 + Math.sign(sn) * Math.abs(sn) ** .68 * (roof - floor) / 2, z);
      uv.push(i / sides, options.uvRange ? (z-options.uvRange[0])/(options.uvRange[1]-options.uvRange[0]) : (z + 7.8) / 15.5);
      if (j < rings && i < sides) { const n = j * stride + i; index.push(n, n + 1, n + stride, n + 1, n + stride + 1, n + stride); }
    }
  }
  // Separate closed end caps retain correct normals and prevent a see-through pylon.
  for (const end of [0, 1]) {
    const station = end ? stations.at(-1)! : stations[0], center = points.length / 3;
    const rect=end?options.rearCapUv:options.frontCapUv;
    const capUv=(u:number,v:number):[number,number]=>rect?[rect[0]+u*(rect[2]-rect[0]),rect[1]+v*(rect[3]-rect[1])]:[u,v];
    points.push(0, (station[2] + station[3]) / 2, station[0]); uv.push(...capUv(.5,.5));
    const ring = end ? rings * stride : 0;
    for (let i = 0; i < sides; i++) {
      const base = points.length / 3;
      for (const n of [ring + i, ring + i + 1]) { points.push(...points.slice(n * 3, n * 3 + 3)); uv.push(...capUv(.5 + points[n * 3] / (station[1] * 2), (points[n * 3 + 1] - station[2]) / (station[3] - station[2]))); }
      if (end) index.push(center, base, base + 1); else index.push(center, base + 1, base);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(index);
  g.computeVertexNormals(); return mesh(parent, g, material);
}

type Station = [number, number, number, number];
function stationAt(stations: Station[], z: number): Station {
  let i = 0;
  while (i < stations.length - 2 && z > stations[i + 1][0]) i++;
  const a = stations[i], b = stations[i + 1];
  const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return [z, THREE.MathUtils.lerp(a[1], b[1], t), THREE.MathUtils.lerp(a[2], b[2], t), THREE.MathUtils.lerp(a[3], b[3], t)];
}

// Pane faces replace, rather than cover, painted cockpit faces. The small
// number of angular bays makes windshield panels flat and leaves crisp posts.
function cockpitShell(parent: THREE.Object3D, stations: Station[], skin: THREE.Material,
  glass: THREE.Material, frame: THREE.Material) {
  const zSections = [-7.8, -7.52, -7.05, -6.25, -5.2];
  const ring = (z: number): P[] => {
    const [,w,floor,roof] = stationAt(stations,z);
    const cheekExponent=THREE.MathUtils.lerp(.83,.63,THREE.MathUtils.smoothstep(z,-7.3,-5.2));
    const front = z <= -7.05;
    const lower = front ? .53 : z <= -6.25 ? .16 : .11;
    const middle = front ? .88 : z <= -6.25 ? .84 : .88;
    // Only a narrow structural post remains between the two windshields.
    const upper = 1.565;
    const angles = [0,.08,lower,middle,upper,Math.PI/2,
      Math.PI-upper,Math.PI-middle,Math.PI-lower,Math.PI-.08,Math.PI,
      Math.PI+.08,Math.PI+.54,3*Math.PI/2,2*Math.PI-.54,2*Math.PI-.08,TAU];
    return angles.map(angle => {
      const c=Math.cos(angle),s=Math.sin(angle);
      return [Math.sign(c)*Math.abs(c)**cheekExponent*w,
        (floor+roof)/2+Math.sign(s)*Math.abs(s)**.68*(roof-floor)/2,z];
    });
  };
  const rings=zSections.map(ring);
  const faces=new Map<THREE.Material,{positions:number[];uv:number[];normals:number[]}>();
  const add=(material:THREE.Material,quad:P[],uvRect:[number,number,number,number])=>{
    const data=faces.get(material)??{positions:[],uv:[],normals:[]}; faces.set(material,data);
    const [a,b,c,d]=quad, [u0,v0,u1,v1]=uvRect;
    data.positions.push(...a,...b,...c,...b,...d,...c);
    data.uv.push(u0,v0,u1,v0,u0,v1,u1,v0,u1,v1,u0,v1);
    // Loft cross-sections make a few quads mildly noncoplanar. Both triangles
    // in each cockpit pane use one best-fit normal so the diagonal cannot
    // catch a completely different specular highlight.
    const ab=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    const ac=new THREE.Vector3(c[0]-a[0],c[1]-a[1],c[2]-a[2]);
    const bd=new THREE.Vector3(d[0]-b[0],d[1]-b[1],d[2]-b[2]);
    const bc=new THREE.Vector3(c[0]-b[0],c[1]-b[1],c[2]-b[2]);
    const normal=ab.cross(ac).add(bd.cross(bc)).normalize();
    for(let i=0;i<6;i++) data.normals.push(normal.x,normal.y,normal.z);
  };
  for (let j=0;j<rings.length-1;j++) for(let i=0;i<16;i++) {
    const wind=j===2&&[2,3,6,7].includes(i);
    const chin=j===2&&[11,14].includes(i);
    const sideWindow=j===3&&[1,2,7,8].includes(i);
    const glazing=wind||chin||sideWindow;
    const p=[rings[j][i],rings[j][i+1],rings[j+1][i],rings[j+1][i+1]];
    add(glazing?glass:skin,p,[(i/16), (zSections[j]+7.8)/15.5, (i+1)/16, (zSections[j+1]+7.8)/15.5]);
    if (glazing) for(const [a,b] of [[p[0],p[1]],[p[1],p[3]],[p[3],p[2]],[p[2],p[0]]]) brace(parent,a,b,.022,frame);
  }
  // Close the tapered nose; the later cabin loft closes the aft joint.
  const nose=rings[0];
  for(let i=0;i<16;i++) add(skin,[[0,-.40,-7.8],nose[i+1],nose[i],nose[i]], [.5,.1,.5,.1]);
  for(const [material,{positions,uv,normals}] of faces) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    if(material===glass) geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    else geometry.computeVertexNormals();
    mesh(parent,geometry,material);
  }
}

function nacelle(parent: THREE.Object3D, side: number, material: THREE.Material) {
  const rings: [number, number, number, number, number][] = [
    [3.04, .41, .42, 1.36, 1.37], [3.21, .52, .51, 1.36, 1.39],
    [3.54, .59, .56, 1.38, 1.43], [4.72, .56, .52, 1.40, 1.45],
    [5.72, .48, .46, 1.40, 1.44], [6.42, .38, .39, 1.39, 1.41],
  ];
  const points: number[] = [], uv: number[] = [], index: number[] = [], sides = 20;
  for (let j = 0; j < rings.length; j++) {
    const [z, rx, ry, x, y] = rings[j];
    for (let i = 0; i <= sides; i++) {
      const angle = i * TAU / sides;
      points.push(side * x + Math.cos(angle) * rx, y + Math.sin(angle) * ry, z);
      uv.push(i / sides, (z - rings[0][0]) / (rings.at(-1)![0] - rings[0][0]));
      if (j < rings.length - 1 && i < sides) {
        const k = j * (sides + 1) + i;
        index.push(k, k + 1, k + sides + 1, k + 1, k + sides + 2, k + sides + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index); g.computeVertexNormals();
  return mesh(parent, g, material);
}

function gearFairing(parent: THREE.Object3D, side: number, z: number, rear: boolean, material: THREE.Material) {
  const rootX=rear?1.02:1.19, outX=rear?1.66:1.69;
  const upper=rear?-.79:-1.02, lower=rear?-1.27:-1.34;
  const frontRoot=rear?-.51:-.42, backRoot=rear?.48:.43;
  const frontOuter=rear?-.30:-.26, backOuter=rear?.25:.27;
  const vertices: P[]=[
    [side*rootX,upper,z+frontRoot], [side*(rootX+.12),lower,z+frontRoot],
    [side*outX,upper-.30,z+frontOuter], [side*(outX+.02),-1.46,z+frontOuter],
    [side*rootX,upper,z+backRoot], [side*(rootX+.12),lower,z+backRoot],
    [side*outX,upper-.30,z+backOuter], [side*(outX+.02),-1.46,z+backOuter],
  ];
  const fairing=mesh(parent,new ConvexGeometry(vertices.map(point=>new THREE.Vector3(...point))),material);
  fairing.name=rear?'Aft landing gear fairing':'Forward landing gear fairing';
  return fairing;
}

function tankRoundel(parent: THREE.Object3D, stations: Station[], side: number,
  centerZ: number, centerY: number, radius: number, clearance: number, material: THREE.Material) {
  const onTank=(y:number,z:number):P=>{
    const [,width,floor,roof]=stationAt(stations,z);
    const height=(roof-floor)/2, mid=(roof+floor)/2;
    const vertical=THREE.MathUtils.clamp((y-mid)/height,-.99,.99);
    const sine=Math.sign(vertical)*Math.abs(vertical)**(1/.68);
    const cosine=Math.sqrt(1-sine*sine);
    return [side*(1.72+cosine**.63*width+clearance),y,z];
  };
  const center=onTank(centerY,centerZ), points:number[]=[], indices:number[]=[];
  points.push(...center);
  const segments=32;
  for(let i=0;i<=segments;i++) {
    const angle=i*TAU/segments;
    points.push(...onTank(centerY+Math.sin(angle)*radius,centerZ+Math.cos(angle)*radius));
    if(i>0) indices.push(0,i,i+1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return mesh(parent,geometry,material);
}

function bladeGeometry() {
  // Root radius .575 and swept tip radius 9.145 preserve the published disc.
  const plan: [number, number, number][] = [
    [.575, -.17, .18], [1.15, -.27, .28], [6.9, -.29, .29],
    [8.85, -.24, .31], [9.145, -.03, .17],
  ];
  const points: number[] = [], indices: number[] = [];
  for (const y of [.034, -.034]) for (const [radius, leading, trailing] of plan) {
    points.push(radius, y, leading, radius, y, trailing);
  }
  const stations = plan.length;
  for (let i = 0; i < stations - 1; i++) {
    const k = i * 2, b = stations * 2 + k;
    indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    indices.push(b + 2, b + 1, b, b + 2, b + 3, b + 1);
    indices.push(k, k + 2, b, b, k + 2, b + 2);
    indices.push(k + 1, b + 1, k + 3, k + 3, b + 1, b + 3);
  }
  indices.push(0, stations * 2, 1, 1, stations * 2, stations * 2 + 1);
  const end = (stations - 1) * 2, bottom = stations * 2 + end;
  indices.push(end, end + 1, bottom, end + 1, bottom + 1, bottom);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}

function rotorHeadGeometry() {
  const parts: THREE.BufferGeometry[]=[];
  const rotated=(geometry:THREE.BufferGeometry, angle:number)=>{
    geometry.rotateY(angle); parts.push(geometry);
  };
  for(let i=0;i<3;i++) {
    const angle=i*TAU/3;
    const grip=new THREE.BoxGeometry(.91,.15,.21);
    grip.translate(.52,0,0); rotated(grip,angle);
    const bearing=new THREE.CylinderGeometry(.14,.14,.17,12);
    bearing.rotateZ(Math.PI/2); bearing.translate(.79,0,0); rotated(bearing,angle);
    const from=new THREE.Vector3(.23,-.13,.24),to=new THREE.Vector3(.80,.08,.13);
    const axis=to.clone().sub(from);
    const link=new THREE.CylinderGeometry(.035,.035,axis.length(),8);
    link.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize())));
    link.translate((from.x+to.x)/2,(from.y+to.y)/2,(from.z+to.z)/2);
    rotated(link,angle);
  }
  const swashplate=new THREE.TorusGeometry(.33,.05,8,20);
  swashplate.rotateX(Math.PI/2); swashplate.translate(0,-.13,0); parts.push(swashplate);
  const result=mergeGeometries(parts,false);
  parts.forEach(part=>part.dispose());
  if(!result) throw new Error('Could not assemble the rotor head');
  return result;
}
function marking(parent: THREE.Object3D, text: string, p: P, side: number, width: number, color = '#171d19') {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.font = '600 58px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 512, 64, 1000);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  const m = mesh(parent, new THREE.PlaneGeometry(width, width / 8), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide }), p);
  m.rotation.y = side * Math.PI / 2; return m;
}

function rotorBlurTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(256, 256, 16, 256, 256, 250);
  gradient.addColorStop(0, 'rgba(40,49,45,0.04)');
  gradient.addColorStop(.35, 'rgba(40,49,45,0.22)');
  gradient.addColorStop(.72, 'rgba(40,49,45,0.43)');
  gradient.addColorStop(.90, 'rgba(40,49,45,0.32)');
  gradient.addColorStop(1, 'rgba(40,49,45,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);
  // Short, curved tonal sweeps suggest motion without freezing into blade rods.
  ctx.strokeStyle = 'rgba(22,29,26,0.12)';
  for (let ring = 0; ring < 3; ring++) {
    ctx.lineWidth = 3 + ring;
    for (let i = 0; i < 12; i++) {
      const start = i * TAU / 12 + ring * .19;
      ctx.beginPath(); ctx.arc(256, 256, 106 + ring * 55, start, start + .31); ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Authored colour/roughness atlases, not photographs. Two coordinated livery sets. */
function paintSet(japanese: boolean) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const base = japanese ? '#756449' : '#666b59';
  ctx.fillStyle = base; ctx.fillRect(0,0,1024,1024);
  if (japanese) {
    // The supplied JGSDF photographs show broad tan ground with fewer,
    // organic sage-green and near-black-green fields, including on the aft pylon.
    // Draw across the U seam to keep the wrap continuous on the fuselage.
    const blob = (x: number, y: number, w: number, h: number, rotation: number, color: string, shape: number) => {
      ctx.fillStyle = color;
      for (const wrap of [-1024, 0, 1024]) {
        ctx.save(); ctx.translate(x + wrap, y); ctx.rotate(rotation); ctx.scale(w / 2, h / 2);
        const q = Math.sin(shape * 2.7) * .12;
        ctx.beginPath(); ctx.moveTo(-1, -.20);
        ctx.bezierCurveTo(-1.14, -.76, -.48 + q, -1.13, .13, -.92);
        ctx.bezierCurveTo(.68, -1.05, 1.13, -.44 + q, .91, .12);
        ctx.bezierCurveTo(1.11, .63, .42, 1.04, -.18, .89);
        ctx.bezierCurveTo(-.76, 1.07, -1.15, .40, -1, -.20);
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    };
    const green: Array<[number,number,number,number,number]> = [
      [70,125,255,190,-.25], [485,100,335,205,.18], [900,190,325,215,-.30],
      [230,410,350,225,.22], [670,465,350,225,-.18], [85,720,300,215,.26],
      [455,825,315,230,-.12], [920,790,300,215,.28],
    ];
    green.forEach(([x,y,w,h,r],i) => blob(x,y,w,h,r,'#3e5549',i));
    // The almost-black colour is a small boundary accent, not a third set of
    // broad islands. Place a narrow, broken field on every other green edge.
    green.forEach(([x,y,w,h,r],i) => {
      if (i % 2 === 0) blob(x+w*.37,y-h*.24,w*.22,h*.58,r+.18,'#1d2c27',i+10);
    });
    // The aft closure uses its own solid green paint, so the general side
    // camouflage atlas needs no special centre patch or thin rear squiggle.
  }
  // Restrained paint variation and a few actual compartment breaks. A regular
  // square grid implied structural panels that the Chinook skin does not have.
  const wash=ctx.createLinearGradient(0,0,1024,0); wash.addColorStop(0,'#ffffff08'); wash.addColorStop(.48,'#00000000'); wash.addColorStop(.75,'#00000017'); wash.addColorStop(1,'#ffffff08'); ctx.fillStyle=wash; ctx.fillRect(0,0,1024,1024);
  const joints = [176, 254, 518, 766, 873, 955];
  ctx.strokeStyle='#15201825'; ctx.lineWidth=1.3;
  for (const y of joints) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(1024,y); ctx.stroke(); }
  ctx.strokeStyle='#111a1430'; ctx.lineWidth=1.4;
  for(const [x,y,w,h] of [[46,330,78,112],[558,394,92,76],[84,730,80,100]]) {
    ctx.strokeRect(x+.5,y+.5,w,h);
    ctx.strokeStyle='#d6d2b020'; ctx.lineWidth=.8; ctx.strokeRect(x+2,y+2,w-4,h-4);
    ctx.strokeStyle='#111a1430'; ctx.lineWidth=1.4;
  }
  // The two exhausts sit near the aft top of the cabin. Their soot is soft and
  // restrained so it reads as surface use rather than a dark livery feature.
  for(const x of [0,512]) {
    const stain=ctx.createLinearGradient(x,900,x,1024);
    stain.addColorStop(0,'rgba(35,35,30,0)'); stain.addColorStop(.48,'rgba(35,35,30,.055)'); stain.addColorStop(1,'rgba(35,35,30,.10)');
    ctx.fillStyle=stain; ctx.fillRect(x-26,900,52,124);
  }
  const map=new THREE.CanvasTexture(canvas); map.colorSpace=THREE.SRGBColorSpace; map.anisotropy=4;
  const roughCanvas=document.createElement('canvas'); roughCanvas.width=128; roughCanvas.height=128;
  const rc=roughCanvas.getContext('2d')!;rc.fillStyle='#d4d4d4';rc.fillRect(0,0,128,128);
  for(let i=0;i<256;i++){rc.fillStyle=i%2?'#cecece':'#d9d9d9';rc.fillRect((i*43)%128,(i*71)%128,7,5);}
  const roughnessMap=new THREE.CanvasTexture(roughCanvas); roughnessMap.anisotropy=2;
  const normalCanvas=document.createElement('canvas'); normalCanvas.width=512; normalCanvas.height=512;
  const nc=normalCanvas.getContext('2d')!; nc.fillStyle='#8080ff'; nc.fillRect(0,0,512,512);
  nc.strokeStyle='#8280ff'; nc.lineWidth=1;
  for(const y of joints) { nc.beginPath(); nc.moveTo(0,y/2); nc.lineTo(512,y/2); nc.stroke(); }
  const normalMap=new THREE.CanvasTexture(normalCanvas); normalMap.anisotropy=2;
  const aoCanvas=document.createElement('canvas'); aoCanvas.width=512; aoCanvas.height=512;
  const ac=aoCanvas.getContext('2d')!; ac.fillStyle='#f4f4f4'; ac.fillRect(0,0,512,512);
  ac.strokeStyle='#b5b5b5'; ac.lineWidth=1;
  for(const y of joints) { ac.beginPath(); ac.moveTo(0,y/2); ac.lineTo(512,y/2); ac.stroke(); }
  const aoMap=new THREE.CanvasTexture(aoCanvas); aoMap.anisotropy=2;
  const skin=mat('#ffffff',1,{map,roughnessMap,normalMap,normalScale:new THREE.Vector2(.22,.22),aoMap,aoMapIntensity:.48,metalness:.04}); skin.name=japanese?'JGSDF three-colour painted skin':'RSAF olive-grey painted skin';
  let aftSkin=skin;
  if(japanese) {
    const aftCanvas=document.createElement('canvas'); aftCanvas.width=512; aftCanvas.height=512;
    const aftCtx=aftCanvas.getContext('2d')!; aftCtx.fillStyle='#ffffff'; aftCtx.fillRect(0,0,512,512);
    for(const x of [0,256]) {
      const stain=aftCtx.createLinearGradient(x,438,x,512);
      stain.addColorStop(0,'rgba(35,35,30,0)'); stain.addColorStop(.55,'rgba(35,35,30,.045)'); stain.addColorStop(1,'rgba(35,35,30,.075)');
      aftCtx.fillStyle=stain; aftCtx.fillRect(x-13,438,26,74);
    }
    const aftMap=new THREE.CanvasTexture(aftCanvas); aftMap.colorSpace=THREE.SRGBColorSpace; aftMap.anisotropy=2;
    aftSkin=mat('#3e5549',1,{map:aftMap,roughnessMap,normalMap,normalScale:new THREE.Vector2(.22,.22),aoMap,aoMapIntensity:.48,metalness:.04});
  }
  if(japanese) aftSkin.name='JGSDF solid green aft paint';
  const trim=mat(japanese?'#3d5146':base,.85), seam=mat(japanese?'#263630':'#484f40',.86);
  return {skin,aftSkin,trim,seam};
}

/** Evidence-based exterior; dimensions in metres. See docs/aircraft-geometry-references.md. */
export function createAircraft(campaign: Campaign) {
  const root = new THREE.Group(); root.name = 'Chinook';
  const japanese = campaign.id === 'jp_ketapang_2026_09';
  const solid = new THREE.Group(); root.add(solid);
  const paint = paintSet(japanese);
  const body = paint.skin, olive = paint.trim, brown = paint.seam;
  const dark = mat('#202620'), rubber = mat('#131815', .98), metal = mat('#6d7168', .42, { metalness: .7 });
  rubber.name='Chinook tyres';
  // Opaque dark cockpit glass keeps a readable canopy while using a broad,
  // restrained highlight instead of expensive transmission/refraction.
  const glass = mat('#263d43', .18, { metalness: .32, side: THREE.DoubleSide, envMapIntensity: 1.18 });
  glass.name='Chinook cockpit glazing';
  const cabinGlass=mat('#263d43', .18, { metalness: .32, side: THREE.DoubleSide, envMapIntensity: 1.18 });
  cabinGlass.name='Chinook cabin glazing';
  const roundelWhite=japanese?mat('#e5e2cb',.8,{side:THREE.DoubleSide}):undefined;
  const roundelRed=japanese?mat('#ae3036',.8,{side:THREE.DoubleSide}):undefined;
  // Constant-section cargo cabin, faceted chin, and a closed upswept ramp.
  const cabinStations: Station[] = [[-7.8,.08,-.50,-.23],[-7.52,.47,-.79,.02],[-7.12,.88,-1.04,.49],[-6.67,1.19,-1.18,1.02],[-6.05,1.37,-1.32,1.43],[-5.2,1.42,-1.34,1.55],[4.6,1.42,-1.32,1.55],[6.0,1.34,-1.2,1.48],[6.8,1.16,-.97,1.35],[7.55,.91,-.61,1.17],[8.22,.70,-.31,1.03]];
  cockpitShell(solid,cabinStations,body,glass,brown);
  if (japanese) {
    // Keep the sides camouflaged, but paint the tapered aft fuselage and
    // closed rear cap solid green. This removes the S motif from the chase view.
    loft(cabinStations.slice(5,8),body,solid);
    loft(cabinStations.slice(7),paint.aftSkin,solid);
  } else loft(cabinStations.slice(5),body,solid);
  // Short forward transmission pylon and tall aft transmission pylon are defining features.
  loft([[-6.42,.54,1.22,2.13],[-6.01,.74,1.28,2.43],[-5.45,.77,1.36,2.44],[-4.84,.65,1.42,2.17],[-4.00,.16,1.49,1.62]], body, solid,
    {frontCapUv:[.02,.075,.07,.12],rearCapUv:[.02,.22,.07,.27]});
  loft([[3.85,.27,1.38,1.68],[4.45,.59,1.28,2.36],[5.35,.82,.89,3.02],[6.13,.86,.76,3.17],[7.04,.78,.74,3.08],[7.58,.57,.79,2.74],[8.12,.18,.89,1.58]], paint.aftSkin, solid,{uvRange:[3.85,8.12]});
  box(solid,[.45,.13,8.5],[0,1.57,.05],olive); // Synchronising driveshaft fairing.
  // Cabin windows and entrances sit aft of the faceted cockpit shell.
  const tankStations:Station[]=[[-4.19,.11,-.89,-.36],[-3.92,.38,-1.29,-.07],[-3.46,.61,-1.40,.04],[-2.95,.68,-1.42,.06],[3.50,.68,-1.40,.03],[4.45,.61,-1.27,-.06],[5.29,.36,-1.03,-.23],[5.58,.12,-.82,-.39]];
  for (const side of [-1,1]) {
    // The starboard crew entrance is distinct from the port emergency hatch.
    if (side > 0) {
      box(solid,[.035,1.75,.86],[side*1.434,-.20,-4.53],brown);
      box(solid,[.045,.59,.62],[side*1.458,.36,-4.53],cabinGlass);
      box(solid,[.055,.08,.22],[side*1.48,-.36,-4.18],metal);
    } else {
      box(solid,[.03,.76,.80],[side*1.439,.35,-4.57],brown);
      box(solid,[.044,.56,.59],[side*1.46,.39,-4.57],cabinGlass);
    }
    for (const z of [-3.0,-1.05,.9,2.85]) {
      const rim = cylinder(solid,.31,.04,[side*1.439,.42,z],metal,'x'); rim.name='Porthole rim';
      cylinder(solid,.269,.049,[side*1.467,.42,z],cabinGlass,'x');
    }
    // Both photographed export variants carry enlarged long-range side tanks.
    const tank = loft(tankStations,body,solid,
      {frontCapUv:[.02,.22,.07,.27],rearCapUv:[.02,.84,.07,.89]});
    tank.position.x=side*1.72;
    for (const z of [-2.95,3.52]) box(solid,[.025,.68,.035],[side*2.40,-.67,z],brown);
    // Engine cowling, open intake and exhaust are one stepped pod rather than
    // a stretched sphere with a flat disc stuck to its nose.
    nacelle(solid,side,olive);
    const intake=mesh(solid,new THREE.TorusGeometry(.43,.055,8,24),metal,[side*1.36,1.37,3.03]); intake.name='Engine intake lip';
    cylinder(solid,.36,.014,[side*1.36,1.37,3.13],dark,'z');
    cylinder(solid,.13,.025,[side*1.36,1.37,3.11],brown,'z');
    box(solid,[.36,.20,.68],[side*1.12,1.30,5.30],olive); // pod/pylon mounting saddle
    // Hollow exhaust sleeve with a recessed dark turbine face, no silver end-cap.
    const exhaust=mesh(solid,new THREE.CylinderGeometry(.39,.36,.68,24,1,true),metal,[side*1.39,1.40,6.73]); exhaust.rotation.x=Math.PI/2;
    const lip=mesh(solid,new THREE.TorusGeometry(.367,.026,6,24),metal,[side*1.39,1.40,7.08]);
    lip.name='Exhaust rolled lip';
    cylinder(solid,.327,.015,[side*1.39,1.40,6.92],dark,'z');
    // Sparse cross braces and a recessed centre are visible in the supplied
    // aft-quarter photograph; they read as an open nozzle from the chase view.
    box(solid,[.52,.018,.025],[side*1.39,1.40,7.092],brown);
    box(solid,[.018,.52,.025],[side*1.39,1.40,7.094],brown);
    ellipsoid(solid,[.055,.055,.035],[side*1.39,1.40,7.10],dark);
    for(const z of [6.51,6.76]) { const band=mesh(solid,new THREE.TorusGeometry(.379,.014,4,24),brown,[side*1.39,1.40,z]); band.name='Exhaust sleeve band'; }
    // Aft fuselage protection/sensor housings visible in operational RSAF imagery.
    if(!japanese) { const sensor=box(solid,[.22,.28,.31],[side*1.11,.06,6.92],dark); sensor.rotation.y=side*.32; }
    // Four structural legs carry six tyres: paired tyres on each forward leg,
    // one on each aft leg. The tyres still touch the deck at local Y=-2.52.
    for (const z of [-4.1,5.8]) {
      const rear=z>0;
      const legX=side*1.56, rootX=side*(rear?1.07:1.24);
      // Tapered support fairings overlap the fuselage/tank and connect to the
      // visible strut without the old floating block or spherical joint.
      gearFairing(solid,side,z,rear,olive);
      const mountZ=z-(rear?.10:0);
      box(solid,[.28,.34,.43],[side*1.54,-1.38,mountZ],olive);
      brace(solid,[rootX,rear?-.84:-1.07,z-.32],[legX,-1.80,z],.075,olive);
      brace(solid,[rootX,rear?-.89:-1.12,z+.31],[legX,-1.84,z],.064,olive);
      brace(solid,[side*1.54,-1.48,mountZ],[legX,-1.99,z],.105,metal);
      cylinder(solid,.15,.25,[legX,-1.99,z],metal,'x');
      for(const fork of [-.14,.14]) brace(solid,[legX,-1.91,z],[legX,-2.08,z+fork],.045,metal);
      const tyreXs=rear?[legX]:[side*1.40,side*1.72];
      for (const tyreX of tyreXs) {
        cylinder(solid,.44,rear?.32:.23,[tyreX,-2.08,z],rubber,'x');
        cylinder(solid,.18,rear?.335:.245,[tyreX,-2.08,z],metal,'x');
        cylinder(solid,.066,rear?.35:.26,[tyreX,-2.08,z],dark,'x');
      }
    }
    // Discreet national identifiers; no invented registration or squadron badge.
    if (japanese) {
      tankRoundel(solid,tankStations,side,3.82,-.65,.34,.028,roundelWhite!);
      tankRoundel(solid,tankStations,side,3.82,-.65,.265,.047,roundelRed!);
      marking(root,'陸上自衛隊',[side*2.409,-.51,.5],side,2.1,'#c5c4a1');
    } else marking(root,'REPUBLIC OF SINGAPORE AIR FORCE',[side*2.409,-.56,.25],side,5.5);
  }
  // The weather-radar housing tapers into the sloping chin instead of sitting
  // on the tip as a spherical button. The F's EO/IR turret remains below it.
  loft([[-8.03,.025,-.40,-.32],[-7.86,.20,-.59,-.11],[-7.64,.40,-.72,.035],[-7.42,.44,-.71,.05]],dark,solid);
  if (!japanese) {
    ellipsoid(solid,[.21,.22,.22],[0,-1.18,-6.96],olive);
    ellipsoid(solid,[.115,.11,.10],[0,-1.24,-7.14],cabinGlass);
  }
  // The body loft itself forms the closed upswept ramp; no offset flap or
  // freestanding edge pieces project beyond its tapered silhouette.
  // The low synchronising-shaft fairing above already defines the cabin roof.
  // Unreferenced tall rods and the round roof lump obscured the JGSDF silhouette.
  cylinder(solid,.12,.34,[0,-1.52,0],metal);
  const hook=mesh(solid,new THREE.TorusGeometry(.16,.04,6,12,Math.PI*1.7),dark,[0,-1.76,0]); hook.rotation.y=Math.PI/2;

  const rotors: THREE.Group[]=[];
  const rotorMat=mat('#222823',.56);
  for(const [z,y,sign] of [[-5.7,2.73,1],[6.15,3.18,-1]]) {
    cylinder(solid,.16,.38,[0,y-.1,z],metal);
    const rotor=new THREE.Group(); rotor.position.set(0,y,z); rotor.rotation.y=sign<0?Math.PI/3:0;
    const disc=mesh(rotor,new THREE.CircleGeometry(9.145,64),new THREE.MeshBasicMaterial({map:rotorBlurTexture(),transparent:true,opacity:.8,depthWrite:false,side:THREE.DoubleSide})); disc.rotation.x=-Math.PI/2; disc.position.y=-.04; disc.castShadow=false; disc.renderOrder=1;
    const blades:THREE.Mesh[]=[];
    for(let i=0;i<3;i++) {
      const g=bladeGeometry();
      const blade=mesh(rotor,g,rotorMat); blade.rotation.y=i*TAU/3; blades.push(blade);
    }
    mesh(rotor,rotorHeadGeometry(),metal).name='Articulated rotor grips and pitch links';
    cylinder(rotor,.32,.20,[0,0,0],dark);
    rotor.userData.spin=sign; rotor.userData.disc=disc; rotor.userData.blades=blades;
    root.add(rotor); rotors.push(rotor);
  }
  // Collapse stationary meshes by material; detailed exterior costs only a handful of draw calls.
  solid.updateMatrixWorld(true);
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  solid.traverse(o=>{if(o instanceof THREE.Mesh){
    const transformed=o.geometry.clone().applyMatrix4(o.matrixWorld);
    // The faceted cockpit is intentionally non-indexed while smooth lofts and
    // primitives are indexed. BufferGeometryUtils requires a uniform layout.
    const g=transformed.index ? transformed.toNonIndexed() : transformed;
    if(g!==transformed) transformed.dispose();
    if (!(o.material as THREE.MeshBasicMaterial).map) g.deleteAttribute('uv');
    const list=batches.get(o.material)??[];list.push(g);batches.set(o.material,list);
  }});
  root.remove(solid);
  for(const [material,geometries] of batches) {
    const g=mergeGeometries(geometries,false);
    if(!g) throw new Error(`Could not merge aircraft geometry for ${material.name || material.type}`);
    mesh(root,g,material);
    geometries.forEach(geo=>geo.dispose());
  }
  solid.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});
  const lightMounts=createAircraftLightMounts(root,{
    port: {position:[-2.25,-.35,-3.50],direction:[-1,.06,-.20]},
    starboard: {position:[2.25,-.35,-3.50],direction:[1,.06,-.20]},
    aft: {position:[0,1.30,8.16],direction:[0,.05,1]},
    upperBeacon: {position:[0,3.21,6.42],direction:[0,.91,.42]},
    lowerBeacon: {position:[0,-1.40,.52],direction:[0,-.91,.42]},
    landingPort: {position:[-.50,-1.18,-6.55],direction:[-.07,-.71,-.70]},
    landingStarboard: {position:[.50,-1.18,-6.55],direction:[.07,-.71,-.70]},
  });
  return {root,rotors,lightMounts};
}
