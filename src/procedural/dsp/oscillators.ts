/**
 * Bandlimited oscillators (§4.1).
 *
 * `polyBlepSaw` produces a downward saw in [-1, 1] that is clean up to the
 * Nyquist for the fundamentals we use (up to ~2 kHz lead notes). Cheap
 * enough to run per-voice per-sample.
 */

export function polyBlep(t: number, dt: number): number {
  // Standard polyBLEP correction for a discontinuity at phase = 0 (saw wrap).
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Advance a running phase and return the polyBLEP-corrected saw sample. */
export function polyBlepSaw(phase: number, dt: number): number {
  return 2 * phase - 1 - polyBlep(phase, dt);
}

export function sine(phase: number): number {
  return Math.sin(2 * Math.PI * phase);
}

export function triangle(phase: number): number {
  return 2 * Math.abs(2 * phase - 1) - 1;
}

export function wrapPhase(p: number): number {
  // Much cheaper than `% 1` for values within a few cycles of 0..1.
  while (p >= 1) p -= 1;
  while (p < 0) p += 1;
  return p;
}
