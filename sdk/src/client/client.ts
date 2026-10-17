import type { Command } from "../protocol/commands.js";
import { validateCommand } from "../protocol/commands.js";
import {
  MemoryTokenStorage, Qu32Error,
  type LoginResponse, type StateResponse, type TokenStorage, type User,
} from "./types.js";

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface Qu32ClientOptions {
  /** e.g. https://192.168.1.50:8443 */
  baseUrl: string;
  storage?: TokenStorage;
  fetch?: FetchLike;
  /** State polling interval in ms (default 700). */
  pollMs?: number;
  /** Minimum ms between throttled sends per control (default 40 => 25 msg/s). */
  throttleMs?: number;
}

export type ConnectionStatus = "idle" | "online" | "gateway-unreachable" | "unauthorized";

export interface ClientState {
  status: ConnectionStatus;
  data: StateResponse | null;
  error: string | null;
}

type Listener = (s: ClientState) => void;

/**
 * Qu32Client: login, live state (polling with revision check), and typed control intents.
 * It speaks only HTTPS to the gateway. It never talks MIDI or opens raw sockets.
 */
export class Qu32Client {
  readonly baseUrl: string;
  private storage: TokenStorage;
  private f: FetchLike;
  private token: string | null = null;
  private pollMs: number;
  private throttleMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private listeners = new Set<Listener>();
  private rev = -1;
  private _state: ClientState = { status: "idle", data: null, error: null };
  private pending = new Map<string, { cmd: Command; timer: ReturnType<typeof setTimeout> | null; last: number }>();

  constructor(opts: Qu32ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.storage = opts.storage ?? new MemoryTokenStorage();
    this.f = (opts.fetch ?? (globalThis as unknown as { fetch: FetchLike }).fetch).bind(globalThis);
    this.pollMs = opts.pollMs ?? 700;
    this.throttleMs = opts.throttleMs ?? 40;
  }

  get state(): ClientState { return this._state; }

  // ---------------------------------------------------------------- auth
  async login(username: string, password: string): Promise<User> {
    const r = await this.request<LoginResponse>("POST", "/api/login", { username, password }, false);
    this.token = r.token;
    await this.storage.set(r.token);
    this.rev = -1;
    return r.user;
  }

  /** Resume from a stored token. Returns null if none or expired. */
  async restore(): Promise<User | null> {
    this.token = await this.storage.get();
    if (!this.token) return null;
    try {
      const r = await this.request<{ user: User }>("GET", "/api/session");
      return r.user;
    } catch (e) {
      if (e instanceof Qu32Error && e.isAuth) return null;
      throw e;
    }
  }

  async logout(): Promise<void> {
    this.stop();
    try { if (this.token) await this.request("POST", "/api/logout", {}); } catch { /* ignore */ }
    await this.clearToken();
    this.publish({ status: "idle", data: null, error: null });
  }

  private async clearToken() {
    this.token = null;
    this.rev = -1;
    await this.storage.set(null);
  }

  // ---------------------------------------------------------------- state
  async refresh(): Promise<StateResponse> {
    const r = await this.request<StateResponse | { unchanged: true; rev: number }>("GET", `/api/state?since=${this.rev}`);
    if ("unchanged" in r) {
      if (this._state.status !== "online") this.publish({ ...this._state, status: "online", error: null });
      return this._state.data!;
    }
    this.rev = r.rev;
    this.publish({ status: "online", data: r, error: null });
    return r;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this._state);
    return () => this.listeners.delete(l);
  }

  /** Start polling. Safe to call twice. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.refresh();
      } catch (e) {
        if (e instanceof Qu32Error && e.isAuth) {
          await this.clearToken();
          this.publish({ status: "unauthorized", data: null, error: e.message });
          this.running = false;
          return;
        }
        this.publish({ ...this._state, status: "gateway-unreachable", error: (e as Error).message });
      }
      if (this.running) this.timer = setTimeout(tick, this.pollMs);
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
  }

  private publish(s: ClientState) {
    this._state = s;
    for (const l of this.listeners) l(s);
  }

  // ---------------------------------------------------------------- control
  /** Send one command now. Rejects with Qu32Error (403 forbidden, 409/503 console not ready). */
  async send(cmd: Command): Promise<void> {
    const err = validateCommand(cmd);
    if (err) throw new Qu32Error(err, 400);
    await this.request("POST", "/api/command", cmd);
  }

  /**
   * Fader-drag friendly send: coalesces to the latest value per control key,
   * at most one request per `throttleMs`. Call flush(key) on release.
   */
  sendThrottled(key: string, cmd: Command): void {
    const p = this.pending.get(key) ?? { cmd, timer: null, last: 0 };
    p.cmd = cmd;
    this.pending.set(key, p);
    if (p.timer) return;
    const wait = Math.max(0, p.last + this.throttleMs - Date.now());
    p.timer = setTimeout(() => {
      p.timer = null;
      p.last = Date.now();
      this.send(p.cmd).catch((e) => this.publish({ ...this._state, error: (e as Error).message }));
    }, wait);
  }

  // convenience wrappers
  setSendLevel(address: number, busIndex: number, value: number) { return this.send({ operation: "sendLevel", address, busIndex, value }); }
  setSendPan(address: number, busIndex: number, value: number) { return this.send({ operation: "sendPan", address, busIndex, value }); }
  setMonitorMaster(busIndex: number, value: number) { return this.send({ operation: "monitorMasterFader", busIndex, value }); }
  setMonitorMute(busIndex: number, muted: boolean) { return this.send({ operation: "monitorMasterMute", busIndex, muted }); }
  setFader(address: number, value: number) { return this.send({ operation: "stripFader", address, value }); }
  setMute(address: number, muted: boolean) { return this.send({ operation: "stripMute", address, muted }); }
  setProcessing(address: number, key: string, value: number, confirm?: string) {
    return this.send({ operation: "processing", address, key, value, ...(confirm ? { confirm } : {}) });
  }
  recallScene(scene: number) { return this.send({ operation: "sceneRecall", scene, confirm: `RECALL ${scene}` }); }

  // ---------------------------------------------------------------- admin (engineer)
  listUsers() { return this.request<{ users: User[] }>("GET", "/api/admin/users"); }
  createUser(username: string, password: string, busIndex: number) {
    return this.request<{ user: User }>("POST", "/api/admin/users", { username, password, busIndex });
  }
  updateUser(username: string, patch: { busIndex?: number; enabled?: boolean; password?: string }) {
    return this.request<{ user: User }>("POST", "/api/admin/user", { username, ...patch });
  }
  setMixerHost(host: string) { return this.request<{ ok: true; host: string }>("POST", "/api/admin/mixer", { host }); }
  changePassword(password: string) { return this.request<{ ok: true }>("POST", "/api/admin/password", { password }); }
  health() { return this.request<{ ok: true; name: string; version: string }>("GET", "/api/health", undefined, false); }

  // ---------------------------------------------------------------- http
  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { "X-Qu-Client": "qu32-mobile" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.f(this.baseUrl + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
      throw new Qu32Error(msg, res.status);
    }
    return data as T;
  }
}
