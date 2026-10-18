"use strict";
/*
 * Audio engine (runs in a hidden Electron window).
 *
 *  Qu-32 USB input (up to 32 ch) -> splitter -> per-slot [mono|stereo] merger -> MediaStreamDestination
 *       -> one RTCPeerConnection per phone (Opus, stereo)
 *  Mic -> gate -> channel N of the USB return device (talkback)
 */
const SAMPLE_RATE = 48000;

let ctx = null;
let inStream = null, inSrc = null, splitter = null, inChannels = 0;
const slots = new Map(); // slotId -> { dest, merger, analyser, buf, channel, stereo }
const peers = new Map(); // slotId -> RTCPeerConnection
let missing = [];
let lastError = null;

// talkback
let tbCtx = null, tbStream = null, tbGate = null, tbError = null, tbTalking = false;

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

function slotRecord(id) {
  let r = slots.get(id);
  if (!r) {
    const c = ensureCtx();
    const dest = c.createMediaStreamDestination();
    dest.channelCount = 2;
    r = { dest, merger: null, analyser: c.createAnalyser(), channel: 0, stereo: false };
    r.analyser.fftSize = 1024;
    r.buf = new Float32Array(r.analyser.fftSize);
    slots.set(id, r);
  }
  return r;
}

function routeSlot(id, channel, stereo) {
  const r = slotRecord(id);
  const c = ensureCtx();
  if (r.merger) { try { r.merger.disconnect(); } catch (e) { /* ok */ } }
  r.merger = c.createChannelMerger(2);
  r.merger.connect(r.dest);
  r.merger.connect(r.analyser);
  r.channel = channel; r.stereo = stereo;
  if (!splitter) return;
  const a = channel - 1, b = channel; // 0-based
  const have = splitter.numberOfOutputs;
  if (a >= have || (stereo && b >= have)) { missing.push(id); return; }
  if (stereo) { splitter.connect(r.merger, a, 0); splitter.connect(r.merger, b, 1); }
  else { splitter.connect(r.merger, a, 0); splitter.connect(r.merger, a, 1); }
}

async function configure({ inputId, outputId, micId, returnChannel, mapping }) {
  lastError = null; missing = [];
  const c = ensureCtx();
  // ----- capture
  if (inStream) { inStream.getTracks().forEach((t) => t.stop()); }
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
  // ----- slots
  const wanted = new Set(mapping.map((m) => m.slotId));
  for (const [id, r] of slots) if (!wanted.has(id)) { try { r.merger && r.merger.disconnect(); } catch (e) { /* ok */ } slots.delete(id); closePeer(id); }
  for (const m of mapping) routeSlot(m.slotId, m.channel, m.stereo);
  if (inStream && missing.length) {
    lastError = `The USB input only provides ${splitter.numberOfOutputs} channel(s), but monitor ${missing.join(", ")} needs a higher channel. ` +
      `On Windows, install the Allen & Heath USB driver and set it to 32 channels, then Apply again.`;
  }
  // ----- talkback
  await configureTalkback({ outputId, micId, returnChannel });
}

async function configureTalkback({ outputId, micId, returnChannel }) {
  tbError = null;
  try {
    if (tbStream) tbStream.getTracks().forEach((t) => t.stop());
    if (tbCtx) { await tbCtx.close().catch(() => {}); }
    tbStream = null; tbCtx = null; tbGate = null;
    if (!micId && !outputId) return; // talkback not configured yet
    tbCtx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    if (outputId && tbCtx.setSinkId) await tbCtx.setSinkId(outputId);
    const max = tbCtx.destination.maxChannelCount || 2;
    const target = Math.max(1, returnChannel) - 1;
    if (target >= max) throw new Error(`The talkback output only has ${max} channel(s); return channel ${returnChannel} is not available.`);
    tbCtx.destination.channelCount = max;
    tbCtx.destination.channelInterpretation = "discrete";
    tbStream = await navigator.mediaDevices.getUserMedia({
      audio: Object.assign({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, micId ? { deviceId: { exact: micId } } : {}),
    });
    const mic = tbCtx.createMediaStreamSource(tbStream);
    tbGate = tbCtx.createGain();
    tbGate.gain.value = 0; // closed until the engineer holds the talk button
    const merger = tbCtx.createChannelMerger(max);
    mic.connect(tbGate);
    tbGate.connect(merger, 0, target);
    merger.connect(tbCtx.destination);
    await tbCtx.resume();
  } catch (e) {
    tbError = e.message;
  }
}

function talk({ on }) {
  tbTalking = !!on;
  if (!tbGate) { if (on) throw new Error(tbError || "Talkback microphone / USB return is not configured. Choose them under Audio and press Apply."); return true; }
  tbGate.gain.setTargetAtTime(on ? 1 : 0, tbCtx.currentTime, 0.01);
  return true;
}

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
  if (!r) throw new Error("This monitor is not routed to an audio channel yet");
  closePeer(slotId);
  const pc = new RTCPeerConnection({ iceServers: [] });
  peers.set(slotId, pc);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") { if (peers.get(slotId) === pc) peers.delete(slotId); }
  };
  await pc.setRemoteDescription({ type: "offer", sdp });
  const t = pc.getTransceivers()[0];
  t.direction = "sendonly";
  const track = r.dest.stream.getAudioTracks()[0];
  await t.sender.replaceTrack(track);
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
    error: lastError, talkError: tbError,
  });
}, 200);
