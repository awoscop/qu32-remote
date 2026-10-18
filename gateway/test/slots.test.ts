import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AudioBridge } from "../src/audio.js";
import { Auth } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { QuLink } from "../src/mixer.js";
import { MockQu } from "../src/mock-mixer.js";
import { createGateway, type Gateway } from "../src/server.js";
import { Slots } from "../src/slots.js";
import { Talkback } from "../src/talkback.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    await sleep(20);
  }
}

let mock: MockQu, dir: string, main: Gateway, musician: Gateway, link: QuLink, slots: Slots, auth: Auth;
let engBase: string, musBase: string;
const offers: Array<{ slot: number; sdp: string }> = [];
const bridge: AudioBridge = {
  offer: async (slot, sdp) => { offers.push({ slot, sdp }); return `v=0\r\nanswer-for-${slot}`; },
  hangup: () => {},
  streaming: () => false,
};

async function call(base: string, method: string, p: string, body?: unknown, token?: string) {
  const r = await fetch(base + p, {
    method,
    headers: { "X-Qu-Client": "qu32-web", ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null; try { json = await r.json(); } catch { /* html */ }
  return { status: r.status, json, res: r };
}
const join = (token: string, base = musBase) => call(base, "POST", "/api/join", { token });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "qu32-slots-"));
  mock = new MockQu();
  const mport = await mock.listen();
  const base = loadConfig({ QU32_DATA_DIR: dir, QU32_INSECURE_HTTP: "1", QU32_WEB_PORT: "0", QU32_BIND: "127.0.0.1" });
  auth = new Auth(dir);
  await auth.bootstrap("engineer-test-password");
  slots = new Slots(dir, auth);
  link = new QuLink({ host: "127.0.0.1", port: mport, allowedModels: [3], retryMs: 300 });
  main = createGateway(base, { auth, link, slots });
  musician = createGateway({ ...base, musicianOnly: true }, { auth, link, slots, audio: bridge });
  engBase = `http://127.0.0.1:${await main.listen()}`;
  musBase = `http://127.0.0.1:${await musician.listen()}`;
  link.start();
  await until(() => link.phase === "ready");
  slots.setCount(3);
});

afterAll(async () => {
  await musician.close();
  await main.close();
  await mock.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("QR slots", () => {
  it("only active slots can join, and each is locked to its own bus", async () => {
    const s1 = slots.get(1)!, s3 = slots.get(3)!, s5 = slots.get(5)!;
    const j1 = await join(s1.token);
    expect(j1.status).toBe(200);
    expect(j1.json.slot).toMatchObject({ id: 1, busIndex: 0, busName: "Mix 1", stereo: false });
    expect((await join(s5.token)).status).toBe(401); // inactive (count = 3)
    const j3 = await join(s3.token);
    expect(j3.json.slot).toMatchObject({ id: 3, busIndex: 2 });

    mock.received.length = 0;
    expect((await call(musBase, "POST", "/api/command", { operation: "sendLevel", address: 0x20, busIndex: 0, value: 50 }, j1.json.token)).status).toBe(200);
    await until(() => mock.received.some((e) => e.kind === "nrpn" && e.id === 0x20 && e.vx === 0 && e.va === 50));
    mock.received.length = 0;
    for (const cmd of [
      { operation: "sendLevel", address: 0x20, busIndex: 2, value: 50 },
      { operation: "monitorMasterFader", busIndex: 4, value: 50 },
      { operation: "stripFader", address: 0x20, value: 50 },
      { operation: "sceneRecall", scene: 1, confirm: "RECALL 1" },
    ]) expect((await call(musBase, "POST", "/api/command", cmd, j1.json.token)).status).toBe(403);
    await sleep(120);
    expect(mock.received).toEqual([]);
  });

  it("state for a slot hides everything outside its bus", async () => {
    const j = await join(slots.get(2)!.token);
    const st = await call(musBase, "GET", "/api/state?since=-1", undefined, j.json.token);
    expect(st.json.slot).toMatchObject({ id: 2 });
    const addrs: number[] = st.json.mixer.strips.map((s: any) => s.address);
    expect(addrs).toContain(0x61);
    for (const hidden of [0x60, 0x62, 0x63, 0x67]) expect(addrs).not.toContain(hidden);
    expect(st.json.mixer.host).toBe("");
  });

  it("exposes mix-assignment so the page can show only inputs sent to this mix", async () => {
    const j = await join(slots.get(2)!.token);
    expect(j.json.slot.showAll).toBe(false);
    const st = await call(musBase, "GET", "/api/state?since=-1", undefined, j.json.token);
    const p = st.json.mixer.params as Record<string, number>;
    expect(p["32:85:1"]).toBe(1); // CH 1 assigned to Mix 2
    expect(p["35:85:1"]).toBe(0); // CH 4 not assigned
    expect(p["32:85:0"]).toBeUndefined(); // never another mix
    slots.update(2, { showAll: true });
    expect((await join(slots.get(2)!.token)).json.slot.showAll).toBe(true);
    slots.update(2, { showAll: false });
  });

  it("clamps sends to the slot's level ceiling", async () => {
    slots.update(1, { ceiling: 0x40 });
    const j = await join(slots.get(1)!.token);
    mock.received.length = 0;
    await call(musBase, "POST", "/api/command", { operation: "sendLevel", address: 0x21, busIndex: 0, value: 120 }, j.json.token);
    await until(() => mock.received.some((e) => e.kind === "nrpn" && e.ch === 0x21 && e.id === 0x20 && e.va === 0x40));
    slots.update(1, { ceiling: 0x72 });
  });

  it("regenerating a QR kills the old code and the live session", async () => {
    const old = slots.get(2)!.token;
    const j = await join(old);
    expect((await call(musBase, "GET", "/api/state", undefined, j.json.token)).status).toBe(200);
    const fresh = slots.regenerate(2).token;
    expect(fresh).not.toBe(old);
    expect((await call(musBase, "GET", "/api/state", undefined, j.json.token)).status).toBe(401);
    expect((await join(old)).status).toBe(401);
    expect((await join(fresh)).status).toBe(200);
  });

  it("disabling a slot or lowering the count drops its sessions", async () => {
    const j = await join(slots.get(3)!.token);
    slots.update(3, { enabled: false });
    expect((await call(musBase, "GET", "/api/state", undefined, j.json.token)).status).toBe(401);
    slots.update(3, { enabled: true });
    const k = await join(slots.get(3)!.token);
    const oldToken = slots.get(3)!.token;
    slots.setCount(2);
    expect((await call(musBase, "GET", "/api/state", undefined, k.json.token)).status).toBe(401);
    expect((await join(oldToken)).status).toBe(401);
    expect(slots.get(3)!.token).not.toBe(oldToken);
    slots.setCount(3);
  });

  it("reports which phones are connected", async () => {
    slots.regenerate(1);
    const j = await join(slots.get(1)!.token);
    await call(musBase, "GET", "/api/state", undefined, j.json.token);
    expect(slots.connected(1)).toBe(true);
    expect(slots.connected(4)).toBe(false);
  });

  it("validates slot settings", () => {
    expect(() => slots.setCount(8)).toThrow();
    expect(() => slots.update(1, { name: "x".repeat(41) })).toThrow();
    expect(() => slots.update(1, { ceiling: 200 })).toThrow();
    expect(() => slots.update(1, { usbChannel: 0 })).toThrow();
    expect(slots.update(1, { name: "Drums", usbChannel: 4 })).toMatchObject({ name: "Drums", usbChannel: 4 });
  });
});

describe("musician-only (HTTP) port", () => {
  it("exposes no login, admin, CA or engineer access", async () => {
    expect((await call(musBase, "POST", "/api/login", { username: "engineer", password: "engineer-test-password" })).status).toBe(404);
    expect((await call(musBase, "GET", "/api/admin/users")).status).toBe(404);
    const eng = await call(engBase, "POST", "/api/login", { username: "engineer", password: "engineer-test-password" });
    expect(eng.status).toBe(200);
    expect((await call(musBase, "GET", "/api/state", undefined, eng.json.token)).status).toBe(403);
  });

  it("serves the monitor page for well-formed tokens only", async () => {
    const ok = await fetch(`${musBase}/m/${slots.get(1)!.token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/text\/html/);
    expect(ok.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await ok.text()).toContain("My Monitor");
    expect((await fetch(`${musBase}/m/short`)).status).toBe(404);
  });
});

describe("audio signalling", () => {
  it("passes a slot's offer to the audio bridge and refuses engineers / bad SDP", async () => {
    const j = await join(slots.get(1)!.token);
    const r = await call(musBase, "POST", "/api/audio/offer", { sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n" }, j.json.token);
    expect(r.status).toBe(200);
    expect(r.json.sdp).toContain("answer-for-1");
    expect(offers.at(-1)?.slot).toBe(1);
    expect((await call(musBase, "POST", "/api/audio/offer", { sdp: "not sdp" }, j.json.token)).status).toBe(400);
  });

  it("reports 501 when no audio engine is attached", async () => {
    const j = await join(slots.get(1)!.token, engBase);
    const r = await call(engBase, "POST", "/api/audio/offer", { sdp: "v=0\r\n" }, j.json.token);
    expect(r.status).toBe(501);
  });
});

describe("talkback", () => {
  it("raises only the chosen mixes and zeroes every bus on release", async () => {
    const tb = new Talkback(link);
    mock.received.length = 0;
    expect(tb.start([0, 2])).toBe(true);
    await until(() => mock.received.filter((e) => e.kind === "nrpn" && e.ch === 0x3f && e.id === 0x20).length === 7);
    const sends = mock.received.filter((e) => e.kind === "nrpn" && e.ch === 0x3f && e.id === 0x20) as Array<{ vx: number; va: number }>;
    expect(sends.filter((e) => e.va === 0x62).map((e) => e.vx).sort()).toEqual([0, 2]);
    expect(sends.filter((e) => e.va === 0).length).toBe(5);
    mock.received.length = 0;
    tb.stop();
    await until(() => mock.received.filter((e) => e.kind === "nrpn" && e.va === 0 && e.ch === 0x3f).length === 7);
    expect(tb.active).toBe(false);
  });

  it("refuses to start when the console is not ready and auto-releases after the cap", async () => {
    const dead = new Talkback(new QuLink({ host: "", port: 1, allowedModels: [3] }));
    expect(dead.start([0])).toBe(false);
    const tb = new Talkback(link, { strip: 0x3f, level: 0x62, maxMs: 100 });
    tb.start([1]);
    await until(() => !tb.active, 1000);
  });
});

describe("token guessing (runs last: it exhausts this IP's allowance)", () => {
  it("throttles guessing of QR tokens", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 13; i++) codes.push((await join("x".repeat(22))).status);
    expect(codes.at(-1)).toBe(429);
  });

});
