import { shipLandingPoint } from '../sim/shipLanding';
import * as THREE from 'three';
import type { Campaign, Mission, SimState } from '../types';
import { updateAircraftLightEmission, type AircraftLightMounts } from './aircraftLighting';

const DECK_Y = -2.55;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

type EmissiveFixtures = {
  red: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  warm: THREE.MeshStandardMaterial;
  windows: THREE.MeshStandardMaterial;
};

function emissiveMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#171a17',
    emissive: color,
    emissiveIntensity: 0,
    roughness: 0.42,
    metalness: 0.04,
    toneMapped: false,
  });
}

function placeMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
  scale?: THREE.Vector3,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  if (scale) mesh.scale.copy(scale);
  parent.add(mesh);
  return mesh;
}

function makeLightGroup(position: { x: number; z: number }, rotationY = 0) {
  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);
  group.rotation.y = rotationY;
  return group;
}

/** Gameplay-only aircraft, ship, shore and settlement lighting. */
export function createNightLighting(
  scene: THREE.Scene,
  aircraftAnchor: THREE.Object3D,
  campaign: Campaign,
  mission: Mission,
  aircraftLights: AircraftLightMounts,
  coastalAnchor?: { x: number; y: number; z: number },
): {
  update(state: SimState, nightStrength: number, sunIntensity: number): void;
  dispose(): void;
} {
  const japanese = campaign.id === 'jp_ketapang_2026_09';
  const stern = japanese ? 40 : 35;
  const shipLength = campaign.shipLength;
  const shipWidth = campaign.shipWidth;
  const shipStation = (fraction: number) => stern - shipLength + fraction * shipLength;
  const landingZ = shipLandingPoint(campaign, mission).z;

  const fixtures: EmissiveFixtures = {
    red: emissiveMaterial('#ff2029'),
    green: emissiveMaterial('#22e579'),
    white: emissiveMaterial('#fff1d3'),
    amber: emissiveMaterial('#ffd27a'),
    warm: emissiveMaterial('#ffb85b'),
    windows: emissiveMaterial('#ffc875'),
  };
  const sphereGeometry = new THREE.SphereGeometry(1, 10, 8);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const lampGeometry = new THREE.CylinderGeometry(0.045, 0.07, 4, 8);
  const fixtureGroups: THREE.Group[] = [];
  const ownedObjects: THREE.Object3D[] = [];

  const addLens = (
    parent: THREE.Object3D,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    radius = 0.13,
  ) => placeMesh(
    parent,
    sphereGeometry,
    material,
    new THREE.Vector3(x, y, z),
    new THREE.Vector3(radius, radius, radius),
  );

  const landingSpot = new THREE.SpotLight('#fff1d2', 0, 180, 0.52, 0.72, 2);
  landingSpot.name = 'aircraft-landing-illumination';
  landingSpot.position.set(0, -0.42, -7.05);
  landingSpot.target.position.set(0, -12, -16);
  landingSpot.castShadow = false;
  landingSpot.shadow.mapSize.set(512, 512);
  landingSpot.shadow.camera.near = 0.5;
  landingSpot.shadow.camera.far = 180;
  landingSpot.shadow.bias = -0.00035;
  landingSpot.shadow.normalBias = 0.035;
  aircraftAnchor.add(landingSpot, landingSpot.target);
  ownedObjects.push(landingSpot, landingSpot.target);

  const shipGroup = makeLightGroup(mission.ship);
  scene.add(shipGroup);
  fixtureGroups.push(shipGroup);
  ownedObjects.push(shipGroup);
  const bridgeZ = japanese ? shipStation(0.392) : shipStation(0.292);
  const bridgeX = japanese ? shipWidth * 0.27 : 0;
  const bridgeTop = japanese ? DECK_Y + 9.55 : DECK_Y + 11.4;
  const bridgeWing = japanese ? shipWidth * 0.19 : shipWidth * 0.37;
  const bridgeFlood = new THREE.SpotLight('#ffe6bd', 0, 175, 0.78, 0.66, 2);
  bridgeFlood.position.set(bridgeX + bridgeWing, bridgeTop, bridgeZ - (japanese ? 0 : 5));
  bridgeFlood.target.position.set(0, DECK_Y + 0.18, landingZ - mission.ship.z);
  shipGroup.add(bridgeFlood, bridgeFlood.target);
  ownedObjects.push(bridgeFlood, bridgeFlood.target);

  // Red/green bridge wings, mast marker and discreet deck-edge lamps help
  // read the ship's orientation and the clear landing lane after sunset.
  addLens(shipGroup, fixtures.red, bridgeX - bridgeWing, bridgeTop - 0.7, bridgeZ, 0.19);
  addLens(shipGroup, fixtures.green, bridgeX + bridgeWing, bridgeTop - 0.7, bridgeZ, 0.19);
  addLens(shipGroup, fixtures.white, japanese ? -1 : 0, japanese ? 21.2 : 24.6, japanese ? shipStation(0.445) : shipStation(0.395), 0.23);
  const deckEdgeX = shipWidth * 0.5 - 0.9;
  const edgeLampZ = japanese ? [-13, 2, 17, 31] : [-19, -4, 11, 26];
  for (const z of edgeLampZ) {
    for (const side of [-1, 1]) addLens(shipGroup, fixtures.amber, side * deckEdgeX, DECK_Y + 0.12, z, 0.105);
  }
  const bowZ = stern - shipLength + (japanese ? 9 : 8);
  addLens(shipGroup, fixtures.red, -shipWidth * 0.47, -0.15, bowZ, 0.16);
  addLens(shipGroup, fixtures.green, shipWidth * 0.47, -0.15, bowZ, 0.16);

  const routeTarget = mission.shore ?? mission.lake;
  const routeX = routeTarget.x - mission.ship.x;
  const routeZ = routeTarget.z - mission.ship.z;
  const routeLength = Math.max(1, Math.hypot(routeX, routeZ));
  const ux = routeX / routeLength;
  const uz = routeZ / routeLength;
  const sx = -uz;
  const sz = ux;
  const shoreAngle = Math.atan2(ux, uz);
  const hasShore = Boolean(mission.shore);
  const shoreAnchor = mission.shore ?? mission.lake;
  const shoreGroup = makeLightGroup(shoreAnchor, shoreAngle);
  shoreGroup.visible = hasShore;
  scene.add(shoreGroup);
  fixtureGroups.push(shoreGroup);
  ownedObjects.push(shoreGroup);
  const shoreFlood = new THREE.SpotLight('#fff0d7', 0, 125, 0.7, 0.72, 2);
  shoreFlood.position.set(25, 11, 15);
  shoreFlood.target.position.set(0, -0.04, 0);
  shoreGroup.add(shoreFlood, shoreFlood.target);
  ownedObjects.push(shoreFlood, shoreFlood.target);
  // The solid pole and housing live in world.ts with their collision bounds.
  placeMesh(shoreGroup, boxGeometry, fixtures.white, new THREE.Vector3(25, 9.92, 14.76), new THREE.Vector3(0.44, 0.17, 0.06));

  // Match world.ts's route-frame settlement placement so the warm practical
  // falls across the authored row of raised homes rather than the map marker.
  const lakeDx = mission.lake.x - mission.ship.x;
  const lakeDz = mission.lake.z - mission.ship.z;
  const lakeT = lakeDx * ux + lakeDz * uz;
  const lakeS = lakeDx * sx + lakeDz * sz;
  const settlementT = lakeT + 25;
  const settlementS = lakeS + mission.lake.radius * 1.2 + 65;
  const settlementAnchor = {
    x: mission.ship.x + settlementT * ux + settlementS * sx,
    z: mission.ship.z + settlementT * uz + settlementS * sz,
  };
  const settlementGroup = makeLightGroup(settlementAnchor, shoreAngle);
  scene.add(settlementGroup);
  fixtureGroups.push(settlementGroup);
  ownedObjects.push(settlementGroup);
  const settlementPractical = new THREE.PointLight('#ffc47a', 0, 100, 2);
  settlementPractical.position.set(0, 7, 0);
  settlementGroup.add(settlementPractical);
  ownedObjects.push(settlementPractical);

  const lanternMaterial = new THREE.MeshStandardMaterial({ color: '#282722', roughness: 0.86 });
  const windowGeometry = new THREE.PlaneGeometry(1, 1);
  fixtures.windows.side = THREE.DoubleSide;
  for (let i = 0; i < 12; i++) {
    const homeX = (i % 2 ? 1 : -1) * 20;
    const homeZ = (Math.floor(i / 2) - 2.5) * 24;
    const windowOne = placeMesh(
      settlementGroup,
      windowGeometry,
      fixtures.windows,
      new THREE.Vector3(homeX, 3.1, homeZ - 7.63),
      new THREE.Vector3(1.05, 1.7, 1),
    );
    windowOne.rotation.y = Math.PI;
    const windowTwo = placeMesh(
      settlementGroup,
      windowGeometry,
      fixtures.windows,
      new THREE.Vector3(homeX + 3, 4, homeZ - 7.63),
      new THREE.Vector3(1.55, 0.82, 1),
    );
    windowTwo.rotation.y = Math.PI;

    // A wall lantern sits by each front doorway; only the single settlement
    // practical above casts light, keeping the local-light count fixed.
    const side = homeX > 0 ? 1 : -1;
    const lantern = new THREE.Mesh(lampGeometry, lanternMaterial);
    lantern.scale.setScalar(0.18);
    lantern.position.set(homeX + side * 5.45, 4.1, homeZ - 7.48);
    settlementGroup.add(lantern);
    addLens(settlementGroup, fixtures.warm, homeX + side * 5.45, 4.42, homeZ - 7.58, 0.09);
  }

  const fireA = new THREE.PointLight('#ff7431', 0, 155, 2);
  const fireB = new THREE.PointLight('#ffad53', 0, 135, 2);
  fireA.position.set(mission.fire.x - mission.fire.radius * 0.25, 3.2, mission.fire.z + mission.fire.radius * 0.1);
  fireB.position.set(mission.fire.x + mission.fire.radius * 0.22, 4.3, mission.fire.z - mission.fire.radius * 0.16);
  scene.add(fireA, fireB);
  ownedObjects.push(fireA, fireB);

  const updateEmissives = (night: number) => {
    fixtures.red.emissiveIntensity = night * 2.25;
    fixtures.green.emissiveIntensity = night * 2.25;
    fixtures.white.emissiveIntensity = night * 2.15;
    fixtures.amber.emissiveIntensity = night * 1.8;
    fixtures.warm.emissiveIntensity = night * 2.0;
    fixtures.windows.emissiveIntensity = night * 2.25;
  };

  const landingPort = aircraftLights.mounts.landingPort;
  const landingStarboard = aircraftLights.mounts.landingStarboard;
  const landingPosition = landingPort.position.clone().add(landingStarboard.position).multiplyScalar(0.5);
  const landingDirection = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(landingPort.quaternion)
    .add(new THREE.Vector3(0, 0, 1).applyQuaternion(landingStarboard.quaternion))
    .normalize();
  // The two physical housings are the single landing light's mounting basis.
  // Aim below the aircraft while following their shared forward/downward axis.
  landingDirection.y = Math.min(-0.2, landingDirection.y);
  landingDirection.normalize();
  landingSpot.position.copy(landingPosition);
  landingSpot.target.position.copy(landingPosition).addScaledVector(landingDirection, 20);

  const practicalPosition = new THREE.Vector3();
  return {
    update(state, nightStrength, sunIntensity) {
      const night = clamp01(nightStrength);
      const time = state.timeSec;
      updateEmissives(night);
      updateAircraftLightEmission(aircraftLights, night, time);

      const altitude = Math.max(0, state.position.y);
      landingSpot.position.copy(landingPosition);
      const downRange = Math.max(8, altitude + 5) / Math.max(0.2, -landingDirection.y);
      const forwardRange = Math.max(14, (altitude + 5) * 0.92) / Math.max(0.2, Math.abs(landingDirection.z));
      landingSpot.target.position.copy(landingPosition).addScaledVector(landingDirection, Math.max(downRange, forwardRange));
      landingSpot.intensity = night * 14_000;

      const nearShip = Math.hypot(state.position.x - mission.ship.x, state.position.z - landingZ) < 105;
      const shoreX = mission.shore?.x ?? mission.ship.x;
      const shoreZ = mission.shore?.z ?? landingZ;
      const nearShore = hasShore && Math.hypot(state.position.x - shoreX, state.position.z - shoreZ) < 105;
      const landingPhase = state.phase === 'prepare' || state.phase === 'return' || state.phase === 'land' ||
        state.phase === 'shore_rig' || state.phase === 'shore_unrig' || state.phase === 'deck_rig';
      const nightLanding = night > 0.58 && sunIntensity <= 0.05 && state.position.y < 24 &&
        landingPhase && (nearShip || nearShore);
      landingSpot.castShadow = nightLanding;

      bridgeFlood.intensity = night * 36_000;
      shoreFlood.intensity = hasShore ? night * 8_000 : 0;
      // Reuse the settlement light slot at the closer coastal practical.
      const nearCoast = coastalAnchor && Math.hypot(state.position.x - coastalAnchor.x, state.position.z - coastalAnchor.z) <
        Math.hypot(state.position.x - settlementAnchor.x, state.position.z - settlementAnchor.z);
      if (nearCoast && coastalAnchor) {
        settlementPractical.position.copy(settlementGroup.worldToLocal(practicalPosition.set(coastalAnchor.x, coastalAnchor.y, coastalAnchor.z)));
      } else settlementPractical.position.set(0, 7, 0);
      settlementPractical.intensity = night * 3_200;

      const heat = clamp01((state.fireHeat + state.peatHeat * 0.35) / 100);
      let fireActivity = 0;
      if (state.fireState === 'burning') fireActivity = Math.max(0.2, heat);
      else if (state.fireState === 'surface_suppressed' || state.fireState === 'being_secured') fireActivity = heat * 0.58;
      else fireActivity = heat * 0.1;
      const flicker = 0.88 + 0.1 * Math.sin(time * 7.4) + 0.06 * Math.sin(time * 12.8 + 1.2);
      const fireOutput = night * fireActivity * flicker;
      fireA.intensity = 12_500 * fireOutput;
      fireB.intensity = 9_500 * fireOutput;
    },
    dispose() {
      for (const object of ownedObjects) object.removeFromParent();
      landingSpot.shadow.map?.dispose();
      landingSpot.shadow.map = null;
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      for (const group of fixtureGroups) {
        group.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (mesh.geometry) geometries.add(mesh.geometry);
          const material = mesh.material;
          if (Array.isArray(material)) material.forEach((item) => materials.add(item));
          else if (material) materials.add(material);
        });
      }
      geometries.add(sphereGeometry);
      geometries.add(boxGeometry);
      geometries.add(lampGeometry);
      geometries.add(windowGeometry);
      for (const material of Object.values(fixtures)) materials.add(material);
      materials.add(lanternMaterial);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
