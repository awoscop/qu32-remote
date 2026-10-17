/**
 * Streaming parser for MIDI bytes coming from the mixer.
 * Handles running status, interleaved real-time bytes, NRPN assembly and SysEx.
 */
export type MidiEvent =
  | { kind: "nrpn"; n: number; ch: number; id: number; va: number; vx: number }
  | { kind: "mute"; n: number; ch: number; on: boolean }
  | { kind: "program"; n: number; program: number }
  | { kind: "sysex"; data: number[] }
  | { kind: "activeSense" };

interface Pending {
  ch: number;
  id: number;
  va: number;
  emitted: boolean;
}

export class QuParser {
  private status = 0;
  private data: number[] = [];
  private inSysex = false;
  private sysex: number[] = [];
  /** NRPN assembly per MIDI channel nibble. */
  private nrpn = new Map<number, Pending>();

  push(bytes: ArrayLike<number>): MidiEvent[] {
    const out: MidiEvent[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]! & 0xff;
      if (b >= 0xf8) {
        if (b === 0xfe) out.push({ kind: "activeSense" });
        continue; // other real-time bytes are ignored
      }
      if (b === 0xf0) {
        this.flushAll(out);
        this.inSysex = true;
        this.sysex = [];
        this.status = 0;
        continue;
      }
      if (b === 0xf7) {
        if (this.inSysex) out.push({ kind: "sysex", data: this.sysex });
        this.inSysex = false;
        this.sysex = [];
        continue;
      }
      if (b & 0x80) {
        // channel status byte; aborts any sysex in flight
        this.inSysex = false;
        this.status = b;
        this.data = [];
        continue;
      }
      if (this.inSysex) {
        this.sysex.push(b);
        continue;
      }
      if (!this.status) continue; // data byte without status: drop
      this.data.push(b);
      const type = this.status & 0xf0;
      const n = this.status & 0x0f;
      const need = type === 0xc0 || type === 0xd0 ? 1 : 2;
      if (this.data.length < need) continue;
      const d = this.data;
      this.data = [];
      if (type === 0xb0) this.controlChange(n, d[0]!, d[1]!, out);
      else if (type === 0x90) {
        this.flushNrpn(n, out);
        const [ch, vel] = d as [number, number];
        if (vel > 0) out.push({ kind: "mute", n, ch, on: vel >= 0x40 });
      } else if (type === 0xc0) {
        this.flushNrpn(n, out);
        out.push({ kind: "program", n, program: d[0]! });
      }
    }
    return out;
  }

  /** Emit an NRPN whose data-LSB never arrived (call shortly after a read burst). */
  flush(): MidiEvent[] {
    const out: MidiEvent[] = [];
    this.flushAll(out);
    return out;
  }

  private controlChange(n: number, cc: number, v: number, out: MidiEvent[]): void {
    if (cc === 0x63) {
      this.flushNrpn(n, out);
      this.nrpn.set(n, { ch: v, id: -1, va: -1, emitted: false });
    } else if (cc === 0x62) {
      const p = this.nrpn.get(n);
      if (p) p.id = v;
    } else if (cc === 0x06) {
      const p = this.nrpn.get(n);
      if (p) p.va = v;
    } else if (cc === 0x26) {
      const p = this.nrpn.get(n);
      if (p && p.id >= 0 && p.va >= 0 && !p.emitted) {
        out.push({ kind: "nrpn", n, ch: p.ch, id: p.id, va: p.va, vx: v });
        p.emitted = true;
      }
    }
    // Bank-select (CC 0 / 32) and other CCs are ignored.
  }

  private flushNrpn(n: number, out: MidiEvent[]): void {
    const p = this.nrpn.get(n);
    if (p && !p.emitted && p.id >= 0 && p.va >= 0) {
      out.push({ kind: "nrpn", n, ch: p.ch, id: p.id, va: p.va, vx: 0 });
      p.emitted = true;
    }
  }

  private flushAll(out: MidiEvent[]): void {
    for (const n of this.nrpn.keys()) this.flushNrpn(n, out);
  }
}

export type SysexMessage =
  | { type: "systemState"; n: number; boxId: number; major: number; minor: number }
  | { type: "endSync"; n: number }
  | { type: "name"; n: number; ch: number; name: string }
  | { type: "unknown"; data: number[] };

const HEADER = [0x00, 0x00, 0x1a, 0x50, 0x11, 0x01, 0x00];

/** Decode the payload of a SysEx event (bytes between F0 and F7). */
export function decodeSysex(data: number[]): SysexMessage {
  for (let i = 0; i < HEADER.length; i++) if (data[i] !== HEADER[i]) return { type: "unknown", data };
  const n = data[7]!;
  const cmd = data[8];
  if (cmd === 0x11 && data.length >= 12) return { type: "systemState", n: n & 0x0f, boxId: data[9]!, major: data[10]!, minor: data[11]! };
  if (cmd === 0x14) return { type: "endSync", n: n & 0x0f };
  if (cmd === 0x02 && data.length >= 10) {
    const name = String.fromCharCode(...data.slice(10).filter((c) => c >= 0x20 && c < 0x7f)).trim();
    return { type: "name", n: n & 0x0f, ch: data[9]!, name };
  }
  return { type: "unknown", data };
}
