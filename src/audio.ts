import type { CampaignId, Mission, SimState } from './types';
import { musicLevelFor, musicTracks, type MusicTrackId } from './music';

type MusicLayer = {
  element: HTMLAudioElement;
  id: MusicTrackId;
  level: number;
  playPending: boolean;
};

type VoicePriority = 'hint' | 'event' | 'urgent';

type VoiceRequest = {
  id: string;
  priority: VoicePriority;
  missionToken: number;
  sequence: number;
};

type VoicePlayback = {
  request: VoiceRequest;
  cancelled: boolean;
  source: AudioBufferSourceNode | null;
  gapTimer: ReturnType<typeof setTimeout> | null;
};

const MUSIC_VOLUME = 0.22;
const MUSIC_FADE_SECONDS = 0.8;
const MUSIC_LEVEL_SECONDS = 2.5;
const MUSIC_PREFERENCE = 'music-enabled';
const VOICE_PREFERENCE = 'voice-enabled';
const VOICE_MUSIC_DUCK = 0.72;
const VOICE_GAP_MS = 130;
const VOICE_QUEUE_LIMIT = 2;

const VOICE_PRIORITY: Record<VoicePriority, number> = { hint: 0, event: 1, urgent: 2 };

function savedMusicPreference(): boolean {
  try { return localStorage.getItem(MUSIC_PREFERENCE) !== 'false'; }
  catch { return true; }
}

function savedVoicePreference(): boolean {
  try { return localStorage.getItem(VOICE_PREFERENCE) !== 'false'; }
  catch { return true; }
}

/** Small procedural sound bed; all mission cues also have text equivalents. */
export class GameAudio {
  private context: AudioContext | null = null;
  private rotor: OscillatorNode | null = null;
  private rotorGain: GainNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private musicId: MusicTrackId = 'menu';
  private musicLayers: MusicLayer[] = [];
  private musicEnabled = savedMusicPreference();
  private musicUnlocked = false;
  private musicLastUpdate = performance.now();
  private musicShouldPlay = true;
  private musicLevel = 0.82;
  private musicTargetLevel = 0.82;
  private voiceEnabled = savedVoicePreference();
  private voiceCallsign: string | null = null;
  private voiceMissionToken = 0;
  private voicePaused = false;
  private voiceQueue: VoiceRequest[] = [];
  private voicePlayback: VoicePlayback | null = null;
  private voiceBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private voiceSequence = 0;
  private voiceGain: GainNode | null = null;
  private voiceActive = false;

  isMusicEnabled(): boolean { return this.musicEnabled; }

  isVoiceEnabled(): boolean { return this.voiceEnabled; }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    try { localStorage.setItem(MUSIC_PREFERENCE, String(enabled)); } catch { /* Optional preference. */ }
    if (enabled) this.unlock();
    this.updateMusic();
  }

  setVoiceEnabled(enabled: boolean): void {
    this.voiceEnabled = enabled;
    try { localStorage.setItem(VOICE_PREFERENCE, String(enabled)); } catch { /* Optional preference. */ }
    if (!enabled) {
      this.clearVoicePlayback();
      return;
    }
    this.unlock();
  }

  setVoiceMission(campaignId: CampaignId | null): void {
    this.voiceMissionToken++;
    this.clearVoicePlayback();
    this.voiceCallsign = campaignId === 'sg_fictional_2026_10'
      ? 'callsign_singa'
      : campaignId === 'jp_ketapang_2026_09' ? 'callsign_japan' : null;
  }

  playVoiceCue(id: string, priority: VoicePriority = 'event'): void {
    if (!this.voiceEnabled || !this.musicUnlocked || this.voicePaused || document.hidden || !this.voiceCallsign) return;
    if (!/^[a-z0-9_-]+$/i.test(id) || id === this.voiceCallsign) return;
    if (this.voicePlayback?.request.id === id || this.voiceQueue.some(request => request.id === id)) return;
    const request: VoiceRequest = {
      id,
      priority,
      missionToken: this.voiceMissionToken,
      sequence: this.voiceSequence++,
    };

    if (priority === 'hint' && (this.voicePlayback || this.voiceQueue.length)) return;
    if (priority === 'urgent') {
      this.voiceQueue = [];
      this.stopCurrentVoice();
    } else if (this.voicePlayback && VOICE_PRIORITY[priority] > VOICE_PRIORITY[this.voicePlayback.request.priority]) {
      this.stopCurrentVoice();
    }

    if (priority === 'event' && this.voiceQueue.length >= VOICE_QUEUE_LIMIT) return;
    this.voiceQueue.push(request);
    this.voiceQueue.sort((a, b) => VOICE_PRIORITY[b.priority] - VOICE_PRIORITY[a.priority] || a.sequence - b.sequence);
    this.pumpVoiceQueue();
  }

  setVoicePaused(paused: boolean): void {
    this.voicePaused = paused;
    if (paused) this.clearVoicePlayback();
  }

  setMusicTrack(id: MusicTrackId): void {
    if (id === this.musicId && this.musicLayers.some(layer => layer.id === id)) return;
    this.musicId = id;
    const existing = this.musicLayers.find(layer => layer.id === id);
    if (existing) {
      if (this.musicUnlocked && this.musicEnabled && this.musicShouldPlay) this.playMusicLayer(existing);
      return;
    }
    const element = new Audio();
    element.preload = 'none';
    element.src = `${import.meta.env.BASE_URL}music/${musicTracks[id].file}`;
    element.loop = true;
    element.volume = 0;
    const layer: MusicLayer = { element, id, level: 0, playPending: false };
    this.musicLayers.push(layer);
    if (this.musicUnlocked && this.musicEnabled && this.musicShouldPlay) this.playMusicLayer(layer);
  }

  private playMusicLayer(layer: MusicLayer): void {
    if (!layer.element.paused || layer.playPending) return;
    layer.playPending = true;
    void layer.element.play().catch(() => undefined).finally(() => { layer.playPending = false; });
  }

  private updateMusic(): void {
    if (!this.musicLayers.length) this.setMusicTrack(this.musicId);
    const now = performance.now();
    const elapsed = Math.min(0.1, Math.max(0, (now - this.musicLastUpdate) / 1000));
    const step = elapsed / MUSIC_FADE_SECONDS;
    this.musicLastUpdate = now;
    this.musicLevel += (this.musicTargetLevel - this.musicLevel) * (1 - Math.exp(-elapsed / MUSIC_LEVEL_SECONDS));
    if (document.hidden) {
      for (const layer of this.musicLayers) {
        layer.level = 0;
        layer.element.volume = 0;
        layer.element.pause();
      }
      return;
    }
    const shouldPlay = this.musicUnlocked && this.musicEnabled && this.musicShouldPlay;
    const selected = this.musicLayers.find(layer => layer.id === this.musicId);
    if (shouldPlay && selected) this.playMusicLayer(selected);
    const selectedReady = !!selected && !selected.element.paused && selected.element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
    const fallback = selectedReady ? undefined : [...this.musicLayers].reverse().find(layer => layer.id !== this.musicId && !layer.element.paused);
    for (const layer of this.musicLayers) {
      const target = shouldPlay && (layer.id === this.musicId || layer === fallback) ? 1 : 0;
      layer.level = target > layer.level ? Math.min(target, layer.level + step) : Math.max(target, layer.level - step);
      layer.element.volume = layer.level * MUSIC_VOLUME * this.musicLevel * (this.voiceActive ? VOICE_MUSIC_DUCK : 1);
      if (layer.level === 0 && target === 0) layer.element.pause();
    }
    this.musicLayers = this.musicLayers.filter(layer => {
      if (layer.id === this.musicId || layer.level > 0) return true;
      layer.element.pause();
      layer.element.removeAttribute('src');
      layer.element.load();
      return false;
    });
  }

  unlock(): void {
    this.musicUnlocked = true;
    this.updateMusic();
    if (!window.AudioContext) return;
    if (this.context) { void this.context.resume().catch(() => undefined); return; }
    try {
      const context = new AudioContext();
      this.context = context;
      const master = context.createGain();
      master.gain.value = 0.12;
      master.connect(context.destination);

      const voiceGain = context.createGain();
      voiceGain.gain.value = 0.82;
      voiceGain.connect(context.destination);
      this.voiceGain = voiceGain;

      const rotor = context.createOscillator();
      rotor.type = 'sawtooth';
      rotor.frequency.value = 48;
      const rotorFilter = context.createBiquadFilter();
      rotorFilter.type = 'lowpass';
      rotorFilter.frequency.value = 180;
      const rotorGain = context.createGain();
      rotorGain.gain.value = 0;
      rotor.connect(rotorFilter).connect(rotorGain).connect(master);
      rotor.start();
      this.rotor = rotor;
      this.rotorGain = rotorGain;

      const seconds = 2;
      const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
      const samples = buffer.getChannelData(0);
      let seed = 0x6c8e9cf1;
      for (let i = 0; i < samples.length; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        samples[i] = ((seed >>> 0) / 0x80000000) - 1;
      }
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const windFilter = context.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 420;
      const waterFilter = context.createBiquadFilter();
      waterFilter.type = 'bandpass';
      waterFilter.frequency.value = 1100;
      const windGain = context.createGain();
      const waterGain = context.createGain();
      windGain.gain.value = 0;
      waterGain.gain.value = 0;
      noise.connect(windFilter).connect(windGain).connect(master);
      noise.connect(waterFilter).connect(waterGain).connect(master);
      noise.start();
      this.noise = noise;
      this.windGain = windGain;
      this.waterGain = waterGain;
      void context.resume().catch(() => undefined);
    } catch {
      this.dispose();
    }
  }

  update(state: SimState | null, paused: boolean, mission: Mission | null = null): void {
    if (document.hidden) this.clearVoicePlayback();
    this.musicShouldPlay = !state || state.phase === 'debrief' || (!paused && state.phase !== 'failed');
    this.musicTargetLevel = musicLevelFor(state, mission);
    this.updateMusic();
    const context = this.context;
    if (!context || !this.rotorGain || !this.windGain || !this.waterGain || !this.rotor) return;
    const active = !!state && !paused && state.phase !== 'debrief' && state.phase !== 'failed';
    const speed = state ? Math.hypot(state.velocity.x, state.velocity.z) : 0;
    const now = context.currentTime;
    this.rotor.frequency.setTargetAtTime(active ? 45 + Math.min(18, speed * 0.35) : 45, now, 0.12);
    this.rotorGain.gain.setTargetAtTime(active ? 0.72 : 0, now, 0.09);
    this.windGain.gain.setTargetAtTime(active ? Math.min(0.24, speed * 0.007) : 0, now, 0.2);
    this.waterGain.gain.setTargetAtTime(active && state && state.waterLitres > 0 && state.airborneLitres > 0 ? 0.65 : 0, now, 0.05);
  }

  dispose(): void {
    this.clearVoicePlayback();
    this.voiceBuffers.clear();
    for (const layer of this.musicLayers) {
      layer.element.pause();
      layer.element.removeAttribute('src');
      layer.element.load();
    }
    this.musicLayers = [];
    try { this.rotor?.stop(); this.noise?.stop(); void this.context?.close(); } catch { /* Audio is optional. */ }
    this.context = null;
    this.rotor = null;
    this.noise = null;
    this.rotorGain = null;
    this.windGain = null;
    this.waterGain = null;
    this.voiceGain = null;
  }

  private voiceBuffer(id: string): Promise<AudioBuffer | null> {
    const context = this.context;
    if (!context) return Promise.resolve(null);
    const cached = this.voiceBuffers.get(id);
    if (cached) return cached;
    const path = `${import.meta.env.BASE_URL}voice/${id}.mp3`;
    const pending = fetch(path)
      .then(response => {
        if (!response.ok) throw new Error(`Voice cue request failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then(bytes => context.decodeAudioData(bytes))
      .then(buffer => this.context === context ? buffer : null)
      .catch(() => null);
    this.voiceBuffers.set(id, pending);
    void pending.then(buffer => {
      if (!buffer && this.voiceBuffers.get(id) === pending) this.voiceBuffers.delete(id);
    });
    return pending;
  }

  private pumpVoiceQueue(): void {
    if (this.voicePlayback || !this.voiceEnabled || !this.musicUnlocked || this.voicePaused || document.hidden || !this.voiceCallsign) return;
    while (this.voiceQueue.length) {
      const request = this.voiceQueue.shift()!;
      if (request.missionToken !== this.voiceMissionToken) continue;
      const playback: VoicePlayback = { request, cancelled: false, source: null, gapTimer: null };
      this.voicePlayback = playback;
      void this.startVoiceRequest(playback);
      return;
    }
  }

  private async startVoiceRequest(playback: VoicePlayback): Promise<void> {
    const context = this.context;
    const callsign = this.voiceCallsign;
    if (!context || !callsign) {
      this.finishVoiceRequest(playback);
      return;
    }
    const [callsignBuffer, cueBuffer] = await Promise.all([this.voiceBuffer(callsign), this.voiceBuffer(playback.request.id)]);
    if (this.voicePlayback !== playback || playback.cancelled || playback.request.missionToken !== this.voiceMissionToken) return;
    if (!callsignBuffer || !cueBuffer || this.context !== context || !this.voiceGain) {
      this.finishVoiceRequest(playback);
      return;
    }
    this.voiceActive = true;
    this.updateMusic();
    this.playVoiceBuffer(playback, callsignBuffer, () => {
      if (this.voicePlayback !== playback || playback.cancelled) return;
      playback.gapTimer = setTimeout(() => {
        playback.gapTimer = null;
        if (this.voicePlayback === playback && !playback.cancelled && !document.hidden && !this.voicePaused) {
          this.playVoiceBuffer(playback, cueBuffer, () => this.finishVoiceRequest(playback));
        }
      }, VOICE_GAP_MS);
    });
  }

  private playVoiceBuffer(playback: VoicePlayback, buffer: AudioBuffer, onEnded: () => void): void {
    const context = this.context;
    const gain = this.voiceGain;
    if (!context || !gain || this.voicePlayback !== playback || playback.cancelled || document.hidden || this.voicePaused) {
      this.finishVoiceRequest(playback);
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    playback.source = source;
    source.onended = () => {
      source.onended = null;
      if (playback.source === source) playback.source = null;
      if (this.voicePlayback === playback && !playback.cancelled) onEnded();
    };
    try { source.start(); }
    catch { this.finishVoiceRequest(playback); }
  }

  private finishVoiceRequest(playback: VoicePlayback): void {
    if (this.voicePlayback !== playback) return;
    playback.cancelled = true;
    if (playback.gapTimer) clearTimeout(playback.gapTimer);
    playback.gapTimer = null;
    this.voicePlayback = null;
    this.voiceActive = false;
    this.updateMusic();
    this.pumpVoiceQueue();
  }

  private stopCurrentVoice(): void {
    const playback = this.voicePlayback;
    if (!playback) return;
    playback.cancelled = true;
    if (playback.gapTimer) clearTimeout(playback.gapTimer);
    playback.gapTimer = null;
    playback.source?.stop();
    playback.source = null;
    this.voicePlayback = null;
    this.voiceActive = false;
    this.updateMusic();
  }

  private clearVoicePlayback(): void {
    this.voiceQueue = [];
    this.stopCurrentVoice();
    this.voiceActive = false;
    this.updateMusic();
  }
}
