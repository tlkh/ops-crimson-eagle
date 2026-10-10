#!/usr/bin/env python3
"""Rebuild the radio cue MP3s from docs/voice-cues.json and local Kokoro files.

Run with Python 3.12 and kokoro-onnx, numpy, scipy and soundfile installed:
    python scripts/generate_radio_cues.py --model /path/to/kokoro-v1.0.fp16.onnx \
      --voices /path/to/voices-v1.0.bin
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import zipfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro
from scipy.signal import butter, sosfilt


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs" / "voice-cues.json"
FINAL_DIR = ROOT / "public" / "voice"
WORK_DIR = ROOT / "output" / "voice-production"
SAMPLE_RATE = 24_000
PREVIEW_TRANSMISSIONS = (
    ("callsign_singa", "sg_attach_deck"),
    ("callsign_singa", "bucket_full"),
    ("callsign_singa", "release_water"),
    ("callsign_japan", "jp_go_shore"),
    ("callsign_japan", "jp_return_ship"),
)


def run_ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True)


def trim_speech(samples: np.ndarray, rate: int) -> np.ndarray:
    audible = np.flatnonzero(np.abs(samples) > 0.002)
    if not len(audible):
        raise ValueError("Synthesis returned silence")
    margin = int(rate * 0.025)
    return samples[max(0, audible[0] - margin) : min(len(samples), audible[-1] + margin + 1)]


def make_radio_mix(filtered: np.ndarray, rate: int, seed: int) -> np.ndarray:
    voice = np.asarray(filtered, dtype=np.float64)
    peak = np.max(np.abs(voice))
    if peak < 0.002:
        raise ValueError("Filtered voice is silent")
    active = voice[np.abs(voice) > peak * 0.05]
    rms = np.sqrt(np.mean(active * active))
    voice *= min(3.0, 0.13 / max(rms, 1e-6))
    voice = np.tanh(voice * 1.2) / 1.2
    if np.max(np.abs(voice)) > 0.76:
        voice *= 0.76 / np.max(np.abs(voice))

    lead = int(0.15 * rate)
    tail = int(0.19 * rate)
    out = np.zeros(lead + len(voice) + tail, dtype=np.float64)
    out[lead : lead + len(voice)] = voice

    rng = np.random.default_rng(seed)
    static = rng.normal(size=len(out))
    static = sosfilt(butter(3, [700, 6500], btype="bandpass", fs=rate, output="sos"), static)
    static /= max(np.sqrt(np.mean(static * static)), 1e-6)
    envelope = np.full(len(out), 0.0032)
    burst_length = int(0.085 * rate)
    burst = np.sin(np.linspace(0, math.pi, burst_length)) ** 2
    envelope[int(0.025 * rate) : int(0.025 * rate) + burst_length] += 0.050 * burst
    tail_start = lead + len(voice) + int(0.055 * rate)
    envelope[tail_start : tail_start + burst_length] += 0.043 * burst
    edge = int(0.018 * rate)
    envelope[:edge] *= np.linspace(0, 1, edge)
    envelope[-edge:] *= np.linspace(1, 0, edge)
    out += static * envelope
    if np.max(np.abs(out)) > 0.80:
        out *= 0.80 / np.max(np.abs(out))
    return out.astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--voices", type=Path, required=True)
    args = parser.parse_args()
    for path in (args.model, args.voices):
        if not path.is_file():
            parser.error(f"Missing model file: {path}")

    data = json.loads(MANIFEST.read_text())
    cues = data["cues"]
    ids = [cue["id"] for cue in cues]
    if len(ids) != len(set(ids)) or not all(identifier.replace("_", "").isalnum() for identifier in ids):
        raise ValueError("Cue IDs must be unique and safe as filenames")
    dry_dir = WORK_DIR / "dry"
    eq_dir = WORK_DIR / "filtered"
    mixed_dir = WORK_DIR / "radio-wav"
    for folder in (FINAL_DIR, dry_dir, eq_dir, mixed_dir):
        folder.mkdir(parents=True, exist_ok=True)

    ort.set_default_logger_severity(3)
    synthesizer = Kokoro(str(args.model), str(args.voices))
    for index, cue in enumerate(cues, start=1):
        identifier, text = cue["id"], cue["text"]
        dry_path = dry_dir / f"{identifier}.wav"
        eq_path = eq_dir / f"{identifier}.wav"
        wav_path = mixed_dir / f"{identifier}.wav"
        mp3_path = FINAL_DIR / f"{identifier}.mp3"

        speech, rate = synthesizer.create(text, voice=data["voice"]["voiceId"], speed=0.93, lang="en-us")
        if rate != SAMPLE_RATE:
            raise ValueError(f"Unexpected Kokoro sample rate: {rate}")
        speech = trim_speech(np.asarray(speech), rate)
        sf.write(dry_path, speech, rate, subtype="PCM_16")
        run_ffmpeg(
            "-i", str(dry_path),
            "-af", "highpass=f=300,lowpass=f=3400,acompressor=threshold=0.10:ratio=3:attack=8:release=110",
            "-ar", str(rate), "-ac", "1", str(eq_path),
        )
        filtered, _ = sf.read(eq_path, dtype="float32")
        radio = make_radio_mix(filtered, rate, seed=20261010 + index)
        sf.write(wav_path, radio, rate, subtype="PCM_16")
        run_ffmpeg("-i", str(wav_path), "-codec:a", "libmp3lame", "-b:a", "96k", "-ar", str(rate), "-ac", "1", str(mp3_path))
        print(f"{index:02}/{len(cues)} {identifier}: {len(radio) / rate:.2f}s", flush=True)

    preview_wav = WORK_DIR / "radio-cues-preview.wav"
    preview_mp3 = WORK_DIR / "radio-cues-preview.mp3"
    preview_parts = []
    for callsign, cue in PREVIEW_TRANSMISSIONS:
        sign_audio, _ = sf.read(mixed_dir / f"{callsign}.wav", dtype="float32")
        cue_audio, _ = sf.read(mixed_dir / f"{cue}.wav", dtype="float32")
        preview_parts.extend((sign_audio, np.zeros(int(0.13 * SAMPLE_RATE), dtype=np.float32),
                              cue_audio, np.zeros(int(0.45 * SAMPLE_RATE), dtype=np.float32)))
    sf.write(preview_wav, np.concatenate(preview_parts), SAMPLE_RATE, subtype="PCM_16")
    run_ffmpeg("-i", str(preview_wav), "-codec:a", "libmp3lame", "-b:a", "96k", str(preview_mp3))
    with zipfile.ZipFile(WORK_DIR / "radio-cues.zip", "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.write(MANIFEST, arcname="voice-cues.json")
        for identifier in ids:
            bundle.write(FINAL_DIR / f"{identifier}.mp3", arcname=f"voice/{identifier}.mp3")
    print(f"Finished {len(cues)} cues; preview: {preview_mp3}", flush=True)


if __name__ == "__main__":
    main()
