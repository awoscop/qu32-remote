import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isMonitorBus, type Role, type User } from "./qu.js";

interface Account extends User {
  salt: string;
  hash: string;
  createdAt: number;
}

const SESSION_MS = 8 * 3600_000;
const USERNAME = /^[a-z0-9._-]{2,32}$/;

const scrypt = (pw: string, salt: Buffer): Promise<Buffer> =>
  new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

export class AuthError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Accounts on disk (scrypt hashes), sessions in memory (SHA-256 of token). */
export class Auth {
  private accounts = new Map<string, Account>();
  private sessions = new Map<string, { username: string; expires: number; virtual?: User }>();
  /** Set by the slot store: is this virtual (QR) user still valid? */
  virtualCheck: (username: string) => boolean = () => false;
  private failures = new Map<string, number[]>();
  private file: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = path.join(dataDir, "accounts.json");
    if (fs.existsSync(this.file)) {
      for (const a of JSON.parse(fs.readFileSync(this.file, "utf8")) as Account[]) this.accounts.set(a.username, a);
    }
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.accounts.values()], null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  private async hash(pw: string): Promise<{ salt: string; hash: string }> {
    const salt = crypto.randomBytes(16);
    return { salt: salt.toString("hex"), hash: (await scrypt(pw, salt)).toString("hex") };
  }

  private static checkPassword(pw: unknown): string {
    if (typeof pw !== "string" || pw.length < 12 || pw.length > 128) throw new AuthError("Password must be 12-128 characters", 400);
    return pw;
  }

  /** Creates the first engineer if none exists. Returns the generated password ONCE, else null. */
  async bootstrap(initialPassword?: string): Promise<string | null> {
    if ([...this.accounts.values()].some((a) => a.role === "engineer")) return null;
    const pw = initialPassword ?? crypto.randomBytes(12).toString("base64url");
    Auth.checkPassword(pw);
    this.accounts.set("engineer", { username: "engineer", role: "engineer", busIndex: null, enabled: true, createdAt: Date.now(), ...(await this.hash(pw)) });
    this.save();
    return pw;
  }

  async login(username: unknown, password: unknown, ip: string): Promise<{ user: User; token: string }> {
    const now = Date.now();
    const recent = (this.failures.get(ip) ?? []).filter((t) => now - t < 600_000);
    if (recent.length >= 10) throw new AuthError("Too many failed attempts. Try again later.", 429);
    const acct = typeof username === "string" ? this.accounts.get(username.trim().toLowerCase()) : undefined;
    const salt = acct ? Buffer.from(acct.salt, "hex") : Buffer.alloc(16);
    const got = await scrypt(typeof password === "string" ? password.slice(0, 128) : "", salt);
    const ok = !!acct && acct.enabled && crypto.timingSafeEqual(got, Buffer.from(acct.hash, "hex"));
    if (!ok) {
      recent.push(now);
      this.failures.set(ip, recent);
      throw new AuthError("Invalid username or password", 401);
    }
    this.failures.delete(ip);
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(Auth.digest(token), { username: acct!.username, expires: now + SESSION_MS });
    return { user: Auth.pub(acct!), token };
  }

  /** Source-IP throttle shared by password and QR-token attempts. */
  blocked(ip: string): boolean {
    return (this.failures.get(ip) ?? []).filter((t) => Date.now() - t < 600_000).length >= 10;
  }
  noteFailure(ip: string): void {
    const now = Date.now();
    this.failures.set(ip, [...(this.failures.get(ip) ?? []).filter((t) => now - t < 600_000), now]);
  }

  private static digest = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
  private static pub = (a: Account): User => ({ username: a.username, role: a.role, busIndex: a.busIndex, enabled: a.enabled });

  /** Open a session for a QR slot user (no password; the QR token was the credential). */
  openVirtualSession(user: User, ttlMs = 12 * 3600_000): string {
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(Auth.digest(token), { username: user.username, expires: Date.now() + ttlMs, virtual: user });
    return token;
  }

  /** Resolve a bearer token to a live, enabled user (or null). */
  verify(token: string | null | undefined): User | null {
    if (!token) return null;
    const k = Auth.digest(token);
    const s = this.sessions.get(k);
    if (!s) return null;
    if (s.virtual) {
      if (s.expires < Date.now() || !this.virtualCheck(s.username)) { this.sessions.delete(k); return null; }
      return s.virtual;
    }
    const a = this.accounts.get(s.username);
    if (s.expires < Date.now() || !a || !a.enabled) { this.sessions.delete(k); return null; }
    return Auth.pub(a);
  }

  logout(token: string): void { this.sessions.delete(Auth.digest(token)); }

  revoke(username: string): void {
    for (const [k, s] of this.sessions) if (s.username === username) this.sessions.delete(k);
  }

  list(): User[] { return [...this.accounts.values()].map(Auth.pub); }

  async create(username: unknown, password: unknown, busIndex: unknown): Promise<User> {
    const u = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!USERNAME.test(u)) throw new AuthError("Username must be 2-32 chars: a-z 0-9 . _ -", 400);
    if (this.accounts.has(u)) throw new AuthError("Username already exists", 409);
    if (!isMonitorBus(busIndex)) throw new AuthError("busIndex must be 0..6", 400);
    const pw = Auth.checkPassword(password);
    const a: Account = { username: u, role: "monitor" as Role, busIndex, enabled: true, createdAt: Date.now(), ...(await this.hash(pw)) };
    this.accounts.set(u, a);
    this.save();
    return Auth.pub(a);
  }

  /** Edit a musician. Any change revokes the user's live sessions. */
  async update(username: unknown, patch: { busIndex?: unknown; enabled?: unknown; password?: unknown }): Promise<User> {
    const a = typeof username === "string" ? this.accounts.get(username) : undefined;
    if (!a) throw new AuthError("No such user", 404);
    if (a.role === "engineer") throw new AuthError("Use the password endpoint for the engineer account", 400);
    if (patch.busIndex !== undefined) {
      if (!isMonitorBus(patch.busIndex)) throw new AuthError("busIndex must be 0..6", 400);
      a.busIndex = patch.busIndex;
    }
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== "boolean") throw new AuthError("enabled must be boolean", 400);
      a.enabled = patch.enabled;
    }
    if (patch.password !== undefined) Object.assign(a, await this.hash(Auth.checkPassword(patch.password)));
    this.save();
    this.revoke(a.username);
    return Auth.pub(a);
  }

  async setPassword(username: string, password: unknown): Promise<void> {
    const a = this.accounts.get(username);
    if (!a) throw new AuthError("No such user", 404);
    Object.assign(a, await this.hash(Auth.checkPassword(password)));
    this.save();
    this.revoke(username);
  }

  /** Musicians sharing one bus share its master. Used for UI warnings. */
  sharedBuses(): number[] {
    const count = new Map<number, number>();
    for (const a of this.accounts.values()) if (a.role === "monitor" && a.enabled && a.busIndex !== null) count.set(a.busIndex, (count.get(a.busIndex) ?? 0) + 1);
    return [...count].filter(([, n]) => n > 1).map(([b]) => b);
  }
}
