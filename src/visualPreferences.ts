const KEY = 'crimson-eagle:cinematic-effects';
let sessionValue: boolean | undefined;
const listeners = new Set<(enabled: boolean) => void>();
import type { GraphicsMode } from './render/quality';

const GRAPHICS_KEY = 'crimson-eagle:graphics-mode';
let graphicsValue: GraphicsMode | undefined;
const graphicsListeners = new Set<(mode: GraphicsMode) => void>();

export function graphicsMode(): GraphicsMode {
  if (graphicsValue) return graphicsValue;
  try {
    const stored = localStorage.getItem(GRAPHICS_KEY);
    return stored === 'high' || stored === 'battery' ? stored : 'auto';
  } catch { return 'auto'; }
}
export function setGraphicsMode(mode: GraphicsMode): void {
  graphicsValue = mode;
  try { localStorage.setItem(GRAPHICS_KEY, mode); } catch { /* Session-only preference. */ }
  graphicsListeners.forEach(listener => listener(mode));
}
export function onGraphicsModeChange(listener: (mode: GraphicsMode) => void): () => void {
  graphicsListeners.add(listener);
  return () => { graphicsListeners.delete(listener); };
}

export function cinematicEffectsEnabled(): boolean {
  if (sessionValue !== undefined) return sessionValue;
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setCinematicEffectsEnabled(enabled: boolean): void {
  sessionValue = enabled;
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* Retain the session preference when storage is unavailable. */ }
  listeners.forEach(listener => listener(enabled));
}
export function onCinematicEffectsChange(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
