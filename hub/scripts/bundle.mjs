import { build } from "esbuild";
import "./copy-web.mjs";
// Bundles the hub, the gateway and the SDK protocol into one file, so the packaged app has no path dependencies.
await build({
  entryPoints: ["src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22",
  outfile: "dist/main.js", external: ["electron"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log("bundled dist/main.js");
