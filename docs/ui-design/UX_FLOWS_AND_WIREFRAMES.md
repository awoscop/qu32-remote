# QU32 Hub — Information Architecture, Flows & Wireframes

All scenarios are grounded in the supplied `DESIGN.md` brief. These are **product and UI design specifications**, not tested live-system behaviour.

## Navigation recommendation

Use **section navigation in the Windows Hub**, not a single extremely long scrolling page. Keep persistent global console status and momentary talkback dock. A left rail gives efficient access to the engineer's high-frequency tasks without burying a live status or making the user scroll past Setup.

```text
WINDOWS HUB
├── Overview               [operating status, monitor overview, readiness]
├── Console & audio        [desk IP, USB device, talkback routing, LAN adapter]
├── Mix designer           [32 input × up to 7 musician assignment matrix]
├── Monitors               [1–7 monitor cards, QR, caps/locks, mix type]
├── Talkback               [recipients, hold-to-talk, source configuration]
└── Shows                  [current, saved, modified, import/export]

PERSISTENT CHROME
├── Header: QU32 HUB | console connection | musician count | emergency talkback stop
└── Footer: selected recipients | Hold to talk

MUSICIAN PHONE (QR web view, no login / navigation)
└── Monitor name → connection → start listening → overall volume + mute
    → assigned inputs (level + pan) → help / connection messages

ENGINEER PHONE (native, authentication before entry)
└── Channels | Mix Sends | Outputs | EQ & DSP | Scenes | Access
```

## Wireframe — Windows Hub overview

```text
┌───────────┬──────────────────────────────────────────────────────────────────┐
│ QU32 HUB  │ SUNDAY SOUNDCHECK / OVERVIEW       [DEMO / ONLINE]  [3 / 4]     │
│           ├──────────────────────────────────────────────────────────────────┤
│ Overview  │ ┌──────────────────────────────────────────────────────────────┐ │
│ Setup     │ │ Everything in its place.              decorative console mark │ │
│ Mix       │ │ [ Open mix designer ] [ Current show ]                       │ │
│ Monitors  │ └──────────────────────────────────────────────────────────────┘ │
│ Talkback  │ [ Console online ] [ 3/4 listening ] [ 32 USB channels ]        │
│ Shows     │                                                                  │
│           │ ┌──────────────────────────────┐ ┌────────────────────────────┐ │
│           │ │ MONITORS                     │ │ READY FOR SERVICE?         │ │
│           │ │ Drums         ● Listening    │ │ ✓ Console connected       │ │
│           │ │ Keys          ● Listening    │ │ ✓ USB audio configured    │ │
│           │ │ Lead Vox      ● Listening    │ │ ✓ Mixes assigned          │ │
│           │ │ Guitar        ○ No phone     │ │ ! One phone not joined    │ │
│           │ └──────────────────────────────┘ └────────────────────────────┘ │
├───────────┴──────────────────────────────────────────────────────────────────┤
│ Quick talkback [ Drums ✓ ] [Keys] [Lead Vox] [Guitar] [HOLD TO TALK]         │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Wireframe — Mix designer

```text
Search 32 channels…       [ASSIGNED = HEARD]  [Copy column] [Save show]
┌─────────────────┬─────────┬─────────┬─────────┬─────────┐
│ Desk input      │ Drums   │ Keys    │ LeadVox │ Guitar  │ ← sticky names
├─────────────────┼─────────┼─────────┼─────────┼─────────┤
│ DRUMS                                                 │
│ 01 Kick In      │  [x]    │  [ ]    │  [ ]    │  [ ]    │
│ 02 Kick Out     │  [x]    │  [ ]    │  [ ]    │  [ ]    │
│ ...             │         │         │         │         │
│ VOCALS                                                │
│ 23 Lead Vox     │  [x]    │  [x]    │  [x]    │  [x]    │
└─────────────────┴─────────┴─────────┴─────────┴─────────┘
```

Production: sticky first column and header; keyboard navigation; 32 real labels from desk; up to 7 dynamically configured columns; fast all-row and copy-column actions; horizontal scrolling at small widths. Live changes are not yet wired in the preview.

## Wireframe — Monitor management

```text
MUSICIAN MONITORS                      [4 OF 7] [PRINT QR SHEET]
┌─────────────────────────────────────────────────────────────┐
│ DR  Drums · Monitor 1 / Mix 1                  [ON/OFF]     │
│ ● Phone connected   ● Audio streaming                      │
│ ┌─────────┐  Mix type: [Digital mix ▼]                      │
│ │ DEMO QR │  Personal join URL                             │
│ └─────────┘  [Copy link] [Phone preview] [New QR] [Talk]     │
│ Start level ━━━━━━━━━━━━●━━━━━━         −3.0 dB           │
│ Assigned inputs: [name] [level] [maximum] [lock]            │
└─────────────────────────────────────────────────────────────┘
```

Production must surface digital versus desk mix differences and show safe warnings before invalidating QR codes or reducing monitor count.

## Wireframe — Musician phone (single page)

```text
QU32 HUB / MY MIX                          ● Connected

MONITOR 01 · PERSONAL MIX
Drums.
Your own mix, your way.

┌───────────────────────────────────┐
│  ◉ HEAR YOUR MIX                │
│  [ START LISTENING             ] │
│  ● Listening  · Delay ~52 ms     │
│  ▃▆▅▂█▄▇  [signal level]          │
└───────────────────────────────────┘
┌───────────────────────────────────┐
│ OVERALL VOLUME           0 dB     │
│ ━━━━━━━━━━━━━●━━━━━━              │
│ Mute everything             [○]   │
└───────────────────────────────────┘
MY INPUTS                6 assigned
┌───────────────────────────────────┐
│ [icon] Kick                −5 dB  │
│ ━━━━━━━━━━●━━━━━━                  │
│ Pan  L ━━━━━●━━━━━ R       C      │
└───────────────────────────────────┘
┌───────────────────────────────────┐
│ [icon] Tracks              −14 dB │
│ ━━━●━━━━━━━━━━━━  LOCKED          │
└───────────────────────────────────┘
```

No extra nav, technical modal, microphone permission prompt, audio routing details, or stage-unrelated settings.

## Wireframe — Talkback

```text
TALKBACK / ENGINEER
Select recipients:
[Drums ✓] [Keys] [Lead Vox] [Guitar]

                  ╭────────────────╮
                  │      MIC       │
                  │  HOLD TO TALK  │
                  ╰────────────────╯

Source: [Desk microphone CH 32 ▼]    Level [−5 dB ▼]

Always end on: pointerup, pointercancel, mouseleave, window blur,
Space-key release, or timeout at 60 seconds.
```

## Flow 1 — First-time setup

```text
Start Hub → show setup checklist → engineer credentials displayed once
 → Qu-32 IP + Connect → connected?
       no → show wrong IP/network guidance → retry
       yes → select USB 32-channel device → channels sufficient?
             no → driver/device warning → refresh
             yes → choose 1–7 monitors → enter names → assign inputs
                   → configure level caps/locks → Save show → share QR links
```

Target is a 10-minute straightforward first setup; do not force optional advanced routing before connecting the desk.

## Flow 2 — Musician joins

```text
Engineer issues private QR → musician scans → QR valid?
   no → explicit invalid/revoked screen → ask for new QR
   yes → personal mix page → Tap Start listening
       → browser permits playback? no → Tap to allow audio
       → audio available? no → control-only state with explanation
       → ready → show listening + meter + delay estimate → mix faders
```

No login form and no configuration menu. A scanning volunteer can help without being given the engineer password.

## Flow 3 — Weekly service

```text
Launch Hub → Open last show → unsaved changes present?
   yes → Save / Discard / Cancel
   no → load show → check console + USB audio + each phone
     → one phone missing? regenerate/share QR if needed
     → ready indicator → rehearsal / service → Save tweaks
```

## Flow 4 — Change mix during service

```text
Engineer toggles a matrix checkbox → gateway validates permissions
  → recompute/send mix changes → musician UI receives state update
  → fader list reflects new assignment without refresh
  → if gateway unreachable: disable edits + show reason; do not queue commands
```

## Flow 5 — Talk to a musician

```text
Select explicit destination(s) → hold pointer / Space → begin talkback
  → destination hears routed mic + controlled ducking → release or blur
  → instant stop → idle, with 60-second automatic stop as last resort
```

A panic/stop action also ends the active transmission. A production interlock must exist at the gateway even if the desktop UI freezes.

## Flow 6 — Lost phone / wrong QR recipient

```text
Open recipient monitor → New QR → confirm consequence
 → server revokes existing private token/session
 → old phone: QR revoked screen → new QR distributed privately
```

## Flow 7 — Offline / reconnect

```text
TCP console / gateway / Wi-Fi / USB audio failure
 → distinguish WHICH layer failed
 → lock controls that can no longer be applied reliably
 → reconnect without replaying stale fader actions
 → reconcile from authoritative console + gateway state
 → indicate Ready / No audio / Connected individually
```

## Additional safety states

- Wrong desk: console identifies as an unexpected device; suspend commands; show target IP/device identity.
- 0 monitors: useful blank state and prominent Add monitor.
- 7 monitors: Add disabled with capacity explanation.
- Invalid USB routing: state which monitor needs which input channel.
- Output changes: unlock and permission verification required before Main LR / master control.
- Scene recall: explicit action-specific confirmation, especially during a live service.
- QR: token leakage prevention, expiring/revocable credentials, no demo token acceptance.

## Prototype state routes

| Open | What you can preview |
|---|---|
| `index.html` | All Windows Hub sections; click sidebar |
| `musician.html` | Connected music mix layout and sliders |
| `musician.html?demo=1` | QA-only state selector (not for release) |
| `musician.html?demo=1&state=invalid` | Revoked QR screen |
| `musician.html?demo=1&state=disconnected` | Gateway-offline locked controls |
| `musician.html?demo=1&state=empty` | No assigned channels |
| `musician.html?demo=1&state=noaudio` | Audio engine unavailable |
| `musician.html?demo=1&state=reconnecting` | Reconnecting audio |
| `engineer.html` | Channel banks, sends, outputs, DSP, scenes, access |
