/**
 * Qu-32 address catalog. Source: "Qu Mixer MIDI Protocol, Firmware V1.9+" (Allen & Heath, Oct 2021).
 * `address` is the MIDI "CH" byte (strip id), NOT a network address.
 * `busIndex` is the logical bus used on the wire/API:
 *   0..6 = Mix 1, 2, 3, 4, 5-6, 7-8, 9-10;  16..19 = FX send 1-4.
 */

export type StripFamily =
  | "input"
  | "stereo"
  | "fxReturn"
  | "fxSend"
  | "dca"
  | "muteGroup"
  | "mix"
  | "main"
  | "group"
  | "matrix";

export interface StripInfo {
  address: number;
  family: StripFamily;
  /** Default console label, e.g. "CH 1". */
  label: string;
  /** Has a fader (mute groups do not). */
  hasFader: boolean;
  /** Can be used as a source for mix sends. */
  isSendSource: boolean;
}

function range(n: number, f: (i: number) => StripInfo): StripInfo[] {
  return Array.from({ length: n }, (_, i) => f(i));
}

export const STRIPS: readonly StripInfo[] = [
  ...range(4, (i) => ({ address: 0x00 + i, family: "fxSend" as const, label: `FX Send ${i + 1}`, hasFader: true, isSendSource: false })),
  ...range(4, (i) => ({ address: 0x08 + i, family: "fxReturn" as const, label: `FX Ret ${i + 1}`, hasFader: true, isSendSource: true })),
  ...range(4, (i) => ({ address: 0x10 + i, family: "dca" as const, label: `DCA ${i + 1}`, hasFader: true, isSendSource: false })),
  ...range(32, (i) => ({ address: 0x20 + i, family: "input" as const, label: `CH ${i + 1}`, hasFader: true, isSendSource: true })),
  ...range(3, (i) => ({ address: 0x40 + i, family: "stereo" as const, label: `ST ${i + 1}`, hasFader: true, isSendSource: true })),
  ...range(4, (i) => ({ address: 0x50 + i, family: "muteGroup" as const, label: `Mute Grp ${i + 1}`, hasFader: false, isSendSource: false })),
  ...["Mix 1", "Mix 2", "Mix 3", "Mix 4", "Mix 5-6", "Mix 7-8", "Mix 9-10"].map((label, i) => ({
    address: 0x60 + i,
    family: "mix" as const,
    label,
    hasFader: true,
    isSendSource: false,
  })),
  { address: 0x67, family: "main" as const, label: "Main LR", hasFader: true, isSendSource: false },
  ...["Grp 1-2", "Grp 3-4", "Grp 5-6", "Grp 7-8"].map((label, i) => ({
    address: 0x68 + i,
    family: "group" as const,
    label,
    hasFader: true,
    isSendSource: false,
  })),
  ...["Mtx 1-2", "Mtx 3-4"].map((label, i) => ({
    address: 0x6c + i,
    family: "matrix" as const,
    label,
    hasFader: true,
    isSendSource: false,
  })),
];

const BY_ADDRESS = new Map(STRIPS.map((s) => [s.address, s]));

export function stripInfo(address: number): StripInfo | undefined {
  return BY_ADDRESS.get(address);
}

export const ADDRESS = {
  input: (n: number) => 0x20 + (n - 1), // n = 1..32
  stereo: (n: number) => 0x40 + (n - 1), // 1..3
  fxReturn: (n: number) => 0x08 + (n - 1),
  fxSend: (n: number) => 0x00 + (n - 1),
  dca: (n: number) => 0x10 + (n - 1),
  muteGroup: (n: number) => 0x50 + (n - 1),
  mixMaster: (busIndex: number) => 0x60 + busIndex, // busIndex 0..6
  mainLR: 0x67,
} as const;

export interface MonitorBus {
  busIndex: number;
  name: string;
  stereo: boolean;
  /** Strip address of this bus's master. */
  masterAddress: number;
}

export const MONITOR_BUSES: readonly MonitorBus[] = [
  { busIndex: 0, name: "Mix 1", stereo: false, masterAddress: 0x60 },
  { busIndex: 1, name: "Mix 2", stereo: false, masterAddress: 0x61 },
  { busIndex: 2, name: "Mix 3", stereo: false, masterAddress: 0x62 },
  { busIndex: 3, name: "Mix 4", stereo: false, masterAddress: 0x63 },
  { busIndex: 4, name: "Mix 5-6", stereo: true, masterAddress: 0x64 },
  { busIndex: 5, name: "Mix 7-8", stereo: true, masterAddress: 0x65 },
  { busIndex: 6, name: "Mix 9-10", stereo: true, masterAddress: 0x66 },
];

export const FX_BUS_FIRST = 16;
export const FX_BUS_LAST = 19;

export const isMonitorBus = (b: unknown): b is number => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= 6;
export const isFxBus = (b: unknown): b is number =>
  Number.isInteger(b) && (b as number) >= FX_BUS_FIRST && (b as number) <= FX_BUS_LAST;
export const isStereoMonitorBus = (b: unknown): b is number => Number.isInteger(b) && (b as number) >= 4 && (b as number) <= 6;

export function busName(busIndex: number): string {
  if (isMonitorBus(busIndex)) return MONITOR_BUSES[busIndex]!.name;
  if (isFxBus(busIndex)) return `FX Send ${busIndex - FX_BUS_FIRST + 1}`;
  return `Bus ${busIndex}`;
}

/** Qu-32 model id in the System State reply. */
export const QU32_BOX_ID = 3;
export const QU_TCP_PORT = 51325;

/** NRPN parameter ids (LSB of NRPN). */
export const NRPN_ID = {
  fader: 0x17,
  pan: 0x16,
  lrAssign: 0x18,
  mixAssign: 0x55,
  mixPrePost: 0x50,
  sendLevel: 0x20,
} as const;

export interface ProcessingParam {
  key: string;
  id: number;
  /** Data LSB (VX) used for this parameter. */
  vx: number;
  max: number;
  group: "hpf" | "eq" | "gate" | "comp" | "preamp" | "delay";
  label: string;
  /** Boolean toggle (0/1). */
  toggle?: boolean;
  /** Requires this exact confirmation text in the API. */
  dangerous?: string;
}

const P = (
  key: string,
  id: number,
  vx: number,
  max: number,
  group: ProcessingParam["group"],
  label: string,
  extra: Partial<ProcessingParam> = {},
): ProcessingParam => ({ key, id, vx, max, group, label, ...extra });

export const PROCESSING: readonly ProcessingParam[] = [
  P("hpfEnable", 0x14, 0x00, 1, "hpf", "HPF in", { toggle: true }),
  P("hpfFreq", 0x13, 0x07, 127, "hpf", "HPF freq"),
  P("peqEnable", 0x11, 0x00, 1, "eq", "PEQ in", { toggle: true }),
  P("eqLowGain", 0x01, 0x07, 127, "eq", "LF gain"),
  P("eqLowFreq", 0x02, 0x07, 127, "eq", "LF freq"),
  P("eqLowWidth", 0x03, 0x07, 127, "eq", "LF width"),
  P("eqLowMidGain", 0x05, 0x07, 127, "eq", "LM gain"),
  P("eqLowMidFreq", 0x06, 0x07, 127, "eq", "LM freq"),
  P("eqLowMidWidth", 0x07, 0x07, 127, "eq", "LM width"),
  P("eqHighMidGain", 0x09, 0x07, 127, "eq", "HM gain"),
  P("eqHighMidFreq", 0x0a, 0x07, 127, "eq", "HM freq"),
  P("eqHighMidWidth", 0x0b, 0x07, 127, "eq", "HM width"),
  P("eqHighGain", 0x0d, 0x07, 127, "eq", "HF gain"),
  P("eqHighFreq", 0x0e, 0x07, 127, "eq", "HF freq"),
  P("eqHighWidth", 0x0f, 0x07, 127, "eq", "HF width"),
  P("gateEnable", 0x46, 0x00, 1, "gate", "Gate in", { toggle: true }),
  P("gateAttack", 0x41, 0x07, 127, "gate", "Gate attack"),
  P("gateRelease", 0x42, 0x07, 127, "gate", "Gate release"),
  P("gateHold", 0x43, 0x07, 127, "gate", "Gate hold"),
  P("gateThreshold", 0x44, 0x07, 127, "gate", "Gate threshold"),
  P("gateDepth", 0x45, 0x07, 127, "gate", "Gate depth"),
  P("compEnable", 0x68, 0x00, 1, "comp", "Comp in", { toggle: true }),
  P("compType", 0x61, 0x07, 3, "comp", "Comp type"),
  P("compAttack", 0x62, 0x07, 127, "comp", "Comp attack"),
  P("compRelease", 0x63, 0x07, 127, "comp", "Comp release"),
  P("compKnee", 0x64, 0x07, 1, "comp", "Comp knee"),
  P("compRatio", 0x65, 0x07, 127, "comp", "Comp ratio"),
  P("compThreshold", 0x66, 0x07, 127, "comp", "Comp threshold"),
  P("compGain", 0x67, 0x07, 127, "comp", "Comp gain"),
  P("preampGain", 0x19, 0x07, 127, "preamp", "Preamp gain"),
  P("phantom", 0x69, 0x07, 1, "preamp", "48V phantom", { toggle: true, dangerous: "ENABLE 48V" }),
  P("polarity", 0x6a, 0x07, 1, "preamp", "Polarity", { toggle: true }),
  P("delayEnable", 0x6d, 0x00, 1, "delay", "Delay in", { toggle: true }),
  P("delayTime", 0x6c, 0x07, 127, "delay", "Delay time"),
];

const PROC_BY_KEY = new Map(PROCESSING.map((p) => [p.key, p]));
const PROC_BY_ID = new Map(PROCESSING.map((p) => [`${p.id}:${p.vx}`, p]));
export const processingParam = (key: string) => PROC_BY_KEY.get(key);
export const processingParamById = (id: number, vx: number) => PROC_BY_ID.get(`${id}:${vx}`);

/** Strip families that processing commands are accepted for (V1: inputs and stereo inputs). */
export const PROCESSING_FAMILIES: readonly StripFamily[] = ["input", "stereo"];
