import { MissionRadioDirector, type RadioTransmission } from '../../src/missionRadio';
import type { Campaign, Mission, SimState } from '../../src/types';

export type TrailerAudioSample = {
  /** Time on the trailer's output timeline, in seconds. */
  time: number;
  state: SimState;
  campaign: Campaign;
  mission: Mission;
};

const SAMPLE_RATE = 48_000;
const VOICE_GAIN = 0.82;
const RADIO_GAP_SECONDS = 0.13;
const FADE_SECONDS = 0.28;

/**
 * Render the game's procedural flight bed and state-driven radio into a WAV.
 *
 * The rotor, wind, and water graph mirrors GameAudio in src/audio.ts, including
 * its gains, filters, speed response, and water-in-flight gate. The noise uses
 * the same fixed xorshift seed as the game, so identical samples render
 * deterministically. Radio requests come from MissionRadioDirector, the same
 * transition/guidance logic used during play. Music is intentionally omitted.
 *
 * This capture helper runs in a browser context with OfflineAudioContext,
 * fetch, and the game's BASE_URL available (including its GitHub Pages base).
 */
export async function renderTrailerAudio(
  samples: TrailerAudioSample[],
  duration: number,
): Promise<Blob> {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('Trailer audio rendering requires OfflineAudioContext.');
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Audio duration must be positive.');

  const frameCount = Math.max(1, Math.ceil(duration * SAMPLE_RATE));
  const context = new OfflineAudioContext(2, frameCount, SAMPLE_RATE);
  const outputGain = context.createGain();
  outputGain.connect(context.destination);
  const master = context.createGain();
  master.gain.value = 0.12;
  master.connect(outputGain);

  const sorted = samples
    .filter(sample => Number.isFinite(sample.time) && sample.time >= 0 && sample.time <= duration)
    .slice()
    .sort((a, b) => a.time - b.time);

  if (sorted.length) {
    const rotor = context.createOscillator();
    rotor.type = 'sawtooth';
    const rotorFilter = context.createBiquadFilter();
    rotorFilter.type = 'lowpass';
    rotorFilter.frequency.value = 180;
    const rotorGain = context.createGain();
    rotor.connect(rotorFilter).connect(rotorGain).connect(master);
    rotor.start(0);

    const seconds = 2;
    const noiseBuffer = context.createBuffer(1, SAMPLE_RATE * seconds, SAMPLE_RATE);
    const noiseData = noiseBuffer.getChannelData(0);
    let seed = 0x6c8e9cf1;
    for (let i = 0; i < noiseData.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      noiseData[i] = ((seed >>> 0) / 0x80000000) - 1;
    }

    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    const waterFilter = context.createBiquadFilter();
    waterFilter.type = 'bandpass';
    waterFilter.frequency.value = 1100;
    const windGain = context.createGain();
    const waterGain = context.createGain();
    noise.connect(windFilter).connect(windGain).connect(master);
    noise.connect(waterFilter).connect(waterGain).connect(master);
    noise.start(0);

    automateFromSamples(sorted, duration, rotor.frequency, rotorGain.gain, windGain.gain, waterGain.gain);
  }

  // Replay the production radio director against the recorded state edges.
  // Runtime samples may also carry ExtendedSimState fields used by the director.
  const selectedCues = new Set(['sg_bucket_rigged', 'bucket_filling', 'bucket_full', 'water_released']);
  const transmissions = collectRadioTransmissions(sorted).filter(cue => selectedCues.has(cue.id));
  const voiceBuffers = await loadVoiceBuffers(context, transmissions.map(item => item.id));
  let voiceCursor = 0;
  for (const transmission of transmissions) {
    const callsignId = transmission.campaign.id === 'sg_fictional_2026_10' ? 'callsign_singa' : 'callsign_japan';
    const callsign = voiceBuffers.get(callsignId);
    const cue = voiceBuffers.get(transmission.id);
    if (!callsign || !cue) continue;
    const start = Math.max(0, Math.min(duration, transmission.time));
    // Keep selected cues at their observed event; never queue stale instructions.
    if (start < voiceCursor || start + callsign.duration + RADIO_GAP_SECONDS + cue.duration > duration - 1) continue;
    const at = start;
    voiceCursor = playVoice(context, callsign, at, outputGain);
    voiceCursor += RADIO_GAP_SECONDS;
    voiceCursor = playVoice(context, cue, voiceCursor, outputGain);
  }

  const fade = Math.min(FADE_SECONDS, duration / 2);
  outputGain.gain.setValueAtTime(0, 0);
  outputGain.gain.linearRampToValueAtTime(1, fade);
  outputGain.gain.setValueAtTime(1, Math.max(fade, duration - fade));
  outputGain.gain.linearRampToValueAtTime(0, duration);

  const rendered = await context.startRendering();
  return encodeWav(rendered);
}

type TimedTransmission = RadioTransmission & { time: number; campaign: Campaign };

function collectRadioTransmissions(samples: TrailerAudioSample[]): TimedTransmission[] {
  const transmissions: TimedTransmission[] = [];
  const director = new MissionRadioDirector(transmission => {
    const current = currentSample;
    if (current) transmissions.push({ ...transmission, time: current.time, campaign: current.campaign });
  });
  let currentSample: TrailerAudioSample | null = null;
  let previousKey = '';
  for (const sample of samples) {
    const key = `${sample.campaign.id}/${sample.mission.id}`;
    currentSample = sample;
    if (key !== previousKey) {
      director.reset(sample.state, sample.campaign, sample.mission);
      previousKey = key;
    } else {
      director.update(sample.state, sample.campaign, sample.mission);
    }
  }
  return transmissions;
}

function automateFromSamples(
  samples: TrailerAudioSample[],
  duration: number,
  frequency: AudioParam,
  rotorLevel: AudioParam,
  windLevel: AudioParam,
  waterLevel: AudioParam,
): void {
  const initial = samples[0];
  const firstActive = isAudioActive(initial.state);
  const firstSpeed = horizontalSpeed(initial.state);
  frequency.setValueAtTime(firstActive ? 45 + Math.min(18, firstSpeed * 0.35) : 45, 0);
  rotorLevel.setValueAtTime(firstActive ? 0.72 : 0, 0);
  windLevel.setValueAtTime(firstActive ? Math.min(0.24, firstSpeed * 0.007) : 0, 0);
  waterLevel.setValueAtTime(firstActive && hasWaterInFlight(initial.state) ? 0.65 : 0, 0);

  for (let index = 1; index < samples.length; index++) {
    const sample = samples[index];
    const time = Math.min(duration, Math.max(0, sample.time));
    const active = isAudioActive(sample.state);
    const speed = horizontalSpeed(sample.state);
    // Match the game's eased parameter response to prevent clicks at hard cuts.
    frequency.setTargetAtTime(active ? 45 + Math.min(18, speed * 0.35) : 45, time, 0.12);
    rotorLevel.setTargetAtTime(active ? 0.72 : 0, time, 0.09);
    windLevel.setTargetAtTime(active ? Math.min(0.24, speed * 0.007) : 0, time, 0.2);
    waterLevel.setTargetAtTime(active && hasWaterInFlight(sample.state) ? 0.65 : 0, time, 0.05);
  }
  frequency.setTargetAtTime(45, duration, 0.12);
  rotorLevel.setTargetAtTime(0, duration, 0.09);
  windLevel.setTargetAtTime(0, duration, 0.2);
  waterLevel.setTargetAtTime(0, duration, 0.05);
}

function horizontalSpeed(state: SimState): number {
  return Math.hypot(state.velocity.x, state.velocity.z);
}

function isAudioActive(state: SimState): boolean {
  return state.phase !== 'debrief' && state.phase !== 'failed';
}

function hasWaterInFlight(state: SimState): boolean {
  return state.waterLitres > 0 && state.airborneLitres > 0;
}

async function loadVoiceBuffers(
  context: OfflineAudioContext,
  cueIds: string[],
): Promise<Map<string, AudioBuffer>> {
  const uniqueIds = [...new Set(cueIds.flatMap(id => [id, 'callsign_singa', 'callsign_japan']))];
  const result = new Map<string, AudioBuffer>();
  await Promise.all(uniqueIds.map(async id => {
    try {
      const url = `${import.meta.env.BASE_URL}voice/${id}.mp3`;
      const response = await fetch(url);
      if (!response.ok) return;
      result.set(id, await context.decodeAudioData(await response.arrayBuffer()));
    } catch {
      // Radio is optional for the render if an asset is missing or undecodable.
    }
  }));
  return result;
}

function playVoice(context: OfflineAudioContext, buffer: AudioBuffer, start: number, output: GainNode): number {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = VOICE_GAIN;
  source.connect(gain).connect(output);
  const boundedStart = Math.max(0, Math.min(context.length / context.sampleRate, start));
  const available = context.length / context.sampleRate - boundedStart;
  const playedDuration = Math.min(buffer.duration, Math.max(0, available));
  if (playedDuration <= 0) return start;
  source.start(boundedStart, 0, playedDuration);
  return boundedStart + playedDuration;
}

function encodeWav(audio: AudioBuffer): Blob {
  const channels = 2;
  const bytesPerSample = 2;
  const dataBytes = audio.length * channels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  const left = audio.getChannelData(0);
  const right = audio.getChannelData(1);
  let offset = 44;
  for (let i = 0; i < audio.length; i++) {
    view.setInt16(offset, floatToPcm(left[i]), true);
    view.setInt16(offset + 2, floatToPcm(right[i]), true);
    offset += 4;
  }
  return new Blob([output], { type: 'audio/wav' });
}

function floatToPcm(sample: number): number {
  const value = Math.max(-1, Math.min(1, sample));
  return value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
}
