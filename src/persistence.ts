import type { CampaignId, SimState } from './types';

const DB_NAME = 'operation-crimson-eagle';
const STORE = 'checkpoints';
const SAVE_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, SAVE_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, key: string, value?: SimState): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = value ? tx.objectStore(STORE).put(value, key) : tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveCheckpoint(state: SimState): Promise<void> {
  await transact('readwrite', state.campaignId, structuredClone(state));
}

export async function loadCheckpoint(id: CampaignId): Promise<SimState | null> {
  try {
    const state = await transact<SimState>('readonly', id);
    if (!state || state.campaignId !== id || !Number.isFinite(state.tick) || !state.position) return null;
    return state;
  } catch {
    return null;
  }
}

export async function clearCheckpoint(id: CampaignId): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export type Progress = Record<string, { score: number; outcome: string }>;
export function readProgress(id: CampaignId): Progress {
  try { return JSON.parse(localStorage.getItem(`progress:${id}`) || '{}') as Progress; } catch { return {}; }
}
export function writeProgress(state: SimState): void {
  if (state.outcome !== 'success' && state.outcome !== 'partial') return;
  const progress = readProgress(state.campaignId);
  if (!progress[state.missionId] || progress[state.missionId].score < state.score) {
    progress[state.missionId] = { score: state.score, outcome: state.outcome };
    localStorage.setItem(`progress:${state.campaignId}`, JSON.stringify(progress));
  }
}
