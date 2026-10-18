import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

/**
 * Digital mix: a software personal mix per musician, kept inside the Hub.
 * Musicians' faders change levels here, never on the desk. The engineer decides which input channels each
 * musician gets, saves that as a show file, and can load a different show for the next service.
 */

export const DEFAULT_LEVEL = 0x4f; // -5 dB starting level for a newly assigned channel
export const DEFAULT_MAX = 0x72; // +5 dB: highest a musician can push a channel
export const DEFAULT_MASTER = 0x62; // 0 dB
export const PAN_CENTRE = 0x25;
export const MAX_MUSICIANS = 7;
export const MAX_INPUTS = 32;

export interface ShowChannel {
  /** Desk input channel 1..32. The Hub reads it from the same-numbered USB channel (pre-fader direct out). */
  input: number;
  level: number; // 0..127
  pan: number; // 0..74 (37 = centre)
  /** Highest level the musician may set. */
  max: number;
  /** If true the musician cannot move this channel. */
  locked: boolean;
}

export interface ShowMusician {
  slotId: number;
  name: string;
  master: number;
  muted: boolean;
  channels: ShowChannel[];
}

export interface ShowFile {
  format: "qu32-show";
  version: 1;
  name: string;
  savedAt: string;
  musicians: ShowMusician[];
}

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Strict validation of an untrusted show (imported file). Throws a readable error. */
export function parseShow(raw: unknown): ShowFile {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || o.format !== "qu32-show") throw new Error("Not a QU32 show file");
  if (o.version !== 1) throw new Error("Unsupported show file version");
  if (typeof o.name !== "string" || !o.name.trim() || o.name.length > 80) throw new Error("Show name must be 1-80 characters");
  if (!Array.isArray(o.musicians) || o.musicians.length > MAX_MUSICIANS) throw new Error(`A show can have at most ${MAX_MUSICIANS} musicians`);
  const seen = new Set<number>();
  const musicians = o.musicians.map((m: Record<string, unknown>, idx: number): ShowMusician => {
    if (!m || typeof m !== "object") throw new Error(`Musician ${idx + 1} is invalid`);
    if (!isInt(m.slotId, 1, MAX_MUSICIANS) || seen.has(m.slotId)) throw new Error(`Musician ${idx + 1} has a bad or duplicate slot`);
    seen.add(m.slotId);
    if (typeof m.name !== "string" || m.name.length > 40) throw new Error(`Musician ${m.slotId} name is invalid`);
    if (!isInt(m.master, 0, 127)) throw new Error(`Musician ${m.slotId} master is invalid`);
    if (!Array.isArray(m.channels) || m.channels.length > MAX_INPUTS) throw new Error(`Musician ${m.slotId} has too many channels`);
    const inputs = new Set<number>();
    const channels = m.channels.map((c: Record<string, unknown>): ShowChannel => {
      if (!c || !isInt(c.input, 1, MAX_INPUTS) || inputs.has(c.input)) throw new Error(`Musician ${m.slotId} has a bad or duplicate input`);
      inputs.add(c.input);
      if (!isInt(c.level, 0, 127) || !isInt(c.pan, 0, 74) || !isInt(c.max, 0, 127) || typeof c.locked !== "boolean") throw new Error(`Musician ${m.slotId} channel ${c.input} has invalid values`);
      return { input: c.input, level: Math.min(c.level, c.max), pan: c.pan, max: c.max, locked: c.locked };
    });
    return { slotId: m.slotId, name: m.name.trim(), master: m.master, muted: m.muted === true, channels };
  });
  return { format: "qu32-show", version: 1, name: o.name.trim(), savedAt: typeof o.savedAt === "string" ? o.savedAt : new Date().toISOString(), musicians };
}

export class DigitalMix extends EventEmitter {
  /** Increases on every change (used by pollers). */
  rev = 0;
  showName = "Untitled show";
  dirty = false;
  private musicians = new Map<number, ShowMusician>();
  private file: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    super();
    this.file = path.join(dir, "current-mix.json");
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as { show: unknown; dirty?: boolean };
      const s = parseShow(raw.show);
      this.apply(s);
      this.dirty = raw.dirty === true;
    } catch { /* first run or unreadable: start empty */ }
  }

  private apply(s: ShowFile): void {
    this.showName = s.name;
    this.musicians.clear();
    for (const m of s.musicians) this.musicians.set(m.slotId, structuredClone(m));
  }

  get(slotId: number): ShowMusician {
    let m = this.musicians.get(slotId);
    if (!m) {
      m = { slotId, name: "", master: DEFAULT_MASTER, muted: false, channels: [] };
      this.musicians.set(slotId, m);
    }
    return m;
  }

  all(): ShowMusician[] {
    return [...this.musicians.values()].sort((a, b) => a.slotId - b.slotId);
  }

  private touch(slotId: number | null, dirty = true): void {
    this.rev++;
    if (dirty) this.dirty = true;
    this.emit("change", slotId);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 500);
  }

  private persist(): void {
    try {
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ show: this.toShow(this.showName), dirty: this.dirty }), { mode: 0o600 });
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch { /* never break live mixing over a disk error */ }
  }

  flush(): void { if (this.saveTimer) clearTimeout(this.saveTimer); this.persist(); }

  // ------------------------------------------------ engineer edits
  assign(slotId: number, input: number, on: boolean): void {
    if (!isInt(slotId, 1, MAX_MUSICIANS) || !isInt(input, 1, MAX_INPUTS)) throw new RangeError("Bad slot or input");
    const m = this.get(slotId);
    const has = m.channels.some((c) => c.input === input);
    if (on && !has) {
      m.channels.push({ input, level: DEFAULT_LEVEL, pan: PAN_CENTRE, max: DEFAULT_MAX, locked: false });
      m.channels.sort((a, b) => a.input - b.input);
    } else if (!on && has) m.channels = m.channels.filter((c) => c.input !== input);
    else return;
    this.touch(slotId);
  }

  setChannel(slotId: number, input: number, patch: { level?: unknown; pan?: unknown; max?: unknown; locked?: unknown }): void {
    const c = this.get(slotId).channels.find((x) => x.input === input);
    if (!c) throw new RangeError("Channel is not assigned to this musician");
    if (patch.max !== undefined) { if (!isInt(patch.max, 0, 127)) throw new RangeError("max must be 0..127"); c.max = patch.max; }
    if (patch.level !== undefined) { if (!isInt(patch.level, 0, 127)) throw new RangeError("level must be 0..127"); c.level = patch.level; }
    if (patch.pan !== undefined) { if (!isInt(patch.pan, 0, 74)) throw new RangeError("pan must be 0..74"); c.pan = patch.pan; }
    if (patch.locked !== undefined) { if (typeof patch.locked !== "boolean") throw new RangeError("locked must be boolean"); c.locked = patch.locked; }
    c.level = Math.min(c.level, c.max);
    this.touch(slotId);
  }

  rename(slotId: number, name: string): void { this.get(slotId).name = name; this.touch(slotId, false); }

  // ------------------------------------------------ musician edits (clamped and permission checked)
  userSet(slotId: number, op: "level" | "pan" | "master" | "mute", input: unknown, value: unknown): void {
    const m = this.get(slotId);
    if (op === "master") {
      if (!isInt(value, 0, 127)) throw new RangeError("value must be 0..127");
      m.master = value;
    } else if (op === "mute") {
      if (typeof value !== "boolean") throw new RangeError("value must be boolean");
      m.muted = value;
    } else {
      const c = m.channels.find((x) => x.input === input);
      if (!c) throw new RangeError("That channel is not in your mix");
      if (c.locked) throw new RangeError("The sound engineer has locked this channel");
      if (op === "level") { if (!isInt(value, 0, 127)) throw new RangeError("value must be 0..127"); c.level = Math.min(value, c.max); }
      else { if (!isInt(value, 0, 74)) throw new RangeError("value must be 0..74"); c.pan = value; }
    }
    this.touch(slotId);
  }

  // ------------------------------------------------ shows
  toShow(name: string): ShowFile {
    return { format: "qu32-show", version: 1, name, savedAt: new Date().toISOString(), musicians: this.all().map((m) => structuredClone(m)) };
  }

  load(show: ShowFile): void {
    this.apply(show);
    this.dirty = false;
    this.touch(null, false);
  }

  newShow(): void {
    this.musicians.clear();
    this.showName = "Untitled show";
    this.dirty = false;
    this.touch(null, false);
  }

  markSaved(name: string): void { this.showName = name; this.dirty = false; this.touch(null, false); }
}

const slug = (n: string) => n.trim().replace(/[^A-Za-z0-9 _.-]+/g, "_").replace(/\s+/g, " ").slice(0, 60) || "show";

/** Show files on disk: <dir>/shows/<name>.qu32show.json */
export class ShowStore {
  readonly dir: string;
  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "shows");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  list(): { file: string; name: string; savedAt: string }[] {
    const out: { file: string; name: string; savedAt: string }[] = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith(".qu32show.json")) continue;
      try { const s = parseShow(JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8"))); out.push({ file: f, name: s.name, savedAt: s.savedAt }); } catch { /* skip bad file */ }
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  save(show: ShowFile): string {
    const file = `${slug(show.name)}.qu32show.json`;
    fs.writeFileSync(path.join(this.dir, file), JSON.stringify(show, null, 2));
    return file;
  }

  load(file: string): ShowFile {
    if (file !== path.basename(file) || !file.endsWith(".qu32show.json")) throw new Error("Invalid show file name");
    return parseShow(JSON.parse(fs.readFileSync(path.join(this.dir, file), "utf8")));
  }

  remove(file: string): void {
    if (file !== path.basename(file) || !file.endsWith(".qu32show.json")) throw new Error("Invalid show file name");
    fs.rmSync(path.join(this.dir, file), { force: true });
  }

  static readExternal(p: string): ShowFile { return parseShow(JSON.parse(fs.readFileSync(p, "utf8"))); }
  static writeExternal(p: string, show: ShowFile): void { fs.writeFileSync(p, JSON.stringify(show, null, 2)); }
}
