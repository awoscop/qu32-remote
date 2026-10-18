import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Auth } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { QuLink } from "../src/mixer.js";
import { MockQu } from "../src/mock-mixer.js";
import { createGateway, type Gateway } from "../src/server.js";
import { Qu32Client, Qu32Error, type StateResponse } from "../../sdk/src/index.js";

const ENG_PW = "engineer-test-password";
const MUS_PW = "musician-test-password";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => T | Promise<T>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    await sleep(25);
  }
}

let mock: MockQu;
let gw: Gateway;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "qu32-test-"));
  mock = new MockQu();
  const mport = await mock.listen();
  const cfg = { ...loadConfig({ QU32_DATA_DIR: dir, QU32_INSECURE_HTTP: "1", QU32_WEB_PORT: "0", QU32_BIND: "127.0.0.1" }) };
  const auth = new Auth(dir);
  await auth.bootstrap(ENG_PW);
  const link = new QuLink({ host: "127.0.0.1", port: mport, allowedModels: [3], retryMs: 300 });
  gw = createGateway(cfg, { auth, link });
  base = `http://127.0.0.1:${await gw.listen()}`;
  link.start();
});

afterAll(async () => {
  await gw.close();
  await mock.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const client = () => new Qu32Client({ baseUrl: base });
const state = async (c: Qu32Client): Promise<StateResponse> => c.refresh();
const status = async (fn: () => Promise<unknown>): Promise<number> => {
  try { await fn(); return 200; } catch (e) { if (e instanceof Qu32Error) return e.status; throw e; }
};

describe("gateway with simulated Qu-32", () => {
  let eng: Qu32Client;

  it("syncs with the console and reports firmware", async () => {
    eng = client();
    await eng.login("engineer", ENG_PW);
    const s = await until(async () => { const r = await state(eng); return r.mixer.phase === "ready" ? r : null; });
    expect(s.mixer.firmware).toBe("1.09");
    expect(s.mixer.strips.find((x) => x.address === 0x20)?.fader).toBe(0x62);
    await until(async () => (await state(eng)).mixer.strips.find((x) => x.address === 0x20)?.label === "Mock CH 1");
  });

  it("rejects bad credentials, missing header and anonymous access", async () => {
    expect(await status(() => client().login("engineer", "wrong-password-123"))).toBe(401);
    expect((await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(400);
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it("engineer commands reach the console as correct MIDI", async () => {
    mock.received.length = 0;
    await eng.setFader(0x20, 0x55);
    await until(() => mock.received.some((e) => e.kind === "nrpn" && e.ch === 0x20 && e.id === 0x17 && e.va === 0x55 && e.vx === 7));
    await eng.setMute(0x21, true);
    await until(() => mock.received.some((e) => e.kind === "mute" && e.ch === 0x21 && e.on));
    await eng.recallScene(7);
    await until(() => mock.received.some((e) => e.kind === "program" && e.program === 6));
  });

  it("reflects changes made on the desk", async () => {
    mock.moveFader(0x22, 0x31);
    await until(async () => (await state(eng)).mixer.strips.find((x) => x.address === 0x22)?.fader === 0x31);
  });

  it("validates and rejects malformed commands", async () => {
    expect(await status(() => eng.send({ operation: "sceneRecall", scene: 3, confirm: "nope" }))).toBe(400);
    const r = await fetch(`${base}/api/command`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Qu-Client": "qu32-mobile", Authorization: `Bearer ${(eng as unknown as { token: string }).token}` },
      body: JSON.stringify({ operation: "rawMidi", bytes: [144, 32, 127] }),
    });
    expect(r.status).toBe(400);
  });

  describe("musician account", () => {
    let mus: Qu32Client;

    it("is created by the engineer with password hashed on disk", async () => {
      const { user } = await eng.createUser("singer", MUS_PW, 4);
      expect(user).toMatchObject({ role: "monitor", busIndex: 4 });
      const disk = fs.readFileSync(path.join(dir, "accounts.json"), "utf8");
      expect(disk).not.toContain(MUS_PW);
      expect(disk).not.toContain(ENG_PW);
      expect(await status(() => eng.createUser("short", "tiny", 1))).toBe(400);
      mus = client();
      await mus.login("singer", MUS_PW);
    });

    it("can change only its own bus", async () => {
      mock.received.length = 0;
      await mus.setSendLevel(0x20, 4, 42);
      await mus.setSendPan(0x20, 4, 10);
      await mus.setMonitorMaster(4, 0x50);
      await until(() => mock.received.some((e) => e.kind === "nrpn" && e.id === 0x20 && e.vx === 4 && e.va === 42));
      await until(() => mock.received.some((e) => e.kind === "nrpn" && e.id === 0x16 && e.vx === 4 && e.va === 10));
      await until(() => mock.received.some((e) => e.kind === "nrpn" && e.ch === 0x64 && e.id === 0x17 && e.va === 0x50));
    });

    it("is refused everything else with 403 and nothing reaches the console", async () => {
      mock.received.length = 0;
      expect(await status(() => mus.setSendLevel(0x20, 0, 10))).toBe(403); // other bus
      expect(await status(() => mus.setMonitorMaster(2, 10))).toBe(403);
      expect(await status(() => mus.setSendPan(0x20, 5, 10))).toBe(403); // other stereo bus
      expect(await status(() => mus.setFader(0x20, 10))).toBe(403);
      expect(await status(() => mus.setMute(0x20, true))).toBe(403);
      expect(await status(() => mus.setFader(0x67, 0))).toBe(403); // Main LR
      expect(await status(() => mus.setProcessing(0x20, "hpfFreq", 20))).toBe(403);
      expect(await status(() => mus.recallScene(1))).toBe(403);
      expect(await status(() => mus.listUsers())).toBe(403);
      expect(await status(() => mus.setMixerHost("10.0.0.9"))).toBe(403);
      expect(await status(() => mus.createUser("evil.user", "another-long-password", 0))).toBe(403);
      await sleep(150);
      expect(mock.received).toEqual([]);
    });

    it("only sees its own bus (no Main LR, other mixes, host or scene)", async () => {
      const m = (await state(mus)).mixer;
      expect(m.host).toBe("");
      expect(m.scene).toBeNull();
      const addrs = m.strips.map((s) => s.address);
      expect(addrs).toContain(0x64); // own master
      for (const hidden of [0x60, 0x61, 0x63, 0x65, 0x67]) expect(addrs).not.toContain(hidden);
      for (const k of Object.keys(m.params)) {
        const [ch, id, vx] = k.split(":").map(Number);
        const isOwnMaster = ch === 0x64 && id === 0x17;
        const isOwnSend = (id === 0x20 || id === 0x16 || id === 0x55) && vx === 4;
        expect(isOwnMaster || isOwnSend).toBe(true);
      }
      expect(m.strips.filter((s) => s.address >= 0x20 && s.address < 0x40).every((s) => s.fader === null && s.muted === null)).toBe(true);
    });

    it("loses access immediately when reassigned or disabled", async () => {
      await eng.updateUser("singer", { busIndex: 2 });
      expect(await status(() => mus.refresh())).toBe(401);
      const again = client();
      await again.login("singer", MUS_PW);
      expect(await status(() => again.setSendLevel(0x20, 4, 1))).toBe(403);
      expect(await status(() => again.setSendLevel(0x20, 2, 1))).toBe(200);
      await eng.updateUser("singer", { enabled: false });
      expect(await status(() => again.refresh())).toBe(401);
      expect(await status(() => client().login("singer", MUS_PW))).toBe(401);
    });
  });

  it("throttles repeated login failures per source", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push(await status(() => client().login("nobody", "wrong-wrong-wrong")));
    // earlier tests already used up some of this IP's 10 allowed failures
    expect(codes.every((c) => c === 401 || c === 429)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    expect(codes.indexOf(429)).toBeGreaterThan(0);
  });

  it("locks controls when the console drops, and re-syncs without replaying commands", async () => {
    mock.dropClient();
    await until(async () => (await state(eng)).mixer.phase !== "ready");
    expect(await status(() => eng.setFader(0x20, 1))).toBeGreaterThanOrEqual(409);
    await until(async () => (await state(eng)).mixer.phase === "ready", 8000);
    mock.received.length = 0;
    await sleep(200);
    expect(mock.received.filter((e) => e.kind === "nrpn" && e.id === 0x17 && e.va === 1)).toEqual([]);
  });
});

describe("link safety", () => {
  it("refuses a device that is not a Qu-32", async () => {
    const other = new MockQu({ boxId: 1 }); // Qu-16
    const port = await other.listen();
    const link = new QuLink({ host: "127.0.0.1", port, allowedModels: [3], retryMs: 60_000 });
    link.start();
    await until(() => link.phase === "error");
    expect(link.message).toMatch(/not a Qu-32/);
    expect(link.send([0x90, 0x20, 0x7f])).toBe(false);
    link.stop();
    await other.close();
  });

  it("never writes before ready", () => {
    const link = new QuLink({ host: "", port: 1, allowedModels: [3] });
    expect(link.send([0xfe])).toBe(false);
  });
});
