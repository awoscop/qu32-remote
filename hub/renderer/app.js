"use strict";
const $ = (id) => document.getElementById(id);
const CEILINGS = [["-10 dB", 0x3f], ["-5 dB", 0x4f], ["0 dB", 0x62], ["+5 dB", 0x72], ["+10 dB", 0x7f]];
const TB_LEVELS = [["-10 dB", 0x3f], ["-5 dB", 0x4f], ["0 dB", 0x62], ["+5 dB", 0x72]];

let last = null;
let devicesLoaded = false;
const cards = new Map(); // slot id -> element refs
const tbSelected = new Set();
let talking = false;

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
}
const focused = (n) => document.activeElement === n;
const msg = (t) => alert(t);
const guard = (p) => p.catch((e) => msg(String(e && e.message ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : e)));

// ------------------------------------------------------------ one-time fills
for (const [label, v] of TB_LEVELS) $("tbLevel").append(new Option(label, v));
for (let n = 1; n <= 32; n++) $("tbStrip").append(new Option(`CH ${n}`, 0x1f + n));

$("mixerConnect").onclick = () => guard(window.hub.setMixerHost($("mixerIp").value.trim()));
$("mixerIp").addEventListener("keydown", (e) => { if (e.key === "Enter") $("mixerConnect").click(); });
$("plus").onclick = () => last && guard(window.hub.setCount(Math.min(7, last.count + 1)));
$("minus").onclick = () => last && guard(window.hub.setCount(Math.max(0, last.count - 1)));
$("lanIp").onchange = () => guard(window.hub.setLanIp($("lanIp").value));
$("firstPwOk").onclick = () => window.hub.dismissFirstPassword();
$("openData").onclick = () => window.hub.openDataFolder();
$("resetPw").onclick = async () => {
  if (!confirm("Reset the engineer password? Anyone signed in as engineer on a phone will be signed out.")) return;
  const pw = await window.hub.resetEngineerPassword();
  prompt("New engineer password (copy it now, it is not shown again):", pw);
};
$("audioRefresh").onclick = () => loadDevices();
$("audioApply").onclick = async () => {
  $("audioMsg").textContent = "Applying...";
  await guard(window.hub.setAudio({ usbInId: $("usbIn").value, usbOutId: $("usbOut").value, micId: $("mic").value, returnChannel: Number($("retCh").value) }));
};
$("tbStrip").onchange = () => window.hub.setTalkback({ strip: Number($("tbStrip").value) });
$("tbLevel").onchange = () => window.hub.setTalkback({ level: Number($("tbLevel").value) });

// ------------------------------------------------------------ talkback
async function talkStart(only) {
  if (talking) return;
  const buses = only ? [only] : [...tbSelected];
  if (!buses.length) { $("talkMsg").textContent = "Select at least one monitor to talk to."; return; }
  talking = true; $("talk").classList.add("live"); $("talk").textContent = "TALKING...";
  const r = await window.hub.talk(true, buses);
  if (!r.ok) { talking = false; $("talk").classList.remove("live"); $("talk").textContent = "Hold to talk"; $("talkMsg").textContent = r.error || "Talkback failed"; }
}
async function talkStop() {
  if (!talking) return;
  talking = false; $("talk").classList.remove("live"); $("talk").textContent = "Hold to talk";
  await window.hub.talk(false, []);
}
const tb = $("talk");
tb.addEventListener("mousedown", () => talkStart());
tb.addEventListener("touchstart", (e) => { e.preventDefault(); talkStart(); }, { passive: false });
for (const ev of ["mouseup", "mouseleave", "touchend", "touchcancel", "blur"]) tb.addEventListener(ev, talkStop);
window.addEventListener("blur", talkStop);
window.addEventListener("beforeunload", () => { window.hub.talk(false, []); });
window.addEventListener("keydown", (e) => { if (e.code === "Space" && !e.repeat && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) && !tb.disabled) { e.preventDefault(); talkStart(); } });
window.addEventListener("keyup", (e) => { if (e.code === "Space") talkStop(); });

// ------------------------------------------------------------ shows
$("showSave").onclick = () => guard(window.hub.showSave($("showNameInput").value.trim() || (last && last.show.name)));
$("showNew").onclick = () => { if (confirm("Start a new empty show? Unsaved changes to the current show are lost.")) guard(window.hub.showNew()); };
$("showLoad").onclick = () => { const f = $("showList").value; if (!f) return; if (!last.show.dirty || confirm("Open this show? Unsaved changes to the current show are lost.")) guard(window.hub.showLoad(f)); };
$("showDelete").onclick = () => { const f = $("showList").value; if (f && confirm("Delete this saved show?")) guard(window.hub.showDelete(f)); };
$("showExport").onclick = () => guard(window.hub.showExport());
$("showImport").onclick = () => guard(window.hub.showImport());

function renderShow(st) {
  $("showName").textContent = st.show.name;
  $("showDirty").textContent = st.show.dirty ? "  (unsaved changes)" : "";
  const sel = $("showList");
  if (!focused(sel)) {
    const sig = st.show.list.map((s) => s.file).join("|");
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig; sel.textContent = "";
      if (!st.show.list.length) sel.append(new Option("No saved shows yet", ""));
      for (const s of st.show.list) sel.append(new Option(s.name, s.file));
    }
  }
  if (!focused($("showNameInput")) && $("showNameInput").dataset.for !== st.show.name) {
    $("showNameInput").value = st.show.name === "Untitled show" ? "" : st.show.name;
    $("showNameInput").dataset.for = st.show.name;
  }
}

// ------------------------------------------------------------ mix designer matrix
function renderMatrix(st) {
  const tbl = $("matrix");
  const digital = st.slots.filter((s) => s.mode === "digital");
  $("matrixCard").hidden = digital.length === 0;
  const sig = digital.map((s) => s.id + ":" + s.name).join("|") + "#" + st.deskNames.join("|");
  if (tbl.dataset.sig !== sig) {
    tbl.dataset.sig = sig; tbl.textContent = "";
    const head = el("tr", {}, el("th", { textContent: "Input" }));
    for (const s of digital) head.append(el("th", { textContent: s.name || ("Monitor " + s.id), title: "Monitor " + s.id }));
    tbl.append(el("thead", {}, head));
    const body = el("tbody");
    for (let n = 1; n <= 32; n++) {
      const tr = el("tr", {}, el("td", { textContent: n + ". " + st.deskNames[n - 1] }));
      for (const s of digital) {
        const cb = el("input", { type: "checkbox", ariaLabel: (st.deskNames[n - 1]) + " for " + (s.name || "monitor " + s.id) });
        cb.dataset.slot = s.id; cb.dataset.input = n;
        cb.onchange = () => guard(window.hub.mixAssign(s.id, n, cb.checked));
        tr.append(el("td", {}, cb));
      }
      body.append(tr);
    }
    tbl.append(body);
  }
  for (const cb of tbl.querySelectorAll("input[type=checkbox]")) {
    const s = st.slots.find((x) => x.id === Number(cb.dataset.slot));
    if (s && !focused(cb)) cb.checked = s.mixChannels.some((c) => c.input === Number(cb.dataset.input));
  }
}

// ------------------------------------------------------------ per-musician level editor
function renderLevels(r, s, st) {
  const box = r.levelsBody;
  const sig = s.mixChannels.map((c) => c.input + ":" + c.max + ":" + c.locked).join(",") + "|" + st.deskNames.join("|").length;
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig; box.textContent = "";
    if (!s.mixChannels.length) box.append(el("div", { className: "muted", textContent: "No inputs assigned yet. Tick them in the mix designer." }));
    for (const c of s.mixChannels) {
      const row = el("div", { className: "lvrow" });
      const lab = el("span", { textContent: c.input + ". " + st.deskNames[c.input - 1], title: st.deskNames[c.input - 1] });
      const rng = el("input", { type: "range", min: 0, max: 127, ariaLabel: "Start level" });
      rng.dataset.level = c.input;
      rng.onchange = () => guard(window.hub.mixChannel(s.id, c.input, { level: Number(rng.value) }));
      const cap = el("select", { ariaLabel: "Highest level the musician can set", title: "Highest level the musician can set" });
      for (const [l, v] of CEILINGS) cap.append(new Option("max " + l, v));
      cap.value = String(c.max); cap.dataset.cap = c.input;
      cap.onchange = () => guard(window.hub.mixChannel(s.id, c.input, { max: Number(cap.value) }));
      const lock = el("input", { type: "checkbox", title: "Lock: musician cannot move this input", ariaLabel: "Lock" });
      lock.checked = c.locked;
      lock.onchange = () => guard(window.hub.mixChannel(s.id, c.input, { locked: lock.checked }));
      row.append(lab, rng, cap, el("label", { className: "inline" }, lock, "lock"));
      box.append(row);
    }
  }
  for (const rng of box.querySelectorAll("input[data-level]")) {
    const c = s.mixChannels.find((x) => x.input === Number(rng.dataset.level));
    if (c && !focused(rng)) { rng.max = c.max; rng.value = c.level; }
  }
}

// ------------------------------------------------------------ devices
async function loadDevices() {
  try {
    const d = await window.hub.audioDevices();
    const fill = (sel, items, current, blank) => {
      sel.textContent = "";
      sel.append(new Option(blank, ""));
      for (const i of items) sel.append(new Option(i.label, i.id));
      sel.value = items.some((i) => i.id === current) ? current : "";
    };
    const s = (last && last.settings) || {};
    fill($("usbIn"), d.inputs, s.usbInId, "System default input");
    fill($("usbOut"), d.outputs, s.usbOutId, "Not set (talkback off)");
    fill($("mic"), d.inputs, s.micId, "Not set (talkback off)");
    $("retCh").value = s.returnChannel || 32;
    devicesLoaded = true;
  } catch (e) { $("audioMsg").textContent = "Could not list audio devices: " + e.message; }
}

// ------------------------------------------------------------ slot cards
function makeCard(s) {
  const r = {};
  r.root = el("div", { className: "slot" });
  r.bus = el("span", { className: "bus" });
  r.enabled = el("input", { type: "checkbox", title: "Enabled", ariaLabel: "Enabled" });
  r.enabled.onchange = () => guard(window.hub.updateSlot(s.id, { enabled: r.enabled.checked }));
  r.root.append(el("div", { className: "top" }, r.bus, el("label", { className: "inline" }, "On", r.enabled)));
  r.name = el("input", { className: "name", maxLength: 40, placeholder: "Name, e.g. Drums", ariaLabel: "Monitor name" });
  r.name.onchange = () => guard(window.hub.updateSlot(s.id, { name: r.name.value }));
  r.img = el("img", { alt: `QR code for monitor ${s.id}` });
  r.url = el("div", { className: "url" });
  r.copy = el("button", { className: "small", textContent: "Copy link" });
  r.copy.onclick = () => { window.hub.copy(r.urlText); r.copy.textContent = "Copied"; setTimeout(() => (r.copy.textContent = "Copy link"), 1200); };
  r.regen = el("button", { className: "small", textContent: "New QR" });
  r.regen.onclick = () => { if (confirm("Make a new QR code? The old one stops working and this phone is disconnected.")) guard(window.hub.regenerate(s.id)); };
  r.phone = el("span", {}, el("i"), "Phone");
  r.audio = el("span", {}, el("i"), "Audio");
  r.status = el("div", { className: "status" }, r.phone, r.audio);
  r.meterI = el("i");
  r.meter = el("div", { className: "meter" }, r.meterI);
  r.ceiling = el("select", { ariaLabel: "Maximum level" });
  for (const [l, v] of CEILINGS) r.ceiling.append(new Option(l, v));
  r.ceiling.onchange = () => guard(window.hub.updateSlot(s.id, { ceiling: Number(r.ceiling.value) }));
  r.usb = el("input", { type: "number", min: 1, max: 32, ariaLabel: "First USB channel" });
  r.usb.onchange = () => guard(window.hub.updateSlot(s.id, { usbChannel: Number(r.usb.value) }));
  r.usbLabel = el("span", {}, "USB ch");
  r.mode = el("select", { ariaLabel: "Mix type", title: "Digital mix: personal mix inside the Hub. Desk mix: the console's own monitor mix." });
  r.mode.append(new Option("Digital mix (recommended)", "digital"), new Option("Desk mix (console Mix bus)", "desk"));
  r.mode.onchange = () => guard(window.hub.updateSlot(s.id, { mode: r.mode.value }));
  r.levelsBody = el("div");
  r.levels = el("details", { className: "levels" }, el("summary", { textContent: "Inputs & levels" }), r.levelsBody);
  r.showAll = el("input", { type: "checkbox", ariaLabel: "Show all channels" });
  r.showAll.onchange = () => guard(window.hub.updateSlot(s.id, { showAll: r.showAll.checked }));
  r.talk = el("button", { className: "small", textContent: "Hold to talk to this mix" });
  const go = () => talkStart(s.id), stop = () => talkStop();
  r.talk.addEventListener("mousedown", go);
  r.talk.addEventListener("touchstart", (e) => { e.preventDefault(); go(); }, { passive: false });
  for (const ev of ["mouseup", "mouseleave", "touchend", "touchcancel"]) r.talk.addEventListener(ev, stop);
  r.deskOpts = el("div", { className: "opts" }, "Max level", r.ceiling, r.usbLabel, r.usb);
  r.deskShow = el("label", { className: "inline opts", title: "Off: the phone shows only the channels you have sent to this mix" }, r.showAll, "Show all channels");
  r.root.append(r.name, el("div", { className: "opts" }, "Mix", r.mode), r.img, r.url, el("div", { className: "row" }, r.copy, r.regen), r.status, r.meter,
    r.levels, r.deskOpts, r.deskShow, r.talk);
  return r;
}

function renderSlots(st) {
  const box = $("slots");
  const ids = new Set(st.slots.map((s) => s.id));
  for (const [id, r] of cards) if (!ids.has(id)) { r.root.remove(); cards.delete(id); }
  for (const s of st.slots) {
    let r = cards.get(s.id);
    if (!r) { r = makeCard(s); cards.set(s.id, r); box.append(r.root); }
    r.root.classList.toggle("off", !s.enabled);
    r.bus.textContent = `Monitor ${s.id} · ${s.bus}${s.stereo ? " (stereo)" : ""}`;
    r.enabled.checked = s.enabled;
    if (!focused(r.name)) r.name.value = s.name;
    if (r.img.src !== s.qr && s.qr) r.img.src = s.qr;
    r.url.textContent = s.url; r.urlText = s.url;
    r.phone.className = s.connected ? "on" : ""; r.audio.className = s.streaming ? "on" : "";
    r.phone.lastChild.textContent = s.connected ? "Phone connected" : "No phone";
    r.audio.lastChild.textContent = s.streaming ? "Audio streaming" : "No audio";
    r.meterI.style.width = `${Math.round(s.level * 100)}%`;
    if (!focused(r.ceiling)) r.ceiling.value = String(s.ceiling);
    if (!focused(r.usb)) r.usb.value = s.usbChannel;
    r.showAll.checked = !!s.showAll;
    if (!focused(r.mode)) r.mode.value = s.mode;
    const dig = s.mode === "digital";
    r.levels.hidden = !dig; r.deskOpts.hidden = dig; r.deskShow.hidden = dig;
    if (dig) renderLevels(r, s, st);
    r.talk.disabled = st.mixer.phase !== "ready";
    r.usbLabel.textContent = s.stereo ? "USB ch (L, R=+1)" : "USB ch";
  }
  $("noSlots").hidden = st.slots.length > 0;
}

function renderTalkChips(st) {
  const box = $("tbBuses");
  const sig = st.slots.map((s) => `${s.id}:${s.name}`).join("|");
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.textContent = "";
    for (const s of st.slots) {
      const c = el("div", { className: "chip", role: "checkbox", tabIndex: 0, textContent: `${s.id}. ${s.name}` });
      c.dataset.id = s.id;
      c.setAttribute("aria-checked", String(tbSelected.has(s.id)));
      const toggle = () => { tbSelected.has(s.id) ? tbSelected.delete(s.id) : tbSelected.add(s.id); c.classList.toggle("on", tbSelected.has(s.id)); c.setAttribute("aria-checked", String(tbSelected.has(s.id))); };
      c.onclick = toggle; c.onkeydown = (e) => { if (e.key === "Enter") toggle(); };
      c.classList.toggle("on", tbSelected.has(s.id));
      box.append(c);
    }
    const all = el("div", { className: "chip", textContent: "All" });
    all.onclick = () => { const every = st.slots.every((s) => tbSelected.has(s.id)); st.slots.forEach((s) => (every ? tbSelected.delete(s.id) : tbSelected.add(s.id))); box.dataset.sig = ""; };
    box.append(all);
  }
}

function render(st) {
  last = st;
  $("count").textContent = st.count;
  const ph = st.mixer.phase;
  const pill = $("consolePill");
  pill.className = "pill " + (ph === "ready" ? "ok" : ph === "offline" || ph === "error" ? "bad" : "");
  pill.lastChild.textContent = ph === "ready" ? `Qu-32 online${st.mixer.firmware ? ` · fw ${st.mixer.firmware}` : ""}` : `Console: ${st.mixer.message}`;
  $("mixerMsg").textContent = `${ph}: ${st.mixer.message}`;
  if (!focused($("mixerIp")) && !$("mixerIp").value && st.mixer.host) $("mixerIp").value = st.mixer.host;

  const lan = $("lanIp");
  if (!focused(lan)) {
    const sig = st.lanIps.join(",");
    if (lan.dataset.sig !== sig) { lan.dataset.sig = sig; lan.textContent = ""; for (const ip of st.lanIps) lan.append(new Option(ip, ip)); if (!st.lanIps.length) lan.append(new Option("No network found", "")); }
    lan.value = st.lanIp;
  }
  const errs = $("errors");
  const msgs = [...st.errors];
  if (st.engine.error) msgs.push(st.engine.error);
  errs.hidden = msgs.length === 0;
  errs.textContent = ""; for (const m of msgs) errs.append(el("div", { textContent: m }));

  $("firstPw").hidden = !st.firstPassword;
  if (st.firstPassword) { $("firstPwText").textContent = st.firstPassword; $("httpsText").textContent = st.httpsUrl; }

  renderShow(st);
  renderMatrix(st);
  renderSlots(st);
  renderTalkChips(st);

  const e = st.engine;
  $("audioMsg").textContent = !e.ready ? "Audio engine starting..." : e.inputChannels ? `USB input: ${e.inputChannels} channel(s) available.` : "No USB input open. Choose the Qu-32 USB device and press Apply.";
  if (e.talkError) $("audioMsg").textContent += ` Talkback: ${e.talkError}`;
  $("talk").disabled = st.mixer.phase !== "ready";
  if (document.activeElement !== $("tbStrip")) $("tbStrip").value = String(st.settings.talkStrip);
  if (document.activeElement !== $("tbLevel")) $("tbLevel").value = String(st.settings.talkLevel);
  $("urls").textContent = `Musician address: ${st.baseUrl}   ·   Engineer app: ${st.httpsUrl}`;
  if (!devicesLoaded && e.ready) loadDevices();
}

async function tick() {
  try { render(await window.hub.getState()); } catch (e) { /* main busy */ }
  setTimeout(tick, 500);
}
tick();
