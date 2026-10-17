import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
  /** PUBLIC CA certificate; safe to install on phones. */
  caCertPath: string;
}

/**
 * Local CA + gateway leaf certificate via the openssl CLI.
 * The CA key never leaves dataDir. The leaf is reissued when the LAN IP changes.
 */
export function ensureTls(dataDir: string, lanIp: string, openssl = "openssl"): TlsMaterial {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const p = (f: string) => path.join(dataDir, f);
  const run = (...args: string[]) => execFileSync(openssl, args, { stdio: ["ignore", "pipe", "pipe"] });

  if (!fs.existsSync(p("qu32-local-ca.key")) || !fs.existsSync(p("qu32-local-ca.crt"))) {
    run("genrsa", "-out", p("qu32-local-ca.key"), "2048");
    run("req", "-x509", "-new", "-key", p("qu32-local-ca.key"), "-sha256", "-days", "3650", "-subj", "/CN=QU32 Local CA", "-out", p("qu32-local-ca.crt"));
  }

  const sanFile = p("gateway.san");
  const san = `DNS:localhost,IP:127.0.0.1${lanIp === "127.0.0.1" ? "" : `,IP:${lanIp}`}`;
  if (!fs.existsSync(p("gateway.crt")) || !fs.existsSync(p("gateway.key")) || !fs.existsSync(sanFile) || fs.readFileSync(sanFile, "utf8") !== san) {
    run("genrsa", "-out", p("gateway.key"), "2048");
    run("req", "-new", "-key", p("gateway.key"), "-subj", "/CN=QU32 Gateway", "-out", p("gateway.csr"));
    fs.writeFileSync(p("gateway.ext"), `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
    run("x509", "-req", "-in", p("gateway.csr"), "-CA", p("qu32-local-ca.crt"), "-CAkey", p("qu32-local-ca.key"), "-CAcreateserial",
      "-out", p("gateway.crt"), "-days", "800", "-sha256", "-extfile", p("gateway.ext"));
    fs.writeFileSync(sanFile, san);
  }
  return { key: fs.readFileSync(p("gateway.key")), cert: fs.readFileSync(p("gateway.crt")), caCertPath: p("qu32-local-ca.crt") };
}
