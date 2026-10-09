import type { SimState } from './types';

/** Small procedural sound bed; all mission cues also have text equivalents. */
export class GameAudio {
  private context: AudioContext | null = null;
  private rotor: OscillatorNode | null = null;
  private rotorGain: GainNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private waterGain: GainNode | null = null;

  unlock(): void {
    if (!window.AudioContext) return;
    if (this.context) { void this.context.resume().catch(() => undefined); return; }
    try {
      const context = new AudioContext();
      this.context = context;
      const master = context.createGain();
      master.gain.value = 0.12;
      master.connect(context.destination);

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

  update(state: SimState | null, paused: boolean): void {
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
    try { this.rotor?.stop(); this.noise?.stop(); void this.context?.close(); } catch { /* Audio is optional. */ }
    this.context = null;
    this.rotor = null;
    this.noise = null;
    this.rotorGain = null;
    this.windGain = null;
    this.waterGain = null;
  }
}
