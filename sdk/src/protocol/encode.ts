/**
 * Byte encoders for the Qu MIDI protocol (V1.9+). Pure functions, no I/O.
 * N = base MIDI channel nibble (0..15). CH = strip address. See catalog.ts.
 */
import { NRPN_ID } from "./catalog.js";

const b7 = (v: number, what: string): number => {
  if (!Number.isInteger(v) || v < 0 || v > 0x7f) throw new RangeError(`${what} must be an integer 0..127, got ${v}`);
  return v;
};
const nib = (n: number): number => {
  if (!Number.isInteger(n) || n < 0 || n > 15) throw new RangeError(`MIDI channel must be 0..15, got ${n}`);
  return n;
};

/** NRPN: BN 63 CH, BN 62 ID, BN 06 VA, BN 26 VX */
export function nrpn(n: number, ch: number, id: number, va: number, vx: number): number[] {
  const s = 0xb0 | nib(n);
  return [s, 0x63, b7(ch, "CH"), s, 0x62, b7(id, "ID"), s, 0x06, b7(va, "VA"), s, 0x26, b7(vx, "VX")];
}

/** Mute: NOTE ON (7F on / 3F off) then NOTE ON velocity 0 */
export function mute(n: number, ch: number, on: boolean): number[] {
  const s = 0x90 | nib(n);
  return [s, b7(ch, "CH"), on ? 0x7f : 0x3f, s, ch, 0x00];
}

export const fader = (n: number, ch: number, va: number) => nrpn(n, ch, NRPN_ID.fader, va, 0x07);
export const sendLevel = (n: number, ch: number, vx: number, va: number) => nrpn(n, ch, NRPN_ID.sendLevel, va, vx);
export const sendPan = (n: number, ch: number, vx: number, va: number) => nrpn(n, ch, NRPN_ID.pan, va, vx);
export const sendAssign = (n: number, ch: number, vx: number, on: boolean) => nrpn(n, ch, NRPN_ID.mixAssign, on ? 1 : 0, vx);
export const sendPrePost = (n: number, ch: number, vx: number, pre: boolean) => nrpn(n, ch, NRPN_ID.mixPrePost, pre ? 1 : 0, vx);

/** Scene recall: set Bank 1 then Program Change. scene = 1..100 */
export function sceneRecall(n: number, scene: number): number[] {
  if (!Number.isInteger(scene) || scene < 1 || scene > 100) throw new RangeError(`scene must be 1..100, got ${scene}`);
  const s = 0xb0 | nib(n);
  return [s, 0x00, 0x00, s, 0x20, 0x00, 0xc0 | n, scene - 1];
}

export const ACTIVE_SENSE = [0xfe] as const;

/** SysEx header: F0 00 00 1A 50 11 01 00 0N  (n = 0x7F for All Call) */
export function sysexHeader(n: number): number[] {
  return [0xf0, 0x00, 0x00, 0x1a, 0x50, 0x11, 0x01, 0x00, n === 0x7f ? 0x7f : nib(n)];
}

/** Get System State (All Call). qupadFlag=1 makes the mixer expect Active Sense within 5 s. */
export function systemStateRequest(qupadFlag: 0 | 1 = 1): number[] {
  return [...sysexHeader(0x7f), 0x10, qupadFlag, 0xf7];
}

export function nameRequest(n: number, ch: number): number[] {
  return [...sysexHeader(n), 0x01, b7(ch, "CH"), 0xf7];
}
