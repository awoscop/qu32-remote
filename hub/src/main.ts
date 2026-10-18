import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, ipcMain, session, shell } from "electron";
import QRCode from "qrcode";
import type { AudioBridge } from "../../gateway/dist/audio.js";
import { Auth } from "../../gateway/dist/auth.js";
import { loadConfig, type Config } from "../../gateway/dist/config.js";
import { QuLink } from "../../gateway/dist/mixer.js";
import { createGateway, type Gateway } from "../../gateway/dist/server.js";
import { Slots } from "../../gateway/dist/slots.js";
import { Talkback } from "../../gateway/dist/talkback.js";
import { MONITOR_BUSES } from "../../sdk/dist/protocol/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(here, "..", "renderer");

// WebRTC: advertise real LAN addresses (not mDNS aliases) so phones can reach the hub.
app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.env.QU32_FAKE_MEDIA === "1") {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}
if (process.env.QU32_DATA_DIR) app.setPath("userData", path.resolve(process.env.QU32_DATA_DIR, "electron"));

interface Settings {
  mixerHost: string;
  lanIp: string;
  httpPort: number;
  httpsPort: number;
  usbInId: string;
  usbOutId: string;
  micId: string;
  returnChannel: number;
  talkStrip: number;
  talkLevel: number;
}
const DEFAULTS: Settings = { mixerHost: "", lanIp: "", httpPort: 8080, httpsPort: 8443, usbInId: "", usbOutId: "", micId: "", returnChannel: 32, talkStrip: 0x3f, talkLevel: 0x62 };

let settingsFile = "";
let settings: Settings = { ...DEFAULTS };
const saveSettings = () => fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

const privateIps = (): string[] =>
  Object.values(os.networkInterfaces()).flatMap((l) => l ?? [])
    .filter((i) => i.family === "IPv4" && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))
    .map((i) => i.address);

// ---------------------------------------------------------------- audio engine RPC
let audioWin: BrowserWindow | null = null;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
let engineStatus: { inputChannels: number; missing: number[]; levels: Record<number, number>; streaming: Record<number, boolean>; error: string | null; talkError: string | null; ready: boolean } =
  { inputChannels: 0, missing: [], levels: {}, streaming: {}, error: null, talkError: null, ready: false };

function rpc<T>(method: string, args: unknown = {}, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!audioWin || audioWin.isDestroyed()) return reject(new Error("Audio engine is not running"));
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Audio engine timed out (${method})`)); }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    audioWin.webContents.send("audio:cmd", id, method, args);
  });
}
ipcMain.on("audio:reply", (_e, id: string, ok: boolean, value: unknown) => {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  if (ok) p.resolve(value); else p.reject(new Error(String(value)));
});
ipcMain.on("audio:status", (_e, s: typeof engineStatus) => { engineStatus = { ...engineStatus, ...s, ready: true }; });

const bridge: AudioBridge = {
  offer: (slotId, sdp) => rpc<string>("offer", { slotId, sdp }),
  hangup: (slotId) => { void rpc("hangup", { slotId }).catch(() => {}); },
  streaming: (slotId) => !!engineStatus.streaming[slotId],
};

// ---------------------------------------------------------------- core services
let auth: Auth, slots: Slots, link: QuLink, talkback: Talkback, baseCfg: Config;
let httpGw: Gateway | null = null, httpsGw: Gateway | null = null;
let firstPassword: string | null = null;
const errors: string[] = [];
let httpsInfo = "starting";

const pushError = (m: string) => { if (!errors.includes(m)) errors.push(m); };

async function listen(gw: Gateway): Promise<number> {
  return new Promise((resolve, reject) => { gw.server.once("error", reject); gw.listen().then(resolve, reject); });
}

async function startHttp(): Promise<void> {
  const cfg: Config = { ...baseCfg, port: settings.httpPort, insecureHttp: true, musicianOnly: true, bind: "0.0.0.0" };
  httpGw = createGateway(cfg, { auth, link, slots, audio: bridge, ownsLink: false });
  try { await listen(httpGw); } catch (e) { pushError(`Musician port ${settings.httpPort} could not start: ${(e as Error).message}`); httpGw = null; }
}

async function startHttps(): Promise<void> {
  if (httpsGw) { await httpsGw.close(); httpsGw = null; }
  const cfg: Config = { ...baseCfg, port: settings.httpsPort, insecureHttp: false, musicianOnly: false, bind: "0.0.0.0", lanIp: settings.lanIp || privateIps()[0] || "127.0.0.1" };
  try {
    const gw = createGateway(cfg, { auth, link, slots, ownsLink: false });
    await listen(gw);
    httpsGw = gw;
    httpsInfo = `https://${cfg.lanIp}:${settings.httpsPort}`;
  } catch (e) {
    httpsInfo = "off";
    const m = (e as Error).message;
    pushError(/openssl|ENOENT/i.test(m) ? "Engineer phone app (HTTPS) is off: OpenSSL was not found. Install Git for Windows or OpenSSL." : `Engineer HTTPS port could not start: ${m}`);
  }
}

// ---------------------------------------------------------------- UI state
const qrCache = new Map<string, string>();
async function qr(url: string): Promise<string> {
  let q = qrCache.get(url);
  if (!q) {
    q = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240, color: { dark: "#0B1421", light: "#FFFFFF" } });
    qrCache.set(url, q);
  }
  return q;
}

async function uiState() {
  const lanIp = settings.lanIp || privateIps()[0] || "";
  const base = `http://${lanIp}:${settings.httpPort}`;
  const snap = link.snapshot();
  const active = await Promise.all(slots.active().map(async (s) => {
    const bus = MONITOR_BUSES[s.id - 1]!;
    const url = `${base}/m/${s.token}`;
    return {
      id: s.id, name: s.name, enabled: s.enabled, ceiling: s.ceiling, usbChannel: s.usbChannel,
      bus: bus.name, stereo: bus.stereo, url, qr: lanIp ? await qr(url) : "",
      connected: slots.connected(s.id), streaming: !!engineStatus.streaming[s.id], level: engineStatus.levels[s.id] ?? 0,
    };
  }));
  return {
    lanIp, lanIps: privateIps(), baseUrl: base, httpsUrl: httpsInfo,
    mixer: { phase: snap.phase, message: snap.message, firmware: snap.firmware, host: link.host },
    count: slots.count, slots: active,
    engine: engineStatus, errors,
    firstPassword,
    settings: { usbInId: settings.usbInId, usbOutId: settings.usbOutId, micId: settings.micId, returnChannel: settings.returnChannel, talkStrip: settings.talkStrip, talkLevel: settings.talkLevel },
    talk: { active: talkback.active, buses: talkback.buses },
  };
}

function usbMapping() {
  return slots.active().map((s) => ({ slotId: s.id, channel: s.usbChannel, stereo: MONITOR_BUSES[s.id - 1]!.stereo }));
}

async function applyAudio(): Promise<void> {
  try {
    await rpc("configure", { inputId: settings.usbInId, outputId: settings.usbOutId, micId: settings.micId, returnChannel: settings.returnChannel, mapping: usbMapping() }, 20_000);
  } catch (e) {
    engineStatus = { ...engineStatus, error: (e as Error).message };
  }
}

function registerIpc() {
  ipcMain.handle("hub:getState", () => uiState());
  ipcMain.handle("hub:setCount", async (_e, n: number) => { slots.setCount(n); await applyAudio(); });
  ipcMain.handle("hub:updateSlot", async (_e, id: number, patch: Record<string, unknown>) => { slots.update(id, patch); if ("usbChannel" in patch) await applyAudio(); });
  ipcMain.handle("hub:regenerate", (_e, id: number) => { slots.regenerate(id); void rpc("hangup", { slotId: id }).catch(() => {}); });
  ipcMain.handle("hub:setMixerHost", (_e, host: string) => {
    if (!/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host)) throw new Error("Enter an IPv4 address like 192.168.1.60");
    settings.mixerHost = host; saveSettings(); link.setHost(host);
  });
  ipcMain.handle("hub:setLanIp", async (_e, ip: string) => { settings.lanIp = ip; saveSettings(); await startHttps(); });
  ipcMain.handle("hub:resetEngineerPassword", async () => {
    const pw = crypto.randomBytes(12).toString("base64url");
    await auth.setPassword("engineer", pw);
    return pw;
  });
  ipcMain.handle("hub:dismissFirstPassword", () => { firstPassword = null; });
  ipcMain.handle("hub:audioDevices", () => rpc("devices", {}, 20_000));
  ipcMain.handle("hub:setAudio", async (_e, patch: Partial<Settings>) => {
    for (const k of ["usbInId", "usbOutId", "micId"] as const) if (typeof patch[k] === "string") settings[k] = patch[k]!;
    if (Number.isInteger(patch.returnChannel) && patch.returnChannel! >= 1 && patch.returnChannel! <= 32) settings.returnChannel = patch.returnChannel!;
    saveSettings();
    await applyAudio();
  });
  ipcMain.handle("hub:setTalkback", (_e, patch: { strip?: number; level?: number }) => {
    if (Number.isInteger(patch.strip) && patch.strip! >= 0x20 && patch.strip! <= 0x3f) settings.talkStrip = patch.strip!;
    if (Number.isInteger(patch.level) && patch.level! >= 0 && patch.level! <= 127) settings.talkLevel = patch.level!;
    talkback.cfg.strip = settings.talkStrip; talkback.cfg.level = settings.talkLevel;
    saveSettings();
  });
  ipcMain.handle("hub:talk", async (_e, on: boolean, buses: number[]) => {
    if (!on) { talkback.stop(); await rpc("talk", { on: false }).catch(() => {}); return { ok: true }; }
    if (!talkback.start(buses)) return { ok: false, error: "The console is not ready, or no mix was selected." };
    try { await rpc("talk", { on: true }); } catch (e) { talkback.stop(); return { ok: false, error: (e as Error).message }; }
    return { ok: true };
  });
  ipcMain.handle("hub:copy", (_e, text: string) => { clipboard.writeText(String(text)); });
  ipcMain.handle("hub:openDataFolder", () => shell.openPath(path.join(app.getPath("userData"), "data")));
}

// ---------------------------------------------------------------- windows
let mainWin: BrowserWindow | null = null;

function createWindows() {
  audioWin = new BrowserWindow({
    show: false, width: 400, height: 300,
    webPreferences: { preload: path.join(rendererDir, "audio-preload.cjs"), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  void audioWin.loadFile(path.join(rendererDir, "audio.html"));

  mainWin = new BrowserWindow({
    width: 1180, height: 860, minWidth: 900, minHeight: 640, backgroundColor: "#0B1421", title: "QU32 Hub",
    webPreferences: { preload: path.join(rendererDir, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  mainWin.setMenuBarVisibility(false);
  void mainWin.loadFile(path.join(rendererDir, "index.html"));
  mainWin.on("blur", () => { if (talkback.active) { talkback.stop(); void rpc("talk", { on: false }).catch(() => {}); } });
  mainWin.on("closed", () => app.quit());
  mainWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

async function boot() {
  const data = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(data, { recursive: true });
  settingsFile = path.join(app.getPath("userData"), "hub-settings.json");
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) }; } catch { /* first run */ }
  if (process.env.QU32_HTTP_PORT) settings.httpPort = Number(process.env.QU32_HTTP_PORT);
  if (process.env.QU32_WEB_PORT) settings.httpsPort = Number(process.env.QU32_WEB_PORT);
  if (process.env.QU32_MIXER_IP) settings.mixerHost = process.env.QU32_MIXER_IP;

  baseCfg = loadConfig({ ...process.env, QU32_DATA_DIR: data });
  auth = new Auth(data);
  firstPassword = await auth.bootstrap(process.env.QU32_ENGINEER_PASSWORD);
  slots = new Slots(data, auth);
  if (slots.count === 0 && process.env.QU32_SLOTS === undefined) slots.setCount(2);
  if (process.env.QU32_SLOTS) slots.setCount(Number(process.env.QU32_SLOTS));
  link = new QuLink({ host: settings.mixerHost, port: Number(process.env.QU32_MIXER_PORT ?? 51325), allowedModels: baseCfg.allowedModels });
  talkback = new Talkback(link, { strip: settings.talkStrip, level: settings.talkLevel, maxMs: 60_000 });
  talkback.onChange = (active) => { if (!active) void rpc("talk", { on: false }).catch(() => {}); };

  registerIpc();
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  await startHttp();
  await startHttps();
  link.start();
  createWindows();
  if (process.env.QU32_DUMP) {
    // diagnostics for automated checks: periodic state dump + one screenshot of the admin window
    const dump = process.env.QU32_DUMP;
    setInterval(async () => { try { const st = await uiState(); fs.writeFileSync(dump, JSON.stringify({ ...st, slots: st.slots.map((x) => ({ ...x, qr: x.qr ? "(png)" : "" })) }, null, 2)); } catch { /* ignore */ } }, 500);
    setTimeout(async () => { try { fs.writeFileSync(dump + ".png", (await mainWin!.webContents.capturePage()).toPNG()); } catch { /* ignore */ } }, Number(process.env.QU32_SHOT_MS ?? 6000));
  }
  if (process.env.QU32_SELFTEST) {
    const out = process.env.QU32_SELFTEST;
    setTimeout(async () => {
      const r: Record<string, unknown> = {};
      try {
        const d = await rpc<{ inputs: { id: string }[]; outputs: { id: string }[] }>("devices", {}, 20_000);
        r.devices = { inputs: d.inputs.length, outputs: d.outputs.length };
        settings.micId = d.inputs[0]?.id ?? ""; settings.usbOutId = d.outputs[0]?.id ?? ""; settings.returnChannel = 2;
        await applyAudio();
        await new Promise((x) => setTimeout(x, 800));
        r.engineAfterApply = { error: engineStatus.error, talkError: engineStatus.talkError };
        const key = `${settings.talkStrip}:32:`;
        talkback.start([0, 2]);
        await rpc("talk", { on: true });
        await new Promise((x) => setTimeout(x, 400));
        const p = link.snapshot().params;
        r.whileTalking = { active: talkback.active, bus0: p[key + "0"], bus1: p[key + "1"], bus2: p[key + "2"] };
        talkback.stop();
        await rpc("talk", { on: false });
        const p2 = link.snapshot().params;
        r.afterRelease = { active: talkback.active, bus0: p2[key + "0"], bus2: p2[key + "2"] };
        r.ok = true;
      } catch (e) { r.error = (e as Error).message; }
      fs.writeFileSync(out, JSON.stringify(r, null, 2));
    }, 4000);
  }
  // push saved audio config once the engine page has loaded
  audioWin!.webContents.once("did-finish-load", () => { setTimeout(() => { void applyAudio(); }, 500); });
}

// Fail-safe: talkback sends are zeroed whenever the hub quits.
async function shutdown() {
  try { talkback?.stop(); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 200));
  try { link?.stop(); } catch { /* ignore */ }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(boot).catch((e) => { console.error(e); app.quit(); });
  app.on("window-all-closed", () => app.quit());
  let quitting = false;
  app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    // give the zeroing talkback writes a moment to leave the socket before exiting
    void shutdown().then(() => setTimeout(() => app.exit(0), 250));
  });
}
