import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Auth } from "./auth.js";
import { MONITOR_BUSES, type User } from "./qu.js";

export const MAX_SLOTS = MONITOR_BUSES.length; // 7 monitor buses: Mix 1-4, 5-6, 7-8, 9-10

export interface Slot {
  /** 1..7. Slot n is permanently bound to monitor bus n-1. */
  id: number;
  name: string;
  /** QR secret. 128-bit random, rotated by regenerate(). */
  token: string;
  enabled: boolean;
  /** Highest raw level (0..127) a musician may set on sends/master. 0x72 = +5 dB. */
  ceiling: number;
  /** First USB capture channel (1-based) carrying this mix. Stereo mixes use channel and channel+1. */
  usbChannel: number;
  /** Show every channel on the musician's page, not just the ones the engineer assigned to their mix. */
  showAll: boolean;
  /** "digital": personal mix inside the Hub (default). "desk": the console's own monitor mix, controlled over MIDI. */
  mode: "digital" | "desk";
}

interface Persisted {
  count: number;
  slots: Slot[];
}

const defaultUsb = (id: number): number => ({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 7, 7: 9 })[id] ?? id;

export const slotUsername = (id: number) => `slot-${id}`;
const parseSlotId = (username: string): number | null => {
  const m = /^slot-(\d)$/.exec(username);
  return m ? Number(m[1]) : null;
};

/**
 * QR monitor slots. Each slot is one musician position on one monitor bus.
 * The QR token is exchanged for a normal gateway session with role "monitor" bound to that bus,
 * so the regular policy engine does all authorization.
 */
export class Slots {
  private data: Persisted;
  private file: string;
  private seen = new Map<number, number>();

  constructor(dataDir: string, private auth: Auth) {
    this.file = path.join(dataDir, "slots.json");
    let d: Persisted | null = null;
    try { d = JSON.parse(fs.readFileSync(this.file, "utf8")) as Persisted; } catch { /* first run */ }
    this.data = d ?? { count: 0, slots: [] };
    for (let id = 1; id <= MAX_SLOTS; id++) {
      if (!this.data.slots.find((s) => s.id === id)) {
        this.data.slots.push({ id, name: MONITOR_BUSES[id - 1]!.name, token: Slots.newToken(), enabled: true, ceiling: 0x72, usbChannel: defaultUsb(id), showAll: false, mode: "digital" });
      }
    }
    for (const s of this.data.slots) { if (typeof s.showAll !== "boolean") s.showAll = false; if (s.mode !== "desk" && s.mode !== "digital") s.mode = "digital"; }
    this.data.slots.sort((a, b) => a.id - b.id);
    auth.virtualCheck = (u) => this.isValidUser(u);
    this.save();
  }

  private static newToken = () => crypto.randomBytes(16).toString("base64url");

  private save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get count(): number { return this.data.count; }

  /** Active slots (the first `count`). */
  active(): Slot[] { return this.data.slots.filter((s) => s.id <= this.data.count); }
  all(): Slot[] { return this.data.slots; }
  get(id: number): Slot | undefined { return this.data.slots.find((s) => s.id === id); }

  setCount(n: unknown): void {
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > MAX_SLOTS) throw new RangeError(`count must be 0..${MAX_SLOTS}`);
    const old = this.data.count;
    this.data.count = n as number;
    // slots that were switched off lose their sessions and get a fresh token so an old QR cannot return
    for (let id = this.data.count + 1; id <= old; id++) this.regenerate(id, false);
    this.save();
  }

  update(id: number, patch: { name?: unknown; enabled?: unknown; ceiling?: unknown; usbChannel?: unknown; showAll?: unknown; mode?: unknown }): Slot {
    const s = this.get(id);
    if (!s) throw new RangeError("No such slot");
    if (patch.name !== undefined) {
      if (typeof patch.name !== "string" || patch.name.length > 40) throw new RangeError("name must be at most 40 characters");
      s.name = patch.name.trim();
    }
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== "boolean") throw new RangeError("enabled must be boolean");
      s.enabled = patch.enabled;
      if (!s.enabled) this.auth.revoke(slotUsername(id));
    }
    if (patch.mode !== undefined) {
      if (patch.mode !== "digital" && patch.mode !== "desk") throw new RangeError("mode must be digital or desk");
      s.mode = patch.mode;
      this.auth.revoke(slotUsername(id));
    }
    if (patch.showAll !== undefined) {
      if (typeof patch.showAll !== "boolean") throw new RangeError("showAll must be boolean");
      s.showAll = patch.showAll;
    }
    if (patch.ceiling !== undefined) {
      if (!Number.isInteger(patch.ceiling) || (patch.ceiling as number) < 0 || (patch.ceiling as number) > 127) throw new RangeError("ceiling must be 0..127");
      s.ceiling = patch.ceiling as number;
    }
    if (patch.usbChannel !== undefined) {
      if (!Number.isInteger(patch.usbChannel) || (patch.usbChannel as number) < 1 || (patch.usbChannel as number) > 32) throw new RangeError("usbChannel must be 1..32");
      s.usbChannel = patch.usbChannel as number;
    }
    this.save();
    return s;
  }

  /** New QR token; every live session of that slot is dropped. */
  regenerate(id: number, save = true): Slot {
    const s = this.get(id);
    if (!s) throw new RangeError("No such slot");
    s.token = Slots.newToken();
    this.auth.revoke(slotUsername(id));
    this.seen.delete(id);
    if (save) this.save();
    return s;
  }

  /** Exchange a QR token for a session. Constant-time compare; null if unknown/disabled/inactive. */
  join(token: unknown): { token: string; user: User; slot: Slot } | null {
    if (typeof token !== "string" || token.length < 16 || token.length > 64) return null;
    const t = Buffer.from(token);
    for (const s of this.active()) {
      const a = Buffer.from(s.token);
      if (a.length === t.length && crypto.timingSafeEqual(a, t) && s.enabled) {
        const user = this.userFor(s);
        this.touch(s.id);
        return { token: this.auth.openVirtualSession(user), user, slot: s };
      }
    }
    return null;
  }

  userFor(s: Slot): User {
    return { username: slotUsername(s.id), role: "monitor", busIndex: s.id - 1, enabled: true };
  }

  slotOf(username: string): Slot | undefined {
    const id = parseSlotId(username);
    return id === null ? undefined : this.get(id);
  }

  private isValidUser(username: string): boolean {
    const s = this.slotOf(username);
    return !!s && s.enabled && s.id <= this.data.count;
  }

  touch(id: number): void { this.seen.set(id, Date.now()); }
  /** A phone is "connected" if its page made an authenticated request in the last 5 s. */
  connected(id: number): boolean { return Date.now() - (this.seen.get(id) ?? 0) < 5000; }
}
