import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Campaign } from '../types';

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
function loft(stations: [number, number, number, number][], material: THREE.Material, parent: THREE.Object3D, options: { uvRange?: [number,number]; rearCapUv?: [number,number,number,number] } = {}) {
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
    const rect=end?options.rearCapUv:undefined;
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

function panel(parent: THREE.Object3D, vertices: P[], material: THREE.Material, uvRect: [number,number,number,number] = [0,0,1,1]) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
  const indices: number[] = []; for (let i = 1; i < vertices.length - 1; i++) indices.push(0, i, i + 1);
  const [u0,v0,u1,v1]=uvRect;
  g.setIndex(indices); g.setAttribute('uv', new THREE.Float32BufferAttribute(vertices.map((_, i) => [[u0,v0],[u1,v0],[u1,v1],[u0,v1]][i % 4]).flat(), 2)); g.computeVertexNormals(); return mesh(parent, g, material);
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
  // Subtle broad paint variation, panel joints and fasteners survive mip filtering naturally.
  const wash=ctx.createLinearGradient(0,0,1024,0); wash.addColorStop(0,'#ffffff08'); wash.addColorStop(.48,'#00000000'); wash.addColorStop(.75,'#00000017'); wash.addColorStop(1,'#ffffff08'); ctx.fillStyle=wash; ctx.fillRect(0,0,1024,1024);
  ctx.strokeStyle='#15201838'; ctx.lineWidth=1.2;
  for(let y=48;y<1024;y+=97) {ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1024,y);ctx.stroke();}
  for(let x=40;x<1024;x+=128) {ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,1024);ctx.stroke();}
  ctx.fillStyle='#151b173a'; for(let y=48;y<1024;y+=97) for(let x=10;x<1024;x+=18) ctx.fillRect(x,y+4,1.5,1.5);
  const map=new THREE.CanvasTexture(canvas); map.colorSpace=THREE.SRGBColorSpace; map.anisotropy=4;
  const roughCanvas=document.createElement('canvas'); roughCanvas.width=128; roughCanvas.height=128;
  const rc=roughCanvas.getContext('2d')!;rc.fillStyle='#d4d4d4';rc.fillRect(0,0,128,128);
  for(let i=0;i<256;i++){rc.fillStyle=i%2?'#cecece':'#d9d9d9';rc.fillRect((i*43)%128,(i*71)%128,7,5);}
  const roughnessMap=new THREE.CanvasTexture(roughCanvas);
  const skin=mat('#ffffff',1,{map,roughnessMap,metalness:.06}); skin.name=japanese?'JGSDF three-colour painted skin':'RSAF olive-grey painted skin';
  const aftSkin=japanese?mat('#3e5549',1,{roughnessMap,metalness:.06}):skin;
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
  const glass = mat('#142d35', .14, { metalness: .38, side: THREE.DoubleSide });
  // Constant-section cargo cabin, sloping chin, broad flat rear closure: not an ellipsoid.
  const cabinStations: [number,number,number,number][] = [[-7.8,.1,-.65,-.15],[-7.4,.82,-1.05,.25],[-6.9,1.14,-1.3,.6],[-6.1,1.35,-1.34,1.38],[-5.2,1.42,-1.34,1.55],[4.6,1.42,-1.32,1.55],[6.0,1.34,-1.2,1.48],[6.8,1.16,-.97,1.35],[7.55,.91,-.61,1.17],[8.22,.70,-.31,1.03]];
  if (japanese) {
    // Keep the sides camouflaged, but paint the tapered aft fuselage and
    // closed rear cap solid green. This removes the S motif from the chase view.
    loft(cabinStations.slice(0,7),body,solid);
    loft(cabinStations.slice(6),paint.aftSkin,solid);
  } else loft(cabinStations,body,solid);
  // Short forward transmission pylon and tall aft transmission pylon are defining features.
  loft([[-6.45,.6,1.2,2.23],[-6.0,.8,1.25,2.45],[-5.3,.8,1.35,2.37],[-4.6,.55,1.4,2.05],[-3.85,.2,1.45,1.55]], body, solid);
  loft([[3.85,.32,1.3,1.65],[4.5,.69,1.22,2.55],[5.3,.89,.65,3.05],[6.3,.91,.4,3.18],[7.24,.78,.25,3.0],[7.8,.63,.49,2.65],[8.25,.46,.84,1.73]], paint.aftSkin, solid,{uvRange:[3.85,8.25]});
  box(solid,[.45,.13,8.5],[0,1.57,.05],olive); // Synchronising driveshaft fairing.
  // Framed, flat cockpit panes. Forward windows slope into the roof, lower nose windows into the chin.
  for (const side of [-1,1]) {
    const S = (x:number,y:number,z:number):P => [side*x,y,z];
    panel(solid,[S(.075,.43,-7.13),S(.89,.39,-6.99),S(.86,1.19,-6.24),S(.075,1.28,-6.38)],glass);
    panel(solid,[S(.98,.39,-6.93),S(1.32,.33,-6.09),S(1.30,1.13,-5.97),S(.98,1.17,-6.2)],glass);
    panel(solid,[S(1.35,.31,-5.97),S(1.425,.28,-5.23),S(1.425,1.10,-5.23),S(1.35,1.15,-5.97)],glass);
    panel(solid,[S(.92,.24,-7.02),S(1.18,-.08,-6.54),S(.99,-.89,-6.65),S(.77,-.72,-7.14)],glass);
    // Crew door and round troop-cabin windows, four evenly spaced portholes.
    box(solid,[.035,1.8,.86],[side*1.425,-.19,-4.51],brown);
    box(solid,[.04,.64,.63],[side*1.452,.35,-4.51],glass);
    for (const z of [-3.0,-1.05,.9,2.85]) {
      const rim = cylinder(solid,.31,.04,[side*1.439,.42,z],metal,'x'); rim.name='Porthole rim';
      cylinder(solid,.269,.049,[side*1.467,.42,z],glass,'x');
    }
    // Both photographed export variants carry enlarged long-range side tanks.
    const tank = loft([[-4.15,.08,-.8,-.35],[-3.8,.5,-1.35,-.02],[-3.25,.68,-1.4,.03],[3.55,.68,-1.38,.0],[4.9,.55,-1.18,-.16],[5.6,.07,-.79,-.35]],body,solid);
    tank.position.x=side*1.72;
    for (const z of [-3.2,2.9]) box(solid,[.025,.8,.055],[side*2.40,-.67,z],brown);
    // Engines sit beside the rear pylon, intake forward and bright exhaust aft.
    ellipsoid(solid,[.56,.55,1.85],[side*1.35,1.38,4.83],olive);
    cylinder(solid,.46,.20,[side*1.35,1.38,3.13],dark,'z');
    ellipsoid(solid,[.24,.24,.14],[side*1.35,1.38,3.0],brown);
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
    box(solid,[.055,.30,.13],[side*1.10,-.06,7.64],olive);
    // Four landing legs and four wheels. Compact structural mounts replace the
    // oversized spherical joints; the tyre contact plane stays at -2.52 m.
    for (const z of [-4.1,5.8]) {
      const rear=z>0;
      const legX=side*1.56, mountZ=z-(rear?.12:.03);
      box(solid,[.27,.31,.40],[side*1.49,-1.30,mountZ],olive);
      brace(solid,[side*1.49,-1.45,mountZ],[legX,-1.94,z],.105,metal);
      brace(solid,[side*(rear?1.57:1.44),-1.27,z-.39],[legX,-1.91,z],.064,olive);
      brace(solid,[side*(rear?1.46:1.40),-1.28,z+.31],[legX,-1.91,z],.058,brown);
      for(const fork of [-.13,.13]) brace(solid,[legX,-1.87,z],[legX,-2.08,z+fork],.047,metal);
      cylinder(solid,.14,.28,[legX,-2.08,z],metal,'x');
      cylinder(solid,.44,.30,[legX,-2.08,z],rubber,'x');
      cylinder(solid,.19,.32,[legX,-2.08,z],metal,'x');
      cylinder(solid,.065,.33,[legX,-2.08,z],dark,'x');
    }
    // Discreet national identifiers; no invented registration or squadron badge.
    if (japanese) {
      const m=mesh(solid,new THREE.CircleGeometry(.35,24),mat('#e5e2cb'),[side*1.445,.39,4.0]); m.rotation.y=side*Math.PI/2;
      const red=mesh(solid,new THREE.CircleGeometry(.28,24),mat('#ae3036'),[side*1.452,.39,4.0]); red.rotation.y=side*Math.PI/2;
      marking(root,'陸上自衛隊',[side*2.409,-.51,.5],side,2.1,'#c5c4a1');
    } else marking(root,'REPUBLIC OF SINGAPORE AIR FORCE',[side*2.409,-.56,.25],side,5.5);
  }
  // Rounded weather-radar nose and the F's chin sensor, visible in MINDEF imagery.
  ellipsoid(solid,[.52,.37,.44],[0,-.20,-7.77],dark);
  if (!japanese) { ellipsoid(solid,[.22,.27,.23],[0,-1.38,-7.15],olive); ellipsoid(solid,[.12,.12,.11],[0,-1.45,-7.33],glass); }
  // The body loft itself forms the closed upswept ramp; no offset flap or
  // freestanding edge pieces project beyond its tapered silhouette.
  ellipsoid(solid,[.055,.06,.055],[0,2.84,7.52],mat('#9d2824',.35,{emissive:'#8f1c19',emissiveIntensity:.35}));
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
      const g=new THREE.BoxGeometry(8.57,.055,.52); g.translate(4.86,0,0);
      const blade=mesh(rotor,g,rotorMat); blade.rotation.y=i*TAU/3; blades.push(blade);
      const grip=box(rotor,[.85,.16,.20],[0,0,0],metal); grip.geometry.translate(.50,0,0); grip.rotation.y=i*TAU/3;
    }
    cylinder(rotor,.32,.20,[0,0,0],dark);
    rotor.userData.spin=sign; rotor.userData.disc=disc; rotor.userData.blades=blades;
    root.add(rotor); rotors.push(rotor);
  }
  // Collapse stationary meshes by material; detailed exterior costs only a handful of draw calls.
  solid.updateMatrixWorld(true);
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  solid.traverse(o=>{if(o instanceof THREE.Mesh){const g=o.geometry.clone().applyMatrix4(o.matrixWorld);if (!(o.material as THREE.MeshBasicMaterial).map) g.deleteAttribute('uv');const list=batches.get(o.material)??[];list.push(g);batches.set(o.material,list);}});
  root.remove(solid);
  for(const [material,geometries] of batches) { const g=mergeGeometries(geometries,false); if(g) mesh(root,g,material); geometries.forEach(geo=>geo.dispose()); }
  solid.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});
  return {root,rotors};
}
