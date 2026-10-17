import { EventEmitter } from "node:events";
import net from "node:net";
import {
  ACTIVE_SENSE, NRPN_ID, QuParser, STRIPS, decodeSysex, nameRequest, paramKey, stripInfo, systemStateRequest,
  type Command, type MidiEvent, type MixerPhase, type MixerSnapshot, type StripState,
} from "./qu.js";
import { MONITOR_BUSES, processingParam } from "./qu.js";

const KEEPALIVE_MS = 1000;
const SYNC_TIMEOUT_MS = 16000;
const SILENCE_MS = 8000; // Qu sends Active Sense about every 300 ms
const RETRY_MS = 3500;

export interface MixerOptions {
  host: string;
  port: number;
  allowedModels: number[];
  retryMs?: number;
}

/**
 * Owns the single TCP MIDI session to the Qu. Keeps a cache of console state from feedback.
 * Fail-closed: send() refuses unless phase === "ready". Nothing is queued while offline.
 */
export class QuLink extends EventEmitter {
  phase: MixerPhase = "offline";
  message = "Not configured";
  firmware: string | null = null;
  host: string;
  port: number;
  /** Base MIDI channel nibble reported by the mixer. */
  n = 0;
  scene: number | null = null;
  rev = 0;
  updatedAt = Date.now();
  private params = new Map<string, number>();
  private mutes = new Map<number, boolean>();
  private names = new Map<number, string>();
  private sock: net.Socket | null = null;
  private parser = new QuParser();
  private keepalive: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private lastRx = 0;
  private closed = false;

  constructor(private opts: MixerOptions) {
    super();
    this.host = opts.host;
    this.port = opts.port;
    if (this.host) this.message = "Connecting...";
  }

  start(): void {
    this.closed = false;
    if (this.host) this.connect();
  }

  setHost(host: string): void {
    this.host = host;
    this.teardown();
    this.closed = false;
    if (host) this.connect();
    else this.setPhase("offline", "Not configured");
  }

  stop(): void {
    this.closed = true;
    this.teardown();
    this.setPhase("offline", "Stopped");
  }

  private connect(): void {
    this.teardown();
    this.setPhase("connecting", `Connecting to ${this.host}...`);
    const s = new net.Socket();
    this.sock = s;
    s.setNoDelay(true);
    s.setTimeout(0);
    s.on("connect", () => {
      this.parser = new QuParser();
      this.lastRx = Date.now();
      this.setPhase("syncing", "Requesting console state...");
      s.write(Buffer.from([...ACTIVE_SENSE, ...systemStateRequest(1)]));
      this.keepalive = setInterval(() => {
        if (Date.now() - this.lastRx > SILENCE_MS) return this.fail("Console stopped responding");
        s.write(Buffer.from(ACTIVE_SENSE));
      }, KEEPALIVE_MS);
      this.syncTimer = setTimeout(() => this.fail("Timed out waiting for console state"), SYNC_TIMEOUT_MS);
    });
    s.on("data", (d) => this.onData(d));
    s.on("error", (e) => this.fail(`Connection error: ${e.message}`));
    s.on("close", () => this.fail("Connection closed"));
    s.connect(this.port, this.host);
  }

  private onData(d: Buffer): void {
    this.lastRx = Date.now();
    this.handle(this.parser.push(d));
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.handle(this.parser.flush()), 25);
  }

  private handle(events: MidiEvent[]): void {
    let changed = false;
    for (const e of events) {
      switch (e.kind) {
        case "nrpn": {
          const k = paramKey(e.ch, e.id, e.vx);
          if (this.params.get(k) !== e.va) { this.params.set(k, e.va); changed = true; }
          break;
        }
        case "mute":
          if (this.mutes.get(e.ch) !== e.on) { this.mutes.set(e.ch, e.on); changed = true; }
          break;
        case "program":
          this.scene = e.program + 1;
          changed = true;
          break;
        case "sysex": {
          const m = decodeSysex(e.data);
          if (m.type === "systemState") this.onSystemState(m.n, m.boxId, m.major, m.minor);
          else if (m.type === "endSync") this.onEndSync();
          else if (m.type === "name" && m.name) { this.names.set(m.ch, m.name); changed = true; }
          break;
        }
        case "activeSense":
          break;
      }
    }
    if (changed) this.bump();
  }

  private onSystemState(n: number, boxId: number, major: number, minor: number): void {
    if (!this.opts.allowedModels.includes(boxId)) {
      this.fail(`Connected device is not a Qu-32 (model id ${boxId})`, true);
      return;
    }
    this.n = n;
    this.firmware = `${major}.${String(minor).padStart(2, "0")}`;
    this.setPhase("syncing", "Receiving console state...");
  }

  private onEndSync(): void {
    if (this.phase !== "syncing") return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.setPhase("ready", "Console online");
    for (const s of STRIPS) if (s.family !== "muteGroup") this.sock?.write(Buffer.from(nameRequest(this.n, s.address)));
  }

  /** Write MIDI bytes. Returns false (and writes nothing) unless the console is ready. */
  send(bytes: number[]): boolean {
    if (this.phase !== "ready" || !this.sock || this.sock.destroyed) return false;
    this.sock.write(Buffer.from(bytes));
    return true;
  }

  /** Reflect a just-sent command in the cache; console feedback overwrites it if it differs. */
  applyOptimistic(c: Command): void {
    switch (c.operation) {
      case "sendLevel": this.params.set(paramKey(c.address, NRPN_ID.sendLevel, c.busIndex), c.value); break;
      case "sendPan": this.params.set(paramKey(c.address, NRPN_ID.pan, c.busIndex), c.value); break;
      case "stripFader": this.params.set(paramKey(c.address, NRPN_ID.fader, 7), c.value); break;
      case "monitorMasterFader": this.params.set(paramKey(MONITOR_BUSES[c.busIndex]!.masterAddress, NRPN_ID.fader, 7), c.value); break;
      case "stripMute": this.mutes.set(c.address, c.muted); break;
      case "monitorMasterMute": this.mutes.set(MONITOR_BUSES[c.busIndex]!.masterAddress, c.muted); break;
      case "processing": { const p = processingParam(c.key)!; this.params.set(paramKey(c.address, p.id, p.vx), c.value); break; }
      case "sceneRecall": this.scene = c.scene; break;
      default: break;
    }
    this.bump();
  }

  snapshot(): MixerSnapshot {
    const strips: StripState[] = STRIPS.map((s) => ({
      address: s.address,
      label: this.names.get(s.address) || s.label,
      family: s.family,
      fader: s.hasFader ? (this.params.get(paramKey(s.address, NRPN_ID.fader, 7)) ?? null) : null,
      muted: this.mutes.get(s.address) ?? null,
    }));
    return {
      phase: this.phase,
      message: this.message,
      firmware: this.firmware,
      host: this.host,
      updatedAt: this.updatedAt,
      scene: this.scene,
      strips,
      params: Object.fromEntries(this.params),
    };
  }

  private setPhase(p: MixerPhase, msg: string): void {
    if (this.phase === p && this.message === msg) return;
    this.phase = p;
    this.message = msg;
    this.bump();
    this.emit("phase", p, msg);
  }

  private bump(): void {
    this.rev++;
    this.updatedAt = Date.now();
    this.emit("change");
  }

  private fail(msg: string, fatal = false): void {
    if (this.phase === "offline" && this.closed) return;
    this.teardown();
    this.setPhase(fatal ? "error" : "offline", msg);
    if (!this.closed && this.host) this.retryTimer = setTimeout(() => this.connect(), this.opts.retryMs ?? RETRY_MS);
  }

  private teardown(): void {
    for (const t of [this.keepalive, this.syncTimer, this.retryTimer, this.flushTimer]) if (t) { clearTimeout(t); clearInterval(t); }
    this.keepalive = this.syncTimer = this.retryTimer = this.flushTimer = null;
    if (this.sock) {
      this.sock.removeAllListeners();
      this.sock.on("error", () => {});
      this.sock.destroy();
      this.sock = null;
    }
  }
}

export { stripInfo };
