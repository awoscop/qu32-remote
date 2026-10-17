import os from "node:os";
import path from "node:path";

export interface Config {
  dataDir: string;
  port: number;
  bind: string;
  mixerHost: string;
  mixerPort: number;
  lanIp: string;
  /** Plain HTTP. For local development and automated tests only. */
  insecureHttp: boolean;
  /** Qu box ids accepted in the System State reply (3 = Qu-32). */
  allowedModels: number[];
  openssl: string;
}

function detectLanIp(): string {
  const all = Object.values(os.networkInterfaces()).flatMap((l) => l ?? []).filter((i) => i.family === "IPv4" && !i.internal);
  const isPrivate = (a: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  // prefer RFC1918 LAN addresses; never pick link-local 169.254.x.x unless nothing else exists
  return (all.find((i) => isPrivate(i.address)) ?? all.find((i) => !i.address.startsWith("169.254.")) ?? all[0])?.address ?? "127.0.0.1";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dataDir: path.resolve(env.QU32_DATA_DIR ?? ".qu32-private"),
    port: Number(env.QU32_WEB_PORT ?? 8443),
    bind: env.QU32_BIND ?? "0.0.0.0",
    mixerHost: env.QU32_MIXER_IP ?? "",
    mixerPort: Number(env.QU32_MIXER_PORT ?? 51325),
    lanIp: env.QU32_LAN_IP ?? detectLanIp(),
    insecureHttp: env.QU32_INSECURE_HTTP === "1",
    allowedModels: (env.QU32_ALLOWED_MODELS ?? "3").split(",").map(Number),
    openssl: env.QU32_OPENSSL ?? "openssl",
  };
}
