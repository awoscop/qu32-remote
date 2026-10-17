import { MockQu } from "./mock-mixer.js";

const m = new MockQu();
const port = await m.listen(Number(process.env.MOCK_PORT ?? 51325));
console.log(`Mock Qu-32 listening on 127.0.0.1:${port}. Point the gateway at 127.0.0.1 (QU32_MIXER_PORT=${port}).`);
