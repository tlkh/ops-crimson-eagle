import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { createFireResponse } from './fireResponse';
import { qualityProfile } from './quality';

const campaign = campaigns[0];
const mission = campaign.missions[0];

function instancePosition(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

describe('fire response renderer', () => {
  it('initializes visible t=0 poses for previews and tracks simulation-time updates', () => {
    const scene = new THREE.Scene();
    const preview = createFireResponse(scene, campaign, mission, { preview: true });
    const engines = scene.getObjectByName('Fire engine bodies') as THREE.InstancedMesh;
    expect(engines).toBeDefined();
    const initial = instancePosition(engines, 1);
    expect(initial.length()).toBeGreaterThan(100);
    preview.update({ timeSec: 120, fireState: 'burning' });
    expect(instancePosition(engines, 1).distanceTo(initial)).toBeLessThan(1e-5);
    preview.dispose();
    expect(scene.children).toHaveLength(0);

    const liveScene = new THREE.Scene();
    const live = createFireResponse(liveScene, campaign, mission);
    const liveEngine = liveScene.getObjectByName('Fire engine bodies') as THREE.InstancedMesh;
    const before = instancePosition(liveEngine, 1);
    live.update({ timeSec: 2, fireState: 'burning' });
    expect(instancePosition(liveEngine, 1).distanceTo(before)).toBeGreaterThan(5);
    live.dispose();
    expect(liveScene.children).toHaveLength(0);
  });

  it('reduces hose and small-detail draws at low quality and disposes instanced resources', () => {
    const scene = new THREE.Scene();
    const response = createFireResponse(scene, campaign, mission);
    response.update({ timeSec: 30, fireState: 'burning' });
    const hoses = scene.getObjectByName('Short staging hose lines') as THREE.InstancedMesh;
    const sprays = scene.getObjectByName('Short firefighting spray streams') as THREE.InstancedMesh;
    expect(hoses.visible).toBe(true);
    expect(sprays.visible).toBe(true);

    response.setQuality(qualityProfile('battery', true));
    expect(hoses.visible).toBe(false);
    expect(sprays.visible).toBe(false);
    expect((scene.getObjectByName('Fire engine roof ladders') as THREE.InstancedMesh).visible).toBe(false);

    response.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
