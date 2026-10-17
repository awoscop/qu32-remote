# @qu32/sdk

Client SDK and Qu MIDI protocol library for **QU32 Secure Remote** (Allen & Heath Qu-32).

- `@qu32/sdk`: `Qu32Client`: login, live state, typed control commands. Talks **only HTTPS to the QU32 gateway**, never raw MIDI or TCP. Works in React Native, browsers and Node 18+ (anything with `fetch`).
- `@qu32/sdk/protocol`: pure encoder/parser for the Qu MIDI protocol V1.9+ (used by the gateway; usable on its own).

## Install

```bash
npm install ./qu32-sdk-0.1.0.tgz
```

## Use

```ts
import { Qu32Client, formatDb } from "@qu32/sdk";

const qu = new Qu32Client({ baseUrl: "https://192.168.1.50:8443" });
const user = await qu.login("drummer", "a-long-password");   // user.role === "monitor", user.busIndex === 2

qu.subscribe(({ status, data }) => {
  if (data?.mixer.phase === "ready") console.log(data.mixer.strips[0]);
});
qu.start();                                                   // polls state (revision-checked)

await qu.setSendLevel(0x20, user.busIndex!, 0x62);            // CH 1 into my mix at 0 dB
qu.sendThrottled("ch1-send", { operation: "sendLevel", address: 0x20, busIndex: 2, value: 90 }); // drag-safe
console.log(formatDb(0x62));                                  // "0.0 dB"
```

React Native: pass `storage` backed by `expo-secure-store`:

```ts
import * as SecureStore from "expo-secure-store";
const storage = {
  get: () => SecureStore.getItemAsync("qu32.token"),
  set: (t) => (t ? SecureStore.setItemAsync("qu32.token", t) : SecureStore.deleteItemAsync("qu32.token")),
};
const qu = new Qu32Client({ baseUrl, storage });
```

## Behaviour to know

- A resolved `send()` means the **gateway accepted and wrote** the command. The console's own feedback (next state poll) is the truth.
- Errors are `Qu32Error` with `.status`: `401` sign in again, `403` not permitted for this account, `409/503` console not ready (controls are locked; nothing is queued), `429` too many requests.
- Permissions are enforced by the gateway from the account (role + assigned bus). Client-side checks are only a convenience.
- Levels are raw `0..127`; `formatDb` / `levelToDb` use the official table points (interpolated in between).
