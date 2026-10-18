"use strict";
/* QU32 Hub window. All state comes from the main process (window.hub); nothing here is trusted for permissions. */
const $ = (id) => document.getElementById(id);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CEILINGS = [["-10 dB", 0x3f], ["-5 dB", 0x4f], ["0 dB", 0x62], ["+5 dB", 0x72], ["+10 dB", 0x7f]];
const TB_LEVELS = [["-10 dB", 0x3f], ["-5 dB", 0x4f], ["0 dB", 0x62], ["+5 dB", 0x72]];
const COLORS = ["teal", "amber", "blue", "purple"];
const VIEW_TITLES = { overview: "Console overview", setup: "Console & audio", mix: "Mix designer", monitors: "Musician monitors", talkback: "Talkback", shows: "Shows" };
const VIEW_CRUMBS = { overview: "Overview", setup: "Console & audio", mix: "Mix designer", monitors: "Monitors", talkback: "Talkback", shows: "Shows" };

let last = null;
let talking = false;
let toastTimer = null;
let devicesLoaded = false;
let matrixFilter = "";
const selectedTalk = new Set();
const cards = new Map(); // slot id -> card refs

// ------------------------------------------------------------------ helpers
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
}
const focused = (n) => document.activeElement === n;
const initials = (n) => { const w = String(n || "?").trim().split(/\s+/); return ((w[0] || "?")[0] + (w.length > 1 ? w[1][0] : (w[0] || "").slice(1, 2))).toUpperCase(); };
const paint = (r) => r.style.setProperty("--fill", ((+r.value - (+r.min || 0)) / ((+r.max || 100) - (+r.min || 0)) * 100) + "%");
const PTS = [[0, -Infinity], [12, -45], [16, -40], [23, -35], [31, -30], [39, -25], [47, -20], [54, -15], [63, -10], [79, -5], [98, 0], [114, 5], [127, 10]];
function db(raw) {
  if (raw <= 0) return "-inf";
  for (let i = 1; i < PTS.length; i++) {
    const [r1, d1] = PTS[i], [r0, d0] = PTS[i - 1];
    if (raw <= r1) { const lo = isFinite(d0) ? d0 : -60; const v = raw === r1 ? d1 : lo + (raw - r0) / (r1 - r0) * (d1 - lo); const r = Math.round(v * 10) / 10; return (r > 0 ? "+" : "") + (Number.isInteger(r) ? r : r.toFixed(1)) + " dB"; }
  }
  return "+10 dB";
}
const clean = (e) => String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3600);
}
const guard = (p) => Promise.resolve(p).catch((e) => toast(clean(e)));

function modal(title, text, onConfirm, label = "Confirm", danger = true, extra = null) {
  const root = $("modalRoot");
  root.textContent = "";
  const cancel = el("button", { className: "btn", textContent: "Cancel" });
  const ok = el("button", { className: "btn " + (danger ? "btn-danger" : "btn-primary"), textContent: label });
  const box = el("div", { className: "modal", role: "alertdialog", ariaModal: "true", ariaLabel: title }, el("h2", { textContent: title }), el("p", { textContent: text }));
  if (extra) box.append(extra);
  box.append(el("div", { className: "modal-actions" }, onConfirm ? cancel : "", ok));
  const close = () => { root.textContent = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  cancel.onclick = close;
  ok.onclick = () => { close(); if (onConfirm) onConfirm(); };
  root.append(el("div", { className: "modal-backdrop" }, box));
  (onConfirm ? cancel : ok).focus();
}

// ------------------------------------------------------------------ navigation
function open(view) {
  if (!VIEW_TITLES[view]) view = "overview";
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  $$(".nav-link[data-view]").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  $("breadcrumb").textContent = VIEW_CRUMBS[view];
  $("topTitle").textContent = VIEW_TITLES[view];
  window.scrollTo({ top: 0 });
  if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
}
$$("[data-view]").forEach((b) => b.addEventListener("click", () => open(b.dataset.view)));
$$("[data-open]").forEach((b) => b.addEventListener("click", () => open(b.dataset.open)));

// ------------------------------------------------------------------ talkback
function renderTargets(st) {
  if (!st) return;
  const enabled = st.slots.filter((x) => x.enabled);
  for (const id of [...selectedTalk]) if (!enabled.some((s) => s.id === id)) selectedTalk.delete(id);
  const sig = enabled.map((s) => s.id + ":" + s.name).join("|") + "#" + [...selectedTalk].join(",");
  for (const box of [$("footerTargets"), $("talkPageTargets")]) {
    if (box.dataset.sig === sig) continue;
    box.dataset.sig = sig; box.textContent = "";
    for (const s of enabled) {
      const b = el("button", { className: "target-chip" + (selectedTalk.has(s.id) ? " active" : ""), textContent: s.name || ("Monitor " + s.id), ariaPressed: String(selectedTalk.has(s.id)) });
      b.onclick = () => { selectedTalk.has(s.id) ? selectedTalk.delete(s.id) : selectedTalk.add(s.id); renderTargets(last); };
      box.append(b);
    }
    if (!enabled.length) box.append(el("span", { className: "muted sm", textContent: "No monitors to talk to yet" }));
  }
}
function setTalkUi(on, names = "") {
  for (const id of ["footerTalk", "bigTalk"]) $(id).classList.toggle("talking", on);
  $("talkState").textContent = on ? "TALKING..." : "HOLD TO TALK";
  $("footerTalk").textContent = on ? "Release to stop" : "Hold to talk";
  $("talkHint").textContent = on ? "Live to " + names : "Select at least one monitor, then hold the button.";
}
async function talkStart(ids, btn) {
  if (talking) return;
  const list = ids ?? [...selectedTalk];
  if (!list.length) { toast("Select at least one monitor to talk to."); return; }
  talking = true;
  const names = list.map((i) => { const s = last.slots.find((x) => x.id === i); return s ? (s.name || ("Monitor " + i)) : i; }).join(", ");
  setTalkUi(true, names);
  if (btn && btn.classList.contains("hold-btn")) btn.classList.add("talking");
  const r = await window.hub.talk(true, list);
  if (!r.ok) { talking = false; setTalkUi(false); $$(".hold-btn").forEach((b) => b.classList.remove("talking")); toast(r.error || "Talkback failed"); }
}
async function talkStop() {
  if (!talking) return;
  talking = false; setTalkUi(false);
  $$(".hold-btn").forEach((b) => b.classList.remove("talking"));
  await window.hub.talk(false, []);
}
function bindHold(btn, getIds) {
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); talkStart(getIds(), btn); });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) btn.addEventListener(ev, talkStop);
}
bindHold($("footerTalk"), () => undefined);
bindHold($("bigTalk"), () => undefined);
document.addEventListener("pointerup", talkStop);
window.addEventListener("blur", talkStop);
window.addEventListener("beforeunload", () => { window.hub.talk(false, []); });
document.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName || "").toLowerCase();
  const ok = e.code === "Space" && !e.repeat && !["input", "textarea", "select"].includes(tag) && (tag !== "button" || e.target.matches("#bigTalk,#footerTalk"));
  if (ok) { e.preventDefault(); talkStart(); }
});
document.addEventListener("keyup", (e) => { if (e.code === "Space") talkStop(); });
$("stopTalkTop").onclick = () => { talkStop(); toast("Talkback stopped."); };

// ------------------------------------------------------------------ setup controls
$("mixerConnect").onclick = () => guard(window.hub.setMixerHost($("mixerIp").value.trim()).then(() => toast("Connecting to the console...")));
$("mixerIp").addEventListener("keydown", (e) => { if (e.key === "Enter") $("mixerConnect").click(); });
$("lanIp").onchange = () => guard(window.hub.setLanIp($("lanIp").value));
$("firstPwOk").onclick = () => window.hub.dismissFirstPassword();
$("openData").onclick = () => window.hub.openDataFolder();
$("resetPw").onclick = () => modal("Reset the engineer password?", "Anyone signed in as engineer on a phone will be signed out. The new password is shown once.", async () => {
  try {
    const pw = await window.hub.resetEngineerPassword();
    modal("New engineer password", "Copy it now. It is not shown again.", null, "Done", false, el("p", {}, el("code", { textContent: pw })));
  } catch (e) { toast(clean(e)); }
}, "Reset password");
$("audioRefresh").onclick = () => loadDevices(true);
$("audioApply").onclick = () => {
  $("audioMsg").textContent = "Applying...";
  guard(window.hub.setAudio({ usbInId: $("usbIn").value, usbOutId: $("usbOut").value, micId: $("tbSource").value === "pc" ? $("mic").value : "", returnChannel: Number($("retCh").value) }).then(() => toast("Audio settings applied.")));
};
$("tbSource").onchange = () => {
  const pc = $("tbSource").value === "pc";
  $("pcMicRow").hidden = !pc;
  if (!pc) guard(window.hub.setAudio({ micId: "" }));
};
$("mic").onchange = () => guard(window.hub.setAudio({ micId: $("mic").value }));
$("tbStrip").onchange = () => guard(window.hub.setTalkback({ strip: Number($("tbStrip").value) }).then(() => window.hub.setAudio({})));
$("tbLevel").onchange = () => guard(window.hub.setTalkback({ level: Number($("tbLevel").value) }));
for (const [l, v] of TB_LEVELS) $("tbLevel").append(new Option(l, v));
for (let n = 1; n <= 32; n++) $("tbStrip").append(new Option("CH " + n, 0x1f + n));

async function loadDevices(manual) {
  try {
    const d = await window.hub.audioDevices();
    const s = (last && last.settings) || {};
    const fill = (sel, items, current, blank) => {
      sel.textContent = ""; sel.append(new Option(blank, ""));
      for (const i of items) sel.append(new Option(i.label, i.id));
      sel.value = items.some((i) => i.id === current) ? current : "";
    };
    fill($("usbIn"), d.inputs, s.usbInId, "System default input");
    fill($("usbOut"), d.outputs, s.usbOutId, "Not set (desk-mix talkback off)");
    fill($("mic"), d.inputs, s.micId, "Choose a microphone");
    $("retCh").value = s.returnChannel || 32;
    devicesLoaded = true;
    if (manual) toast("Audio devices refreshed.");
  } catch (e) { $("audioMsg").textContent = "Could not list audio devices: " + clean(e); }
}

// ------------------------------------------------------------------ shows
$("saveShow").onclick = () => guard(window.hub.showSave($("showName").value.trim() || (last && last.show.name)).then(() => toast("Show saved.")));
$("saveMatrix").onclick = () => guard(window.hub.showSave($("showName").value.trim() || (last && last.show.name)).then(() => { toast("Show saved."); open("shows"); }));
$("newShow").onclick = () => modal("Start a new show?", "A new show starts with empty assignments. Unsaved changes to the current show are lost.", () => guard(window.hub.showNew()), "Create show");
$("exportShow").onclick = () => guard(window.hub.showExport().then((ok) => { if (ok) toast("Show exported."); }));
$("importShow").onclick = () => {
  const go = () => guard(window.hub.showImport().then((ok) => { if (ok) toast("Show imported."); }));
  if (last && last.show.dirty) modal("Discard unsaved changes?", "Importing a show replaces the current one.", go, "Import show"); else go();
};

function renderShows(st) {
  const show = st.show;
  $("currentShowName").textContent = show.name;
  $("showCrumb").textContent = show.name + (show.dirty ? " *" : "");
  const untitled = show.name === "Untitled show";
  const stat = $("showStatus");
  stat.className = "pill " + (show.dirty ? "warn" : untitled ? "" : "ok");
  stat.textContent = show.dirty ? "Modified" : untitled ? "Not saved yet" : "Saved";
  $("showSaveState").textContent = show.dirty ? "This show has unsaved changes." : untitled ? "Name it and save to keep this setup." : "No unsaved changes.";
  if (!focused($("showName")) && $("showName").dataset.for !== show.name) { $("showName").value = untitled ? "" : show.name; $("showName").dataset.for = show.name; }
  $("showCountText").textContent = show.list.length ? show.list.length + (show.list.length === 1 ? " saved show" : " saved shows") : "None yet";
  const sig = show.list.map((s) => s.file + s.savedAt).join("|") + "#" + show.name + show.dirty;
  const box = $("showCards");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig; box.textContent = "";
  if (!show.list.length) box.append(el("div", { className: "card card-pad muted", textContent: "No saved shows yet. Name the current show and press Save show." }));
  for (const s of show.list) {
    const active = s.name === show.name && !show.dirty;
    const open_ = el("button", { className: "btn " + (active ? "btn-secondary" : "btn-primary"), textContent: active ? "Current show" : "Open show", disabled: active });
    open_.onclick = () => {
      const go = () => guard(window.hub.showLoad(s.file).then(() => toast("Opened " + s.name)));
      if (last.show.dirty) modal("Discard unsaved changes?", "Opening another show replaces the unsaved changes.", go, "Open show"); else go();
    };
    const del = el("button", { className: "btn btn-ghost", textContent: "Delete" });
    del.onclick = () => modal("Delete this show?", "\"" + s.name + "\" will be removed from this PC. This cannot be undone.", () => guard(window.hub.showDelete(s.file)), "Delete show");
    const when = new Date(s.savedAt);
    box.append(el("article", { className: "card show-card" + (active ? " active-show" : "") },
      el("span", { className: "pill" + (active ? " ok" : ""), textContent: active ? "Loaded" : "Saved show" }),
      el("h3", { textContent: s.name }),
      el("p", { textContent: isNaN(when) ? "" : when.toLocaleString() }),
      el("div", { className: "row-gap" }, open_, del)));
  }
}

// ------------------------------------------------------------------ mix designer
$("matrixSearch").addEventListener("input", () => { matrixFilter = $("matrixSearch").value.trim().toLowerCase(); $("matrix").dataset.sig = ""; if (last) renderMatrix(last); });
$("matrixCopy").onclick = () => {
  const from = Number($("copyFrom").value), to = Number($("copyTo").value);
  if (!from || !to || from === to) { toast("Choose two different musicians."); return; }
  const a = last.slots.find((s) => s.id === from), b = last.slots.find((s) => s.id === to);
  modal("Copy " + a.name + " assignments?", "This replaces the inputs " + b.name + " hears with the inputs " + a.name + " hears.", async () => {
    const have = new Set(a.mixChannels.map((c) => c.input));
    await guard(Promise.all(Array.from({ length: 32 }, (_, i) => window.hub.mixAssign(to, i + 1, have.has(i + 1)))));
    toast("Copied " + a.name + " to " + b.name + ".");
  }, "Copy assignments", false);
};

function renderMatrix(st) {
  const digital = st.slots.filter((s) => s.mode === "digital");
  $("matrixEmpty").hidden = digital.length > 0;
  $("matrixBox").hidden = digital.length === 0;
  $("matrixDirty").textContent = st.show.dirty ? "● Unsaved changes" : "No changes";
  $("matrixDirty").className = "pill" + (st.show.dirty ? " warn" : "");
  const tbl = $("matrix");
  const sig = digital.map((s) => s.id + ":" + s.name).join("|") + "#" + st.deskNames.join("|") + "#" + matrixFilter;
  if (tbl.dataset.sig !== sig) {
    tbl.dataset.sig = sig; tbl.textContent = "";
    const head = el("tr", {}, el("th", { textContent: "Desk input" }));
    for (const s of digital) head.append(el("th", { textContent: s.name || ("Monitor " + s.id), title: "Monitor " + s.id }));
    head.append(el("th", { textContent: "All" }));
    tbl.append(el("thead", {}, head));
    const body = el("tbody");
    let shown = 0;
    for (let n = 1; n <= 32; n++) {
      const name = st.deskNames[n - 1];
      if (matrixFilter && !name.toLowerCase().includes(matrixFilter) && String(n) !== matrixFilter) continue;
      shown++;
      const tr = el("tr", {}, el("td", {}, el("span", { className: "num", textContent: String(n).padStart(2, "0") }), el("strong", { textContent: name })));
      for (const s of digital) {
        const cb = el("input", { type: "checkbox", className: "matrix-check", ariaLabel: "Send " + name + " to " + (s.name || "monitor " + s.id) });
        cb.dataset.slot = s.id; cb.dataset.input = n;
        cb.onchange = () => guard(window.hub.mixAssign(s.id, n, cb.checked));
        tr.append(el("td", {}, cb));
      }
      const all = el("button", { className: "btn btn-ghost btn-icon-sm", textContent: "all", title: "Give this input to everyone, or remove it from everyone" });
      all.onclick = () => { const every = digital.every((s) => s.mixChannels.some((c) => c.input === n)); guard(Promise.all(digital.map((s) => window.hub.mixAssign(s.id, n, !every)))); };
      tr.append(el("td", {}, all));
      body.append(tr);
    }
    if (!shown) body.append(el("tr", {}, el("td", { colSpan: digital.length + 2, textContent: "No matching channels" })));
    tbl.append(body);
  }
  for (const cb of $$("input.matrix-check", tbl)) {
    const s = st.slots.find((x) => x.id === Number(cb.dataset.slot));
    if (s && !focused(cb)) cb.checked = s.mixChannels.some((c) => c.input === Number(cb.dataset.input));
  }
  const csig = digital.map((s) => s.id + ":" + s.name).join("|");
  for (const [sel, label] of [[$("copyFrom"), "From"], [$("copyTo"), "To"]]) {
    if (sel.dataset.sig !== csig) {
      const cur = sel.value; sel.dataset.sig = csig; sel.textContent = "";
      sel.append(new Option(label + "...", ""));
      for (const s of digital) sel.append(new Option(s.name || ("Monitor " + s.id), s.id));
      sel.value = cur;
    }
  }
}

// ------------------------------------------------------------------ monitors
$("plus").onclick = () => last && last.count < 7 && guard(window.hub.setCount(last.count + 1));
$("addFirst").onclick = () => guard(window.hub.setCount(1));
$("minus").onclick = () => {
  if (!last || last.count < 1) return;
  const s = last.slots[last.slots.length - 1];
  modal("Remove monitor " + last.count + "?", (s && s.name ? s.name : "This monitor") + "'s QR code will stop working and any connected phone is disconnected.", () => guard(window.hub.setCount(last.count - 1)), "Remove monitor");
};
$("qrSheet").onclick = () => guard(window.hub.qrSheet());

function mini(level) {
  const n = Math.floor(level * 18);
  return Array.from({ length: 18 }, (_, i) => '<span class="' + (i < n ? (i > 13 ? "hot" : "on") : "") + '"></span>').join("");
}

function makeCard(s) {
  const r = {};
  r.root = el("article", { className: "card monitor-card" });
  r.av = el("div", { className: "avatar" });
  r.name = el("input", { className: "name-input", maxLength: 40, placeholder: "Name, e.g. Drums", ariaLabel: "Monitor name" });
  r.name.onchange = () => guard(window.hub.updateSlot(s.id, { name: r.name.value.trim() }));
  r.sub = el("div", { className: "muted sm" });
  r.enabled = el("input", { type: "checkbox", ariaLabel: "Monitor enabled" });
  r.enabled.onchange = () => guard(window.hub.updateSlot(s.id, { enabled: r.enabled.checked }));
  r.root.append(el("div", { className: "monitor-card-top" },
    el("div", { className: "card-who" }, r.av, el("div", { className: "grow" }, r.name, r.sub)),
    el("label", { className: "switch" }, r.enabled, el("span", { textContent: "On" }))));
  r.pPhone = el("span", { className: "pill" }); r.pAudio = el("span", { className: "pill" });
  r.root.append(el("div", { className: "pill-row" }, r.pPhone, r.pAudio));

  r.img = el("img", { alt: "QR code for this monitor" });
  r.url = el("div", { className: "help-text url-line" });
  r.mode = el("select", { className: "select", ariaLabel: "Mix type" });
  r.mode.append(new Option("Digital mix (recommended)", "digital"), new Option("Desk mix (console Mix bus)", "desk"));
  r.mode.onchange = () => guard(window.hub.updateSlot(s.id, { mode: r.mode.value }));
  r.meter = el("div", { className: "mini-meter", ariaLabel: "Level in this musician's mix" });
  r.modeNote = el("div", { className: "tiny-note" });
  r.root.append(el("div", { className: "monitor-card-mid" },
    el("div", {}, el("div", { className: "qr-box" }, r.img), el("div", { className: "tiny-note center", textContent: "Private link" })),
    el("div", { className: "mc-fields" }, el("label", { className: "field-label", textContent: "Mix type" }), r.mode, r.url, el("div", { className: "eyebrow gap-top", textContent: "Mix level" }), r.meter, r.modeNote)));

  const copy = el("button", { className: "btn btn-secondary", textContent: "Copy link" });
  copy.onclick = () => { window.hub.copy(r.urlText); toast("Link copied. Treat it as private."); };
  const prev = el("button", { className: "btn btn-secondary", textContent: "Phone preview" });
  prev.onclick = () => guard(window.hub.openUrl(r.urlText));
  const regen = el("button", { className: "btn", textContent: "New QR" });
  regen.onclick = () => modal("Make a new QR code?", "The old QR code will stop working and the connected phone will be signed out.", () => guard(window.hub.regenerate(s.id).then(() => toast("New QR created."))), "New QR code");
  r.talk = el("button", { className: "btn btn-ghost hold-btn", textContent: "Hold to talk" });
  bindHold(r.talk, () => [s.id]);
  r.root.append(el("div", { className: "monitor-actions" }, copy, prev, regen, r.talk));

  // digital mix block
  r.master = el("input", { type: "range", className: "range", min: 0, max: 127, ariaLabel: "Starting overall volume" });
  r.masterRead = el("strong", { className: "mono" });
  r.master.oninput = () => { paint(r.master); r.masterRead.textContent = db(+r.master.value); };
  r.master.onchange = () => guard(window.hub.mixMaster(s.id, +r.master.value));
  r.levelsBody = el("div", { className: "monitor-input-rows" });
  r.digital = el("div", {},
    el("div", { className: "mini-input-row" }, el("div", { className: "row-top" }, el("span", { textContent: "Starting overall volume" }), r.masterRead), r.master, el("div", { className: "help-text", textContent: "Musicians can change this on their phone. You can cap or lock each input below." })),
    el("details", { className: "monitor-input-details" }, el("summary", {}, "Input levels, maximums & locks"), r.levelsBody));
  // desk mix block
  r.ceiling = el("select", { className: "select slim", ariaLabel: "Maximum level" });
  for (const [l, v] of CEILINGS) r.ceiling.append(new Option("Max " + l, v));
  r.ceiling.onchange = () => guard(window.hub.updateSlot(s.id, { ceiling: Number(r.ceiling.value) }));
  r.usb = el("input", { type: "number", min: 1, max: 32, className: "input mono slim-input", ariaLabel: "First USB channel" });
  r.usb.onchange = () => guard(window.hub.updateSlot(s.id, { usbChannel: Number(r.usb.value) }));
  r.usbLabel = el("span", { className: "muted sm" });
  r.showAll = el("input", { type: "checkbox", ariaLabel: "Show all channels" });
  r.showAll.onchange = () => guard(window.hub.updateSlot(s.id, { showAll: r.showAll.checked }));
  r.desk = el("div", { className: "mini-input-row" },
    el("div", { className: "form-row wrap" }, r.ceiling, r.usbLabel, r.usb, el("label", { className: "switch" }, r.showAll, el("span", { textContent: "Show all channels" }))),
    el("div", { className: "help-text", textContent: "Desk mix uses the console's own Mix bus, controlled over MIDI. The phone shows only inputs assigned to that Mix on the desk." }));
  r.root.append(r.digital, r.desk);
  return r;
}

function renderLevels(r, s, st) {
  const box = r.levelsBody;
  const sig = s.mixChannels.map((c) => c.input + ":" + c.max + ":" + c.locked).join(",") + "#" + st.deskNames.join("|").length;
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig; box.textContent = "";
    if (!s.mixChannels.length) box.append(el("div", { className: "lv-empty", textContent: "No inputs assigned yet. Tick them in the Mix designer." }));
    for (const c of s.mixChannels) {
      const rng = el("input", { type: "range", className: "range", min: 0, max: c.max, ariaLabel: "Start level" });
      rng.dataset.level = c.input;
      const read = el("strong", { className: "mono" });
      read.dataset.read = c.input;
      rng.oninput = () => { paint(rng); read.textContent = db(+rng.value); };
      rng.onchange = () => guard(window.hub.mixChannel(s.id, c.input, { level: Number(rng.value) }));
      const cap = el("select", { className: "select slim", ariaLabel: "Highest level the musician can set" });
      for (const [l, v] of CEILINGS) cap.append(new Option("Max " + l, v));
      cap.value = String(c.max);
      cap.onchange = () => guard(window.hub.mixChannel(s.id, c.input, { max: Number(cap.value) }));
      const lock = el("input", { type: "checkbox", ariaLabel: "Lock this input" });
      lock.checked = c.locked;
      lock.onchange = () => guard(window.hub.mixChannel(s.id, c.input, { locked: lock.checked }));
      box.append(el("div", { className: "monitor-input-ctrl" },
        el("div", { className: "name-row" }, el("strong", { textContent: c.input + ". " + st.deskNames[c.input - 1] }), read, el("label", { className: "switch" }, lock, el("span", { textContent: "Lock" }))),
        el("div", { className: "form-row" }, rng, cap)));
    }
  }
  for (const rng of $$("input[data-level]", box)) {
    const c = s.mixChannels.find((x) => x.input === Number(rng.dataset.level));
    if (c && !focused(rng)) {
      rng.max = c.max; rng.value = c.level; paint(rng);
      const rd = $$("[data-read]", box).find((x) => x.dataset.read === rng.dataset.level);
      if (rd) rd.textContent = db(c.level);
    }
  }
}

function renderMonitors(st) {
  const box = $("monitorCards");
  const ids = new Set(st.slots.map((s) => s.id));
  for (const [id, r] of cards) if (!ids.has(id)) { r.root.remove(); cards.delete(id); }
  $("monEmpty").hidden = st.slots.length > 0;
  $("monCount").textContent = st.count + " of 7 monitors";
  $("navCount").textContent = String(st.count);
  $("plus").disabled = st.count >= 7; $("minus").disabled = st.count < 1; $("qrSheet").disabled = st.count < 1;
  for (const s of st.slots) {
    let r = cards.get(s.id);
    if (!r) { r = makeCard(s); cards.set(s.id, r); box.append(r.root); }
    const i = s.id - 1;
    const dig = s.mode === "digital";
    r.root.classList.toggle("off", !s.enabled);
    r.av.className = "avatar " + COLORS[i % 4]; r.av.textContent = initials(s.name || ("M" + s.id));
    if (!focused(r.name)) r.name.value = s.name;
    r.sub.textContent = "Monitor " + s.id + " · " + s.bus + (s.stereo ? " (stereo)" : "");
    r.enabled.checked = s.enabled;
    r.pPhone.className = "pill" + (s.connected ? " ok" : ""); r.pPhone.innerHTML = '<span class="dot' + (s.connected ? " online" : "") + '"></span>' + (s.connected ? "Phone connected" : "No phone");
    r.pAudio.className = "pill" + (s.streaming ? " ok" : ""); r.pAudio.textContent = s.streaming ? "Audio streaming" : "No audio";
    if (s.qr && r.img.getAttribute("src") !== s.qr) r.img.src = s.qr;
    r.url.textContent = s.url; r.urlText = s.url;
    if (!focused(r.mode)) r.mode.value = s.mode;
    r.meter.innerHTML = mini(s.level);
    r.modeNote.textContent = dig ? "Personal mix: individual levels and caps" : "Desk bus control and USB routing";
    r.digital.hidden = !dig; r.desk.hidden = dig;
    if (dig) {
      if (!focused(r.master)) { r.master.value = s.master; paint(r.master); }
      r.masterRead.textContent = db(s.master);
      renderLevels(r, s, st);
    } else {
      if (!focused(r.ceiling)) r.ceiling.value = String(s.ceiling);
      if (!focused(r.usb)) r.usb.value = s.usbChannel;
      r.showAll.checked = !!s.showAll;
      r.usbLabel.textContent = s.stereo ? "First USB channel (L, R = +1)" : "USB channel";
    }
  }
}

// ------------------------------------------------------------------ overview + setup
function renderOverview(st) {
  const enabled = st.slots.filter((s) => s.enabled);
  const connected = enabled.filter((s) => s.connected).length;
  const listening = enabled.filter((s) => s.streaming).length;
  const consoleOk = st.mixer.phase === "ready";
  const usbOk = st.engine.ready && st.engine.inputChannels > 0 && !st.engine.error;
  const empty = enabled.filter((s) => s.mode === "digital" && s.mixChannels.length === 0);
  const saved = st.show.name !== "Untitled show" && !st.show.dirty;
  const missingPhones = enabled.filter((s) => !s.connected);
  const steps = [
    [consoleOk ? "ok" : "bad", consoleOk ? "Console connected" : "Console not connected", consoleOk ? "Network control is ready" : st.mixer.message],
    [usbOk ? "ok" : "warn", usbOk ? "USB audio configured" : "USB audio needs attention", usbOk ? st.engine.inputChannels + " channels available" : (st.engine.error || "Choose the Qu-32 USB input and press Apply")],
    [enabled.length && !empty.length ? "ok" : "warn", enabled.length && !empty.length ? "Musician mixes assigned" : enabled.length ? "Some mixes are empty" : "No monitors yet",
      enabled.length ? (empty.length ? empty.map((s) => s.name || ("Monitor " + s.id)).join(", ") + " has no inputs" : enabled.length + " monitor" + (enabled.length === 1 ? "" : "s") + " configured") : "Add a monitor for each musician"],
    [saved ? "ok" : "warn", saved ? "Show saved" : st.show.dirty ? "Show has unsaved changes" : "Show not saved yet", st.show.name],
    [!enabled.length || !missingPhones.length ? "ok" : "warn", enabled.length && !missingPhones.length ? "All phones connected" : missingPhones.length + " phone" + (missingPhones.length === 1 ? "" : "s") + " not connected",
      enabled.length ? (missingPhones.map((s) => s.name || ("Monitor " + s.id)).join(", ") || "Everyone has joined") : "-"],
  ];
  const ready = steps.every((s) => s[0] === "ok");
  const sig = JSON.stringify(steps);
  if ($("readySteps").dataset.sig !== sig) {
    $("readySteps").dataset.sig = sig; $("readySteps").textContent = "";
    for (const [k, t, sub] of steps) $("readySteps").append(el("div", { className: "step" }, el("span", { className: "check" + (k === "ok" ? "" : k === "warn" ? " warn" : " bad"), textContent: k === "ok" ? "✓" : "!" }), el("span", {}, el("strong", { textContent: t }), el("small", { textContent: sub }))));
  }
  $("readyTag").textContent = steps.filter((s) => s[0] === "ok").length + " of " + steps.length + " steps";
  $("heroEyebrow").textContent = ready ? "● System ready" : "System status";
  $("heroHead").textContent = ready ? "Everything in its place." : "Almost ready.";
  const issue = steps.find((s) => s[0] !== "ok");
  const who = listening || connected;
  $("heroText").textContent = ready
    ? "Your desk is connected, " + who + " musician" + (who === 1 ? " is" : "s are") + " " + (listening ? "listening" : "connected") + ", and your current show is ready."
    : (issue ? issue[1] + ". " + issue[2] : "");
  $("statConsole").innerHTML = consoleOk ? '<span class="ok-dot">●</span> Connected' : "Not connected";
  $("statConsoleSub").textContent = consoleOk ? "Qu-32" + (st.mixer.firmware ? " · firmware " + st.mixer.firmware : "") + " · " + st.mixer.host : st.mixer.message;
  $("statPhones").innerHTML = String(connected).padStart(2, "0") + " <em>/ " + String(enabled.length).padStart(2, "0") + " connected</em>";
  $("statPhonesSub").textContent = listening + " listening now";
  $("statUsb").innerHTML = st.engine.inputChannels + " <em>channels</em>";
  $("statUsbSub").textContent = usbOk ? "USB audio input open" : (st.engine.error ? "Needs attention" : "No input open");

  const list = $("overviewMonitors");
  const osig = enabled.map((s) => [s.id, s.name, s.connected, s.streaming, s.mode, s.bus, Math.floor(s.level * 18)].join(":")).join("|");
  if (list.dataset.sig !== osig) {
    list.dataset.sig = osig; list.textContent = "";
    if (!enabled.length) list.append(el("div", { className: "lv-empty", textContent: "No monitors yet. Open Monitors to add one." }));
    for (const s of enabled) {
      const mng = el("button", { className: "btn btn-ghost btn-icon", ariaLabel: "Manage " + s.name });
      mng.innerHTML = '<span data-icon="arrow"></span>'; mng.onclick = () => open("monitors");
      const meter = el("div", { className: "mini-meter" }); meter.innerHTML = mini(s.level);
      list.append(el("div", { className: "monitor-line" },
        el("div", { className: "avatar " + COLORS[(s.id - 1) % 4], textContent: initials(s.name || ("M" + s.id)) }),
        el("div", { className: "grow" },
          el("div", { className: "name" }, (s.name || ("Monitor " + s.id)) + " ", el("span", { className: "muted nm", textContent: "· " + s.bus })),
          el("small", { textContent: s.connected ? "Phone connected · " + (s.streaming ? "Listening" : "Audio not started") : "Waiting for phone" }), meter),
        el("span", { className: s.connected ? "short-status" : "soft", textContent: s.connected ? "● Online" : "○ No phone" }), mng));
    }
    hydrateIcons(list);
  }
}

function renderSetup(st) {
  const ph = st.mixer.phase;
  const ok = ph === "ready", bad = ph === "offline" || ph === "error";
  $("setupConsolePill").className = "pill " + (ok ? "ok" : bad ? "danger" : "warn");
  $("setupConsolePill").lastChild.textContent = ok ? "Connected" : bad ? "Offline" : "Connecting";
  $("mixerDot").className = "dot " + (ok ? "online" : bad ? "error" : "warn");
  $("mixerLine").textContent = ok ? "Qu-32 online" : "Console " + ph;
  $("mixerSub").textContent = ok ? (st.mixer.firmware ? "· firmware " + st.mixer.firmware : "") : "· " + st.mixer.message;
  if (!focused($("mixerIp")) && !$("mixerIp").value && st.mixer.host) $("mixerIp").value = st.mixer.host;

  const e = st.engine;
  $("usbPill").className = "pill " + (e.inputChannels > 0 && !e.error ? "ok" : "warn");
  $("usbPill").textContent = e.inputChannels > 0 ? e.inputChannels + " channels" : "No input";
  $("audioMsg").textContent = !e.ready ? "Audio engine starting..." : e.error ? e.error : e.inputChannels ? "USB input open: " + e.inputChannels + " channel(s)." : "No USB input open yet.";
  if (e.talkError) $("audioMsg").textContent += " Talkback: " + e.talkError;

  const lan = $("lanIp");
  if (!focused(lan)) {
    const sig = st.lanIps.join(",");
    if (lan.dataset.sig !== sig) { lan.dataset.sig = sig; lan.textContent = ""; for (const ip of st.lanIps) lan.append(new Option(ip, ip)); if (!st.lanIps.length) lan.append(new Option("No network found", "")); }
    lan.value = st.lanIp;
  }
  $("baseUrl").textContent = st.baseUrl;
  $("httpsUrl").textContent = st.httpsUrl;
  $("httpsPill").className = "pill " + (st.httpsUrl === "off" ? "danger" : "ok"); $("httpsPill").textContent = st.httpsUrl === "off" ? "Off" : "On";

  if (!focused($("tbSource"))) { $("tbSource").value = st.settings.micId ? "pc" : "desk"; $("pcMicRow").hidden = !st.settings.micId; }
  if (!focused($("tbStrip"))) $("tbStrip").value = String(st.settings.talkStrip);
  if (!focused($("tbLevel"))) $("tbLevel").value = String(st.settings.talkLevel);
  const ch = st.settings.talkStrip - 0x1f;
  $("talkSourceInfo").textContent = st.settings.micId ? "PC microphone" + (e.talkSource ? "" : " (not open yet)") : "Desk microphone on CH " + ch + (e.talkSource ? "" : " (that USB channel is not available yet)");
  const lv = TB_LEVELS.find((l) => l[1] === st.settings.talkLevel);
  $("talkLevelInfo").textContent = "CH " + ch + " · " + (lv ? lv[0] : db(st.settings.talkLevel));
}

function renderChrome(st) {
  const ph = st.mixer.phase;
  $("consolePill").className = "pill " + (ph === "ready" ? "ok" : ph === "offline" || ph === "error" ? "danger" : "warn");
  $("consoleText").textContent = ph === "ready" ? "Qu-32 online" + (st.mixer.firmware ? " · fw " + st.mixer.firmware : "") : "Console: " + st.mixer.message;
  const enabled = st.slots.filter((s) => s.enabled);
  $("phonesText").textContent = enabled.filter((s) => s.connected).length + " / " + enabled.length + " phones";
  $("sideIp").textContent = st.lanIp ? st.lanIp + ":" + st.baseUrl.split(":").pop() : "No network";
  $("sideDot").className = "dot " + (st.lanIp ? "online" : "error");
  $("sideNet").textContent = st.lanIp ? "LAN ready" : "Connect to Wi-Fi";
  const msgs = [...st.errors];
  if (st.engine.error && st.engine.ready) msgs.push(st.engine.error);
  const errs = $("errors");
  const sig = msgs.join("|");
  if (errs.dataset.sig !== sig) { errs.dataset.sig = sig; errs.textContent = ""; for (const m of msgs) errs.append(el("div", { textContent: m })); }
  errs.hidden = msgs.length === 0;
  $("firstPw").hidden = !st.firstPassword;
  if (st.firstPassword) { $("firstPwText").textContent = st.firstPassword; $("httpsText").textContent = st.httpsUrl; }
}

function render(st) {
  last = st;
  renderChrome(st);
  renderOverview(st);
  renderSetup(st);
  renderMatrix(st);
  renderMonitors(st);
  renderShows(st);
  renderTargets(st);
  if (!devicesLoaded && st.engine.ready) loadDevices(false);
  if (!render.first) { render.first = true; hydrateIcons(document); }
}

async function tick() {
  try { render(await window.hub.getState()); } catch (e) { /* main process busy; try again */ }
  setTimeout(tick, 500);
}
open(location.hash.slice(1) || "overview");
tick();
