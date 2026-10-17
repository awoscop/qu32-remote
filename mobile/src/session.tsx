import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Qu32Client, type ClientState, type MixerSnapshot, type TokenStorage, type User } from "@qu32/sdk";

const TOKEN_KEY = "qu32.token";
const URL_KEY = "qu32.gateway";

const tokenStorage: TokenStorage = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY),
  set: (t) => (t ? SecureStore.setItemAsync(TOKEN_KEY, t) : SecureStore.deleteItemAsync(TOKEN_KEY)),
};

interface Ctx {
  booting: boolean;
  client: Qu32Client | null;
  user: User | null;
  gatewayUrl: string;
  conn: ClientState;
  mixer: MixerSnapshot | null;
  /** Controls may only be used when the gateway is reachable AND the console is synced. */
  canControl: boolean;
  sharedBuses: number[];
  signIn(url: string, username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);
export const useSession = (): Ctx => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside provider");
  return c;
};

export function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  if (/^http:\/\//i.test(u)) throw new Error("Use https:// (plain HTTP is not allowed)");
  if (!/:\d+$/.test(u)) u += ":8443";
  return u;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [client, setClient] = useState<Qu32Client | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [conn, setConn] = useState<ClientState>({ status: "idle", data: null, error: null });
  const unsub = useRef<(() => void) | null>(null);

  const attach = useCallback((c: Qu32Client) => {
    unsub.current?.();
    unsub.current = c.subscribe((s) => {
      setConn(s);
      if (s.status === "unauthorized") setUser(null);
    });
    c.start();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const url = await SecureStore.getItemAsync(URL_KEY);
        if (url) {
          setGatewayUrl(url);
          const c = new Qu32Client({ baseUrl: url, storage: tokenStorage });
          const u = await c.restore().catch(() => null);
          if (u) { setClient(c); setUser(u); attach(c); }
        }
      } finally {
        setBooting(false);
      }
    })();
    return () => unsub.current?.();
  }, [attach]);

  const signIn = useCallback(async (rawUrl: string, username: string, password: string) => {
    const url = normalizeUrl(rawUrl);
    const c = new Qu32Client({ baseUrl: url, storage: tokenStorage });
    try {
      const u = await c.login(username.trim(), password);
      await SecureStore.setItemAsync(URL_KEY, url);
      setGatewayUrl(url);
      setClient(c);
      setUser(u);
      attach(c);
    } catch (e) {
      const m = (e as Error).message;
      if (/Network request failed|Failed to fetch/i.test(m)) {
        throw new Error("Cannot reach the gateway. Check Wi-Fi and the address. If the address is right, the phone may not trust the gateway certificate yet (install the QU32 CA).");
      }
      throw e;
    }
  }, [attach]);

  const signOut = useCallback(async () => {
    unsub.current?.();
    unsub.current = null;
    await client?.logout();
    setUser(null);
    setClient(null);
    setConn({ status: "idle", data: null, error: null });
  }, [client]);

  const value = useMemo<Ctx>(() => {
    const mixer = conn.data?.mixer ?? null;
    const sharedBuses = conn.data?.sharedBuses ?? [];
    return {
      booting, client, user, gatewayUrl, conn, mixer, sharedBuses,
      canControl: conn.status === "online" && mixer?.phase === "ready",
      signIn, signOut,
    };
  }, [booting, client, user, gatewayUrl, conn, signIn, signOut]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
