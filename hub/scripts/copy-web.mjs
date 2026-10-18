import fs from "node:fs";
// The gateway serves the musician page from ../web relative to its compiled file; mirror it next to the hub build.
fs.mkdirSync(new URL("../web/", import.meta.url), { recursive: true });
fs.copyFileSync(new URL("../../gateway/web/monitor.html", import.meta.url), new URL("../web/monitor.html", import.meta.url));
