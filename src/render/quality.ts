export type GraphicsMode = 'auto' | 'high' | 'battery';
export type RenderQualityProfile = {
  targetFps: 30 | 60;
  renderScale: number;
  shadowSize: 512 | 1024;
  reflectionSize: 256 | 512;
  reflectionIntervalMs: number;
  reflections: boolean;
  detail: 'high' | 'low';
  cinematic: boolean;
};

/** Reduces secondary passes before giving up scene resolution. HUD stays native. */
export function qualityProfile(mode: GraphicsMode, mobile: boolean, level = 0): RenderQualityProfile {
  const tier = mode === 'high' ? 0 : mode === 'battery' ? 3 : Math.max(0, Math.min(3, level));
  return {
    targetFps: mobile || mode === 'battery' ? 30 : 60,
    renderScale: [1, 1, .85, .7][tier],
    shadowSize: tier < 2 ? 1024 : 512,
    reflectionSize: tier === 0 ? 512 : 256,
    reflectionIntervalMs: [80, 160, 240, 320][tier],
    reflections: tier < 3,
    detail: tier < 2 ? 'high' : 'low',
    cinematic: tier < 2,
  };
}

export function scenePixelRatio(width: number, height: number, deviceRatio: number, scale: number): number {
  const longest = Math.max(1, width, height);
  const dpr = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return Math.max(.1, Math.min(dpr, 1.5, 1440 / longest) * scale);
}

/** Renderer-independent policy: warm-up, sustained overload, slow recovery. */
export class AdaptiveQuality {
  level = 0;
  private samples = 0;
  private slow = 0;
  private elapsed = 0;
  private stableMs = 0;
  private warmupMs = 2000;

  reset() { this.samples = this.slow = this.elapsed = this.stableMs = 0; this.warmupMs = 2000; }

  observe(intervalMs: number, cpuMs: number, gpuMs: number | null, targetFps: number): boolean {
    // Backgrounding, pauses and first-frame compilation are not sustained load.
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 250) { this.reset(); return false; }
    if (this.warmupMs > 0) { this.warmupMs -= intervalMs; return false; }
    const budget = 1000 / targetFps;
    this.samples++;
    this.elapsed += intervalMs;
    // Judge cadence across the whole window: a 60fps target on a 90Hz
    // display naturally alternates 11/22ms frames without missing its budget.
    if (cpuMs > budget * .85 || (gpuMs !== null && gpuMs > budget * .88)) this.slow++;
    if (this.elapsed < 3000) return false;
    const overloaded = this.elapsed / this.samples > budget * 1.15 || this.slow / this.samples > .15;
    this.stableMs = overloaded ? 0 : this.stableMs + this.elapsed;
    this.samples = this.slow = this.elapsed = 0;
    if (overloaded && this.level < 3) { this.level++; this.warmupMs = 3000; return true; }
    if (this.stableMs >= 30000 && this.level > 0) {
      this.level--; this.stableMs = 0; this.warmupMs = 3000; return true;
    }
    return false;
  }
}

/** Deadline scheduling retains remainder on 60/90/120 Hz displays. */
export class RenderCadence {
  private nextAt = 0;
  private lastAt: number | undefined;
  reset() { this.nextAt = 0; this.lastAt = undefined; }
  take(now: number, fps: number): number | null {
    if (now + .5 < this.nextAt) return null;
    const interval = 1000 / fps;
    const delta = this.lastAt === undefined ? interval / 1000 : Math.max(0, (now - this.lastAt) / 1000);
    this.lastAt = now;
    this.nextAt = this.nextAt === 0 || now - this.nextAt > interval * 2 ? now + interval : this.nextAt + interval;
    return delta;
  }
}
