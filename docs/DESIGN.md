# QU32 Hub — UI/UX Design Brief

> **How to use this file:** paste it into a design assistant (e.g. ChatGPT) with a request such as
> *"Using this brief, design the complete UI/UX: user flows, wireframes, component specs, a visual style guide and high-fidelity screen mockups
> (as HTML/CSS or Figma-ready descriptions) for all three surfaces. Ask me questions only if something is truly missing."*
> Everything below is real, existing functionality unless it says **Proposed**. The current UI works but is plain and engineer-built; the goal is a polished, calm, stage-ready redesign.

---

## 1. What this product is

**QU32 Hub** lets a church/venue sound engineer give every musician their own **personal in-ear monitor mix on their own phone**, using an
**Allen & Heath Qu-32** digital mixer. No app install for musicians: they scan a QR code, tap once, and hear their mix and move their own faders.
The engineer also controls everything from a Windows desktop app and can **talk back** to any musician.

### The problem it solves
- Wedge/in-ear mixes are usually set once by the engineer; musicians keep asking "more me, less keys". This lets them do it themselves, safely.
- The engineer keeps control: they choose which inputs each person can hear, set limits, lock channels, and save everything as a **show** to recall next week.

### System in one picture
```
 Musician phones (browser, via QR) ──Wi-Fi──►  QU32 Hub (Windows PC)  ◄──USB audio + Ethernet──►  Qu-32 mixer
 Engineer phone app (optional)     ──Wi-Fi──►        │
                                                     └─ streams each musician's mix as live audio to their phone
```

## 2. People (design for these three)

| Persona | Context | Needs | Pain points to design away |
|---|---|---|---|
| **Engineer** (primary, power user) | At a desk/laptop during rehearsal and service, dim room, often rushed, one hand busy | Set up in minutes, see everything at a glance, never accidentally disrupt the service, recall last week's setup, talk to one person quickly | Fiddly setup, unclear status, scary destructive buttons, losing work |
| **Musician** (high volume, non-technical) | On stage, dark, standing, one thumb, earbuds in, nervous about "breaking" something | Hear themselves, nudge a few faders, nothing else | Tiny controls, confusing options, accidentally muting everything, no idea if it is working |
| **Band leader / volunteer** (secondary) | Helps scan QR codes, sets up the Wi-Fi | Know which phone is which, re-issue a QR code | Not knowing who is connected |

## 3. The three surfaces

1. **Hub desktop app** (Windows, Electron, one window ~1180×860, mouse + keyboard; resizable down to 900×640). The engineer's control centre. **Main redesign target.**
2. **Musician phone page** (mobile web page opened from a QR code; no install, no login; portrait phone, thumb use, dark stage lighting). **Second redesign target — most used by the most people.**
3. **Engineer phone app** (React Native, Android/iPhone; full-console remote: channels, mixes, scenes). Lower priority; optional restyle for consistency. Summarised in section 8.

## 4. Visual direction (current tokens, may be refined)

Mood: **professional audio console, calm, trustworthy, stage-safe.** Dark UI (stage lighting, battery, glare), high contrast, big touch targets, restrained colour, never colour-only state.

| Token | Value | Use |
|---|---|---|
| background | `#0B1421` | app background |
| surface | `#172738` | cards |
| surface-2 | `#1F3349` | raised / hover |
| border | `#33485A` | strokes |
| text | `#EAF3FA` | primary |
| muted | `#93AABF` | secondary |
| accent | `#42DBC2` | active, sliders, "ok", primary buttons |
| accent-dim | `#1E6F63` | slider fill, toggles |
| danger | `#D35D65` | mute, destructive, offline, live-talk |
| warning | `#E0A23C` | connecting / attention |

Type: system sans (Segoe UI on desktop, system UI on phones). Radius 10–14 px. 8 px spacing grid. Min touch target 44×44 px (phones), 40 px (desktop).
Status is always **icon/label + colour**. Support light mode only if it adds value (default and primary: dark). Keep the brand mark simple: **QU32 HUB** wordmark (accent "QU32", light "HUB" letter-spaced).

## 5. Hub desktop app — screens and content

Single scrolling window today. **Proposed:** consider a left navigation (Setup · Mix · Monitors · Talkback · Shows) or a tabbed layout, keeping the
"live" essentials (console status, talk button) always visible. Design for a real 1180×860 desktop window and a smaller 900×640.

### 5.1 Global header (always visible)
- Wordmark **QU32 HUB**.
- **Console status pill:** `Starting…` / `Connecting…` / `Qu-32 online · fw 1.09` / `Console offline` / `Wrong device` (colour + text).
- **Network address** dropdown (which PC network address is baked into QR codes; usually one Wi-Fi address like `192.168.1.100`).
- **Proposed:** global "Panic: stop all talkback" button; connected-musician count.

### 5.2 Alert banners (stack under header, dismissible where noted)
- **Errors:** "Engineer phone app (HTTPS) is off: OpenSSL was not found", "Musician port 8080 could not start (in use)", audio engine errors such as
  "The USB input only provides 2 channel(s), but monitor 3 needs a higher one. Install the Allen & Heath USB driver and set 32 channels."
- **First-run:** "Engineer login for the phone app (shown once): `username engineer` · password `J9fy…` · address `https://192.168.1.100:8443` — [I saved it]".

### 5.3 Setup area
**Console card** — Qu-32 IP field + Connect button; live line `ready: Console online` / error text; help: "Find the desk's IP under Setup > Control > Network. It must differ from this PC's address."

**Audio card** — dropdowns: *Qu-32 USB input*, *Talkback output (USB return, only for desk-mix musicians)*, *Talkback microphone (PC mic)*; number field *USB return channel*;
buttons **Apply**, **Refresh devices**; status line "USB input: 32 channel(s) available." or a warning. Explain (tooltips/help): pick the Qu-32 USB device; mic optional (a desk mic is the alternative).

### 5.4 Shows (new concept, central)
A **show** = which inputs each musician gets + starting levels + limits + musician names. Elements:
- Current show name, **"unsaved changes"** indicator.
- Name field + **Save show** (primary), saved-shows dropdown + **Open**, **Delete**, **New**, **Export…**, **Import…** (file dialogs).
- Reassure copy: "Musicians keep the same QR code when you open another show; their phones update live."
- States: untitled, saved, modified, opening (confirm if unsaved changes), empty library.
- **Proposed:** show cards with date and musician count; "duplicate show"; recently used.

### 5.5 Mix designer (the heart of the app)
A matrix: **rows = the 32 desk input channels** (named from the desk, e.g. "1. Kick", "12. Lead Vox"), **columns = musicians** (named, e.g. "Drums", "Keys").
A checked cell = that musician hears that input in their personal mix. Needs: sticky header and first column, scroll for 32 rows, keyboard navigation,
fast multi-select (drag across cells, "assign whole row to everyone", "copy column from musician A"), search/filter channels, highlight which channels are in use by anyone.
**Proposed:** group channels (Drums, Vocals, Keys), per-column "clear", channel colour from the desk.

### 5.6 Monitors (one card per musician; 1–7 musicians)
Header control: **Number of monitors** `−  [3]  +` (changing it adds/removes cards; shrinking invalidates those QR codes — warn).
Each **musician card** contains:
- Title `Monitor 2 · Mix 2` (+ "(stereo)" for the stereo desk mixes), **On/off** toggle, editable **name** (e.g. "Drums").
- **Mix type** select: *Digital mix (recommended)* · *Desk mix (console Mix bus)*.
- **QR code** (large, scannable, white background; must work printed or shown on a projector), the join **URL** (selectable), **Copy link**, **New QR** (confirm: "old code stops working and this phone is disconnected").
- **Live status:** `No phone` / `Phone connected`, `No audio` / `Audio streaming`, and a **level meter** of that musician's mix.
- **Inputs & levels** (digital mix): list of assigned inputs, each with name, **start level slider**, **max level** select (−10/−5/0/+5/+10 dB), **lock** checkbox. Empty state: "No inputs assigned yet. Tick them in the mix designer."
- Desk-mix only: *Max level* select, *First USB channel* number, *Show all channels* checkbox.
- **Hold to talk to this mix** button (see Talkback).
- **Proposed:** a printable "QR sheet" (all codes with names, for taping to music stands), connection quality badge, "preview as this musician".

### 5.7 Talkback
- Choose destination: chips per musician + **All** (multi-select).
- Settings: *Desk input channel* (default CH 32), *Level* (−10…+5 dB).
- Big **Hold to talk** button (also holds on the Space bar; releases on mouse-up, window blur, or after 60 s). States: idle, talking (danger colour, "TALKING…"), disabled (console offline), error text.
- Source modes (explain simply): **desk microphone** (a mic plugged into the chosen desk channel) or **PC microphone**.
- Collapsible one-time setup help (spare desk channel: USB source, unmuted, LR off, sends at −∞).
- Principle: release must feel instant and trustworthy; the destination must be unmistakable *before* pressing.

### 5.8 Footer / utilities
Reset engineer password · Open data folder · informational line "Musician address: `http://192.168.1.100:8080` · Engineer app: `https://192.168.1.100:8443`".

### 5.9 Key states to design (desktop)
First launch (empty) · console offline · wrong device connected · no USB audio device · fewer USB channels than needed · 0 monitors · 7 monitors ·
musician connected + streaming · musician disconnected · unsaved show · talk active · port in use · QR regenerated.

## 6. Musician phone page — screens and content (highest priority for polish)

Opened by scanning a QR code. Portrait, dark, one-handed. **No navigation, no settings, no login.** The page *is* the product for musicians.
Page title is their name/mix (e.g. "Drums").

### 6.1 Layout (top to bottom)
1. **Header:** their name (large), connection pill: `Connecting…` / `Connected` / `Gateway unreachable. Controls locked.`
2. One-line explainer: "Your personal mix. The sound engineer chooses which inputs you get; you set how loud each one is."
3. **Audio card:** big primary button **Start listening** (browsers require a tap), then state text: "Connecting audio…" / "Listening. Keep this page open and the screen on." / "Audio dropped. Reconnecting…" / "Tap to allow audio".
   A thin **live level meter** and a **delay readout**: "Delay about 52 ms (network 1, buffer 32)". Tip: "Plug in your earbuds first."
4. **Volume card:** **Overall volume** fader (shown in dB) + **Mute everything** toggle ("MUTED (tap to unmute)"). Note: "Only changes what you hear."
5. **My inputs:** one row per input the engineer assigned: name ("Lead Vox"), **level fader** with dB readout, **Pan** fader (L100…C…R100). Locked inputs are visibly locked (and disabled). A fader's travel is capped at the engineer's maximum.
   Empty state: "Nothing has been added to your mix yet. Ask the sound engineer."

### 6.2 Interaction requirements
- Thumb-friendly faders (≥ 44 px tall hit area, large thumb), live dB readout while dragging, a visible **0 dB** reference, no accidental page scroll while dragging a fader.
- Changes apply immediately (no Save). Updates from the engineer (new show, changed inputs) appear live without a reload.
- **"More me" idea (Proposed):** pin up to 4 favourite inputs on top; a one-tap "boost me +3 dB" for the musician's own input.
- Must work on iPhone Safari and Android Chrome, in portrait and landscape; respect safe areas; keep the screen awake where the browser allows.
- Safe volume: faders can never exceed the engineer's cap; a limiter protects ears; **Proposed:** a clear "loud" warning colour near the cap.

### 6.3 States to design (musician)
Loading/joining · connected, not yet listening · listening · audio reconnecting · gateway unreachable (controls disabled) · mix empty ·
input locked · **QR no longer valid** (full-screen: "This QR code is no longer valid. Ask the sound engineer for a new one.") ·
muted · audio not enabled on this hub ("You can still control your mix") · "Tap to allow audio" (autoplay blocked).

### 6.4 Bluetooth note (show in UI as a gentle hint)
Bluetooth earpieces add 100–250 ms or more of their own delay. Suggest a small, dismissible hint: "Wired earbuds give the lowest delay. Bluetooth is fine for general listening."

## 7. Core user flows (design as flows, with edge cases)

1. **First-time setup (engineer):** install/run Hub → note first-run login → enter Qu-32 IP → choose USB audio device → set monitor count → name musicians → assign inputs in the mix designer → **Save show** → hand out QR codes. Target: under 10 minutes, with clear "what's next" guidance (consider a setup checklist).
2. **Musician joins:** scan QR → page opens → tap **Start listening** → adjust faders. Zero typing.
3. **Weekly service:** open Hub → **Open** last show → check statuses (all phones green) → save tweaks.
4. **Change a mix live:** engineer ticks/unticks an input in the matrix → the musician's page updates in seconds without reload.
5. **Talk to one musician:** hold their card's **Hold to talk** → they hear the engineer, their mix dips slightly → release.
6. **Lost phone / wrong person scanned:** engineer taps **New QR** → old phone is dropped and shown the "no longer valid" screen.
7. **Console drops / Wi-Fi drops:** controls lock with a clear banner; audio reconnects automatically; nothing replays when it returns.

## 8. Engineer phone app (secondary surface)
Sign-in (gateway address, username, password) → tabs: **Channels** (banks of 8 faders + mute), **Mix Sends** (pick a mix, per-input send + pan), **Outputs** (Main LR, masters, DCAs; locked behind an "Unlock output controls" switch),
**EQ & DSP** (raw HPF/EQ/gate/compressor sliders), **Scenes** (pick 1–100, confirm), **Access** (console IP, create musician accounts, assign buses). Also a **Monitor preview** mode. Persistent status pill; controls lock when offline.
Restyle for consistency with the Hub and musician page; improve fader ergonomics (vertical channel strips in landscape, VU-style meters **Proposed**).

## 9. Content & tone
Plain, calm, short sentences; no jargon on musician screens (say "volume" not "send level"; "your mix" not "bus"). Engineer screens may use console terms (Mix, USB, pre-fader) with plain-language help. Errors say what happened *and what to do*.
Examples: "Cannot reach the gateway. Check Wi-Fi and the address." · "This QR code is no longer valid. Ask the sound engineer for a new one." · "Select at least one monitor to talk to."

## 10. Accessibility and ergonomics
WCAG 2.2 AA contrast on dark theme; never colour-only; all controls keyboard reachable on desktop (talk button also on Space); screen-reader labels for faders with dB values;
respect system text size on phones; reduced-motion friendly; large targets; confirm destructive actions (New QR, delete show, new show with unsaved changes, reduce monitor count).

## 11. Hard constraints (don't design against these)
- Musician page is a **plain web page** (no install, no login, no camera/mic permission, HTTP on the local network). Keep it light: one HTML page, no heavy frameworks, fast on old phones.
- Up to **7 musicians**; **32** desk input channels; fader range is a 0–127 console scale shown in dB (−∞…+10 dB, 0 dB at 98); pan 0–74 shown L/C/R.
- Hub is a **desktop window** (not a web app); the status shown is polled about twice a second.
- QR codes encode a private URL; treat them as secrets (don't show them in places a stranger sees; offer regenerate).
- Audio delay is real (roughly 50–150 ms over Wi-Fi, more with Bluetooth) — set honest expectations in the UI rather than hiding it.
- Talkback must always be releasable instantly; it auto-stops after 60 s and when the window loses focus.

## 12. Deliverables to ask the design assistant for
1. Information architecture and navigation for the Hub (with a recommendation on single page vs sections).
2. User flows for the seven flows above, including error paths.
3. Low-fidelity wireframes → high-fidelity mockups for: Hub (setup, shows, mix designer, monitors/QR cards, talkback), musician phone page (all states), first-run setup checklist.
4. A compact design system: colour tokens (light + dark if proposed), type scale, spacing, components (fader, mute toggle, status pill, QR card, matrix cell, banner, dialog, talk button), iconography, motion rules.
5. Copy deck for all labels, empty states and errors.
6. Handoff-ready output: HTML/CSS (no framework needed) for the musician page and the Hub window, or Figma-ready specs.
