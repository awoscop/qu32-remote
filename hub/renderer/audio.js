"use strict";
/*
 * Audio engine (runs in a hidden Electron window).
 *
 *   Qu-32 USB input (up to 32 ch, pre-fader direct outs)
 *        |
 *     splitter ---- digital musician:  per-input gain -> pan -> [bus] -> master -> limiter -> stream
 *        |   `----- desk musician:     chosen USB mix channel(s) -> [bus] -> master -> limiter -> stream
 *        `-------- desk-mic talkback source
 *   PC microphone ------------------- talkback source
 *
 *   stream -> one RTCPeerConnection per phone (Opus, stereo)
 *   talkback also: mic -> gate -> channel N of the Qu USB return (desk-mix musicians, talk via desk sends)
 */
const SAMPLE_RATE = 48000;
const DUCK = 0.5; // musician's mix drops 6 dB while the engineer talks to them

let ctx = null;
let inStream = null, inSrc = null, splitter = null, inChannels = 0;
const slots = new Map(); // slotId -> record
const peers = new Map(); // slotId -> RTCPeerConnection
let missing = [];
let lastError = null;
let lastMix = null; // last digital-mix payload, re-applied whenever the audio graph is rebuilt

// talkback
let tbCtx = null, tbStream = null, tbGate = null, tbError = null, tbConfigured = false;
let talkBus = null, talkSrcDesc = null;
let talkSetup = { micId: "", talkChannel: 0 };

// Official Qu fader law (raw 0..127 -> dB), same table as the SDK.
const PTS = [[0, -Infinity], [12, -45], [16, -40], [23, -35], [31, -30], [39, -25], [47, -20], [54, -15], [63, -10], [79, -5], [98, 0], [114, 5], [127, 10]];
function rawToGain(raw) {
  if (raw <= 0) return 0;
  for (let i = 1; i < PTS.length; i++) {
    const [r1, d1] = PTS[i], [r0, d0] = PTS[i - 1];
    if (raw <= r1) {
      const lo = isFinite(d0) ? d0 : -60;
      const db = raw === r1 ? d1 : lo + ((raw - r0) / (r1 - r0)) * (d1 - lo);
      return Math.pow(10, db / 20);
    }
  }
  return Math.pow(10, 10 / 20);
}

const audioConstraints = (deviceId, channels) => ({
  audio: Object.assign(
    { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: channels } },
    deviceId ? { deviceId: { exact: deviceId } } : {},
  ),
});

async function devices() {
  // labels are only populated after a media permission has been granted once
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } catch (e) { /* no device */ }
  const all = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind) => all.filter((d) => d.kind === kind).map((d) => ({ id: d.deviceId, label: d.label || d.deviceId.slice(0, 8) }));
  return { inputs: pick("audioinput"), outputs: pick("audiooutput") };
}

function ensureCtx() {
  if (!ctx) ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// ------------------------------------------------------------------ per-slot record
function slotRecord(id) {
  let r = slots.get(id);
  if (r) return r;
  const c = ensureCtx();
  r = {
    mode: "desk",
    dest: c.createMediaStreamDestination(),   // stable: phones stay connected across show changes
    bus: c.createGain(),
    master: c.createGain(),
    limiter: c.createDynamicsCompressor(),
    analyser: c.createAnalyser(),
    talkGain: c.createGain(),
    deskMerger: null,
    chains: new Map(),                         // input -> { gain, pan }
    talking: false, masterRaw: 98, muted: false,
  };
  r.dest.channelCount = 2;
  r.limiter.threshold.value = -3; r.limiter.knee.value = 0; r.limiter.ratio.value = 20;
  r.limiter.attack.value = 0.003; r.limiter.release.value = 0.12;
  r.analyser.fftSize = 1024;
  r.buf = new Float32Array(r.analyser.fftSize);
  r.talkGain.gain.value = 0;
  r.bus.connect(r.master); r.master.connect(r.limiter);
  r.talkGain.connect(r.limiter);               // talkback bypasses the musician's own volume
  r.limiter.connect(r.dest); r.limiter.connect(r.analyser);
  slots.set(id, r);
  return r;
}

function applyMaster(r) {
  const lin = r.muted ? 0 : rawToGain(r.masterRaw) * (r.talking ? DUCK : 1);
  r.master.gain.setTargetAtTime(lin, ensureCtx().currentTime, 0.02);
}

function clearChains(r) {
  for (const ch of r.chains.values()) { try { ch.gain.disconnect(); ch.pan.disconnect(); } catch (e) { /* ok */ } }
  r.chains.clear();
}
function clearDesk(r) {
  if (r.deskMerger) { try { r.deskMerger.disconnect(); } catch (e) { /* ok */ } r.deskMerger = null; }
}

function routeDesk(id, channel, stereo) {
  const r = slotRecord(id);
  clearChains(r); clearDesk(r);
  r.mode = "desk";
  r.masterRaw = 98; r.muted = false; applyMaster(r);
  r.deskMerger = ensureCtx().createChannelMerger(2);
  r.deskMerger.connect(r.bus);
  if (!splitter) return;
  const a = channel - 1, b = channel;
  const have = splitter.numberOfOutputs;
  if (a >= have || (stereo && b >= have)) { missing.push(`monitor ${id} (desk mix, USB ${channel})`); return; }
  if (stereo) { splitter.connect(r.deskMerger, a, 0); splitter.connect(r.deskMerger, b, 1); }
  else { splitter.connect(r.deskMerger, a, 0); splitter.connect(r.deskMerger, a, 1); }
}

// ------------------------------------------------------------------ digital mix
/** payload: { slots: [{ slotId, master, muted, channels: [{ input, level, pan }] }] } */
function setMix(payload) {
  lastMix = payload;
  const c = ensureCtx();
  for (const s of payload.slots) {
    const r = slotRecord(s.slotId);
    if (r.mode !== "digital") { clearDesk(r); r.mode = "digital"; }
    r.masterRaw = s.master; r.muted = !!s.muted; applyMaster(r);
    const want = new Set(s.channels.map((x) => x.input));
    for (const [input, ch] of r.chains) {
      if (!want.has(input)) { try { ch.gain.disconnect(); ch.pan.disconnect(); } catch (e) { /* ok */ } r.chains.delete(input); }
    }
    for (const x of s.channels) {
      let ch = r.chains.get(x.input);
      if (!ch) {
        ch = { gain: c.createGain(), pan: c.createStereoPanner() };
        ch.gain.gain.value = 0;
        ch.gain.connect(ch.pan); ch.pan.connect(r.bus);
        if (splitter && x.input - 1 < splitter.numberOfOutputs) splitter.connect(ch.gain, x.input - 1);
        else missing.push(`monitor ${s.slotId} (input ${x.input})`);
        r.chains.set(x.input, ch);
      }
      ch.gain.gain.setTargetAtTime(rawToGain(x.level), c.currentTime, 0.02);
      ch.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (x.pan - 37) / 37)), c.currentTime, 0.02);
    }
  }
  return true;
}

// ------------------------------------------------------------------ capture + configuration
async function configure({ inputId, outputId, micId, returnChannel, mapping, digital, talkChannel }) {
  lastError = null; missing = [];
  const c = ensureCtx();
  if (inStream) inStream.getTracks().forEach((t) => t.stop());
  if (inSrc) { try { inSrc.disconnect(); } catch (e) { /* ok */ } }
  if (splitter) { try { splitter.disconnect(); } catch (e) { /* ok */ } }
  inStream = null; inSrc = null; splitter = null; inChannels = 0;
  try {
    inStream = await navigator.mediaDevices.getUserMedia(audioConstraints(inputId, 32));
    const t = inStream.getAudioTracks()[0];
    inChannels = (t.getSettings && t.getSettings().channelCount) || 2;
    inSrc = c.createMediaStreamSource(inStream);
    inChannels = Math.max(inChannels, inSrc.channelCount || 0);
    splitter = c.createChannelSplitter(Math.max(2, Math.min(32, inChannels)));
    inSrc.connect(splitter);
  } catch (e) {
    lastError = `Cannot open the USB audio input: ${e.message}`;
  }

  const wanted = new Set([...mapping.map((m) => m.slotId), ...digital]);
  for (const [id, r] of slots) {
    if (!wanted.has(id)) { clearChains(r); clearDesk(r); closePeer(id); slots.delete(id); try { r.limiter.disconnect(); } catch (e) { /* ok */ } }
  }
  for (const m of mapping) routeDesk(m.slotId, m.channel, m.stereo);
  for (const id of digital) { const r = slotRecord(id); clearChains(r); r.mode = "digital"; }
  if (lastMix) setMix({ slots: lastMix.slots.filter((s) => digital.includes(s.slotId)) });

  await configureTalkback({ outputId, micId, returnChannel, talkChannel });

  if (inStream && missing.length) {
    lastError = `The USB input provides ${splitter.numberOfOutputs} channel(s), but these need a higher one: ${missing.join("; ")}. ` +
      "On Windows, install the Allen & Heath USB driver and set it to 32 channels, then Apply again.";
  }
}

async function configureTalkback({ outputId, micId, returnChannel, talkChannel }) {
  tbError = null;
  tbConfigured = !!(micId || outputId);
  talkSetup = { micId: micId || "", talkChannel: talkChannel || 0 };
  try {
    if (tbStream) tbStream.getTracks().forEach((t) => t.stop());
    if (tbCtx) await tbCtx.close().catch(() => {});
    if (talkBus) { try { talkBus.disconnect(); } catch (e) { /* ok */ } }
    tbStream = null; tbCtx = null; tbGate = null; talkBus = null; talkSrcDesc = null;
    const c = ensureCtx();

    // PC microphone (used by digital-mix talkback, and by the USB-return path below)
    if (micId) {
      tbStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, deviceId: { exact: micId } },
      });
    }

    // digital-mix talkback source: PC mic, else a desk microphone channel arriving over USB
    talkBus = c.createGain();
    if (tbStream) {
      c.createMediaStreamSource(tbStream).connect(talkBus);
      talkSrcDesc = "PC microphone";
    } else if (talkChannel && splitter && talkChannel - 1 < splitter.numberOfOutputs) {
      splitter.connect(talkBus, talkChannel - 1);
      talkSrcDesc = `desk microphone (USB ${talkChannel})`;
    }
    for (const r of slots.values()) talkBus.connect(r.talkGain);

    // USB-return path: mic -> gate -> channel N of the Qu USB return (desk-mix musicians via desk sends)
    if (micId && outputId) {
      tbCtx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
      if (tbCtx.setSinkId) await tbCtx.setSinkId(outputId);
      const max = tbCtx.destination.maxChannelCount || 2;
      const target = Math.max(1, returnChannel) - 1;
      if (target >= max) throw new Error(`The talkback output only has ${max} channel(s); return channel ${returnChannel} is not available.`);
      tbCtx.destination.channelCount = max;
      tbCtx.destination.channelInterpretation = "discrete";
      const mic = tbCtx.createMediaStreamSource(tbStream);
      tbGate = tbCtx.createGain(); tbGate.gain.value = 0;
      const merger = tbCtx.createChannelMerger(max);
      mic.connect(tbGate); tbGate.connect(merger, 0, target); merger.connect(tbCtx.destination);
      await tbCtx.resume();
    } else if (outputId && !micId) {
      throw new Error("A talkback output is chosen but no microphone. Choose a PC microphone, or clear the output to use a desk microphone.");
    }
  } catch (e) {
    tbError = e.message;
  }
}

/** on: bool. digital: slot ids to talk to in their personal mix. desk: open the USB-return gate (desk-mix musicians). */
function talk({ on, digital = [], desk = false }) {
  for (const [id, r] of slots) {
    const talking = !!on && r.mode === "digital" && digital.includes(id);
    r.talking = talking;
    r.talkGain.gain.setTargetAtTime(talking ? 1 : 0, ensureCtx().currentTime, 0.01);
    applyMaster(r);
  }
  if (on && digital.length && !talkSrcDesc) {
    for (const r of slots.values()) { r.talking = false; r.talkGain.gain.value = 0; applyMaster(r); }
    throw new Error(tbError || "No talkback source. Choose a PC microphone under Audio, or plug a mic into the chosen desk channel and make sure that USB channel is available.");
  }
  if (tbGate) tbGate.gain.setTargetAtTime(on && desk ? 1 : 0, tbCtx.currentTime, 0.01);
  else if (on && desk && tbConfigured && tbError) throw new Error(tbError);
  return true;
}

// ------------------------------------------------------------------ WebRTC out
function tuneOpus(sdp) {
  const m = /a=rtpmap:(\d+) opus\/48000\/2/.exec(sdp);
  if (!m) return sdp;
  const pt = m[1];
  const extra = "stereo=1;sprop-stereo=1;maxaveragebitrate=96000;useinbandfec=1;minptime=10;cbr=0";
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  return re.test(sdp) ? sdp.replace(re, (_x, p) => `a=fmtp:${pt} ${p};${extra}`) : sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${extra}`);
}

function closePeer(id) {
  const pc = peers.get(id);
  if (pc) { try { pc.close(); } catch (e) { /* ok */ } peers.delete(id); }
}

async function offer({ slotId, sdp }) {
  const r = slots.get(slotId);
  if (!r) throw new Error("This monitor is not routed to an audio source yet");
  closePeer(slotId);
  const pc = new RTCPeerConnection({ iceServers: [] });
  peers.set(slotId, pc);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") { if (peers.get(slotId) === pc) peers.delete(slotId); }
  };
  await pc.setRemoteDescription({ type: "offer", sdp });
  const t = pc.getTransceivers()[0];
  t.direction = "sendonly";
  await t.sender.replaceTrack(r.dest.stream.getAudioTracks()[0]);
  const answer = await pc.createAnswer();
  answer.sdp = tuneOpus(answer.sdp);
  await pc.setLocalDescription(answer);
  await new Promise((res) => {
    if (pc.iceGatheringState === "complete") return res();
    const timer = setTimeout(res, 2500);
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(timer); res(); } };
  });
  return pc.localDescription.sdp;
}

const handlers = {
  devices,
  configure,
  setMix,
  offer,
  hangup: ({ slotId }) => { closePeer(slotId); return true; },
  talk,
};

window.engine.onCommand(async (id, method, args) => {
  try {
    const fn = handlers[method];
    if (!fn) throw new Error(`Unknown method ${method}`);
    window.engine.reply(id, true, await fn(args));
  } catch (e) {
    window.engine.reply(id, false, e && e.message ? e.message : String(e));
  }
});

// Status + meters, ~5 times a second
setInterval(() => {
  const levels = {}, streaming = {};
  for (const [id, r] of slots) {
    r.analyser.getFloatTimeDomainData(r.buf);
    let sum = 0;
    for (let i = 0; i < r.buf.length; i++) sum += r.buf[i] * r.buf[i];
    levels[id] = Math.min(1, Math.sqrt(sum / r.buf.length) * 3);
  }
  for (const [id, pc] of peers) streaming[id] = pc.connectionState === "connected";
  window.engine.status({
    inputChannels: splitter ? splitter.numberOfOutputs : 0,
    missing, levels, streaming,
    error: lastError, talkError: tbError, talkSource: talkSrcDesc,
  });
}, 200);
