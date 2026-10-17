import { Auth } from "./auth.js";
import { loadConfig } from "./config.js";
import { QuLink } from "./mixer.js";
import { createGateway, loadSavedHost } from "./server.js";

const cfg = loadConfig();
const auth = new Auth(cfg.dataDir);
const first = await auth.bootstrap(process.env.QU32_ENGINEER_PASSWORD);
const link = new QuLink({ host: cfg.mixerHost || loadSavedHost(cfg), port: cfg.mixerPort, allowedModels: cfg.allowedModels });
const gw = createGateway(cfg, { auth, link });
const port = await gw.listen();
link.start();

const scheme = cfg.insecureHttp ? "http" : "https";
console.log(`\nQU32 gateway listening on ${scheme}://${cfg.lanIp}:${port}`);
console.log(`Data directory: ${cfg.dataDir}  (never share or commit this folder)`);
if (!cfg.insecureHttp) console.log(`Phones must trust the local CA: open ${scheme}://${cfg.lanIp}:${port}/ca.crt on the phone, or copy qu32-local-ca.crt (public file only).`);
if (first) console.log(`\nFirst start. Engineer login:  engineer / ${first}\nSave this password now. It is shown only once.\n`);
console.log(link.host ? `Console: ${link.host}:${cfg.mixerPort}` : "Console IP not set. Sign in as engineer and set it in the app (or set QU32_MIXER_IP).");

const stop = async () => { await gw.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
