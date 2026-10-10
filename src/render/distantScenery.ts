import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Campaign, Mission } from '../types';

export type DistantSceneryContext = { preview?: boolean };

const seeded = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
};

function appendTriangle(positions: number[], colors: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) {
  for (const point of [a, b, c]) {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b);
  }
}

/** A folded, low-poly ridge silhouette with a solid crest and fog-enabled natural material. */
function ridgeGeometry(seed: number, width: number, near: number, depth: number, height: number): THREE.BufferGeometry {
  const random = seeded(seed), samples = 42;
  const roughness = Array.from({ length: samples + 1 }, () => .52 + random() * .48);
  const positions: number[] = [], colors: number[] = [];
  const front = new THREE.Color('#657267'), back = new THREE.Color('#56645a');
  const sections = Array.from({ length: samples + 1 }, (_, i) => {
    const u = i / samples, x = (u * 2 - 1) * width;
    const envelope = Math.pow(Math.max(0, Math.sin(u * Math.PI)), .64);
    const broad = .43 + .24 * Math.sin(u * Math.PI * 2.5 + .35) + .13 * Math.sin(u * Math.PI * 7.1 + 1.1);
    const shoulder = .72 + roughness[i] * .38;
    const ridgeY = Math.max(0, height * envelope * broad * shoulder);
    const z = near + Math.sin(u * Math.PI * 2.1 + .6) * 220 + Math.sin(u * Math.PI * 7.7) * 85;
    return {
      frontBase: new THREE.Vector3(x, -4, z),
      frontTop: new THREE.Vector3(x, ridgeY, z),
      backBase: new THREE.Vector3(x, -4, z + depth),
      backTop: new THREE.Vector3(x, ridgeY * (.93 + roughness[i] * .045), z + depth),
    };
  });
  for (let i = 0; i < samples; i++) {
    const a = sections[i], b = sections[i + 1];
    const shade = .94 + roughness[i] * .12;
    appendTriangle(positions, colors, a.frontBase, a.frontTop, b.frontBase, front.clone().multiplyScalar(shade));
    appendTriangle(positions, colors, a.frontTop, b.frontTop, b.frontBase, front.clone().multiplyScalar(shade));
    appendTriangle(positions, colors, a.backBase, b.backBase, a.backTop, back.clone().multiplyScalar(shade));
    appendTriangle(positions, colors, a.backTop, b.backBase, b.backTop, back.clone().multiplyScalar(shade));
    appendTriangle(positions, colors, a.frontTop, a.backTop, b.frontTop, front.clone().multiplyScalar(1.08));
    appendTriangle(positions, colors, a.backTop, b.backTop, b.frontTop, front.clone().multiplyScalar(1.08));
    appendTriangle(positions, colors, a.frontBase, b.frontBase, a.backBase, back.clone().multiplyScalar(.84));
    appendTriangle(positions, colors, b.frontBase, b.backBase, a.backBase, back.clone().multiplyScalar(.84));
  }
  const first = sections[0], last = sections[samples];
  const endColor = back.clone().multiplyScalar(.9);
  appendTriangle(positions, colors, first.frontBase, first.backBase, first.frontTop, endColor);
  appendTriangle(positions, colors, first.frontTop, first.backBase, first.backTop, endColor);
  appendTriangle(positions, colors, last.frontBase, last.frontTop, last.backBase, endColor);
  appendTriangle(positions, colors, last.frontTop, last.backTop, last.backBase, endColor);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function coloredBox(size: [number, number, number], position: [number, number, number], color: string): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(...size);
  geometry.translate(...position);
  const tint = new THREE.Color(color), colors: number[] = [];
  for (let i = 0; i < geometry.getAttribute('position').count; i++) colors.push(tint.r, tint.g, tint.b);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function coastalTownGeometry(seed: number): THREE.BufferGeometry {
  const random = seeded(seed), parts: THREE.BufferGeometry[] = [];
  const walls = ['#77766a', '#827c6c', '#8a806c', '#747a70', '#91866e'];
  // A low, broad Ketapang-like town edge: uneven blocks and warehouses kept below the horizon.
  for (let row = 0; row < 3; row++) {
    const z = 7900 + row * 340 + random() * 95;
    for (let block = 0; block < 20; block++) {
      if (random() < .16) continue;
      const x = -3550 + block * 370 + (random() - .5) * 190 + (row - 1) * 120;
      const width = 55 + random() * 120;
      const depth = 65 + random() * 125;
      const height = 7 + random() * (row === 1 ? 17 : 13);
      const color = walls[Math.floor(random() * walls.length)];
      parts.push(coloredBox([width, height, depth], [x, height * .5, z], color));
      if (random() < .22) {
        const roofHeight = 1 + random() * 1.4;
        parts.push(coloredBox([width * .58, roofHeight, depth * .62], [x, height + roofHeight * .5, z], '#696d63'));
      }
    }
  }

  // Long, low sheds mark the industrial waterfront; two simple gantries give the port edge scale.
  for (let i = 0; i < 6; i++) {
    const x = 2050 + i * 245;
    const z = 7630 + (i % 2) * 135;
    parts.push(coloredBox([195, 10 + (i % 3) * 2, 94], [x, 6, z], i % 2 ? '#77796f' : '#857f6c'));
  }
  for (let crane = 0; crane < 2; crane++) {
    const x = 2680 + crane * 680, z = 7440 + crane * 85, height = 34 + crane * 4;
    for (const side of [-1, 1]) {
      parts.push(coloredBox([1.6, height, 1.8], [x + side * 18, height * .5, z], '#656b63'));
      parts.push(coloredBox([1.25, height * .56, 1.5], [x + side * 18, height * .28, z + 8], '#656b63'));
    }
    parts.push(coloredBox([43, 1.8, 2], [x, height, z], '#656b63'));
    parts.push(coloredBox([28, 1.1, 1.4], [x + 9, height + 8, z], '#656b63'));
    parts.push(coloredBox([1.3, 8, 1.3], [x + 17, height + 4, z], '#656b63'));
  }
  const geometry = mergeGeometries(parts, false)!;
  parts.forEach(part => part.dispose());
  geometry.computeVertexNormals();
  return geometry;
}

/** World-anchored horizon layers for the playable camera; static silhouettes inherit scene fog and light. */
export function createDistantScenery(
  scene: THREE.Scene,
  campaign: Campaign,
  mission: Mission,
  context: DistantSceneryContext = {},
): { dispose(): void } {
  if (context.preview) return { dispose() {} };

  const root = new THREE.Group();
  root.name = 'Distant scenery';
  const target = mission.shore ?? mission.lake;
  const dx = target.x - mission.ship.x, dz = target.z - mission.ship.z;
  root.position.set(mission.ship.x, 0, mission.ship.z);
  root.rotation.y = Math.atan2(dx, dz);

  const nearRidge = new THREE.Mesh(
    ridgeGeometry(campaign.id === 'jp_ketapang_2026_09' ? 0x4a504e : 0x525341, 15500, 8650, 1150, 290),
    new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide, fog: true }),
  );
  nearRidge.name = 'Low inland ridge';
  nearRidge.frustumCulled = false;
  nearRidge.castShadow = false;
  nearRidge.receiveShadow = false;
  root.add(nearRidge);

  const farRidge = new THREE.Mesh(
    ridgeGeometry(campaign.id === 'jp_ketapang_2026_09' ? 0x4a504e : 0x525341, 21800, 14900, 1850, 690),
    new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide, fog: true }),
  );
  farRidge.name = 'Hazed inland ridge';
  farRidge.frustumCulled = false;
  farRidge.castShadow = false;
  farRidge.receiveShadow = false;
  root.add(farRidge);

  if (campaign.id === 'jp_ketapang_2026_09') {
    const town = new THREE.Mesh(coastalTownGeometry(0x4b45504f), new THREE.MeshStandardMaterial({
      color: '#ffffff', vertexColors: true, roughness: 1, flatShading: true, fog: true,
    }));
    town.name = 'Ketapang port horizon';
    town.castShadow = false;
    town.receiveShadow = false;
    root.add(town);
  }

  scene.add(root);
  return {
    dispose() {
      root.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(material => material.dispose());
      });
      root.removeFromParent();
    },
  };
}
