# QU32 Hub — UI Design System v1.0

> Status: proposed visual specification and clickable prototype. Source of product requirements: user-supplied `DESIGN.md`. Nothing in the HTML preview connects to a physical console, handles live audio, authenticates, or generates real QR credentials.

## Visual thesis

**Quiet confidence in a dark room.** Borrow the visual discipline of professional audio equipment—precise meters, intentional colour, reliable status—without reproducing a busy mixing console on every screen. Engineer views prioritise information density; musician views prioritise one-thumb comfort and peace of mind.

Design principles:

1. **A musician can never feel one tap away from destroying the main mix.** No console jargon or destructive commands on the personal mix page.
2. **State is never colour alone.** Every red/green/amber indicator includes a label and/or symbol.
3. **Give critical controls space.** Touch hit areas ≥44 × 44 CSS px; primary playback button ≥55 px, fader thumb 28 px on the musician page.
4. **The engineer sees the destination before the action.** Talkback recipients are explicitly selected and always visible.
5. **Make uncertainty legible.** Offline / audio unavailable / QR revoked are distinct and give useful next steps.
6. **No surprise persistence.** Live faders apply immediately in production; show configurations can be named, saved, recalled, and marked as modified.

## Visual identity

**Product name:** QU32 Hub  
**Mark:** a rounded teal square with four audio-fader lines.  
**Wordmark:** `QU32` in teal + `HUB` in near-white, uppercase and widely tracked.  
**Visual direction:** midnight navy, cool blue surfaces, luminous mint/teal accent, understated borders and shadows. No neon gradients across all controls.

## Typography

| Role | Preferred | Offline fallback | Use |
|---|---|---|---|
| Display / headings | Inter Display | Inter, Segoe UI, system-ui | View title, musician name, headings |
| Interface / body | Inter | Segoe UI, system-ui | Buttons, inputs, statuses, guidance |
| Audio readouts | IBM Plex Mono | Cascadia Code, Consolas, ui-monospace | dB, MIDI numbers, addresses, times |

Use font weights 400, 600, 700, 800 sparingly; don't rely on ultra-light text. This package ships **no font files and has no required CDN dependencies**. It uses locally installed preferred fonts when available and falls back to the OS sans stack. If exact brand consistency is required, separately source and self-host appropriately licensed web font files during production implementation.

### Type scale

| Token | Size / line height | Weight | Example |
|---|---|---|---|
| Hero / engineer | 30 / 34 px | 790 | Everything in its place. |
| Hero / musician | 36 / 38 px | 810 | Drums. |
| Page heading | 26–27 / 31 px | 800 | Channels |
| Card heading | 16 / 22 px | 770 | USB audio routing |
| Main text | 13–14 / 20–22 px | 400–600 | Descriptions |
| Control label | 12 / 17 px | 690–750 | Save show |
| Context / helper | 11 / 16 px | 400–600 | Phone connected |
| Eyebrow | 10 / 14 px | 750 | SYSTEM READY |
| Numeric readout | 13–30 px | 700–800 | −5.0 dB |

**Minimum practical body size for musician controls:** 13 px; avoid making essential information dependent on 10 px text. Respect dynamic system scaling; keep captions optional if space is constrained.

## Colours

Adapted from the original `DESIGN.md`, with subtle contrast refinements.

| CSS variable | Hex | Purpose |
|---|---|---|
| `--bg` | `#0B1421` | Background / deep stage |
| `--shell` | `#101D2C` | Sidebar, persistent toolbars |
| `--surface` | `#172738` | Main cards |
| `--surface2` | `#1F3349` | Raised / hover |
| `--surface3` | `#233B52` | Focused supporting controls |
| `--border` | `#33485A` | Dividers and boundaries |
| `--text` | `#EAF3FA` | Primary content |
| `--muted` | `#A4B8C9` | Secondary legible content |
| `--soft` | `#718BA1` | Tertiary nonessential content |
| `--accent` | `#42DBC2` | Primary action, active source, connected |
| `--accent-dark` | `#1E6F63` | Toggle and low-impact fill |
| `--warning` | `#E0A23C` | Attention, connecting, pending |
| `--danger` | `#E56D78` | Muted, talk active, fault, destructive |

**Semantic pairing:** `● Connected`, `! Connecting`, `× Offline`, and `MUTED` in text; icons supplement these labels. Teal indicates **active/allowed**, not that an audio stream has been verified by the design preview. Orange indicates a potential action or warning; red means an active safety state or a destructive action.

### Colour contrast and validation

The design aims for WCAG 2.2 AA. Before production, automate contrast tests against all combinations and verify at 200% zoom and increased text size. Certain microcopy/tertiary labels in the prototype use the softer token intentionally, but should be elevated to `--muted` where essential. Never use the soft token for an emergency or muted state.

## Spacing and dimensions

- 8 px base grid, 4 px half-step.
- Cards: 14–20 px radius; inputs/buttons 10–12 px radius; pills 30 px radius.
- Desktop: 222 px left nav; sticky 78 px top bar; persistent bottom talkback 66 px.
- Desktop baseline: 1180×860; adapt at 900×640 with icon-only navigation and scrollable panels; main content must not block footer talkback.
- Musician page: maximum 500 px centered, 20 px side gutters; phone safe-area padding.
- Engineer phone: maximum 530 px centered; banks of eight faders; protected output controls locked by default.
- Touch: minimum 44×44 px; engineer desktop 40×40 px. Swipeable controls need a draggable thumb and keyboard-accessible native range inputs.

## Component catalogue

| Component | Anatomy | States / behaviours |
|---|---|---|
| `StatusPill` | dot + short status + optional value | connecting, online, offline, wrong desk, streaming, no audio |
| `AudioLevelMeter` | compact segmented line / thin dynamic bar | inactive, monitoring, peak warning, unavailable; always labelled |
| `MixFader` | source name, current dB, rail, 0 dB anchor, cap | normal, dragging, engineer-locked, muted, capped |
| `PanFader` | L–C–R value and compact slider | center, left, right, locked |
| `MuteSwitch` | explicit mute label + control | audio on, muted, disabled by policy |
| `ChannelMatrixCell` | square check control + text headers | on, off, keyboard focus, selected for bulk edit |
| `MonitorCard` | name, bus, mode, phone/audio states, QR, actions | active, no phone, audio unavailable, expired link |
| `PrivateQR` | white QR field + explicit label / URL | issued, regenerated, revoked, demo |
| `TalkbackHold` | large momentary button + destination row | idle, transmitting, disabled, timeout, lost focus |
| `ShowCard` | name, updated time, musician count, loaded indicator | empty, active, saved, modified, opening |
| `DestructiveConfirm` | action title, consequence, cancel, confirm | keyboard reachable, focus trapped, no ambiguous buttons |
| `BlockingError` | icon + short heading + corrective instructions | offline, invalid QR, wrong device, insufficient USB channels |
| `OutputUnlock` | locked default + clear toggle + danger context | locked, unlocked, timeout/relocked (production) |

### Fader mapping

The product brief specifies MIDI faders as **0–127** with **0 dB at value 98** and monitor pan 0–74. The UI shows an approximate familiar dB value in this prototype. **Production must replace this preview mapping with a documented, tested console-specific translation table** (including −∞ and unity) and honour engineer caps at the gateway. Do not treat this prototype conversion as protocol truth.

## Motion

- Duration: approximately 100–160 ms for ordinary hover/pressed states.
- No glossy bouncing faders or distracting animated backgrounds.
- Meter motion should be meaningful real signal data in production; the demo meter is illustrative.
- Honour `prefers-reduced-motion`; avoid continuous decorative pulsing near the primary controls.
- Talkback release and mute should have immediate feedback, not a delayed animation.

## Content and microcopy

| Situation | UI copy |
|---|---|
| Musician greeting | "Your own mix, your way." |
| Listen CTA | "Start listening" (production) |
| Browser blocked audio | "Tap to allow audio." |
| Playing audio | "Listening. Keep this page open." |
| Audio unavailable | "You can still adjust your mix, but audio playback is not enabled on this hub." |
| Monitor locked | "This input is locked by your engineer." |
| Empty personal mix | "Nothing has been added to your mix. Ask the sound engineer." |
| Gateway offline | "Cannot reach the gateway. Check your Wi-Fi. Controls are locked until it reconnects." |
| Invalid QR | "This QR code is no longer valid. Ask your sound engineer for a new one." |
| Desktop USB failure | "The Qu-32 USB input offers fewer channels than this mix needs. Select the 32-channel driver, then refresh devices." |
| QR regeneration | "The old QR code will stop working and the connected phone will be signed out." |
| Unavailable talkback | "Talkback is unavailable. Reconnect the console or choose a source." |
| No talkback targets | "Select at least one monitor to talk to." |
| Unsaved show | "This show has unsaved changes." |
| Scene recall | "Recalling this scene can change outputs and mutes. Continue?" |
| Bluetooth latency | "Wired earbuds give the lowest delay. Bluetooth adds noticeable lag." |

## Safe defaults

- Musicians: no global controls, no authentication form, no mix-bus routing complexity, no secondary nav.
- Engineer: main LR output locked by default; scene recall explicitly confirmed; talkback momentary only; recipients always visible.
- Monitor QR: keep join URLs private, generate and revoke from the gateway; do not expose tokens in analytics, screenshots or ordinary debugging logs.
- Offline: disable write controls; do **not** queue and replay old MIDI commands after reconnect.
- Reconnect: display distinct audio vs control link states. A connected page is not proof that audio is actively streaming.

## Reference preview files

- `index.html` — Windows Hub UI concept (overview, console setup, mix matrix, musician cards, talkback, shows).
- `musician.html` — lightweight, single-screen musician web control concept; `?demo=1` opens a QA-only preview-state menu.
- `engineer.html` — engineer Android/iPhone visual concept (channels, sends, outputs, DSP, scenes, access).
- `styles.css` — all tokens, typography and responsive rules; `icons.js` — inline vector icons.
