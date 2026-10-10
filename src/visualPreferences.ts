const KEY = 'crimson-eagle:cinematic-effects';
let sessionValue: boolean | undefined;
const listeners = new Set<(enabled: boolean) => void>();

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
