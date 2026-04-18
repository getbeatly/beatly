/**
 * WAV encoders (§7.2).
 *
 * - `encodeWavPcm16Mono` preserves the existing exported behaviour.
 * - `encodeWavPcm16Stereo` consumes interleaved LR Float32 (length = frames*2).
 */

export function encodeWavPcm16Mono(samples: Float32Array, sampleRate = 48_000): Uint8Array {
  return encodeWav(samples, sampleRate, 1);
}

export function encodeWavPcm16Stereo(interleaved: Float32Array, sampleRate = 48_000): Uint8Array {
  if ((interleaved.length & 1) !== 0) {
    throw new Error("Stereo WAV requires an even-length interleaved buffer");
  }
  return encodeWav(interleaved, sampleRate, 2);
}

function encodeWav(samples: Float32Array, sampleRate: number, channels: 1 | 2): Uint8Array {
  const headerSize = 44;
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const fileSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, fileSize - 8, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = headerSize;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i] ?? 0;
    const clamped = s < -1 ? -1 : s > 1 ? 1 : s;
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
