# QU32 Mobile App & Client SDK — Design

Companion to [QU32-REMOTE-DESIGN.md](QU32-REMOTE-DESIGN.md). That doc covers the whole system; this one specifies the **phone app (APK/IPA)** and the **client SDK** it is built on.

Status: design only. No code in this repo yet. Console behaviour is unverified on hardware.

---

## 1. Scope

| Deliverable | What it is |
|---|---|
| `@qu32/client-sdk` | TypeScript library: login, WebSocket link to the gateway, live console state, typed control intents. Framework-agnostic; usable from React Native, a PWA, or Node scripts. |
| `qu32-mobile` | React Native (Expo) app using the SDK. Two experiences: Engineer (Full Console) and Musician (Monitor Mix). Built to APK (Android) and IPA (iOS); same code also exports as a PWA. |

The app **never opens a TCP socket to the console**. It speaks only HTTPS/WSS to the gateway, so no native TCP module is needed and Expo's standard dev build is enough.

---

## 2. Client SDK

### 2.1 Public API

```ts
import { Qu32Client } from '@qu32/client-sdk';

const client = new Qu32Client({ gatewayUrl: 'https://192.168.1.50:8443' });

// Auth
const session = await client.login({ username, password });   // → { role, bus?, displayName }
await client.logout();

// Connection lifecycle
client.on('status', s => ...);        // 'connecting' | 'online' | 'gateway-lost' | 'console-offline'
client.on('revoked', reason => ...);  // account disabled / reassigned → force re-login

// State (read)
client.state.channel(5);              // { name, fader, mute, pan, sendTo: {mix3: 0.62}, color }
client.state.bus('mix3');             // { name, type: 'mono'|'stereo', master, mute }
client.state.scenes();                // [{ n, name }]
client.subscribe(selector, cb);       // fine-grained updates, returns unsubscribe

// Control (write) — intents, not raw MIDI
client.setFader('ch5', 0.7);
client.setMute('ch5', true);
client.setSend('ch5', 'mix3', 0.62);
client.setPan('ch5', 'mix3', -0.2);
client.setBusMaster('mix3', 0.8);
client.recallScene(12);               // engineer only; returns Promise<void>, rejects FORBIDDEN
```

### 2.2 Internal modules

```
client-sdk/src/
├─ client.ts          Qu32Client facade
├─ transport.ts       WebSocket wrapper: auto-reconnect with backoff, ping/pong, resume token
├─ auth.ts            login/logout, token storage via injected SecureStorage
├─ store.ts           normalized state tree + selector subscriptions (no React dependency)
├─ intents.ts         typed intent builders + client-side pre-validation (range 0..1, known ids)
├─ throttle.ts        coalesce drags: ≤ 25 msgs/s per control, always send final value on release
├─ optimistic.ts      local-echo with rollback; ignore inbound deltas for a control while it is being dragged
├─ errors.ts          FORBIDDEN, CONSOLE_OFFLINE, SESSION_REVOKED, RATE_LIMITED, TIMEOUT
└─ index.ts
```

### 2.3 Behavioural rules

- **Optimistic UI:** fader moves update the local store immediately. If the gateway returns `error`, roll back to last confirmed value.
- **Drag guard:** while a control is held, inbound deltas for it are dropped, then reconciled on release (prevents jitter when the desk echoes).
- **Reconnect:** exponential backoff 0.5 s → 8 s; on reconnect the SDK requests a fresh snapshot instead of trusting stale state. Controls are disabled while `status !== 'online'`.
- **Role-shaped state:** the SDK exposes whatever the gateway sent. A musician's store contains only their bus, so UI cannot accidentally show other buses.
- **Secrets:** tokens go through an injected `SecureStorage` interface (Expo SecureStore on device, memory in tests). Passwords are never persisted.
- **Platform adapters:** `SecureStorage`, `WebSocket` and `fetch` are injected, so the SDK runs in RN, browsers and Node tests with no changes.
- **Versioning:** wire protocol carries `v`. If the gateway is newer/older than the SDK supports, the app shows "Update app / gateway" rather than misbehaving.

### 2.4 React bindings (`@qu32/client-sdk/react`)

```ts
const fader = useChannelFader('ch5');        // [value, setValue]
const mute  = useChannelMute('ch5');
const send  = useSend('ch5', 'mix3');        // [level, setLevel]
const status = useConnectionStatus();
const me    = useSession();                  // role, assigned bus
```

Built on `useSyncExternalStore` against `store.ts` so only the touched control re-renders.

---

## 3. App structure

```
apps/qu32-mobile/
├─ app.json                 name, bundle ids, icons, orientation (portrait + landscape)
├─ eas.json                 build profiles: development, preview (APK), production (AAB/IPA)
├─ app/                     expo-router
│  ├─ _layout.tsx           session gate: no session → /connect; role → route group
│  ├─ connect.tsx           gateway address entry / discovery, cert help link
│  ├─ login.tsx
│  ├─ (engineer)/
│  │  ├─ _layout.tsx        bottom tabs
│  │  ├─ channels.tsx
│  │  ├─ mixes.tsx
│  │  ├─ outputs.tsx
│  │  ├─ processing.tsx
│  │  ├─ scenes.tsx
│  │  └─ admin.tsx          users, bus assignment, ceilings, gateway status
│  └─ (musician)/
│     └─ mix.tsx            single screen, no tabs
├─ src/
│  ├─ components/
│  │  ├─ Fader.tsx          vertical, gesture-handler + reanimated, 60 fps, haptic detent at 0 dB
│  │  ├─ PanKnob.tsx
│  │  ├─ MuteButton.tsx
│  │  ├─ ChannelStrip.tsx   name, colour, fader, mute, level readout
│  │  ├─ BusPicker.tsx
│  │  ├─ ConfirmSheet.tsx   for scene recall, phantom
│  │  ├─ ConnectionBanner.tsx
│  │  └─ Eq.tsx             (later) 4-band graphical EQ
│  ├─ hooks/                useBanks, useKeepAwake, useOrientation
│  ├─ storage/              SecureStore adapter, last-gateway memory
│  └─ theme/                tokens, dark stage theme default
└─ __tests__/
```

**Libraries:** `expo`, `expo-router`, `expo-secure-store`, `expo-keep-awake`, `expo-haptics`, `react-native-gesture-handler`, `react-native-reanimated`, `@qu32/client-sdk`.

---

## 4. Navigation and gating

```
launch → has saved gateway? ─no→ /connect → /login
                           └yes→ /login (or resume if token valid)
/login success → role=engineer → (engineer) tabs
               → role=musician → (musician)/mix   (no way to navigate elsewhere)
SESSION_REVOKED event → clear token → /login with message "Your access changed"
```

- Route groups are a convenience; the **server** rejects out-of-role commands anyway.
- The engineer-only "Monitor Only" toggle swaps the engineer into the musician layout for a chosen bus; it does not change their server role.

---

## 5. Screen specs

### 5.1 Connect
- Field: gateway address (`https://192.168.x.x:8443`). Remembered. Optional QR scan (gateway admin page shows a QR) 🔲.
- Test button → hits `/health`; shows gateway version and console status.
- Help link for installing the gateway's self-signed certificate on Android/iOS.

### 5.2 Musician — "My Mix" (primary screen, designed for stage use)
- Header: bus name (e.g. "Mix 3 – Drums"), connection dot, bus master slider.
- Body: horizontally scrolling vertical faders, one per source in the bus, labelled with channel name and colour. Groups: Vocals · Band · Click/Tracks.
- Landscape: up to 8 faders visible; portrait: 4–5 with horizontal scroll.
- Stereo bus: each strip has a small pan control.
- Large touch targets (≥ 56 px fader thumb), fader fine-adjust by two-finger drag 🔲.
- "More me" (pinned strip) 🔲.
- Screen kept awake. Dark theme, no red/green-only meaning.
- Level ceiling: if the engineer set a max, the fader's travel is visibly capped.
- No navigation chrome, no settings except Logout in a long-press menu.

### 5.3 Engineer — Channels
- 8-strip bank with paging (1–8, 9–16, 17–24, 25–32), tablet shows more.
- Each strip: colour, name, mute, fader, send-to-selected-bus toggle.
- Long-press a strip → channel detail sheet (gain, phantom, HPF, gate, comp, EQ).
- Main LR strip pinned on the right.

### 5.4 Engineer — Mixes
- Bus picker (Mix 1–10, FX 1–4). Strip list shows send levels into that bus; same Fader component.
- Stereo buses show pan.

### 5.5 Engineer — Outputs
- Main LR, DCA 1–4, mute groups 1–4, audio groups.

### 5.6 Engineer — Processing
- Per-channel: preamp gain, phantom (confirm), HPF, gate, compressor, 4-band EQ with graph.

### 5.7 Engineer — Scenes
- Scene list with names; tap → confirm sheet ("Recall scene 12 – Sunday Worship? Outputs may change.") → recall.

### 5.8 Engineer — Admin
- Users: create, disable, reset password, assign bus, set level ceiling.
- Live sessions list with "disconnect".
- Console: IP, MIDI base channel, link status, last resync time.
- Audit log viewer (last N changes).

---

## 6. UX and safety conventions

- Fader value shown in dB while touching; 0 dB detent with haptic tick.
- Mute is a toggle with clear state, not colour alone (icon + label).
- Disconnected state: faders greyed and non-interactive with a persistent banner; never silently drop input.
- Confirmations only for destructive/global actions (scene recall, phantom, unmuting Main LR).
- Accidental-touch protection on Engineer Channels: optional "lock" button that freezes the surface.
- Minimum Android 8 (API 26), iOS 15.

---

## 7. Build and distribution

| Target | How | Output |
|---|---|---|
| Android APK (sideload) | `eas build -p android --profile preview` or GitHub Actions + Gradle | `.apk` to install directly or share by link |
| Android store | `--profile production` | `.aab` for Play Console (internal testing track is enough for a church) |
| iPhone | `eas build -p ios` + TestFlight (requires Apple Developer account, US$99/yr) | `.ipa` |
| iPhone without store | PWA served by gateway, "Add to Home Screen" | No account needed; no native features beyond web |
| Dev | `npx expo run:android` / `run:ios` | Dev build (not Expo Go if native modules beyond Expo Go set are added) |

**Network/permissions**
- Android: `INTERNET`, `ACCESS_NETWORK_STATE`; cleartext not used (HTTPS only). Self-signed gateway cert must be trusted on-device, or the gateway uses a locally-trusted CA/domain (e.g. mkcert-style root installed once).
- iOS: `NSLocalNetworkUsageDescription` string required for LAN access; ATS exception only if cert trust cannot be arranged.

**CI** (`.github/workflows/build-android.yml`): install → typecheck → SDK unit tests → `eas build --non-interactive` (needs `EXPO_TOKEN` secret) → upload APK artifact.

---

## 8. Testing

| Layer | Approach |
|---|---|
| SDK | Vitest against a mock gateway (WebSocket server): login, deltas, drag guard, reconnect, revocation, rate limiting |
| Components | React Native Testing Library: Fader value mapping, Mute toggle, banner states |
| Role gating | Contract test: musician token → raw intents for other buses/Main LR must return FORBIDDEN |
| E2E | Maestro/Detox flow on emulator against gateway + `mock-console`: login → move fader → see delta |
| Hardware | Checklist in QU32-REMOTE-DESIGN.md §12 |

---

## 9. Build order

1. SDK core: transport, auth, store, intents, throttle (+ tests with mock gateway).
2. `Fader`, `MuteButton`, `ChannelStrip` components in isolation.
3. Musician "My Mix" screen end-to-end against mock console. **This is the first shippable slice.**
4. Engineer Channels + Mixes + Outputs.
5. Admin screen.
6. APK build via EAS; install on one real Android phone; test against the real Qu-32 (PA muted).
7. Processing (gain/phantom/HPF/gate/comp/EQ) and Scenes.
8. iOS via TestFlight or PWA.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Self-signed cert friction on phones | Provide a one-time install guide; consider a local CA; PWA install needs a trusted cert |
| Wi-Fi latency/dropouts on stage | Dedicated AP, 5 GHz, reconnect/resync, disabled UI when offline |
| Desk accepts only one TCP client | Gateway is the sole client; no direct phone-to-desk in multi-user setups |
| Protocol gaps vs. Qu-Pad | Scope to documented MIDI commands; list unsupported features explicitly |
| Fader flooding the desk | Client throttle + gateway coalescing queue |
| Musician tampering | Server-side permission checks; assigned bus bound to account, not client input |
