import net from "node:net";
import {
  ACTIVE_SENSE, NRPN_ID, QuParser, STRIPS, fader, mute, sysexHeader,
  type MidiEvent,
} from "./qu.js";

/**
 * Simulated Qu-32 for development and tests. Speaks the documented TCP MIDI protocol:
 * System State -> state push -> End Sync, name requests, and echoes parameter changes as feedback.
 * One TCP client at a time, like the real console. NOT a substitute for hardware testing.
 */
export class MockQu {
  server: net.Server;
  received: MidiEvent[] = [];
  n: number;
  boxId: number;
  private client: net.Socket | null = null;

  constructor(opts: { n?: number; boxId?: number } = {}) {
    this.n = opts.n ?? 0;
    this.boxId = opts.boxId ?? 3;
    this.server = net.createServer((s) => this.onClient(s));
  }

  listen(port = 0): Promise<number> {
    return new Promise((r) => this.server.listen(port, "127.0.0.1", () => r((this.server.address() as net.AddressInfo).port)));
  }

  close(): Promise<void> {
    this.client?.destroy();
    return new Promise((r) => { this.server.close(() => r()); });
  }

  /** Simulate the cable being pulled. */
  dropClient(): void { this.client?.destroy(); }

  /** Simulate a knob moved on the desk. */
  moveFader(ch: number, va: number): void { this.client?.write(Buffer.from(fader(this.n, ch, va))); }

  private onClient(s: net.Socket): void {
    if (this.client && !this.client.destroyed) { s.destroy(); return; }
    this.client = s;
    const parser = new QuParser();
    s.write(Buffer.from(ACTIVE_SENSE));
    const hb = setInterval(() => s.write(Buffer.from(ACTIVE_SENSE)), 300);
    s.on("close", () => { clearInterval(hb); if (this.client === s) this.client = null; });
    s.on("error", () => {});
    s.on("data", (d) => {
      for (const e of [...parser.push(d), ...parser.flush()]) {
        this.received.push(e);
        if (e.kind === "sysex") this.onSysex(s, e.data);
        else if (e.kind === "nrpn") s.write(Buffer.from(this.nrpnBytes(e.ch, e.id, e.va, e.vx)));
        else if (e.kind === "mute") s.write(Buffer.from(mute(this.n, e.ch, e.on)));
        else if (e.kind === "program") s.write(Buffer.from([0xc0 | this.n, e.program]));
      }
    });
  }

  private nrpnBytes(ch: number, id: number, va: number, vx: number): number[] {
    const st = 0xb0 | this.n;
    return [st, 0x63, ch, st, 0x62, id, st, 0x06, va, st, 0x26, vx];
  }

  private onSysex(s: net.Socket, data: number[]): void {
    const cmd = data[8];
    if (cmd === 0x10) {
      const h = sysexHeader(this.n);
      s.write(Buffer.from([...h, 0x11, this.boxId, 1, 9, 0xf7]));
      for (const st of STRIPS.filter((x) => x.family === "input").slice(0, 8)) {
        s.write(Buffer.from(fader(this.n, st.address, 0x62)));
        for (let bus = 0; bus <= 6; bus++) s.write(Buffer.from(this.nrpnBytes(st.address, NRPN_ID.sendLevel, 0x40, bus)));
      }
      for (let bus = 0; bus <= 6; bus++) s.write(Buffer.from(fader(this.n, 0x60 + bus, 0x62)));
      s.write(Buffer.from([...h, 0x14, 0xf7]));
    } else if (cmd === 0x01) {
      const ch = data[9]!;
      const label = STRIPS.find((x) => x.address === ch)?.label ?? `Strip ${ch}`;
      s.write(Buffer.from([...sysexHeader(this.n), 0x02, ch, ...Buffer.from(`Mock ${label}`), 0xf7]));
    }
  }
}
