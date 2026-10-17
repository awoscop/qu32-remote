// The gateway shares the SDK's protocol module (built output) so bytes and address tables exist exactly once.
export * from "../../sdk/dist/protocol/index.js";
export type { MixerSnapshot, StripState, User, Role, MixerPhase } from "../../sdk/dist/client/types.js";
