import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { Auth, AuthError } from "./auth.js";
import { ensureTls } from "./cert.js";
import type { Config } from "./config.js";
import type { AudioBridge } from "./audio.js";
import { QuLink } from "./mixer.js";
import type { Slots } from "./slots.js";
import { authorize, filterSnapshot } from "./policy.js";
import { encodeCommand, MONITOR_BUSES, type Command, type User } from "./qu.js";

const MAX_BODY = 16 * 1024;
const CMD_PER_SEC = 35;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface Gateway {
  server: http.Server | https.Server;
  link: QuLink;
  auth: Auth;
  listen(): Promise<number>;
  close(): Promise<void>;
}

const MONITOR_PAGE = new URL("../web/monitor.html", import.meta.url);
const MUSICIAN_PATHS = new Set(["/api/health", "/api/join", "/api/session", "/api/logout", "/api/state", "/api/command", "/api/audio/offer", "/api/audio/hangup"]);

export function createGateway(cfg: Config, deps: { auth: Auth; link: QuLink; slots?: Slots; audio?: AudioBridge; ownsLink?: boolean }): Gateway {
  const { auth, link, slots, audio } = deps;
  const buckets = new Map<string, { t: number; n: number }>();
  const settingsFile = path.join(cfg.dataDir, "settings.json");
  const auditFile = path.join(cfg.dataDir, "audit.log");

  const audit = (u: User, what: Record<string, unknown>) => {
    try { fs.appendFileSync(auditFile, JSON.stringify({ t: new Date().toISOString(), user: u.username, ...what }) + "\n"); } catch { /* never block control on logging */ }
  };

  const rateOk = (user: string): boolean => {
    const now = Date.now();
    const b = buckets.get(user);
    if (!b || now - b.t >= 1000) { buckets.set(user, { t: now, n: 1 }); return true; }
    return ++b.n <= CMD_PER_SEC;
  };

  const send = (res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    const s = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(s),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    });
    res.end(s);
  };

  const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return reject(new HttpError(415, "Content-Type must be application/json"));
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, "Body too large")); req.destroy(); } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
          resolve(v as Record<string, unknown>);
        } catch { reject(new HttpError(400, "Invalid JSON")); }
      });
      req.on("error", reject);
    });

  const token = (req: http.IncomingMessage): string | null => {
    const h = req.headers.authorization ?? "";
    return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
  };

  async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    const method = req.method ?? "GET";
    const p = url.pathname;
    const ip = req.socket.remoteAddress ?? "?";

    if (method === "GET" && p === "/ca.crt" && !cfg.insecureHttp) {
      const f = path.join(cfg.dataDir, "qu32-local-ca.crt");
      res.writeHead(200, { "Content-Type": "application/x-x509-ca-cert", "Content-Disposition": 'attachment; filename="qu32-local-ca.crt"' });
      res.end(fs.readFileSync(f));
      return;
    }
    if (method === "GET" && /^\/m\/[A-Za-z0-9_-]{16,64}$/.test(p) && slots) {
      const html = fs.readFileSync(MONITOR_PAGE);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:",
      });
      res.end(html);
      return;
    }
    if (!p.startsWith("/api/")) throw new HttpError(404, "Not found");
    if (cfg.musicianOnly && !MUSICIAN_PATHS.has(p)) throw new HttpError(404, "Not found");
    if (method === "GET" && p === "/api/health") return send(res, 200, { ok: true, name: "qu32-gateway", version: "0.1.0" });

    if (method === "POST" && !["qu32-mobile", "qu32-web"].includes(String(req.headers["x-qu-client"]))) throw new HttpError(400, "Missing X-Qu-Client header");

    if (method === "POST" && p === "/api/join") {
      if (!slots) throw new HttpError(404, "Not found");
      if (auth.blocked(ip)) throw new HttpError(429, "Too many failed attempts. Try again later.");
      const b = await readJson(req);
      const j = slots.join(b.token);
      if (!j) { auth.noteFailure(ip); throw new HttpError(401, "This QR code is no longer valid. Ask the sound engineer for a new one."); }
      const bus = MONITOR_BUSES[j.user.busIndex!]!;
      return send(res, 200, { token: j.token, user: j.user, slot: { id: j.slot.id, name: j.slot.name, busIndex: bus.busIndex, busName: bus.name, stereo: bus.stereo, showAll: j.slot.showAll } });
    }

    if (method === "POST" && p === "/api/login") {
      if (cfg.musicianOnly) throw new HttpError(404, "Not found");
      const b = await readJson(req);
      const r = await auth.login(b.username, b.password, ip);
      return send(res, 200, r);
    }

    const tok = token(req);
    const user = auth.verify(tok);
    if (!user) throw new HttpError(401, "Sign in required");
    if (cfg.musicianOnly && user.role === "engineer") throw new HttpError(403, "Engineer access is not available on this port");
    const slot = slots?.slotOf(user.username);
    if (slot) slots!.touch(slot.id);

    if (method === "GET" && p === "/api/session") return send(res, 200, { user });
    if (method === "POST" && p === "/api/logout") { auth.logout(tok!); return send(res, 200, { ok: true }); }

    if (method === "GET" && p === "/api/state") {
      const since = Number(url.searchParams.get("since"));
      if (since === link.rev) return send(res, 200, { unchanged: true, rev: link.rev });
      return send(res, 200, { user, mixer: filterSnapshot(user, link.snapshot()), rev: link.rev, ...(slot ? { slot: { id: slot.id, name: slot.name, showAll: slot.showAll } } : {}), ...(user.role === "engineer" ? { sharedBuses: auth.sharedBuses() } : {}) });
    }

    if (method === "POST" && p === "/api/command") {
      const body = await readJson(req);
      const d = authorize(user, body);
      if (!d.ok) { audit(user, { denied: true, command: body }); throw new HttpError(d.status, d.error); }
      if (link.phase !== "ready") throw new HttpError(link.phase === "offline" || link.phase === "error" ? 503 : 409, `Console not ready (${link.message})`);
      if (!rateOk(user.username)) throw new HttpError(429, "Too many commands");
      let cmd: Command = d.command;
      if (slot && (cmd.operation === "sendLevel" || cmd.operation === "monitorMasterFader")) cmd = { ...cmd, value: Math.min(cmd.value, slot.ceiling) };
      const bytes = encodeCommand(cmd, link.n);
      if (!link.send(bytes)) throw new HttpError(503, "Console not ready");
      link.applyOptimistic(cmd);
      audit(user, { command: cmd });
      return send(res, 200, { ok: true });
    }

    if (p === "/api/audio/offer" || p === "/api/audio/hangup") {
      if (!slot) throw new HttpError(403, "Audio is available to monitor slots only");
      if (!audio) throw new HttpError(501, "Audio streaming is not available on this gateway");
      if (method !== "POST") throw new HttpError(405, "POST required");
      if (p === "/api/audio/hangup") { audio.hangup(slot.id); return send(res, 200, { ok: true }); }
      const b = await readJson(req);
      if (typeof b.sdp !== "string" || b.sdp.length > 30_000 || !b.sdp.startsWith("v=0")) throw new HttpError(400, "Invalid SDP");
      try { return send(res, 200, { sdp: await audio.offer(slot.id, b.sdp) }); }
      catch (e) { throw new HttpError(503, `Audio unavailable: ${(e as Error).message}`); }
    }

    // ---- engineer only
    if (p.startsWith("/api/admin/")) {
      if (user.role !== "engineer") throw new HttpError(403, "Engineer access required");
      if (method === "GET" && p === "/api/admin/users") return send(res, 200, { users: auth.list(), sharedBuses: auth.sharedBuses() });
      const b = await readJson(req);
      if (method === "POST" && p === "/api/admin/users") return send(res, 200, { user: await auth.create(b.username, b.password, b.busIndex) });
      if (method === "POST" && p === "/api/admin/user") return send(res, 200, { user: await auth.update(b.username, b) });
      if (method === "POST" && p === "/api/admin/mixer") {
        if (typeof b.host !== "string" || !IPV4.test(b.host)) throw new HttpError(400, "host must be an IPv4 address");
        fs.writeFileSync(settingsFile, JSON.stringify({ mixerHost: b.host }), { mode: 0o600 });
        link.setHost(b.host);
        return send(res, 200, { ok: true, host: b.host });
      }
      if (method === "POST" && p === "/api/admin/password") {
        await auth.setPassword(user.username, b.password);
        return send(res, 200, { ok: true, relogin: true });
      }
    }
    throw new HttpError(404, "Not found");
  }

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    route(req, res).catch((e: unknown) => {
      if (e instanceof HttpError || e instanceof AuthError) return send(res, e.status, { error: e.message });
      console.error("[gateway] unexpected error:", e);
      send(res, 500, { error: "Internal error" });
    });
  };

  const server = cfg.insecureHttp
    ? http.createServer(handler)
    : https.createServer(
        (() => { const t = ensureTls(cfg.dataDir, cfg.lanIp, cfg.openssl); return { key: t.key, cert: t.cert, minVersion: "TLSv1.2" as const }; })(),
        handler,
      );

  return {
    server, link, auth,
    listen: () => new Promise((resolve) => server.listen(cfg.port, cfg.bind, () => resolve((server.address() as { port: number }).port))),
    close: () => new Promise((resolve) => { if (deps.ownsLink !== false) link.stop(); server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}

export function loadSavedHost(cfg: Config): string {
  try { return (JSON.parse(fs.readFileSync(path.join(cfg.dataDir, "settings.json"), "utf8")) as { mixerHost?: string }).mixerHost ?? ""; } catch { return ""; }
}
