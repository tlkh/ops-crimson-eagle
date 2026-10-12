import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { chaseFraming } from './chaseCamera';

function cameraFor(aspect: number, attached: boolean, precision: number, releasing: number) {
  const frame = chaseFraming(aspect, attached, precision, releasing, 25);
  const camera = new PerspectiveCamera(frame.fov, aspect, .5, 10000);
  camera.position.set(0, frame.height, frame.distance);
  camera.lookAt(0, frame.aimHeight, -frame.lookAhead);
  camera.updateMatrixWorld();
  return camera;
}

describe('flight camera composition', () => {
  it.each([16 / 9, 390 / 844, 844 / 390])('retains rotor span and a swinging full-length sling at aspect %s', aspect => {
    for (const attached of [false, true]) for (const precision of [0, .5, 1]) {
      for (const releasing of attached ? [0, .5, 1] : [0]) {
        const camera = cameraFor(aspect, attached, precision, releasing);
        const points: Vector3[] = [];
        for (const z of [-6.5, 6.5]) for (let i = 0; i < 16; i++) {
          const angle = i / 16 * Math.PI * 2;
          points.push(new Vector3(Math.cos(angle) * 9.145, 7, z + Math.sin(angle) * 9.145));
        }
        if (attached) for (const x of [-7, 0, 7]) for (const z of [-7, 0, 7]) {
          points.push(new Vector3(x, -25, z));
        }
        for (const point of points) {
          point.project(camera);
          expect(Math.abs(point.x)).toBeLessThan(.98);
          expect(Math.abs(point.y)).toBeLessThan(.98);
          expect(point.z).toBeLessThan(1);
        }
      }
    }
  });

  it('shows the horizon during transit with or without a bucket', () => {
    for (const attached of [false, true]) {
      const horizon = new Vector3(0, 0, -9000).project(cameraFor(16 / 9, attached, 0, 0));
      expect(horizon.y).toBeGreaterThan(0);
      expect(horizon.y).toBeLessThan(.85);
    }
  });
});
