#!/usr/bin/env node

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Compress a linear PNG data texture as UASTC KTX2.
 *
 * Local Emscripten BasisEncoder route (recommended):
 *   curl -L -o /tmp/basis_encoder.js https://raw.githubusercontent.com/BinomialLLC/basis_universal/v2_50/webgl/encoder/build/basis_encoder.js
 *   curl -L -o /tmp/basis_encoder.wasm https://raw.githubusercontent.com/BinomialLLC/basis_universal/v2_50/webgl/encoder/build/basis_encoder.wasm
 *   BASIS_ENCODER_JS=/tmp/basis_encoder.js \
 *   BASIS_ENCODER_WASM=/tmp/basis_encoder.wasm \
 *   node scripts/graphics/compress-textures.mjs
 *
 * These pinned official v2_50 Emscripten files run locally; this script never
 * uploads source images. If those variables are absent, an installed `basisu`
 * CLI is used instead.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [inputArg = 'public/graphics/terrain-atlas.png', outputArg] = process.argv.slice(2);
const input = path.resolve(projectRoot, inputArg);
const output = path.resolve(projectRoot, outputArg ?? input.replace(/\.png$/i, '.ktx2'));
const encoderJsPath = process.env.BASIS_ENCODER_JS;
const encoderWasmPath = process.env.BASIS_ENCODER_WASM;
const basisu = process.env.BASISU ?? 'basisu';
const KTX2_SIGNATURE = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

async function validateKtx2(file) {
  const bytes = await readFile(file);
  if (!bytes.subarray(0, KTX2_SIGNATURE.length).equals(KTX2_SIGNATURE)) {
    throw new Error(`Basis Universal wrote an invalid KTX2 file: ${file}`);
  }
  return bytes;
}

async function compressWithWasm(sourceBytes) {
  if (!encoderJsPath || !encoderWasmPath) {
    throw new Error('Set both BASIS_ENCODER_JS and BASIS_ENCODER_WASM to use the local BasisEncoder.');
  }

  const [wrapperSource, wasmStat] = await Promise.all([
    readFile(encoderJsPath, 'utf8'),
    stat(encoderWasmPath),
  ]);
  if (wasmStat.size === 0) throw new Error(`Basis encoder WASM is empty: ${encoderWasmPath}`);

  // Basis Universal's official Emscripten bundle exports a module factory when
  // loaded as a script. Evaluate that local bundle as a CommonJS-like module so
  // Node can provide its standard require() and filesystem APIs.
  const moduleObject = { exports: {} };
  const loadBundle = new Function(
    'module', 'exports', 'require', '__dirname', '__filename',
    `${wrapperSource}\nmodule.exports = BASIS;`,
  );
  loadBundle(
    moduleObject,
    moduleObject.exports,
    createRequire(path.resolve(encoderJsPath)),
    path.dirname(path.resolve(encoderJsPath)),
    path.resolve(encoderJsPath),
  );

  const createBasisModule = moduleObject.exports;
  if (typeof createBasisModule !== 'function') {
    throw new Error(`Basis encoder bundle did not export its Emscripten module factory: ${encoderJsPath}`);
  }

  const basis = await createBasisModule({ locateFile: () => path.resolve(encoderWasmPath) });
  if (basis.initializeBasis() === false) throw new Error('Basis Universal initialization failed.');
  const encoder = new basis.BasisEncoder();

  try {
    const format = basis.basis_tex_format.cUASTC_LDR_4x4.value;
    const pngType = basis.ldr_image_type.cPNGImage.value;
    encoder.setCreateKTX2File(true);
    encoder.setKTX2UASTCSupercompression(true);
    encoder.setPerceptual(false);
    encoder.setKTX2AndBasisSRGBTransferFunc(false);
    encoder.setMipSRGB(false);
    encoder.setSliceSourceImage(0, new Uint8Array(sourceBytes), 0, 0, pngType);
    encoder.setFormatModeAndQualityEffort(format, 85, 3, true);
    encoder.setMipGen(true);
    encoder.setMipWrapping(false);
    encoder.setYFlip(false);

    // The official Basis demo uses 24 MiB for general images; this atlas is
    // small, but keeping that bound supports reuse with larger authoring files.
    const destination = new Uint8Array(24 * 1024 * 1024);
    const length = encoder.encode(destination);
    if (!Number.isInteger(length) || length <= 0 || length > destination.byteLength) {
      throw new Error(`BasisEncoder failed to encode the PNG (returned ${length}).`);
    }
    return Buffer.from(destination.subarray(0, length));
  } finally {
    encoder.delete();
  }
}

async function compressWithCli() {
  const result = spawnSync(basisu, [
    '-file', input,
    '-ktx2',
    '-uastc',
    '-uastc_rdo_l', '1.0',
    '-linear',
    '-mipmap',
    '-mip_clamp',
    '-output_file', output,
  ], { stdio: 'inherit' });

  if (result.error) {
    throw new Error(`Could not run "${basisu}". Install Basis Universal v2.0+ and retry, or set BASISU to its executable path.`);
  }
  if (result.status !== 0) throw new Error(`Basis Universal exited with status ${result.status ?? 'unknown'}.`);
}

try {
  await stat(input);
  await mkdir(path.dirname(output), { recursive: true });
  console.log(`Compressing ${path.relative(projectRoot, input)} → ${path.relative(projectRoot, output)}`);

  if (encoderJsPath || encoderWasmPath) {
    const sourceBytes = await readFile(input);
    const compressed = await compressWithWasm(sourceBytes);
    await writeFile(output, compressed);
  } else {
    await compressWithCli();
  }

  const bytes = await validateKtx2(output);
  const width = bytes.readUInt32LE(20);
  const height = bytes.readUInt32LE(24);
  if (!width || !height) throw new Error(`KTX2 image has invalid dimensions ${width}×${height}.`);
  console.log(`Wrote ${width}×${height}, ${(bytes.byteLength / 1024).toFixed(1)} KiB KTX2.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
