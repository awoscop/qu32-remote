# QU32 Hub — Developer Handoff

**Goal:** translate the current clickable look-and-feel into the existing Electron Windows Hub, ultra-lightweight QR musician page and React Native engineer app without changing their validated permission boundaries. This HTML project is **visual source**, not a working replacement for the existing gateway.

## Directory map

```text
qu32-hub-uiux/
├── index.html                       Windows Hub design and section navigation
├── hub.js                           Mock desktop show/matrix/monitor/talkback interactions
├── musician.html                    Standalone musician one-page design
├── musician.js                      Demo input faders, state cases and controls
├── engineer.html                    Engineer mobile visual prototype
├── engineer.js                      Demo channel strips, scenes, access, output unlock
├── icons.js                         Embedded stroke icons; no library or CDN
├── styles.css                       Shared dark-mode tokens and responsive rules
├── assets/                          Non-functional sample QR SVGs
├── previews/                        Browser-rendered visual references
├── DESIGN_SYSTEM.md                 Tokens, typography, components, content
├── UX_FLOWS_AND_WIREFRAMES.md       IA, screen maps, seven core flows and edge cases
├── DEVELOPER_HANDOFF.md             Integration guidance / acceptance criteria
└── README.md                        How to open / demo / evaluate
```

## Integration targets

| Design | Existing product responsibility | Connection required |
|---|---|---|
| Windows Overview | Electron status + live monitoring | console state, audio engine, connected phones, actual session/show |
| Console & Audio | Electron settings | Qu-32 TCP connection, USB device list, source and return routing |
| Mix Designer | show assignment backend | 32 authoritative channel labels × 1–7 musicians; validated write events |
| Monitors | monitor objects | cap/lock assignments, digital-vs-desk type, stream status, QR token issuer |
| Shows | show repository | save/load/import/export with migration/versioning and dirty guard |
| Talkback | audio + MIDI + hold lifecycle | momentary start/stop; blur release; gateway watchdog, 60 s max |
| Musician Page | static QR-served HTML | token-based session, live audio engine, bus mix state, server caps |
| Engineer Mobile | React Native app | account auth, gateway sessions, MIDI read/write, role-guarded operations |

## One-source-of-truth architecture

```text
Qu-32 mixer <—TCP MIDI—> QU32 Hub (Windows + gateway)
                          ├── USB capture / live audio mixing
                          ├── Auth / QR token / permission engine
                          ├── Show and monitor configuration database
                          ├── Real-time updates + audio streaming
                          ├── Engineer Electron control surface
                          ├── Musician QR webpage (HTML/CSS/JS)
                          └── Authenticated engineer RN mobile app
```

**Do not trust the browser's disabled inputs as access control.** The gateway must check assigned inputs, max levels, locks, user/device identity, monitor bus, command permissions and revocation *on every modification*. Engineer and musician paths remain strictly isolated.

## Full Hub handoff milestones

1. Extract/align CSS tokens into shared desktop/phone variables without bundling a heavy framework into the musician page.
2. Replace `hub.js` mock lists with console-discovered channels, monitor sessions, saved shows and audio device data.
3. Convert DOM updates into state-driven live subscriptions with stable IDs; distinguish control connection, phone connection and *actual* audio reception.
4. Persist shows, confirm destructive changes and visibly flag unsaved state.
5. Implement matrix bulk keyboard actions and search safely; allow 32 channels and up to seven musicians without jank.
6. Integrate momentary talkback with watchdog/failsafe, and test focus loss, pointer cancel, app minimize and gateway crash.

## Musician page handoff milestones

1. Serve as a static, lightweight local-network HTML page; **no login** or install steps; identify musician by a secret QR-scoped credential.
2. Replace "Preview listening state" with the production "Start listening" browser-user-gesture audio start; implement live audio and route state.
3. Replace illustrative wave meter and example latency with actual audio meter and honest measured/estimated delay (never fabricate exact values).
4. Show only assigned inputs and server-approved caps. Disable locked inputs; intercept/stabilise range gestures so vertical scrolling does not grab the thumb.
5. Support iPhone Safari/Android Chrome, safe areas, text enlargement, portrait/landscape, accessibility labels and screen-reader values.
6. Handle invalid QR, disconnect, audio unsupported, autoplay refusal, mute, and empty assignments as independent states.

## Engineer phone handoff milestones

1. Replace demo status with real gateway connection and authenticated engineer profile. No automatic privilege escalation from any preview mode.
2. Implement Qu-32 MIDI parameter mapping from existing gateway/SDK, not the approximate designer number formatter.
3. Engineer output unlock must require server-side engineer permission; consider an additional hold-to-unlock or temporary session reauthorization, and auto-relock.
4. Scene recalls require full scene ID from console + safety confirmation + server-side verification.
5. Test rapidly moved faders and synchronisation when physical desk controls are moved at the same time.
6. Preserve channel-bank 8-strip view and fast access to Mix Sends.

## What the UI prototype actually does

- Local browser interactions for nav, checks, faders, mute, output unlock, talk button press/release and confirmation UI.
- Displays sample musician/USB/console statuses and example audio meters.
- Contains four QR SVGs encoding `https://example.invalid/qu32-demo/N`. These are **deliberately invalid**; none are live credentials.
- Uses no fetch calls, network sockets, audio input/output, credential/session storage, local persistence, MIDI control or secrets.
- Does not make the previous V3 gateway runnable or produce Android APK/iPhone IPA.

## Interaction acceptance tests

### Desktop
- [ ] 1180×860 and 900×640 layouts show nav and live footer without overlap.
- [ ] Header differentiates console disconnected, wrong desk, audio fail and ready.
- [ ] 32×7 matrix remains keyboard and screen-reader accessible.
- [ ] Changing assignments updates the correct musician and does not touch unrelated channels.
- [ ] Save, open, discard and export show states are distinguishable.
- [ ] QR regeneration invalidates the old phone session and warns beforehand.
- [ ] Talkback terminates on release, focus loss, device disconnect and 60s safety timeout.

### Musician
- [ ] QR opens without user typing, sign-in or any camera/microphone permission prompt.
- [ ] Playback starts only following a tap where browser gesture is needed.
- [ ] Fader updates obey caps, assigned channels and locks as enforced by gateway.
- [ ] Hardware audio route and phone latency expectations communicated plainly.
- [ ] All essential controls ≥44×44 px; screen reader announces channel and value.
- [ ] Offline, invalid QR and audio-disabled states each present correct action.
- [ ] No ability to alter Main LR or another musician's bus through crafted network commands.

### Engineer phone
- [ ] Main LR output controls locked until explicit engineer-authorized unlock.
- [ ] Scenes require confirmation and gateway-level role validation.
- [ ] 8-channel banks are usable on small phones and in landscape.
- [ ] Lost gateway disables writes and reconciles changes after reconnect.

## Performance & accessible design verification

- Run real device tests on iOS Safari/Android Chrome, particularly range touch events and private network behaviour.
- Test keyboard (Tab/Shift+Tab/Space/Enter), high contrast, 200% zoom, larger fonts and VoiceOver/TalkBack.
- Automated WCAG colour contrast audit needed before release; preview was visually inspected, **not audited**.
- Security review must explicitly include QR confidentiality, origin/CSRF policies for local HTTP, LAN attacker model, authenticated engineer HTTPS, rate limiting and token revocation.
- Audio: evaluate actual capture/stream quality, dropout handling, limiter and latency with real Qu-32 + earbuds. Browser page design alone cannot guarantee latency or safe SPL.

## Handoff note on local network

The supplied brief asks for the lightweight musician browser page over local HTTP and engineer phone authentication over HTTPS. Production must evaluate mixed-content, secure contexts, browser autoplay and QR URL credential handling. Use encrypted traffic where practical without violating compatibility with the deployment environment, and avoid exposing raw QR tokens to analytics and logs.

## Referenced project scope

Source: `DESIGN.md`, especially Sections 3–12. Preserve that the proposed improvements (favourites, copy column, printable QR sheet, sound meter visuals) are not necessarily implemented in the original product. Do not infer success from a nice preview.
