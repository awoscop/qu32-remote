# QU32 Secure Remote

Control an Allen & Heath **Qu-32** from Android/iPhone over Wi-Fi.

```
Phones (app / SDK) --HTTPS--> Gateway (PC on the LAN) --TCP 51325 MIDI--> Qu-32
```

The Qu-32 accepts **one** TCP MIDI client, so the gateway owns that connection and shares it between
signed-in phones. Engineers get the full console; musicians get only their assigned monitor mix.
Permissions are enforced on the gateway from the account (role + assigned bus). The app UI is not trusted.

| Folder | What |
|---|---|
| `sdk/` | `@qu32/sdk`: client SDK + Qu MIDI protocol library (built from the official V1.9 protocol PDF) |
| `gateway/` | Node.js HTTPS gateway, accounts, policy, audit log, simulated Qu-32 for tests |
| `hub/` | **QU32 Hub**: Windows desktop app. Runs the gateway, QR phone monitors, USB audio streaming, talkback |
| `mobile/` | Expo / React Native app (engineer + musician UIs) |
| `dist-packages/` | Built `qu32-sdk-0.1.0.tgz` (install anywhere with `npm install ./qu32-sdk-0.1.0.tgz`) |

## Status (read this before a service)

- Verified: protocol encoders against the official message formats, the whole gateway/SDK flow against a
  **simulated** Qu-32 (30 automated tests), app type-checks and bundles for Android.
- **Not verified:** a physical Qu-32, an installed APK on a phone, iPhone builds. Do the hardware checklist
  in `docs/QU32-REMOTE-DESIGN.md` section 12 with the PA muted before any live use.
- Not implemented: meters, RTA, patching, graphical EQ, WebSocket push (state is polled ~0.7 s, revision-checked).

## 0. QU32 Hub: QR phone monitors with live audio and talkback (recommended)

Run **QU32 Hub** on a PC connected to the Qu-32 by Ethernet **and** USB-B. Musicians scan a QR code and get their own mix,
audio and faders in the phone browser: no app, no password. Details: [docs/MONITOR-AUDIO-DESIGN.md](docs/MONITOR-AUDIO-DESIGN.md).

```bash
cd hub && npm install && npm run dist      # builds hub/release/win-unpacked/QU32 Hub.exe
npm start                                   # or run from source
```

1. Start the Hub, enter the Qu-32 IP, press **Connect**.
2. Pick the Qu-32 USB input under **Audio**, press **Apply**. Choose the number of monitors. Each card has a QR code.
3. **Digital mix (default, recommended).** Musicians get a personal mix built inside the Hub, separate from the desk's own monitor mixes.
   In the **Mix designer** tick which input channels each musician gets. They raise or lower only those inputs on their phone; this never touches the desk.
   Use the **Inputs & levels** section on a musician's card to set each input's starting level, the highest level they may set, or lock it.
   Set the desk's USB send to **pre-fader direct out** so your own fader moves never change their mix. Input N is read from USB channel N.
4. **Shows.** Name the mix and press **Save show**; **Open** another show for the next service (or Export/Import a file). Musicians keep the same QR code and their phones update live.
5. A musician can instead be set to **Desk mix** (the console's own Mix 1-10, controlled over MIDI, with the Mix Assign filter). Use this only if you want the desk to do the mixing.
6. Musicians join the same Wi-Fi (use a dedicated access point), scan their QR code, tap **Start listening**.
7. Talkback: pick one spare desk channel (default CH 32). Either plug a mic into that channel (**desk microphone**, nothing else to set up), or choose a **PC microphone** under Audio.
   Hold the button on a card to talk to one musician, or the buttons in the Talkback section for several (hold, or hold Space).
   Digital-mix musicians hear you directly in their stream (their mix dips 6 dB while you talk, and their own volume setting does not mute you).
   The desk's built-in talkback routing cannot be controlled remotely (it is not in the Qu MIDI protocol).
8. Each musician page shows a live delay estimate. One phone per QR code gets audio; a second device on the same QR takes over that monitor's audio.
   **Bluetooth earpieces add their own delay (typically 100-250 ms or more) on top of that.** Wired earbuds are the lowest-delay option; Bluetooth suits reference mixes and talkback, not tight timing.

Musician pages are served over plain HTTP on port 8080 so no certificate warning appears; they carry no passwords and can only reach their
own monitor mix. The engineer phone app uses HTTPS on 8443 as before.

## 1. Run the gateway (headless, without the Hub)

Requires Node.js 20+ and OpenSSL (Git for Windows includes it).

```powershell
npm install
npm run build
$env:QU32_MIXER_IP = "192.168.1.100"   # optional; can also be set in the app
.\start-gateway.ps1                    # macOS/Linux: ./start-gateway.sh
```

First start prints the **engineer password once**. Save it. Data lives in `.qu32-private/` (never commit or share it).

| Variable | Default | |
|---|---|---|
| `QU32_MIXER_IP` | saved setting | Qu-32 IPv4 (Setup > Control > Network on the desk) |
| `QU32_LAN_IP` | auto-detected | Gateway IP put in the TLS certificate. Re-issued automatically if it changes |
| `QU32_WEB_PORT` | 8443 | |
| `QU32_DATA_DIR` | `.qu32-private` | |
| `QU32_ENGINEER_PASSWORD` | random | First launch only, 12+ chars |
| `QU32_OPENSSL` | `openssl` | Path to openssl |
| `QU32_ALLOWED_MODELS` | `3` | Qu box ids accepted (3 = Qu-32) |

Give the gateway and the Qu-32 fixed IPs. Never port-forward 8443 or 51325 to the internet.

## 2. Make phones trust the gateway

The gateway uses a private local CA. Install **only the public** `qu32-local-ca.crt`
(download it on the phone from `https://<gateway-ip>:8443/ca.crt`, or copy it from `.qu32-private/`). Never copy `.key` files.

- **Android:** Settings > Security > Encryption & credentials > Install a certificate > **CA certificate**. The app is built to trust user-installed CAs.
- **iPhone:** open the downloaded profile, install it (Settings > General > VPN & Device Management), then enable full trust in Settings > General > About > Certificate Trust Settings.

## 3. Get the app

**APK (Android), no local Android tooling needed:** push this repo to GitHub (it is a standalone project) and run
Actions > **QU32 Remote - Android APK** > Run workflow, then download the `qu32-remote-apk` artifact and sideload it.

**Or with Expo EAS (cloud build, free tier):**

```bash
cd mobile
npx eas-cli login
npx eas-cli build --platform android --profile preview     # APK link in the output
npx eas-cli build --platform ios --profile preview         # needs a paid Apple Developer account + registered devices
```

**Or locally** (needs JDK 17 + Android SDK): `cd mobile && npx expo run:android`.

Sign in with the gateway address (`https://192.168.1.50:8443`), `engineer`, and the password from step 1. Set the console IP in
**Access**, then create musician accounts and assign each a monitor mix.

## 4. Use the SDK in your own app

See [sdk/README.md](sdk/README.md). After changing SDK code: `npm run pack:sdk`, then `cd mobile && npm install ../dist-packages/qu32-sdk-0.1.0.tgz`.

## 5. Tests

```bash
npm install && npm test        # protocol vectors, gateway + permission + sync tests against the simulated desk
cd mobile && npx tsc --noEmit
```

`gateway/src/mock-main.ts` (`node gateway/dist/mock-main.js`) runs the simulated desk for manual trials:
`MOCK_PORT=51325`, then start the gateway with `QU32_MIXER_IP=127.0.0.1`.

## Safety notes

- Controls lock when the console is offline or not synced; nothing is queued or replayed after a reconnect.
- Scene recall needs a typed-exact `confirm` at the API and an extra confirmation in the app. 48V phantom is accepted by the API only with `confirm: "ENABLE 48V"` and is not exposed in the app.
- Output controls (Main LR, masters, groups) are behind an unlock switch in the app.
- Musicians sharing a mix share its master. The engineer's Access screen flags shared mixes.
- A resolved command means the gateway wrote it to the console. The next state poll (the console's own feedback) is the truth.
