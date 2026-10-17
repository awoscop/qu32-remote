/**
 * Fader/send level (0..127) <-> dB, interpolated between the official table points
 * in the Qu MIDI protocol reference. The table points are exact; values between
 * them are linearly interpolated in dB (approximation).
 */
const POINTS: ReadonlyArray<readonly [number, number]> = [
  [0x00, -Infinity],
  [0x0c, -45],
  [0x10, -40],
  [0x17, -35],
  [0x1f, -30],
  [0x27, -25],
  [0x2f, -20],
  [0x36, -15],
  [0x3f, -10],
  [0x4f, -5],
  [0x62, 0],
  [0x72, 5],
  [0x7f, 10],
];

/** Raw value for 0 dB (unity). */
export const UNITY = 0x62;

export function levelToDb(raw: number): number {
  const v = Math.max(0, Math.min(127, Math.round(raw)));
  if (v === 0) return -Infinity;
  for (let i = 1; i < POINTS.length; i++) {
    const [r1, d1] = POINTS[i]!;
    const [r0, d0] = POINTS[i - 1]!;
    if (v <= r1) {
      if (v === r1) return d1;
      const lo = Number.isFinite(d0) ? d0 : -60;
      return lo + ((v - r0) / (r1 - r0)) * (d1 - lo);
    }
  }
  return 10;
}

export function dbToLevel(db: number): number {
  if (!Number.isFinite(db) || db <= -60) return 0;
  for (let i = 1; i < POINTS.length; i++) {
    const [r1, d1] = POINTS[i]!;
    const [r0, d0] = POINTS[i - 1]!;
    if (db <= d1) {
      const lo = Number.isFinite(d0) ? d0 : -60;
      return Math.round(r0 + ((db - lo) / (d1 - lo)) * (r1 - r0));
    }
  }
  return 127;
}

export function formatDb(raw: number): string {
  if (raw <= 0) return "-inf";
  const r = Math.round(levelToDb(raw) * 10) / 10;
  return `${r > 0 ? "+" : ""}${r.toFixed(1)} dB`;
}

/** Pan raw 0..74: 0 = full left, 37 (0x25) = centre, 74 (0x4A) = full right. */
export const PAN_MAX = 0x4a;
export const PAN_CENTER = 0x25;

export function formatPan(raw: number): string {
  if (raw === PAN_CENTER) return "C";
  return raw < PAN_CENTER
    ? `L${Math.round(((PAN_CENTER - raw) / PAN_CENTER) * 100)}`
    : `R${Math.round(((raw - PAN_CENTER) / (PAN_MAX - PAN_CENTER)) * 100)}`;
}
