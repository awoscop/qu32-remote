import { MONITOR_BUSES, PAN_MAX, UNITY, formatDb, formatPan, getSendLevel, getSendPan, getStrip, sendSources } from "@qu32/sdk";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import React, { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Fader } from "../components/Fader";
import { Card, Heading, Toggle } from "../components/ui";
import { useSession } from "../session";
import { colors } from "../theme";

/**
 * Monitor-mix view. Used by musicians (bus locked by their account) and by engineers in
 * "Monitor preview" (bus chosen in the UI). The gateway enforces the real permission either way.
 */
export function MonitorScreen({ busIndex }: { busIndex: number }) {
  const { client, mixer, canControl } = useSession();
  const bus = MONITOR_BUSES[busIndex];
  useEffect(() => { void activateKeepAwakeAsync("monitor"); return () => { void deactivateKeepAwake("monitor"); }; }, []);

  const sources = useMemo(() => (mixer ? sendSources(mixer) : []), [mixer]);
  if (!bus || !client || !mixer) return <Text style={s.empty}>No monitor mix assigned to this account. Ask the sound engineer.</Text>;

  const master = getStrip(mixer, bus.masterAddress);
  const throttle = (key: string, cmd: Parameters<typeof client.sendThrottled>[1]) => client.sendThrottled(key, cmd);

  return (
    <ScrollView contentContainerStyle={s.body}>
      <Text style={s.lock}>MY MONITOR · {bus.name}{bus.stereo ? " · STEREO" : ""}</Text>
      <Text style={s.hint}>Assigned by the sound engineer. Other mixes and Main LR are locked.</Text>

      <Heading>Monitor master</Heading>
      <Card>
        <Fader label="Output level" value={master?.fader ?? undefined} format={formatDb} mark={UNITY} disabled={!canControl}
          onChange={(v) => throttle(`m${busIndex}`, { operation: "monitorMasterFader", busIndex, value: v })}
          onCommit={(v) => client.setMonitorMaster(busIndex, v).catch(() => {})} />
        <View style={{ height: 8 }} />
        <Toggle on={master?.muted} label="Mute monitor" onLabel="MONITOR MUTED" danger disabled={!canControl}
          onPress={() => client.setMonitorMute(busIndex, !master?.muted).catch(() => {})} />
        <Text style={s.warn}>This controls your whole monitor output. Anyone else assigned to this mix shares it.</Text>
      </Card>

      <Heading>Vocals & instruments</Heading>
      <Card>
        {sources.map((src) => {
          const lvl = getSendLevel(mixer, src.address, busIndex);
          const pan = getSendPan(mixer, src.address, busIndex);
          return (
            <View key={src.address} style={s.row}>
              <Fader label={src.label} value={lvl} format={formatDb} mark={UNITY} disabled={!canControl}
                onChange={(v) => throttle(`s${src.address}.${busIndex}`, { operation: "sendLevel", address: src.address, busIndex, value: v })}
                onCommit={(v) => client.setSendLevel(src.address, busIndex, v).catch(() => {})} />
              {bus.stereo && (
                <Fader label="Pan" value={pan} max={PAN_MAX} format={formatPan} mark={37} disabled={!canControl}
                  onChange={(v) => throttle(`p${src.address}.${busIndex}`, { operation: "sendPan", address: src.address, busIndex, value: v })}
                  onCommit={(v) => client.setSendPan(src.address, busIndex, v).catch(() => {})} />
              )}
            </View>
          );
        })}
        {sources.length === 0 && <Text style={s.empty}>Waiting for the console...</Text>}
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48 },
  lock: { color: colors.accent, fontSize: 18, fontWeight: "800", letterSpacing: 1 },
  hint: { color: colors.muted, fontSize: 13, marginBottom: 8 },
  warn: { color: colors.muted, fontSize: 12, marginTop: 10 },
  row: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 4, marginBottom: 6 },
  empty: { color: colors.muted, padding: 24, textAlign: "center" },
});
