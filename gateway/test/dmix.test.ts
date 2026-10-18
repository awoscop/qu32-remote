import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { DEFAULT_LEVEL, DEFAULT_MAX, DigitalMix, parseShow, ShowStore } from "../src/dmix.js";
import { QuLink } from "../src/mixer.js";
import { MockQu } from "../src/mock-mixer.js";
import { createGateway, type Gateway } from "../src/server.js";
import { Slots } from "../src/slots.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | Promise<T>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timeout"); await sleep(20); }
}

describe("DigitalMix", () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "qu32-dmix-")); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("assigns channels with safe defaults and clamps musician changes", () => {
    const m = new DigitalMix(dir);
    m.assign(1, 3, true); m.assign(1, 1, true); m.assign(1, 3, true);
    expect(m.get(1).channels.map((c) => c.input)).toEqual([1, 3]); // sorted, no duplicates
    expect(m.get(1).channels[0]).toMatchObject({ level: DEFAULT_LEVEL, max: DEFAULT_MAX, locked: false });
    m.userSet(1, "level", 1, 127);
    expect(m.get(1).channels[0]!.level).toBe(DEFAULT_MAX); // clamped to the engineer's cap
    m.userSet(1, "level", 1, 40);
    expect(m.get(1).channels[0]!.level).toBe(40);
    expect(() => m.userSet(1, "level", 9, 10)).toThrow(/not in your mix/);
    m.setChannel(1, 3, { locked: true });
    expect(() => m.userSet(1, "level", 3, 10)).toThrow(/locked/);
    m.setChannel(1, 1, { max: 50 });
    expect(m.get(1).channels[0]!.level).toBe(40);
    m.setChannel(1, 1, { max: 30 });
    expect(m.get(1).channels[0]!.level).toBe(30); // lowering the cap pulls the level down
    expect(() => m.userSet(1, "level", 1, 128)).toThrow();
    expect(() => m.userSet(1, "pan", 1, 99)).toThrow();
    expect(() => m.assign(8, 1, true)).toThrow();
    expect(() => m.assign(1, 33, true)).toThrow();
  });

  it("round-trips shows and survives a restart (autosave)", async () => {
    const m = new DigitalMix(dir);
    m.assign(2, 5, true); m.userSet(2, "master", null, 90); m.rename(2, "Drums");
    m.flush();
    const again = new DigitalMix(dir);
    expect(again.get(2).master).toBe(90);
    expect(again.get(2).channels.map((c) => c.input)).toEqual([5]);
    expect(again.get(2).name).toBe("Drums");
  });

  it("loads a different show over the current one", () => {
    const m = new DigitalMix(dir);
    m.assign(1, 1, true);
    const a = m.toShow("Sunday");
    m.assign(1, 2, true);
    m.assign(3, 7, true);
    const b = m.toShow("Youth night");
    m.load(a);
    expect(m.get(1).channels.map((c) => c.input)).toEqual([1]);
    expect(m.get(3).channels).toEqual([]);
    expect(m.showName).toBe("Sunday");
    m.load(b);
    expect(m.get(1).channels.map((c) => c.input)).toEqual([1, 2]);
    expect(m.dirty).toBe(false);
  });
});

describe("show files", () => {
  const good = () => ({
    format: "qu32-show", version: 1, name: "Sunday", savedAt: new Date().toISOString(),
    musicians: [{ slotId: 1, name: "Drums", master: 98, muted: false, channels: [{ input: 1, level: 60, pan: 37, max: 114, locked: false }] }],
  });

  it("accepts a valid show and rejects hostile or broken ones", () => {
    expect(parseShow(good()).musicians[0]!.channels[0]!.input).toBe(1);
    const bad = (mut: (s: any) => void) => { const s: any = good(); mut(s); return () => parseShow(s); };
    expect(bad((s) => { s.format = "other"; })).toThrow(/Not a QU32/);
    expect(bad((s) => { s.version = 2; })).toThrow(/version/);
    expect(bad((s) => { s.musicians[0].channels.push({ ...s.musicians[0].channels[0] }); })).toThrow(/duplicate input/);
    expect(bad((s) => { s.musicians[0].channels[0].level = 200; })).toThrow(/invalid values/);
    expect(bad((s) => { s.musicians[0].channels[0].input = 40; })).toThrow(/bad or duplicate/);
    expect(bad((s) => { s.musicians = Array.from({ length: 8 }, (_, i) => ({ ...good().musicians[0], slotId: i + 1 })); })).toThrow(/at most 7/);
    expect(bad((s) => { s.name = ""; })).toThrow(/name/);
    expect(() => parseShow("nope")).toThrow();
    expect(parseShow({ ...good(), musicians: [{ ...good().musicians[0], channels: [{ input: 1, level: 120, pan: 37, max: 50, locked: false }] }] }).musicians[0]!.channels[0]!.level).toBe(50);
  });

  it("stores, lists, loads and deletes shows, and refuses path tricks", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "qu32-shows-"));
    const store = new ShowStore(d);
    const file = store.save(parseShow(good()));
    expect(store.list().map((s) => s.name)).toEqual(["Sunday"]);
    expect(store.load(file).name).toBe("Sunday");
    expect(() => store.load("../../etc/passwd")).toThrow(/Invalid/);
    expect(() => store.remove("..\\x.qu32show.json")).toThrow(/Invalid/);
    fs.writeFileSync(path.join(store.dir, "broken.qu32show.json"), "{not json");
    expect(store.list()).toHaveLength(1); // a corrupt file never breaks the list
    store.remove(file);
    expect(store.list()).toHaveLength(0);
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe("personal mix over the musician API", () => {
  let mock: MockQu, dir: string, gw: Gateway, link: QuLink, slots: Slots, mix: DigitalMix, base: string;

  async function call(method: string, p: string, body?: unknown, token?: string) {
    const r = await fetch(base + p, { method, headers: { "X-Qu-Client": "qu32-web", ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json: any = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  }
  const join = (id: number) => call("POST", "/api/join", { token: slots.get(id)!.token });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qu32-dmixapi-"));
    mock = new MockQu();
    const mport = await mock.listen();
    const cfg = { ...loadConfig({ QU32_DATA_DIR: dir, QU32_INSECURE_HTTP: "1", QU32_WEB_PORT: "0", QU32_BIND: "127.0.0.1" }), musicianOnly: true };
    const auth = new Auth(dir);
    await auth.bootstrap("engineer-test-password");
    slots = new Slots(dir, auth);
    mix = new DigitalMix(dir);
    link = new QuLink({ host: "127.0.0.1", port: mport, allowedModels: [3], retryMs: 300 });
    gw = createGateway(cfg, { auth, link, slots, mix });
    base = `http://127.0.0.1:${await gw.listen()}`;
    link.start();
    await until(() => link.phase === "ready");
    slots.setCount(3);
    mix.assign(1, 1, true); mix.assign(1, 2, true);
    mix.assign(2, 3, true);
    mix.setChannel(1, 2, { locked: true });
  });
  afterAll(async () => { await gw.close(); await mock.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("slots default to the digital mix and see only their assigned channels", async () => {
    const j = await join(1);
    expect(j.json.slot.mode).toBe("digital");
    await until(async () => (await call("GET", "/api/state?since=-1", undefined, j.json.token)).json.dmix?.channels[0]?.name === "Mock CH 1");
    const st = await call("GET", "/api/state?since=-1", undefined, j.json.token);
    expect(st.json.dmix.channels.map((c: any) => c.input)).toEqual([1, 2]);
    const other = await join(2);
    const st2 = await call("GET", "/api/state?since=-1", undefined, other.json.token);
    expect(st2.json.dmix.channels.map((c: any) => c.input)).toEqual([3]);
  });

  it("lets a musician move their own unlocked channels and master, within the engineer's cap", async () => {
    const j = await join(1);
    expect((await call("POST", "/api/dmix", { op: "level", input: 1, value: 70 }, j.json.token)).status).toBe(200);
    expect(mix.get(1).channels.find((c) => c.input === 1)!.level).toBe(70);
    await call("POST", "/api/dmix", { op: "level", input: 1, value: 127 }, j.json.token);
    expect(mix.get(1).channels.find((c) => c.input === 1)!.level).toBe(DEFAULT_MAX);
    expect((await call("POST", "/api/dmix", { op: "pan", input: 1, value: 10 }, j.json.token)).status).toBe(200);
    expect((await call("POST", "/api/dmix", { op: "master", value: 80 }, j.json.token)).status).toBe(200);
    expect((await call("POST", "/api/dmix", { op: "mute", value: true }, j.json.token)).status).toBe(200);
    expect(mix.get(1)).toMatchObject({ master: 80, muted: true });
  });

  it("refuses locked, unassigned, other-musician and malformed changes", async () => {
    const j = await join(1);
    const before = JSON.stringify(mix.get(2));
    expect((await call("POST", "/api/dmix", { op: "level", input: 2, value: 5 }, j.json.token)).status).toBe(400); // locked
    expect((await call("POST", "/api/dmix", { op: "level", input: 3, value: 5 }, j.json.token)).status).toBe(400); // slot 2's channel
    expect((await call("POST", "/api/dmix", { op: "level", input: 1, value: -1 }, j.json.token)).status).toBe(400);
    expect((await call("POST", "/api/dmix", { op: "explode" }, j.json.token)).status).toBe(400);
    expect((await call("POST", "/api/dmix", { op: "level", slotId: 2, input: 3, value: 99 }, j.json.token)).status).toBe(400); // slotId is never trusted
    expect(JSON.stringify(mix.get(2))).toBe(before);
    expect((await call("POST", "/api/dmix", { op: "master", value: 1 })).status).toBe(401);
  });

  it("revision changes when the engineer loads another show, so phones refresh", async () => {
    const j = await join(1);
    const first = (await call("GET", "/api/state?since=-1", undefined, j.json.token)).json;
    expect((await call("GET", `/api/state?since=${first.rev}`, undefined, j.json.token)).json.unchanged).toBe(true);
    const s = mix.toShow("Other");
    s.musicians[0]!.channels = s.musicians[0]!.channels.filter((c) => c.input === 1);
    mix.load(s);
    const next = (await call("GET", `/api/state?since=${first.rev}`, undefined, j.json.token)).json;
    expect(next.unchanged).toBeUndefined();
    expect(next.dmix.channels.map((c: any) => c.input)).toEqual([1]);
  });

  it("a desk-mix slot cannot use the personal mix API", async () => {
    slots.update(3, { mode: "desk" });
    const j = await join(3);
    expect(j.json.slot.mode).toBe("desk");
    expect((await call("POST", "/api/dmix", { op: "master", value: 50 }, j.json.token)).status).toBe(409);
    const st = await call("GET", "/api/state?since=-1", undefined, j.json.token);
    expect(st.json.dmix).toBeUndefined();
  });

  it("switching a slot's mode signs its phone out", async () => {
    const j = await join(2);
    slots.update(2, { mode: "desk" });
    expect((await call("GET", "/api/state", undefined, j.json.token)).status).toBe(401);
    slots.update(2, { mode: "digital" });
  });
});
