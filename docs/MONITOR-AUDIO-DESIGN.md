# QU32 Hub: Phone Monitors by QR Code (audio + mix control + talkback)

Goal: each instrumentalist scans a QR code with their phone camera and, with **no app install**, hears their own
monitor mix and controls it. The engineer picks how many monitors, and can talk to any mix. Everything runs from
one PC connected to the Qu-32 by USB-B and Ethernet.

Status: **Phases 1-5 built** (QR slots + web page, Hub desktop app, audio streaming, talkback) and verified against a simulated Qu-32 with fake audio devices
(WebRTC audio reaches a browser, talkback raises and releases the right desk sends). **Not yet verified on a real Qu-32:** multichannel USB capture on Windows (section 6), real
latency, iPhone Safari behaviour, and the talkback return path. Builds on the existing `sdk/`, `gateway/`, `mobile/` (control side is already built and simulator-tested).

---

## 1. How it fits together

```
                       ┌──────────────── QU32 Hub (desktop app on the PC) ────────────────┐
 Qu-32 ──USB-B audio──►│ audio capture ─► per-mix Opus streams ──┐                         │
 Qu-32 ◄─USB-B audio───│ talkback player ◄── mic (PC or phone)   │   WebRTC (UDP, LAN)     │──► Musician phone (browser)
 Qu-32 ◄─Ethernet MIDI─│ gateway (existing): accounts, policy,   ├────────────────────────►│     listen + faders
                       │   state cache, MIDI-over-TCP link       │   HTTP(S) + signalling  │
                       │ monitor slots + QR codes                │                         │
                       └─────────────────────────────────────────┴─────────────────────────┘
```

- **Control** (faders, pan, mute) already works: phone -> gateway -> Qu MIDI (TCP 51325).
- **Audio** is new: USB-B streams from the desk into the PC, which sends each mix to the phone assigned to it.
- The Qu-32's network port carries MIDI only. Audio must come in over USB.

## 2. Engineer flow (desktop app)

1. Open **QU32 Hub**. Pick the Qu-32 USB audio device and enter the console IP.
2. Choose **number of monitors** (1 to 7). Slots map in order to Mix 1, 2, 3, 4, 5-6, 7-8, 9-10 (shown on each card, with mono/stereo).
3. Each slot card shows a **QR code**, a name field ("Drums"), a status ("Connected: iPhone"), and **Regenerate QR** (revokes the old one).
4. **Talkback** panel: pick destination mixes (one, several, or all), hold to talk (mic of the PC, or later the engineer's phone).
5. Engineer can still open the full-console app for everything else.

## 3. Musician flow (no install)

1. Scan the QR code with the phone camera. It opens `http://<hub-ip>:8080/m/<slot-token>`.
2. Tap **Start listening** (browsers require a tap before playing audio). Audio starts; faders appear for the sources in that mix.
3. Move a fader: level changes in their mix only. They can never see or change other mixes, Main LR, scenes, or settings.
4. If the engineer regenerates the QR or disables the slot, the page is disconnected immediately.

## 4. Security model

- A QR token is 128-bit random, bound server-side to **one slot -> one bus**. It is exchanged for a normal gateway session
  (`role = monitor`, `busIndex = slot's bus`), so the existing policy engine enforces everything (30 tests already cover this).
  No usernames or passwords for musicians. Credentials for the engineer stay as they are today.
- Regenerate = old token dead and live session dropped.
- Musician page is served over **plain HTTP on the LAN** so a private-CA warning never appears (that would break "no install").
  Trade-off: anyone sniffing that Wi-Fi could capture a slot token. Use a **dedicated, WPA2/3-protected access point** for stage
  monitors, never guest Wi-Fi, and never port-forward the hub. Worst case a stolen token only controls one monitor mix.
- Engineer features (admin, scenes, talkback from a phone mic) require HTTPS and an authenticated engineer session.

## 5. Audio path

| Piece | Choice |
|---|---|
| Capture | Qu-32 USB-B as multichannel input on the PC. Mix outputs must be routed to USB channels on the desk (verify what the Qu-32 can route to USB on your firmware). Mix 1-4 mono + 3 stereo mixes = 10 channels. |
| Process | One shared capture; per slot pick that mix's channel(s), downmix mono mixes to both ears. |
| Encode/transport | WebRTC, Opus (stereo, ~96 kbps) per phone, UDP on the LAN. Signalling over the hub's HTTP API. Playout delay hint set to the minimum. |
| Playback | Browser `<audio>` / Web Audio on the phone, through whatever earbuds are plugged in. |
| Talkback | Mic -> hub -> a spare USB return channel -> a Qu input channel (no preamp, source = USB) -> that channel's sends to the selected mixes are turned up/down by the existing `sendLevel` command. Release = sends back to 0 (fail-safe). |

### Realistic expectations

- **Latency:** expect roughly 50-150 ms phone-side on good 5 GHz Wi-Fi. That suits reference mixes, click, and listening players.
  Singers and drummers who rely on true in-ear timing may find it late. Keep a wired or dedicated wireless IEM option for them.
- **Screen lock / background:** browsers (especially iPhone Safari) may pause audio when the screen locks or the page is
  backgrounded. The page uses a wake-lock/keep-screen-on fallback, but this is the main weakness of "no install". The native app
  (already in `mobile/`) is the fallback for anyone who needs reliable background audio.
- **Wi-Fi:** one dedicated access point, 5 GHz, WMM on, no client isolation. 7 phones x ~100 kbps is small, but retransmits cause dropouts.
- **Safe volume:** limit enforcement belongs on the desk (limiter on each mix output) and the hub applies a per-slot max send ceiling.

## 6. Biggest technical risk (do this first)

Capturing **10+ channels from the Qu USB device on Windows**. Browsers and Windows shared-mode audio often expose only 2 channels
from a device. Phase 0 is a half-day spike on the real PC to find out what works:

1. List the Qu USB device and the channel count Electron's `getUserMedia` actually returns (with and without the A&H driver, shared vs exclusive).
2. If under 10 channels: switch the capture to a native module (PortAudio/ASIO via a small Node addon, or ffmpeg) feeding the same pipeline.
3. Measure end-to-end delay (desk -> phone) with a click test.

Nothing else should be built before this result, because it decides the capture architecture.

## 7. Build phases

| Phase | Deliverable | Needs hardware? |
|---|---|---|
| 0 | USB capture spike + latency measurement | Yes (Qu-32 + PC + 1 phone) |
| 1 | **Slots + QR + web monitor page (control only)**: slot model and tokens in the gateway, `/m/<token>` page with faders, hub admin UI with monitor count and QR cards. Fully testable with the simulator. | No |
| 2 | Hub desktop shell (Electron, packaged installer) wrapping the gateway + admin UI | No |
| 3 | **Audio streaming**: capture, per-mix Opus, WebRTC to the browser page | Yes |
| 4 | Talkback (PC mic first; phone mic needs HTTPS, so via the app) | Yes |
| 5 | Polish: names, favourites ("more me"), per-slot level ceiling, reconnect UX, audit | Partly |

Phase 1 and 2 are safe to build now and are useful even without audio (musicians mix from their phone by QR instead of a password).

## 8. Decisions already made / still open

Made: PC + USB-B + Ethernet; QR join, no app install; engineer picks monitor count in the desktop app; slots map to Mix 1-7 in order.

Open (defaults in brackets):
1. Desktop shell [Electron, same toolchain as the church presentation suite].
2. Musician page over HTTP on a dedicated AP [yes] vs HTTPS with a trusted certificate (needs a domain or installing a CA on every phone).
3. Talkback source [PC mic first; phone mic later].
4. Max ceiling per slot on sends [on, default 0 dB].

---

## 9. Digital mix and show files (added)

The default mix type is now a **digital personal mix** inside the Hub, not a desk Mix bus:

- The Hub reads input channels from the USB capture (input N = USB channel N, ideally pre-fader direct outs) and mixes a stereo stream per musician
  (per-input gain and pan, a master volume, and a safety limiter before the stream is encoded).
- The engineer assigns inputs per musician in the Mix designer and sets a start level, a maximum and an optional lock per input.
- Musician faders move Hub gains only. Nothing is sent to the desk, so the number of musicians is not limited by the desk's 7 monitor buses (the Hub currently offers 7).
- A **show file** (`.qu32show.json`) stores musician names, assigned inputs, levels, limits and master levels. Opening a show changes every phone live; QR codes do not change.
- Talkback is mixed into the selected musicians' streams (PC mic, or a desk mic arriving on a USB channel), with a 6 dB duck of their mix and a 60 s cap.
- The old **desk mix** type remains per musician.

Because audio is mixed on the PC from USB channels, the engineer's desk faders do not affect musician mixes only if the desk's USB send is pre-fader.
