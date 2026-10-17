# QU32 Secure Remote — Design & Project Structure

Blueprint for an Android + iPhone app that controls an Allen & Heath **Qu-32** over IP, with two experiences:

- **Full Console Mode** (engineer): Qu-Pad-style control of the whole desk.
- **Monitor Mix Mode** (musician): a simplified view locked to one engineer-assigned monitor bus.

Both talk to an **authenticated local gateway**, which holds the single MIDI-over-TCP link to the console.

> **Status legend:** ✅ built in V3 (simulator-tested only) · 🟡 built, needs hardware verification · 🔲 planned.
> Nothing here has been verified against a physical Qu-32 yet. Treat every console command as unproven until the hardware checklist (section 12) passes, with the PA safely attenuated.

---

## 1. Goals and non-goals

**Goals**
1. Engineer can run the whole service from a phone/tablet on Wi-Fi.
2. Each musician mixes only their own monitor bus, from their own phone.
3. A musician cannot reach Full Console features, enforced server-side, not just by hiding buttons.
4. Phone UI reflects changes made on the physical desk (two-way sync).
5. Installable on Android and iPhone.

**Non-goals (for now)**
- Full Qu-Pad parity. The published MIDI protocol does not document every Qu-Pad feature (e.g. RTA, some metering, library/user management).
- Internet/remote access. Local network only.
- Qu-16/Qu-24/Qu-SB variants (the protocol is shared, but channel counts and routing differ; keep the console model data-driven so they can be added).

---

## 2. Architecture

```
 Engineer phone ─┐
 Musician phone ─┼─ HTTPS / WSS ─►  Gateway (PC on LAN)  ── TCP 51325 ──►  Qu-32
 Musician phone ─┘                  auth · roles · state                    (one MIDI TCP
                                    cache · rate limit                       client at a time)
```

**Why a gateway:** the Qu-32 accepts one TCP MIDI connection at a time. The gateway owns that connection, keeps a cached copy of console state, and fans it out to many authenticated phones. It is also the only place permissions can be enforced safely.

**Components**

| Component | Role |
|---|---|
| `qu-protocol` | Pure functions: build/parse Qu MIDI messages (NRPN/SysEx), no I/O. Fully unit-testable. |
| `qu-connection` | TCP client to console: connect, keepalive, reconnect, initial state sync, command queue with throttling. |
| `state-store` | In-memory console model (channels, mixes, mutes, names, scenes) updated from console feedback. |
| `auth` | Accounts, password hashing, sessions/tokens, revocation. |
| `permissions` | Role + assignment → allowed command set. Applied to every inbound command. |
| `ws-api` | WebSocket protocol between phones and gateway. |
| `client-sdk` | TypeScript SDK used by the app: connect, login, subscribe, send intents. |
| `app` | UI: Full Console and Monitor screens. |

**Distribution paths for the phone app**
1. **PWA** served by the gateway over HTTPS, added to home screen (fastest; no store, no APK). ✅
2. **Native build** (React Native / Expo dev build) producing an APK / IPA. 🔲 (source exists; binary never compiled)

---

## 3. Roles and permissions

| Role | Can do | Cannot do |
|---|---|---|
| `engineer` | Everything: connect/disconnect console, create/disable users, assign buses, all console controls, scenes | — |
| `musician` | Adjust send levels (and pan on stereo mixes) from sources into **their assigned bus**; assigned-bus master level | Main LR, channel faders/mutes, other buses, gain/phantom, EQ/dynamics, routing, scenes, user admin |

**Rules**
- The gateway checks `(user, command)` on **every** inbound message. UI hiding is cosmetic.
- A musician's assigned bus is stored on the account, never taken from the client.
- Reassigning or disabling a musician **revokes live sessions immediately** (sockets closed, tokens invalid). ✅
- First run generates an engineer password and prints it once. Passwords stored hashed (scrypt/argon2), never plaintext.
- Failed-login rate limiting; short-lived access tokens; commands rate-limited per session so a runaway slider cannot flood the desk.
- Hard limits on musician sends: optional per-bus **max level ceiling** set by the engineer (protects ears and PA).

---

## 4. Console model (Qu-32)

| Item | Count | Notes |
|---|---|---|
| Input channels | 32 mono | + stereo inputs per desk config |
| Mono monitor mixes | 4 | Mix 1–4 |
| Stereo monitor mixes | 3 pairs | Mix 5/6, 7/8, 9/10 |
| FX sends/returns | 4 | |
| Groups | DCA, mute groups, audio groups | |
| Main | LR | |

The console model is data-driven (`consoles/qu32.ts`) so bus types (mono/stereo), counts and labels are not hard-coded in UI code.

**Protocol facts to verify against the official *Qu Mixer MIDI Protocol* PDF (V1.9+) before relying on them**
- TCP port **51325**, one client at a time.
- Control via MIDI over TCP: NRPN for levels/mutes/sends/pan, SysEx for requests (state sync, scenes, names).
- MIDI base channel is configurable on the desk; the gateway must expose it as a setting.
- Reference implementation worth reading: Bitfocus Companion `companion-module-allenheath-qu`.

---

## 5. Gateway ⇄ app protocol (WebSocket, JSON)

Client → gateway (**intents**, validated and permission-checked):

```json
{ "t": "set", "target": "send", "src": "ch5", "bus": "mix3", "value": 0.62 }
{ "t": "set", "target": "mute", "src": "ch5", "value": true }
{ "t": "scene.recall", "n": 12 }
```

Gateway → client:

```json
{ "t": "hello", "role": "musician", "bus": "mix3", "console": "connected" }
{ "t": "state", "snapshot": { "...filtered to what the role may see..." } }
{ "t": "delta", "path": "send.ch5.mix3", "value": 0.62 }
{ "t": "error", "code": "FORBIDDEN", "msg": "..." }
```

- Values are normalized `0..1` on the wire; `qu-protocol` converts to/from the desk's 7-bit/14-bit values and dB.
- Musician snapshots are **filtered** server-side: they receive only their bus, source names and levels.
- Echo suppression: while a user drags a fader, incoming deltas for that control are ignored client-side to avoid jitter.

---

## 6. Screens

### Full Console (engineer)
1. **Channels**: 32 faders in banks of 8 (or all, on tablet), mute, name, selected-channel strip.
2. **Mixes/FX**: pick bus (Mix 1–10, FX 1–4) → per-channel send levels, pan on stereo.
3. **Outputs**: Main LR, group/DCA levels, mute groups.
4. **Processing** 🔲: preamp gain, phantom (confirm dialog), HPF, gate, EQ (graphical), compressor.
5. **Scenes**: list, recall with confirm, store 🔲.
6. **Gateway admin**: console IP/base channel, users, bus assignments, level ceilings, connection health.

### Monitor Mix (musician)
1. Large vertical faders for each source in **my mix**, grouped (Vocals / Band / Click).
2. Stereo pan per source when the bus is stereo.
3. "More me" shortcut: pin up to 4 favourite sources to the top 🔲.
4. Mix master level (subject to ceiling).
5. No navigation to other screens; no mode toggle visible to musician accounts.

### Mode switch
- Engineer sees a **Full Console / Monitor Only** toggle (useful for walking the stage as a musician).
- For musician accounts the toggle does not exist, and the server would reject Full Console commands regardless.

---

## 7. Project structure

```
qu32-remote/
├─ README.md
├─ docs/
│  ├─ DESIGN.md                    ← this file
│  ├─ PROTOCOL-NOTES.md            ← Qu MIDI message tables we actually use, with hardware-verified flags
│  ├─ SECURITY.md                  ← threat model, cert install, password reset
│  └─ HARDWARE-TEST-PLAN.md        ← section 12 checklist with results
├─ packages/
│  ├─ qu-protocol/                 ← pure MIDI encode/decode
│  │  ├─ src/{nrpn.ts,sysex.ts,levels.ts,messages.ts,index.ts}
│  │  └─ test/
│  ├─ console-model/               ← qu32 channel/bus definitions, value scaling
│  │  └─ src/{qu32.ts,types.ts,scale.ts}
│  ├─ client-sdk/                  ← used by the app; wraps WebSocket + auth
│  │  └─ src/{client.ts,store.ts,types.ts}
│  └─ shared/                      ← wire-protocol types shared by gateway and app
│     └─ src/{wire.ts,roles.ts}
├─ apps/
│  ├─ gateway/                     ← Node.js service on the LAN PC
│  │  ├─ src/
│  │  │  ├─ server.ts              ← HTTPS + WSS, serves PWA
│  │  │  ├─ qu-connection.ts       ← TCP link, keepalive, reconnect, resync
│  │  │  ├─ state-store.ts
│  │  │  ├─ auth/{accounts.ts,sessions.ts,hash.ts,rate-limit.ts}
│  │  │  ├─ permissions.ts         ← role/assignment → allowed intents
│  │  │  ├─ command-queue.ts       ← throttle + coalesce fader moves
│  │  │  ├─ config.ts              ← console IP, base channel, ports
│  │  │  └─ mock-console.ts        ← simulator for tests/dev
│  │  ├─ data/                     ← accounts.json, certs (gitignored)
│  │  ├─ scripts/{start-gateway.ps1,start-gateway.sh,make-cert.*}
│  │  └─ test/                     ← auth, permissions, revocation, sync
│  └─ mobile/                      ← React Native (Expo) + PWA build
│     ├─ app/                      ← screens (expo-router)
│     │  ├─ login.tsx
│     │  ├─ (engineer)/{channels,mixes,outputs,processing,scenes,admin}.tsx
│     │  └─ (musician)/mix.tsx
│     ├─ src/{components/{Fader,PanKnob,MuteButton,ChannelStrip,Eq}.tsx,hooks/,theme/}
│     └─ app.json, eas.json
├─ .github/workflows/
│  ├─ test.yml                     ← protocol + gateway tests on every push
│  └─ build-android.yml            ← EAS / Gradle APK build
└─ package.json                    ← workspaces
```

> If this is added inside the existing church-presentation-suite monorepo, place it as `apps/qu32-gateway`, `apps/qu32-mobile` and `packages/qu-protocol`, `packages/qu-console-model`, matching the existing `apps/*` / `packages/*` workspace layout.

---

## 8. Technology choices

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript everywhere | One type set for wire protocol, gateway, app |
| Gateway runtime | Node.js 20+ (`net`, `ws`) | Simple TCP + WebSocket, runs on Windows church PC |
| App | React Native + Expo dev build; PWA fallback | One codebase for Android/iOS; Expo Go cannot do raw TCP but the app does not need TCP (only WebSocket to gateway) |
| TLS | Self-signed cert, installed/trusted on phones | Needed for PWA install + secure WebSocket on LAN |
| Tests | Vitest/Jest + mock console | Protocol and permission logic is testable without hardware |

Note: because phones talk to the **gateway** over WebSocket, the app itself needs no raw-TCP native module. The earlier V1/V2 direct-TCP design (`react-native-tcp-socket`) can remain as an optional "direct mode" for single-user use.

---

## 9. Reliability and safety

- **Reconnect:** gateway retries the console link with backoff; phones show "Console offline" and disable controls; state is re-synced on reconnect.
- **Keepalive:** periodic active-sensing/ping so a dead link is noticed within seconds.
- **Throttling:** coalesce fader drags to ~20–30 msgs/s per control to avoid saturating the desk.
- **Dangerous actions need confirmation** (engineer only): phantom power, scene recall, Main LR unmute from silence.
- **Level ceilings** for musician buses (section 3).
- **Single-writer lock** is not needed for levels (last write wins), but scene recall is serialized.
- **Audit log:** who changed what (user, control, old → new, time), kept for the last N hours.
- **Failure mode:** if the gateway dies, the desk keeps its current state. Nothing in this system is required for audio to pass.

---

## 10. Feature status

| Feature | Status |
|---|---|
| IP connection, state sync, keepalive | ✅ (simulator) / 🟡 |
| 32 channel faders, mutes, names | ✅ / 🟡 |
| Main LR fader + mute | ✅ / 🟡 |
| Mix 1–10 sends, stereo pan | ✅ / 🟡 |
| FX sends | ✅ / 🟡 |
| Scene recall | ✅ / 🟡 |
| Accounts, roles, bus assignment, revocation | ✅ tested |
| Musician restricted to assigned bus (server-enforced) | ✅ tested |
| PWA install | ✅ provided, not tested on device |
| Native APK / IPA | 🔲 source ready, never compiled |
| DCA / mute-group / audio-group control | 🟡 partial |
| Preamp gain, phantom, HPF, gate, comp | 🔲 UI partial |
| Graphical EQ | 🔲 |
| Live meters | 🔲 (protocol support limited; verify) |
| Scene store, user-assignable layers | 🔲 |
| Per-bus level ceiling, audit log, "more me" | 🔲 |

---

## 11. Roadmap

1. **M1 — Hardware bring-up** (PA muted): connect to the real desk, verify channel fader/mute/send/pan, name read, state sync both ways. Record results in `HARDWARE-TEST-PLAN.md`.
2. **M2 — Installable build:** run the PWA on one Android + one iPhone; produce APK via EAS/GitHub Actions; sideload; TestFlight or ad-hoc IPA if needed.
3. **M3 — Musician hardening:** level ceilings, "more me", reconnect UX, audit log, load test with 6+ phones.
4. **M4 — Engineer depth:** DCA/mute groups, gain/phantom, EQ, dynamics, scene store.
5. **M5 — Metering and polish:** meters if protocol allows, tablet layout, dark/stage mode, accessibility.

---

## 12. Hardware verification checklist

Run with amps/PA off or sends to PA muted.

- [ ] Gateway connects to desk IP on TCP 51325; second client is correctly refused or handled.
- [ ] Initial sync matches desk (names, faders, mutes, mix sends).
- [ ] Moving a physical fader updates the phone; moving the phone fader moves the desk.
- [ ] Mute/unmute channel; Main LR mute.
- [ ] Mix 1–4 mono sends; Mix 5–10 stereo sends + pan.
- [ ] FX sends.
- [ ] Scene recall (with confirm).
- [ ] Unplug Ethernet / reboot desk: gateway reconnects and resyncs.
- [ ] Musician account cannot send any non-assigned command (try raw WebSocket messages, not just the UI).
- [ ] Reassign musician to another bus mid-session: old session dropped, new one sees the correct bus.
- [ ] 6+ phones simultaneously, dragging faders: no dropped link, acceptable latency.
- [ ] Confirm MIDI base channel and any firmware version differences (Qu firmware ≥ V1.9 for the protocol document referenced).

---

## 13. Open questions

1. Will the gateway run on a dedicated PC or the existing church presentation PC? (Affects service/auto-start setup.)
2. Dedicated Wi-Fi access point for musicians? (Strongly recommended; avoid congested guest Wi-Fi.)
3. Is iOS distribution via TestFlight acceptable, or is PWA-only enough for iPhones?
4. Should engineer and musicians ever share a bus view (e.g. engineer "listens in" to a musician mix)?
5. Any integration wanted with the presentation suite (e.g. scene recall tied to service-order items)?
