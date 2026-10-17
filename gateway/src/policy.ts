import {
  MONITOR_BUSES, NRPN_ID, paramKey, stripInfo, validateCommand,
  type Command, type MixerSnapshot, type User,
} from "./qu.js";

export type Decision = { ok: true; command: Command } | { ok: false; status: 400 | 403; error: string };

/**
 * Server-authoritative authorization. Permission comes ONLY from the session's user
 * (role + assigned bus). The client's visible "mode" is never an input.
 */
export function authorize(user: User, raw: unknown): Decision {
  const bad = validateCommand(raw);
  if (bad) return { ok: false, status: 400, error: bad };
  const c = raw as Command;
  if (user.role === "engineer") return { ok: true, command: c };

  const own = user.busIndex;
  if (own === null) return { ok: false, status: 403, error: "No monitor bus assigned to this account" };
  switch (c.operation) {
    case "sendLevel":
    case "sendPan":
    case "monitorMasterFader":
    case "monitorMasterMute":
      if (c.busIndex === own) return { ok: true, command: c };
      return { ok: false, status: 403, error: "You can only change your assigned monitor mix" };
    default:
      return { ok: false, status: 403, error: "Your account cannot change this control" };
  }
}

/** Role-shaped snapshot: musicians only see sources + their own bus. */
export function filterSnapshot(user: User, m: MixerSnapshot): MixerSnapshot {
  if (user.role === "engineer") return m;
  const bus = user.busIndex === null ? undefined : MONITOR_BUSES[user.busIndex];
  if (!bus) return { ...m, host: "", strips: [], params: {}, scene: null };
  const params: Record<string, number> = {};
  const strips = [];
  for (const s of m.strips) {
    const info = stripInfo(s.address);
    if (info?.isSendSource) {
      strips.push({ ...s, fader: null, muted: null });
      for (const id of [NRPN_ID.sendLevel, ...(bus.stereo ? [NRPN_ID.pan] : [])]) {
        const k = paramKey(s.address, id, bus.busIndex);
        if (k in m.params) params[k] = m.params[k]!;
      }
    } else if (s.address === bus.masterAddress) {
      strips.push(s);
      const k = paramKey(s.address, NRPN_ID.fader, 7);
      if (k in m.params) params[k] = m.params[k]!;
    }
  }
  return { ...m, host: "", scene: null, strips, params };
}
