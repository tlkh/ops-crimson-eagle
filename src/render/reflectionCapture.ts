/** Tracks the image represented by a planar reflection target. */
export class ReflectionCaptureSchedule {
  private captured = false;
  private lastClockMs = -Infinity;
  private lastTime = NaN;
  private lastView: number[] = [];
  private lastProjection: number[] = [];
  private lastScene: number | undefined;
  private observedTime: number | undefined;
  private stationary = false;
  private resumed = false;

  observeSimulationTime(time: number) {
    if (this.observedTime === time) this.stationary = true;
    else {
      if (this.stationary) this.resumed = true;
      this.stationary = false;
      this.observedTime = time;
    }
  }

  invalidate() { this.captured = false; }

  get isStationary() { return this.stationary; }

  needsCapture(
    clockMs: number,
    time: number,
    view: readonly number[],
    projection: readonly number[],
    intervalMs: number,
    sceneSignature: () => number,
  ): boolean {
    if (!this.captured || this.resumed || clockMs < this.lastClockMs) return true;
    const changed = time !== this.lastTime
      || differs(view, this.lastView, .0006, .015)
      || differs(projection, this.lastProjection, .0001, .0001)
      || (this.stationary && sceneSignature() !== this.lastScene);
    return changed && clockMs - this.lastClockMs >= intervalMs;
  }

  didCapture(clockMs: number, time: number, view: readonly number[], projection: readonly number[], sceneSignature?: number) {
    this.captured = true;
    this.resumed = false;
    this.lastClockMs = clockMs;
    this.lastTime = time;
    this.lastView = Array.from(view);
    this.lastProjection = Array.from(projection);
    this.lastScene = sceneSignature;
  }
}

function differs(next: readonly number[], previous: readonly number[], orientationTolerance: number, positionTolerance: number) {
  if (next.length !== previous.length) return true;
  return next.some((value, index) => Math.abs(value - previous[index]) > (index === 12 || index === 13 || index === 14
    ? positionTolerance : orientationTolerance));
}
