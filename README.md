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
| `mobile/` | Expo / React Native app (engineer + musician UIs) |
| `dist-packages/` | Built `qu32-sdk-0.1.0.tgz` (install anywhere with `npm install ./qu32-sdk-0.1.0.tgz`) |

## Status (read this before a service)

- Verified: protocol encoders against the official message formats, the whole gateway/SDK flow against a
  **simulated** Qu-32 (30 automated tests), app type-checks and bundles for Android.
- **Not verified:** a physical Qu-32, an installed APK on a phone, iPhone builds. Do the hardware checklist
  in `docs/QU32-REMOTE-DESIGN.md` section 12 with the PA muted before any live use.
- Not implemented: meters, RTA, patching, graphical EQ, WebSocket push (state is polled ~0.7 s, revision-checked).

## 1. Run the gateway

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
