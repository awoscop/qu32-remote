import { NRPN_ID, stripInfo } from "../protocol/catalog.js";
import { paramKey } from "../protocol/index.js";
import type { MixerSnapshot, StripState } from "./types.js";

export const getSendLevel = (m: MixerSnapshot, address: number, busIndex: number): number | undefined =>
  m.params[paramKey(address, NRPN_ID.sendLevel, busIndex)];

export const getSendPan = (m: MixerSnapshot, address: number, busIndex: number): number | undefined =>
  m.params[paramKey(address, NRPN_ID.pan, busIndex)];

export const getStrip = (m: MixerSnapshot, address: number): StripState | undefined =>
  m.strips.find((s) => s.address === address);

/** Strips that can feed a mix send (inputs, stereo inputs, FX returns). */
export const sendSources = (m: MixerSnapshot): StripState[] =>
  m.strips.filter((s) => stripInfo(s.address)?.isSendSource);

export const isReady = (m: MixerSnapshot | undefined | null): boolean => m?.phase === "ready";
