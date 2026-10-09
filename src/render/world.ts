import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Campaign, Mission, SimState } from '../types';
import { setRenderedTerrainHeights, setStructureColliders, setTreeColliders, terrainHeight as collisionTerrainHeight } from '../sim/collision';
import type { StructureCollider, TreeCollider } from '../sim/collision';
import { createAtmosphere } from './atmosphere';
import { createWater } from './water';

type V = { x: number; z: number };
const TAU = Math.PI * 2;
const distance = (a: V, b: V) => Math.hypot(a.x - b.x, a.z - b.z);
const distanceToLeg = (point: V, start: V, end: V) => {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.z - start.z - t * dz);
};
const seeded = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const material = (color: THREE.ColorRepresentation, roughness = .94) => new THREE.MeshStandardMaterial({ color, roughness });
function block(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], mat: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...position); mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

// A small shared library of branch-supported crowns, not one sphere per tree.
// Each template has five overlapping, asymmetrical foliage masses (100 triangles).
function treeCrown(variant: number) {
  const parts: THREE.BufferGeometry[] = [];
  const rng = seeded(803 + variant * 59);
  for (let i = 0; i < 5; i++) {
    const a = i * 2.399 + variant, outer = i > 0;
    const g = new THREE.IcosahedronGeometry(1, 0);
    const position = g.getAttribute('position');
    const shades: number[] = [];
    for (let v = 0; v < position.count; v++) {
      const x = position.getX(v), y = position.getY(v), z = position.getZ(v);
      // Coordinate-based perturbations keep duplicate triangle vertices watertight.
      const ripple = 1 + .11 * Math.sin(x * 13 + y * 7 + z * 11 + variant);
      position.setXYZ(v, x * ripple, y * ripple, z * ripple);
      const shade = .78 + (y + 1) * .11 + i * .012;
      shades.push(shade * .96, shade, shade * .91);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
    const width = outer ? .54 + rng() * .2 : .75;
    g.scale(width, (variant === 1 ? .57 : variant === 2 ? .67 : .43) * (.8 + rng() * .4), width * (.82 + rng() * .25));
    g.translate(outer ? Math.cos(a) * .58 : 0, outer ? (variant === 1 ? -.22 : -.12) + rng() * .43 : .2, outer ? Math.sin(a) * .58 : 0);
    g.computeVertexNormals(); parts.push(g);
  }
  const result = mergeGeometries(parts)!; parts.forEach(g => g.dispose()); return result;
}
function treeWood() {
  const pieces: THREE.BufferGeometry[] = [];
  const stem = new THREE.CylinderGeometry(.18, .44, .88, 5, 1, true); stem.translate(0,.44,0); pieces.push(stem);
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3 + .3;
    const start = new THREE.Vector3(0,.52,0), end = new THREE.Vector3(Math.cos(a)*2.5,.98,Math.sin(a)*2.5);
    const delta = end.clone().sub(start);
    const branch = new THREE.CylinderGeometry(.06,.2,delta.length(),4,1,true);
    branch.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    branch.translate(...start.add(end).multiplyScalar(.5).toArray()); pieces.push(branch);
  }
  const result=mergeGeometries(pieces)!;pieces.forEach(g=>g.dispose());return result;
}

/** Reference-informed, deliberately compressed lowland composition; not surveyed geography.
 * Keep all freshwater at y=0 and operational ground within 0.6 m of sim ground.
 * See docs/map-geometry-references.md for evidence and reconstruction boundaries. */
export function createWorld(scene: THREE.Scene, campaign: Campaign, mission: Mission) {
  const atmosphere = createAtmosphere(scene, campaign, mission);
  const jp = campaign.id === 'jp_ketapang_2026_09';
  // Fixed theatre seed: the coastline and forest do not rearrange between sorties.
  const random = seeded(jp ? 62017 : 62135);
  const target = mission.shore ?? mission.lake;
  const dx = target.x - mission.ship.x, dz = target.z - mission.ship.z;
  const routeLength = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / routeLength, uz = dz / routeLength, sx = -uz, sz = ux;
  const fromLocal = (t: number, s: number): V => ({ x: mission.ship.x + t * ux + s * sx, z: mission.ship.z + t * uz + s * sz });
  const local = (p: V) => ({ t: (p.x - mission.ship.x) * ux + (p.z - mission.ship.z) * uz, s: (p.x - mission.ship.x) * sx + (p.z - mission.ship.z) * sz });
  const flightLegs = campaign.missions.flatMap(m => {
    const first = m.shore ?? m.lake;
    return [[m.ship, first], [first, m.lake], [m.lake, m.fire]] as [V, V][];
  });
  const coast = routeLength * .42;
  const coastAt = (s: number) => coast + 34 * Math.sin(s * .003) + 19 * Math.sin(s * .008 + .5);
  const inland = 6500, lateral = 4700;
  // One height field drives both the visible mesh and the aircraft collision
  // envelope. A null result is open water, which this land mesh never samples.
  const terrainHeight = (x: number, z: number) => collisionTerrainHeight(campaign, mission, x, z) ?? -9;
  const water = createWater(scene, campaign, mission);
  water.surface(new THREE.PlaneGeometry(80000, 80000), 0, new THREE.Vector3(0, -9, 0));

  // Small repeating ground grain provides scale without a large downloaded texture.
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const data = ctx.createImageData(128, 128);
    for (let i = 0; i < data.data.length; i += 4) {
      const n = 190 + random() * 65;
      data.data[i] = n; data.data[i + 1] = n; data.data[i + 2] = n; data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  }
  const grain = new THREE.CanvasTexture(canvas); grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(95, 65); grain.colorSpace = THREE.SRGBColorSpace;
  const positions: number[] = [], heights: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
  const cols = 96, rows = 112;
  for (let row = 0; row <= rows; row++) {
    const s = -lateral + row / rows * lateral * 2;
    for (let col = 0; col <= cols; col++) {
      const t = coastAt(s) + col / cols * (inland - coastAt(s));
      const p = fromLocal(t, s), height = terrainHeight(p.x, p.z);
      positions.push(p.x, height, p.z); heights.push(height); uvs.push(row / rows, col / cols);
      const wet = Math.sin(t * .009 + s * .004) + Math.cos(s * .007 - t * .002);
      const c = new THREE.Color(col === 0 ? '#938977' : col === 1 ? '#7c8060' : wet > .6 ? '#536947' : wet < -.8 ? '#7b8055' : '#62724b');
      c.offsetHSL(0, 0, (random() - .5) * .035); colors.push(c.r, c.g, c.b);
      if (col < cols && row < rows) { const a = row * (cols + 1) + col, b = a + cols + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
    }
  }
  setRenderedTerrainHeights(mission, heights);
  const terrain = new THREE.BufferGeometry(); terrain.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); terrain.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); terrain.setIndex(indices); terrain.computeVertexNormals();
  const land = new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, map: grain, roughness: 1 })); land.receiveShadow = true; scene.add(land);

  // Retain the entire authored refill disc; extend irregular bays away from the operational fire area.
  const lakeLocal = local(mission.lake), r = mission.lake.radius;
  const lakeRadius = (a: number) => r * (1.02 + .025 * (1 + Math.sin(a * 5 + .8)) + .04 * Math.pow(Math.max(0, Math.cos(a - Math.PI)), 4));
  const lakeBoundary = (scale: number) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < 96; i++) { const a = i / 96 * TAU, radius = lakeRadius(a) * scale; pts.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius)); }
    return new THREE.ShapeGeometry(new THREE.Shape(pts));
  };
  const shore = new THREE.Mesh(lakeBoundary(1.07), material('#85815a'));
  shore.rotation.x = -Math.PI / 2; shore.position.set(mission.lake.x, -.16, mission.lake.z); scene.add(shore);
  const lake = water.surface(lakeBoundary(1), 1, new THREE.Vector3(mission.lake.x, .025, mission.lake.z));

  // A separate river/drainage corridor to one side of the gameplay route. No invented named river.
  const riverS = (t: number) => -850 + 120 * Math.sin(t * .0021) + 75 * Math.sin(t * .0053);
  const ribbon = (width: number, y: number, mat: THREE.Material) => {
    const verts: number[] = [], idx: number[] = [];
    for (let i = 0; i <= 100; i++) {
      const t = coast - 120 + i / 100 * 6500, center = riverS(t), w = width * (1 + .22 * Math.sin(t * .003));
      for (const side of [-1, 1]) { const p = fromLocal(t, center + side * w); verts.push(p.x, t < coast + 75 ? -8.8 + Math.max(0, (t - coast) / 75) * 8.8 : y, p.z); }
      if (i < 100) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals(); const mesh = new THREE.Mesh(g, mat); scene.add(mesh);
  };
  ribbon(jp ? 68 : 48, -.12, material('#7e7659')); ribbon(jp ? 56 : 38, .015, water.riverMaterial);

  // Layered broadleaf, narrow swamp and spreading coastal crowns share four instanced draws.
  const count = 11500;
  const trunks = new THREE.InstancedMesh(treeWood(), material('#ffffff'), count);
  const crowns = [0,1,2].map(v => new THREE.InstancedMesh(treeCrown(v), new THREE.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:1}), count));
  const crownCounts = [0,0,0];
  const roots = new THREE.InstancedMesh(new THREE.CylinderGeometry(.08,.22,1,4,1,true),material('#605b49'),2400);
  let rootCount=0;
  const dummy = new THREE.Object3D(); let made = 0;
  const treeColliders: TreeCollider[] = [];
  const inWater = (p: V) => { const x = p.x - mission.lake.x, z = -(p.z - mission.lake.z); return Math.hypot(x, z) < lakeRadius(Math.atan2(z, x)) * 1.09; };
  const settlementLocal = { t: lakeLocal.t + 25, s: lakeLocal.s + r * 1.2 + 65 };
  for (let tries = 0; made < count && tries < count * 7; tries++) {
    // Most canopy is concentrated where the player flies; distant forest supplies the horizon.
    const near = random() < .8;
    const t = coast + 100 + random() * (near ? 2400 : inland - coast - 100), s = (random() - .5) * (near ? 2600 : 8500);
    const p = fromLocal(t, s);
    let corridorDistance = Infinity;
    for (const [a, b] of flightLegs) corridorDistance = Math.min(corridorDistance, distanceToLeg(p, a, b));
    if (t < coastAt(s) + 65 || inWater(p) || Math.abs(s - riverS(t)) < 88 || corridorDistance < 58 || campaign.missions.some(m => distance(p, m.fire) < m.fire.radius + 40) || (mission.shore && distance(p, mission.shore) < 900) || Math.hypot(t - settlementLocal.t, s - settlementLocal.s) < 110) continue;
    const patch = Math.sin(t * .006) * Math.cos(s * .005) + Math.sin((s + t) * .013) * .3;
    if (patch < -.55 && random() < .82) continue;
    const coastal = t - coastAt(s) < 220;
    const h = corridorDistance < 125 ? 4 + random() * 4 : coastal ? 4 + random() * 5 : 11 + random() * 14;
    const ground = terrainHeight(p.x,p.z), yaw=random()*TAU;
    // Tree height and crown width are correlated, with occasional emergent individuals.
    const radius = coastal ? 2.6+random()*2 : h*(.23+random()*.1);
    treeColliders.push({ x: p.x, z: p.z, ground, height: h, radius });
    dummy.position.set(p.x,ground,p.z); dummy.rotation.set(0,yaw,0);
    dummy.scale.set(radius*.23,h,radius*.23);dummy.updateMatrix();trunks.setMatrixAt(made,dummy.matrix);
    trunks.setColorAt(made,new THREE.Color().setHSL(.09,.17,.24+random()*.07).convertSRGBToLinear());
    const variant=coastal?2:random()<.36?1:0;
    dummy.position.y=ground+h*.96;dummy.scale.set(radius*(.85+random()*.25),radius*(variant===1?1.15:.9)*(.78+random()*.5),radius*(.8+random()*.4));dummy.updateMatrix();
    crowns[variant].setMatrixAt(crownCounts[variant],dummy.matrix);
    // HSL values are authored as display colours; convert to linear like the hex materials.
    // Otherwise instance colours become chalky under the bright hemisphere lighting.
    // Nearby trees share a subdued stand colour; each tree retains a small variation.
    crowns[variant].setColorAt(crownCounts[variant]++,new THREE.Color().setHSL(.255+Math.sin(t*.003+s*.002)*.016+random()*.012,.3+random()*.12,.24+random()*.065).convertSRGBToLinear());
    if(coastal&&rootCount+4<=2400)for(let k=0;k<4;k++){
      const a=yaw+k*TAU/4, start=new THREE.Vector3(p.x,ground+h*.32,p.z),end=new THREE.Vector3(p.x+Math.cos(a)*2.1,ground,p.z+Math.sin(a)*2.1);
      const delta=end.clone().sub(start);dummy.position.copy(start.add(end).multiplyScalar(.5));dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize());dummy.scale.set(1,delta.length(),1);dummy.updateMatrix();roots.setMatrixAt(rootCount++,dummy.matrix);
    }
    made++;
  }
  trunks.count=made;crowns.forEach((mesh,i)=>mesh.count=crownCounts[i]);roots.count=rootCount;scene.add(trunks,...crowns,roots);


  // Distinct understory, mangrove scrub and palms complement the taller broadleaf canopy.
  const shrubs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),material('#687448'),1800);
  const reeds = new THREE.InstancedMesh(new THREE.ConeGeometry(.7,1,4),material('#8b8c59'),1100);
  const palmTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.22,.4,1,6),material('#75634c'),180);
  const frondGeometry = new THREE.BufferGeometry(), frondVertices:number[]=[];
  // A bowed rachis with separated paired pinnae: visible feathery edges, not solid paddles.
  for(let i=0;i<12;i++){
    const t=.08+i/12*.87,z=t*6,y=.8*Math.sin(t*Math.PI)-1.5*t*t,w=1.05*Math.sin(t*Math.PI)*(.95-i*.025);
    for(const side of [-1,1])frondVertices.push(0,y,z, side*w,y-.18,z+.55, side*.07,y-.1,z+.29);
  }
  frondGeometry.setAttribute('position',new THREE.Float32BufferAttribute(frondVertices,3));frondGeometry.computeVertexNormals();
  const fronds = new THREE.InstancedMesh(frondGeometry,new THREE.MeshStandardMaterial({color:'#526b39',roughness:.95,side:THREE.DoubleSide}),1260);
  let shrubCount=0,reedCount=0,palmCount=0;
  for(let i=0;i<3500;i++) {
    const t=coast+110+random()*2600,s=(random()-.5)*2600,p=fromLocal(t,s);
    if(t<coastAt(s)+65||Math.hypot(t-settlementLocal.t,s-settlementLocal.s)<110||inWater(p)||Math.abs(s-riverS(t))<85||campaign.missions.some(m=>distance(p,m.fire)<m.fire.radius+20)||(mission.shore&&distance(p,mission.shore)<900))continue;
    if(shrubCount<1800){dummy.position.set(p.x,terrainHeight(p.x,p.z)+.7,p.z);dummy.scale.set(1.5+random()*2,.7+random(),1.5+random()*2);dummy.rotation.set(0,random()*TAU,0);dummy.updateMatrix();shrubs.setMatrixAt(shrubCount++,dummy.matrix);}
    const corridor=Math.min(...flightLegs.map(([a,b])=>distanceToLeg(p,a,b)));
    if(palmCount<180&&corridor>140&&random()<.16){const h=7+random()*8,palmGround=terrainHeight(p.x,p.z);dummy.position.set(p.x,palmGround+h*.5,p.z);dummy.scale.set(1,h,1);dummy.rotation.set(.03,random()*TAU,.03);dummy.updateMatrix();palmTrunks.setMatrixAt(palmCount,dummy.matrix);const tip=new THREE.Vector3(0,.5,0).applyMatrix4(dummy.matrix);for(let f=0;f<7;f++){dummy.position.copy(tip);dummy.scale.setScalar(.65+random()*.3);dummy.rotation.set(0,f/7*TAU+random()*.2,0);dummy.updateMatrix();fronds.setMatrixAt(palmCount*7+f,dummy.matrix);}treeColliders.push({x:p.x,z:p.z,ground:palmGround,height:h,radius:4.5});palmCount++;}
  }
  for(let i=0;i<1100;i++){const a=random()*TAU,rad=lakeRadius(a)*(1.025+random()*.06);const x=mission.lake.x+Math.cos(a)*rad,z=mission.lake.z-Math.sin(a)*rad;dummy.position.set(x,.45,z);dummy.scale.set(.35+random()*.5,.8+random()*1.4,.35+random()*.5);dummy.rotation.set(0,random()*TAU,0);dummy.updateMatrix();reeds.setMatrixAt(reedCount++,dummy.matrix);}
  shrubs.count=shrubCount;reeds.count=reedCount;palmTrunks.count=palmCount;fronds.count=palmCount*7;scene.add(shrubs,reeds,palmTrunks,fronds);
  setTreeColliders(mission, treeColliders);

  const timber = material('#79684c'), roof = material('#777d73'), wall = material('#b7aa8e'), dark = material('#343d36');
  const solidStructures: Array<{ object: THREE.Object3D; label: string }> = [];
  const settlement = new THREE.Group(); const village = fromLocal(settlementLocal.t, settlementLocal.s);
  settlement.position.set(village.x, 0, village.z); settlement.rotation.y = Math.atan2(ux, uz);
  // Long roadside/lakeside arrangement with raised floors and gabled sheet roofs.
  for (let i = 0; i < 12; i++) {
    const home = new THREE.Group(), x = (i % 2 ? 1 : -1) * 20, z = (Math.floor(i / 2) - 2.5) * 24;
    home.position.set(x, 0, z); block(home, [10, 3.7, 15], [0, 3.55, 0], wall);
    for (const px of [-4, 4]) for (const pz of [-6, 6]) block(home, [.35, 2, .35], [px, .8, pz], timber);
    for (const side of [-1, 1]) { const slope = block(home, [6, .18, 17], [side * 2.65, 6.15, 0], roof); slope.rotation.z = side * -.37; }
    block(home, [1.5, 2.5, .12], [0, 3.1, -7.56], dark); block(home, [2.2, 1.25, .12], [3.0, 4, -7.56], dark); settlement.add(home);
    solidStructures.push({ object: home, label: 'settlement' });
  }
  block(settlement, [7, .09, 180], [0, -.05, 0], material('#a79770'));
  block(settlement, [110, .28, 2.8], [85, 1.1, 0], timber);
  for (let i = 0; i < 9; i++) block(settlement, [.4, 2.6, .4], [35 + i * 12, -.1, 0], timber);
  scene.add(settlement);
  const boats = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const boat = new THREE.Group(); block(boat, [1.8, .6, 9], [0, .3, 0], timber); block(boat, [1.5, .16, 5], [0, .62, 0], dark);
    const p = fromLocal(lakeLocal.t + (i - 1) * 19, lakeLocal.s + r * .76); boat.position.set(p.x, .04, p.z); boat.rotation.y = Math.atan2(ux, uz) + .3; boats.add(boat);
  }
  scene.add(boats);
  if (mission.shore) {
    // Representative apron at the authored pad; dimensions informed by DGCA facilities listing.
    const apron = new THREE.Group(); apron.position.set(mission.shore.x, 0, mission.shore.z); apron.rotation.y = Math.atan2(ux, uz);
    const concrete=material('#a5aaa3'),asphalt=material('#515957'),stripe=material('#d7d6c5'),glass=material('#586e6e',.25);
    block(apron, [60, .06, 30], [0, -.05, 0], concrete);
    block(apron, [224,.06,51],[105,-.05,74],asphalt);
    // Full-width, compressed-length runway 17/35; correct facilities, authored placement.
    block(apron,[30,.06,1000],[235,-.05,380],asphalt);
    for(const z of [-60,740])block(apron,[100,.06,18],[180,-.04,z],asphalt);
    for(let z=-80;z<860;z+=55)block(apron,[.9,.02,24],[235,.003,z],stripe);
    for(const x of [220.6,249.4])block(apron,[.3,.02,1000],[x,.003,380],stripe);
    for(const z of [-95,845])for(const x of [-10,-6,-2,2,6,10])block(apron,[1.5,.02,22],[235+x,.005,z],stripe);
    for(const x of [-25,25])block(apron,[.25,.02,26],[x,.003,0],stripe);
    // Low terminal, broad overhanging roof, shaded glazing and a compact control tower.
    const terminal = block(apron,[70,6,25],[85,3,128],wall);block(apron,[77,.4,31],[85,6.4,128],roof);
    solidStructures.push({ object: terminal, label: 'airport terminal' });
    for(let x=56;x<=114;x+=8)block(apron,[5,2.4,.18],[x,3.6,115.4],glass);
    for(const x of [48,65,85,105,122])block(apron,[.35,5,.35],[x,2.5,110],concrete);
    const tower = block(apron,[8,15,8],[141,7.5,131],concrete);block(apron,[11,3,11],[141,16,131],glass);block(apron,[13,.4,13],[141,17.7,131],roof);
    solidStructures.push({ object: tower, label: 'control tower' });
    // Service shed and parked rescue truck provide scale without obstructing the helipad.
    const shed = block(apron,[20,6,14],[-36,3,69],wall);block(apron,[22,.4,17],[-36,6.3,69],roof);
    const truck = block(apron,[3,2.8,7],[-22,1.5,53],material('#a84a32'));block(apron,[2.7,1.2,2],[-22,3.4,51],glass);
    solidStructures.push({ object: shed, label: 'airport shed' }, { object: truck, label: 'parked vehicle' });
    for(let x=10;x<=170;x+=40){block(apron,[.2,.02,35],[x,.01,71],material('#dbb95f'));block(apron,[12,.02,.2],[x,.01,55],stripe);}
    const signCanvas=document.createElement('canvas');signCanvas.width=512;signCanvas.height=64;const signContext=signCanvas.getContext('2d')!;signContext.fillStyle='#d3d2b9';signContext.fillRect(0,0,512,64);signContext.fillStyle='#354b45';signContext.font='bold 30px sans-serif';signContext.textAlign='center';signContext.fillText('RAHADI OESMAN',256,43);const signTexture=new THREE.CanvasTexture(signCanvas);signTexture.colorSpace=THREE.SRGBColorSpace;const sign=new THREE.Mesh(new THREE.PlaneGeometry(24,3),new THREE.MeshBasicMaterial({map:signTexture}));sign.position.set(85,6.8,112.3);sign.rotation.y=Math.PI;apron.add(sign);
    scene.add(apron);
  }
  const structureColliders: StructureCollider[] = solidStructures.map(({ object, label }) => {
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
      halfWidth: (bounds.max.x - bounds.min.x) / 2,
      halfLength: (bounds.max.z - bounds.min.z) / 2,
      bottom: bounds.min.y,
      top: bounds.max.y,
      label,
    };
  });
  setStructureColliders(mission, structureColliders);
  return {
    update(time: number, camera?: THREE.Vector3, state?: SimState) {
      water.update(time, state);
      atmosphere.update(time, camera, state);
      // A slight boat bob gives the small lakeside craft a readable waterline.
      boats.children.forEach((boat, i) => { boat.position.y = .04 + Math.sin(time * 1.1 + i * 2) * .065; boat.rotation.z = Math.sin(time * .8 + i) * .018; });
    },
    dispose() { water.dispose(); },
    terrainHeight, lake, shore, boats, route: { ux, uz, sx, sz, routeLength },
  };
}
