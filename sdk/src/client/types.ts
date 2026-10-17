import type { StripFamily } from "../protocol/catalog.js";

export type Role = "engineer" | "monitor";
export type MixerPhase = "offline" | "connecting" | "syncing" | "ready" | "error";

export interface User {
  username: string;
  role: Role;
  /** 0..6 for monitor accounts, null for engineers. */
  busIndex: number | null;
  enabled: boolean;
}

export interface StripState {
  address: number;
  label: string;
  family: StripFamily;
  /** Raw 0..127, or null until the console has reported it. */
  fader: number | null;
  muted: boolean | null;
}

export interface MixerSnapshot {
  phase: MixerPhase;
  message: string;
  firmware: string | null;
  host: string;
  updatedAt: number;
  scene: number | null;
  strips: StripState[];
  /** Keys are `${address}:${paramId}:${index}`; see paramKey() in the protocol module. */
  params: Record<string, number>;
}

export interface StateResponse {
  user: User;
  mixer: MixerSnapshot;
  /** Increments whenever the (role-filtered) state changes. */
  rev: number;
  /** Engineer only: monitor buses with more than one enabled musician. */
  sharedBuses?: number[];
}

export interface LoginResponse {
  user: User;
  token: string;
}

/** Persists the bearer token. Provide expo-secure-store in React Native; memory is the default. */
export interface TokenStorage {
  get(): Promise<string | null>;
  set(token: string | null): Promise<void>;
}

export class MemoryTokenStorage implements TokenStorage {
  private v: string | null = null;
  async get() { return this.v; }
  async set(t: string | null) { this.v = t; }
}

export class Qu32Error extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "Qu32Error";
  }
  get isAuth() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
  get isOffline() { return this.status === 409 || this.status === 503; }
}
