import { describe, expect, it } from "vitest";
import {
  ADDRESS, QuParser, decodeSysex, dbToLevel, encodeCommand, fader, formatDb, levelToDb, mute, nameRequest,
  nrpn, sceneRecall, sendLevel, sendPan, systemStateRequest, validateCommand, UNITY,
} from "@qu32/sdk/protocol";

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, "0")).join(" ");

describe("encoders (golden vectors from Qu MIDI Protocol V1.9)", () => {
  it("mute on/off", () => {
    expect(hex(mute(0, 0x20, true))).toBe("90 20 7f 90 20 00");
    expect(hex(mute(2, 0x67, false))).toBe("92 67 3f 92 67 00");
  });
  it("fader CH1 at 0 dB", () => {
    expect(hex(fader(0, ADDRESS.input(1), UNITY))).toBe("b0 63 20 b0 62 17 b0 06 62 b0 26 07");
  });
  it("send level CH1 -> Mix 5-6", () => {
    expect(hex(sendLevel(0, 0x20, 4, 0x42))).toBe("b0 63 20 b0 62 20 b0 06 42 b0 26 04");
  });
  it("pan on Mix 7-8", () => {
    expect(hex(sendPan(1, 0x21, 5, 0x25))).toBe("b1 63 21 b1 62 16 b1 06 25 b1 26 05");
  });
  it("scene recall uses bank 1 + program change", () => {
    expect(hex(sceneRecall(0, 1))).toBe("b0 00 00 b0 20 00 c0 00");
    expect(hex(sceneRecall(0, 100))).toBe("b0 00 00 b0 20 00 c0 63");
  });
  it("sysex requests", () => {
    expect(hex(systemStateRequest(1))).toBe("f0 00 00 1a 50 11 01 00 7f 10 01 f7");
    expect(hex(nameRequest(0, 0x20))).toBe("f0 00 00 1a 50 11 01 00 00 01 20 f7");
  });
  it("rejects out-of-range values", () => {
    expect(() => nrpn(0, 0x20, 0x17, 200, 7)).toThrow(RangeError);
    expect(() => sceneRecall(0, 101)).toThrow(RangeError);
  });
});

describe("parser", () => {
  it("assembles NRPN across arbitrary chunk boundaries", () => {
    const p = new QuParser();
    const bytes = fader(0, 0x20, 0x55);
    const ev = [...p.push(bytes.slice(0, 4)), ...p.push(bytes.slice(4, 9)), ...p.push(bytes.slice(9))];
    expect(ev).toEqual([{ kind: "nrpn", n: 0, ch: 0x20, id: 0x17, va: 0x55, vx: 0x07 }]);
  });
  it("parses mute, program change, active sense", () => {
    const p = new QuParser();
    const ev = p.push([0xfe, ...mute(0, 0x21, true), 0xc0, 0x04]);
    expect(ev).toEqual([
      { kind: "activeSense" },
      { kind: "mute", n: 0, ch: 0x21, on: true },
      { kind: "program", n: 0, program: 4 },
    ]);
    expect(p.push(mute(0, 0x21, false))).toEqual([{ kind: "mute", n: 0, ch: 0x21, on: false }]);
  });
  it("handles real-time bytes inside a message and running status", () => {
    const p = new QuParser();
    const ev = p.push([0xb0, 0x63, 0x20, 0xfe, 0x62, 0x17, 0x06, 0x40, 0x26, 0x07]);
    expect(ev.filter((e) => e.kind === "nrpn")).toHaveLength(1);
  });
  it("decodes system state, end sync and names", () => {
    const p = new QuParser();
    const hdr = [0x00, 0x00, 0x1a, 0x50, 0x11, 0x01, 0x00, 0x00];
    const ev = p.push([0xf0, ...hdr, 0x11, 3, 1, 9, 0xf7, 0xf0, ...hdr, 0x14, 0xf7, 0xf0, ...hdr, 0x02, 0x20, ...Buffer.from("Lead Vox"), 0xf7]);
    const msgs = ev.map((e) => (e.kind === "sysex" ? decodeSysex(e.data) : null));
    expect(msgs[0]).toEqual({ type: "systemState", n: 0, boxId: 3, major: 1, minor: 9 });
    expect(msgs[1]).toEqual({ type: "endSync", n: 0 });
    expect(msgs[2]).toEqual({ type: "name", n: 0, ch: 0x20, name: "Lead Vox" });
  });
  it("flush emits an NRPN that never got its LSB", () => {
    const p = new QuParser();
    expect(p.push([0xb0, 0x63, 0x20, 0xb0, 0x62, 0x11, 0xb0, 0x06, 0x01])).toEqual([]);
    expect(p.flush()).toEqual([{ kind: "nrpn", n: 0, ch: 0x20, id: 0x11, va: 1, vx: 0 }]);
  });
});

describe("levels", () => {
  it("matches official table points", () => {
    expect(levelToDb(0x62)).toBe(0);
    expect(levelToDb(0x7f)).toBe(10);
    expect(levelToDb(0x3f)).toBe(-10);
    expect(levelToDb(0)).toBe(-Infinity);
    expect(dbToLevel(0)).toBe(0x62);
    expect(dbToLevel(-10)).toBe(0x3f);
    expect(formatDb(0x62)).toBe("0.0 dB");
    expect(formatDb(0)).toBe("-inf");
  });
});

describe("command validation", () => {
  it("accepts good commands and encodes them", () => {
    const c = { operation: "sendLevel", address: 0x20, busIndex: 4, value: 42 } as const;
    expect(validateCommand(c)).toBeNull();
    expect(hex(encodeCommand(c, 0))).toBe("b0 63 20 b0 62 20 b0 06 2a b0 26 04");
  });
  it("rejects bad addresses, buses and values", () => {
    expect(validateCommand({ operation: "sendLevel", address: 0x67, busIndex: 0, value: 1 })).toMatch(/send source/);
    expect(validateCommand({ operation: "sendLevel", address: 0x20, busIndex: 9, value: 1 })).toMatch(/busIndex/);
    expect(validateCommand({ operation: "sendLevel", address: 0x20, busIndex: 0, value: 128 })).toMatch(/0\.\.127/);
    expect(validateCommand({ operation: "sendPan", address: 0x20, busIndex: 0, value: 10 })).toMatch(/stereo/);
    expect(validateCommand({ operation: "nope" })).toMatch(/Unknown/);
  });
  it("requires exact confirmation for scenes and phantom", () => {
    expect(validateCommand({ operation: "sceneRecall", scene: 3, confirm: "yes" })).toMatch(/RECALL 3/);
    expect(validateCommand({ operation: "sceneRecall", scene: 3, confirm: "RECALL 3" })).toBeNull();
    expect(validateCommand({ operation: "processing", address: 0x20, key: "phantom", value: 1 })).toMatch(/ENABLE 48V/);
    expect(validateCommand({ operation: "processing", address: 0x20, key: "phantom", value: 0 })).toBeNull();
    expect(validateCommand({ operation: "processing", address: 0x20, key: "hpfFreq", value: 20 })).toBeNull();
  });
});
