import {
  MONITOR_BUSES, PAN_MAX, PROCESSING, STRIPS, UNITY, busName, formatDb, formatPan, getSendLevel, getSendPan, sendSources,
  type User,
} from "@qu32/sdk";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Fader } from "../components/Fader";
import { Btn, Card, Chip, Heading, Toggle } from "../components/ui";
import { useSession } from "../session";
import { colors, radius } from "../theme";

export type EngineerTab = "channels" | "sends" | "outputs" | "processing" | "scenes" | "access";
export const ENGINEER_TABS: { id: EngineerTab; label: string }[] = [
  { id: "channels", label: "Channels" },
  { id: "sends", label: "Mix Sends" },
  { id: "outputs", label: "Outputs" },
  { id: "processing", label: "EQ & DSP" },
  { id: "scenes", label: "Scenes" },
  { id: "access", label: "Access" },
];

const note = (e: unknown) => Alert.alert("Not applied", (e as Error).message);

export function EngineerScreen({ tab }: { tab: EngineerTab }) {
  switch (tab) {
    case "channels": return <ChannelsTab />;
    case "sends": return <SendsTab />;
    case "outputs": return <OutputsTab />;
    case "processing": return <ProcessingTab />;
    case "scenes": return <ScenesTab />;
    case "access": return <AccessTab />;
  }
}

function ChannelsTab() {
  const { client, mixer, canControl } = useSession();
  const [bank, setBank] = useState(0);
  if (!client || !mixer) return null;
  const inputs = mixer.strips.filter((s) => s.family === "input");
  const others = mixer.strips.filter((s) => s.family === "stereo" || s.family === "fxReturn");
  const banks = ["CH 1-8", "CH 9-16", "CH 17-24", "CH 25-32", "ST / FX"];
  const list = bank < 4 ? inputs.slice(bank * 8, bank * 8 + 8) : others;
  return (
    <ScrollView contentContainerStyle={s.body}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {banks.map((b, i) => <Chip key={b} label={b} active={bank === i} onPress={() => setBank(i)} />)}
      </ScrollView>
      {list.map((st) => (
        <Card key={st.address}>
          <Fader label={st.label} value={st.fader ?? undefined} format={formatDb} mark={UNITY} disabled={!canControl}
            onChange={(v) => client.sendThrottled(`f${st.address}`, { operation: "stripFader", address: st.address, value: v })}
            onCommit={(v) => client.setFader(st.address, v).catch(() => {})} />
          <Toggle on={st.muted} label="Mute" onLabel="MUTED" danger disabled={!canControl}
            onPress={() => client.setMute(st.address, !st.muted).catch(note)} />
        </Card>
      ))}
    </ScrollView>
  );
}

function SendsTab() {
  const { client, mixer, canControl } = useSession();
  const [bus, setBus] = useState(0);
  if (!client || !mixer) return null;
  const buses = [...MONITOR_BUSES.map((b) => b.busIndex), 16, 17, 18, 19];
  const mon = MONITOR_BUSES[bus];
  const master = mon ? mixer.strips.find((x) => x.address === mon.masterAddress) : undefined;
  return (
    <ScrollView contentContainerStyle={s.body}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {buses.map((b) => <Chip key={b} label={busName(b)} active={bus === b} onPress={() => setBus(b)} />)}
      </ScrollView>
      {mon && (
        <Card>
          <Fader label={`${mon.name} master`} value={master?.fader ?? undefined} format={formatDb} mark={UNITY} disabled={!canControl}
            onChange={(v) => client.sendThrottled(`m${bus}`, { operation: "monitorMasterFader", busIndex: bus, value: v })}
            onCommit={(v) => client.setMonitorMaster(bus, v).catch(() => {})} />
          <Toggle on={master?.muted} label="Mute mix" onLabel="MIX MUTED" danger disabled={!canControl}
            onPress={() => client.setMonitorMute(bus, !master?.muted).catch(note)} />
        </Card>
      )}
      <Card>
        {sendSources(mixer).map((src) => (
          <View key={src.address}>
            <Fader label={src.label} value={getSendLevel(mixer, src.address, bus)} format={formatDb} mark={UNITY} disabled={!canControl}
              onChange={(v) => client.sendThrottled(`s${src.address}.${bus}`, { operation: "sendLevel", address: src.address, busIndex: bus, value: v })}
              onCommit={(v) => client.setSendLevel(src.address, bus, v).catch(() => {})} />
            {bus >= 4 && bus <= 6 && (
              <Fader label="Pan" value={getSendPan(mixer, src.address, bus)} max={PAN_MAX} format={formatPan} mark={37} disabled={!canControl}
                onChange={(v) => client.sendThrottled(`p${src.address}.${bus}`, { operation: "sendPan", address: src.address, busIndex: bus, value: v })}
                onCommit={(v) => client.setSendPan(src.address, bus, v).catch(() => {})} />
            )}
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function OutputsTab() {
  const { client, mixer, canControl } = useSession();
  const [unlocked, setUnlocked] = useState(false);
  if (!client || !mixer) return null;
  const fam = ["main", "mix", "dca", "group", "matrix", "fxSend", "muteGroup"];
  const list = mixer.strips.filter((x) => fam.includes(x.family)).sort((a, b) => fam.indexOf(a.family) - fam.indexOf(b.family));
  const can = canControl && unlocked;
  return (
    <ScrollView contentContainerStyle={s.body}>
      <Card>
        <View style={s.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Unlock output controls</Text>
            <Text style={s.muted}>Main LR, masters and groups affect the whole room. Locked by default.</Text>
          </View>
          <Switch value={unlocked} onValueChange={setUnlocked} accessibilityLabel="Unlock output controls" />
        </View>
      </Card>
      {list.map((st) => {
        const info = STRIPS.find((x) => x.address === st.address)!;
        return (
          <Card key={st.address}>
            {info.hasFader && (
              <Fader label={st.label} value={st.fader ?? undefined} format={formatDb} mark={UNITY} disabled={!can}
                onChange={(v) => client.sendThrottled(`f${st.address}`, { operation: "stripFader", address: st.address, value: v })}
                onCommit={(v) => client.setFader(st.address, v).catch(() => {})} />
            )}
            {!info.hasFader && <Text style={s.title}>{st.label}</Text>}
            <Toggle on={st.muted} label="Mute" onLabel="MUTED" danger disabled={!can}
              onPress={() => client.setMute(st.address, !st.muted).catch(note)} />
          </Card>
        );
      })}
    </ScrollView>
  );
}

function ProcessingTab() {
  const { client, mixer, canControl } = useSession();
  const [ch, setCh] = useState(0x20);
  if (!client || !mixer) return null;
  const inputs = mixer.strips.filter((x) => x.family === "input");
  const groups = ["hpf", "eq", "gate", "comp", "preamp", "delay"] as const;
  return (
    <ScrollView contentContainerStyle={s.body}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {inputs.map((x) => <Chip key={x.address} label={x.label.length > 10 ? x.label.slice(0, 10) : x.label} active={ch === x.address} onPress={() => setCh(x.address)} />)}
      </ScrollView>
      <Text style={s.muted}>Values are raw console units (0-127). Compare against the desk screen before relying on them.</Text>
      {groups.map((g) => (
        <View key={g}>
          <Heading>{g}</Heading>
          <Card>
            {PROCESSING.filter((p) => p.group === g && !p.dangerous).map((p) => {
              const v = mixer.params[`${ch}:${p.id}:${p.vx}`];
              return p.toggle ? (
                <Toggle key={p.key} on={v === undefined ? null : v === 1} label={p.label} onLabel={`${p.label}: ON`} disabled={!canControl}
                  onPress={() => client.setProcessing(ch, p.key, v === 1 ? 0 : 1).catch(note)} />
              ) : (
                <Fader key={p.key} label={p.label} value={v} max={p.max} format={(n) => String(n)} disabled={!canControl}
                  onChange={(n) => client.sendThrottled(`${p.key}${ch}`, { operation: "processing", address: ch, key: p.key, value: n })}
                  onCommit={(n) => client.setProcessing(ch, p.key, n).catch(() => {})} />
              );
            })}
          </Card>
        </View>
      ))}
      <Text style={s.muted}>48V phantom power is intentionally not available in the app.</Text>
    </ScrollView>
  );
}

function ScenesTab() {
  const { client, mixer, canControl } = useSession();
  const [scene, setScene] = useState(1);
  if (!client || !mixer) return null;
  const recall = () =>
    Alert.alert(`Recall scene ${scene}?`, "This changes the live mix and may change outputs. Make sure the room is ready.", [
      { text: "Cancel", style: "cancel" },
      { text: `Recall ${scene}`, style: "destructive", onPress: () => client.recallScene(scene).catch(note) },
    ]);
  return (
    <ScrollView contentContainerStyle={s.body}>
      <Card>
        <Text style={s.muted}>Current scene: {mixer.scene ?? "unknown"}</Text>
        <View style={[s.rowBetween, { marginVertical: 14 }]}>
          <Btn title="-" kind="ghost" onPress={() => setScene((n) => Math.max(1, n - 1))} style={{ width: 64 }} />
          <Text style={s.big}>{scene}</Text>
          <Btn title="+" kind="ghost" onPress={() => setScene((n) => Math.min(100, n + 1))} style={{ width: 64 }} />
        </View>
        <Btn title={`Recall scene ${scene}`} kind="danger" disabled={!canControl} onPress={recall} />
      </Card>
    </ScrollView>
  );
}

function AccessTab() {
  const { client, mixer, sharedBuses, signOut } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [host, setHost] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [bus, setBus] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { client?.listUsers().then((r) => setUsers(r.users)).catch(() => {}); }, [client]);
  useEffect(load, [load]);
  useEffect(() => { if (mixer?.host && !host) setHost(mixer.host); }, [mixer?.host, host]);
  if (!client) return null;

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try { await f(); load(); } catch (e) { note(e); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
      <Heading>Console connection</Heading>
      <Card>
        <TextInput style={s.input} value={host} onChangeText={setHost} placeholder="Qu-32 IP, e.g. 192.168.1.100" placeholderTextColor={colors.muted}
          keyboardType="numbers-and-punctuation" autoCapitalize="none" accessibilityLabel="Qu-32 IP address" />
        <View style={{ height: 8 }} />
        <Btn title="Connect to console" disabled={busy || !host} onPress={() => run(() => client.setMixerHost(host.trim()))} />
        <Text style={[s.muted, { marginTop: 8 }]}>{mixer ? `${mixer.phase}: ${mixer.message}` : ""}</Text>
      </Card>

      <Heading>Create musician</Heading>
      <Card>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Username" placeholderTextColor={colors.muted} autoCapitalize="none" accessibilityLabel="New username" />
        <View style={{ height: 8 }} />
        <TextInput style={s.input} value={pw} onChangeText={setPw} placeholder="Password (12+ characters)" placeholderTextColor={colors.muted} secureTextEntry autoCapitalize="none" accessibilityLabel="New password" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 10 }}>
          {MONITOR_BUSES.map((b) => <Chip key={b.busIndex} label={b.name} active={bus === b.busIndex} onPress={() => setBus(b.busIndex)} />)}
        </ScrollView>
        <Btn title="Create account" disabled={busy || !name || pw.length < 12}
          onPress={() => run(async () => { await client.createUser(name, pw, bus); setName(""); setPw(""); })} />
      </Card>

      <Heading>Accounts</Heading>
      {users.filter((u) => u.role === "monitor").map((u) => (
        <Card key={u.username}>
          <View style={s.rowBetween}>
            <View>
              <Text style={s.title}>{u.username}</Text>
              <Text style={s.muted}>{u.busIndex !== null ? busName(u.busIndex) : "-"} · {u.enabled ? "Active" : "Disabled"}{u.busIndex !== null && sharedBuses.includes(u.busIndex) ? " · SHARED MIX" : ""}</Text>
            </View>
            <Switch value={u.enabled} onValueChange={(v) => run(() => client.updateUser(u.username, { enabled: v }))} accessibilityLabel={`${u.username} enabled`} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {MONITOR_BUSES.map((b) => (
              <Chip key={b.busIndex} label={b.name} active={u.busIndex === b.busIndex}
                onPress={() => run(() => client.updateUser(u.username, { busIndex: b.busIndex }))} />
            ))}
          </ScrollView>
        </Card>
      ))}
      <Text style={s.muted}>Changing a musician's mix or disabling them signs them out immediately.</Text>
      <View style={{ height: 16 }} />
      <Btn title="Sign out" kind="ghost" onPress={signOut} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, paddingBottom: 64 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: 13 },
  big: { color: colors.accent, fontSize: 40, fontWeight: "800" },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: radius, color: colors.text, fontSize: 16, minHeight: 48, paddingHorizontal: 14 },
});
