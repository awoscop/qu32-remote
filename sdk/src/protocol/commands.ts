/**
 * API commands: the only way clients ask the gateway to change the console.
 * Clients never send raw MIDI. `validateCommand` is shared by SDK (pre-check) and gateway (authoritative).
 */
import {
  isFxBus, isMonitorBus, isStereoMonitorBus, MONITOR_BUSES, processingParam, PROCESSING_FAMILIES, stripInfo,
} from "./catalog.js";
import { PAN_MAX } from "./db.js";
import * as enc from "./encode.js";

export type Command =
  | { operation: "sendLevel"; address: number; busIndex: number; value: number }
  | { operation: "sendPan"; address: number; busIndex: number; value: number }
  | { operation: "monitorMasterFader"; busIndex: number; value: number }
  | { operation: "monitorMasterMute"; busIndex: number; muted: boolean }
  | { operation: "stripFader"; address: number; value: number }
  | { operation: "stripMute"; address: number; muted: boolean }
  | { operation: "sendAssign"; address: number; busIndex: number; assigned: boolean }
  | { operation: "sendPrePost"; address: number; busIndex: number; pre: boolean }
  | { operation: "processing"; address: number; key: string; value: number; confirm?: string }
  | { operation: "sceneRecall"; scene: number; confirm: string };

export const OPERATIONS = [
  "sendLevel", "sendPan", "monitorMasterFader", "monitorMasterMute", "stripFader",
  "stripMute", "sendAssign", "sendPrePost", "processing", "sceneRecall",
] as const;

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Returns an error message, or null if the (untrusted) object is a well-formed command. */
export function validateCommand(c: unknown): string | null {
  if (!c || typeof c !== "object") return "Command must be an object";
  const o = c as Record<string, unknown>;
  switch (o.operation) {
    case "sendLevel":
    case "sendPan": {
      const s = typeof o.address === "number" ? stripInfo(o.address) : undefined;
      if (!s || !s.isSendSource) return "address is not a send source";
      if (o.operation === "sendLevel") {
        if (!isMonitorBus(o.busIndex) && !isFxBus(o.busIndex)) return "busIndex must be 0..6 or 16..19";
        return isInt(o.value, 0, 127) ? null : "value must be an integer 0..127";
      }
      if (!isStereoMonitorBus(o.busIndex)) return "pan only exists on stereo mixes (busIndex 4..6)";
      return isInt(o.value, 0, PAN_MAX) ? null : `value must be an integer 0..${PAN_MAX}`;
    }
    case "monitorMasterFader":
      if (!isMonitorBus(o.busIndex)) return "busIndex must be 0..6";
      return isInt(o.value, 0, 127) ? null : "value must be an integer 0..127";
    case "monitorMasterMute":
      if (!isMonitorBus(o.busIndex)) return "busIndex must be 0..6";
      return typeof o.muted === "boolean" ? null : "muted must be boolean";
    case "stripFader": {
      const s = typeof o.address === "number" ? stripInfo(o.address) : undefined;
      if (!s || !s.hasFader) return "address has no fader";
      return isInt(o.value, 0, 127) ? null : "value must be an integer 0..127";
    }
    case "stripMute":
      if (typeof o.address !== "number" || !stripInfo(o.address)) return "unknown strip address";
      return typeof o.muted === "boolean" ? null : "muted must be boolean";
    case "sendAssign":
    case "sendPrePost": {
      const s = typeof o.address === "number" ? stripInfo(o.address) : undefined;
      if (!s || !s.isSendSource) return "address is not a send source";
      if (o.operation === "sendAssign") {
        if (!isMonitorBus(o.busIndex) && !isFxBus(o.busIndex)) return "busIndex must be 0..6 or 16..19";
        return typeof o.assigned === "boolean" ? null : "assigned must be boolean";
      }
      if (!isMonitorBus(o.busIndex)) return "busIndex must be 0..6";
      return typeof o.pre === "boolean" ? null : "pre must be boolean";
    }
    case "processing": {
      const s = typeof o.address === "number" ? stripInfo(o.address) : undefined;
      if (!s || !PROCESSING_FAMILIES.includes(s.family)) return "processing is available for input channels only";
      const p = typeof o.key === "string" ? processingParam(o.key) : undefined;
      if (!p) return "unknown processing key";
      if (!isInt(o.value, 0, p.max)) return `value must be an integer 0..${p.max}`;
      if (p.dangerous && o.value === 1 && o.confirm !== p.dangerous) return `confirm must equal "${p.dangerous}"`;
      return null;
    }
    case "sceneRecall":
      if (!isInt(o.scene, 1, 100)) return "scene must be 1..100";
      return o.confirm === `RECALL ${o.scene}` ? null : `confirm must equal "RECALL ${o.scene}"`;
    default:
      return "Unknown operation";
  }
}

/** Encode a validated command to MIDI bytes. Throws on invalid input. */
export function encodeCommand(c: Command, n: number): number[] {
  const err = validateCommand(c);
  if (err) throw new RangeError(err);
  switch (c.operation) {
    case "sendLevel": return enc.sendLevel(n, c.address, c.busIndex, c.value);
    case "sendPan": return enc.sendPan(n, c.address, c.busIndex, c.value);
    case "monitorMasterFader": return enc.fader(n, MONITOR_BUSES[c.busIndex]!.masterAddress, c.value);
    case "monitorMasterMute": return enc.mute(n, MONITOR_BUSES[c.busIndex]!.masterAddress, c.muted);
    case "stripFader": return enc.fader(n, c.address, c.value);
    case "stripMute": return enc.mute(n, c.address, c.muted);
    case "sendAssign": return enc.sendAssign(n, c.address, c.busIndex, c.assigned);
    case "sendPrePost": return enc.sendPrePost(n, c.address, c.busIndex, c.pre);
    case "processing": {
      const p = processingParam(c.key)!;
      return enc.nrpn(n, c.address, p.id, c.value, p.vx);
    }
    case "sceneRecall": return enc.sceneRecall(n, c.scene);
  }
}
