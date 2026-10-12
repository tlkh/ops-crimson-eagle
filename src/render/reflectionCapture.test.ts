import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ReflectionCaptureSchedule } from './reflectionCapture';

describe('planar reflection capture schedule', () => {
  it('reuses an unchanged paused image and captures changed view or scene after its cadence', () => {
    const schedule = new ReflectionCaptureSchedule();
    const camera = new THREE.PerspectiveCamera(53, 1.5, .5, 1000);
    camera.position.set(0, 25, 40);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    let sceneVersion = 1;
    let signatures = 0;
    const signature = () => { signatures++; return sceneVersion; };
    const needs = (clock: number, time = 1) => schedule.needsCapture(
      clock, time, camera.matrixWorld.elements, camera.projectionMatrix.elements, 80, signature,
    );
    const commit = (clock: number, time = 1) => schedule.didCapture(
      clock, time, camera.matrixWorld.elements, camera.projectionMatrix.elements, signature(),
    );

    schedule.observeSimulationTime(1);
    expect(needs(0)).toBe(true);
    commit(0);
    schedule.observeSimulationTime(1);
    expect(needs(1000)).toBe(false);
    expect(signatures).toBeGreaterThan(1);

    camera.position.y += .001;
    camera.updateMatrixWorld();
    expect(needs(1100)).toBe(false);
    camera.position.y += 1;
    camera.updateMatrixWorld();
    expect(needs(1110)).toBe(true);
    commit(1110);

    sceneVersion++;
    expect(needs(1150)).toBe(false);
    expect(needs(1191)).toBe(true);
    commit(1191);
    expect(needs(2000)).toBe(false);
  });

  it('refreshes immediately after resume, resize, quality invalidation, and clock rewind', () => {
    const schedule = new ReflectionCaptureSchedule();
    const view = new THREE.Matrix4().elements;
    const projection = new THREE.Matrix4().elements;
    const signature = () => 7;
    schedule.observeSimulationTime(4);
    schedule.didCapture(200, 4, view, projection, 7);
    schedule.observeSimulationTime(4);
    schedule.observeSimulationTime(4);
    schedule.observeSimulationTime(4.02);
    expect(schedule.needsCapture(205, 4.02, view, projection, 80, signature)).toBe(true);
    schedule.didCapture(205, 4.02, view, projection, 7);
    expect(schedule.needsCapture(210, 4.02, view, projection, 80, signature)).toBe(false);

    projection[0] = 2;
    expect(schedule.needsCapture(220, 4.02, view, projection, 80, signature)).toBe(false);
    expect(schedule.needsCapture(286, 4.02, view, projection, 80, signature)).toBe(true);
    schedule.didCapture(286, 4.02, view, projection, 7);
    schedule.invalidate();
    expect(schedule.needsCapture(287, 4.02, view, projection, 80, signature)).toBe(true);
    schedule.didCapture(287, 4.02, view, projection, 7);
    expect(schedule.needsCapture(0, 4.02, view, projection, 80, signature)).toBe(true);
  });
});
