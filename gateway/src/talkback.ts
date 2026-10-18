import { sendLevel as encSendLevel } from "./qu.js";
import type { QuLink } from "./mixer.js";

export interface TalkbackConfig {
  /** Strip address of the dedicated talkback input (USB source) on the desk. Default CH 32 = 0x3F. */
  strip: number;
  /** Raw send level while talking. 0x62 = 0 dB. */
  level: number;
  /** Hard cap on one continuous talk, ms. */
  maxMs: number;
}

export const DEFAULT_TALKBACK: TalkbackConfig = { strip: 0x3f, level: 0x62, maxMs: 60_000 };

/**
 * Talkback = raise one dedicated input channel's sends to the chosen monitor mixes, and put them back to
 * minus-infinity on release. Release always zeroes ALL seven monitor buses (fail-safe), never replays old values.
 */
export class Talkback {
  active = false;
  buses: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  onChange: (active: boolean) => void = () => {};

  constructor(private link: QuLink, public cfg: TalkbackConfig = DEFAULT_TALKBACK) {}

  start(buses: number[]): boolean {
    const valid = [...new Set(buses)].filter((b) => Number.isInteger(b) && b >= 0 && b <= 6);
    if (!valid.length || this.link.phase !== "ready") return false;
    for (let b = 0; b <= 6; b++) this.write(b, valid.includes(b) ? this.cfg.level : 0);
    this.active = true;
    this.buses = valid;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop(), this.cfg.maxMs);
    this.onChange(true);
    return true;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const was = this.active;
    this.active = false;
    this.buses = [];
    for (let b = 0; b <= 6; b++) this.write(b, 0);
    if (was) this.onChange(false);
  }

  private write(bus: number, value: number): void {
    if (this.link.send(encSendLevel(this.link.n, this.cfg.strip, bus, value))) {
      this.link.applyOptimistic({ operation: "sendLevel", address: this.cfg.strip, busIndex: bus, value });
    }
  }
}
