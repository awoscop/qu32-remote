import React from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { colors, radius } from "../theme";
import { useSession } from "../session";

export function Btn({ title, onPress, kind = "primary", disabled, style }: {
  title: string; onPress: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; style?: ViewStyle;
}) {
  const bg = kind === "primary" ? colors.accent : kind === "danger" ? colors.danger : "transparent";
  const fg = kind === "ghost" ? colors.text : colors.background;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: kind === "ghost" ? colors.border : bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, style]}>
      <Text style={[s.btnText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

/** Mute/toggle with text AND colour so state is never colour-only. */
export function Toggle({ on, label, onLabel, onPress, disabled, danger }: {
  on: boolean | null | undefined; label: string; onLabel?: string; onPress: () => void; disabled?: boolean; danger?: boolean;
}) {
  const active = !!on;
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: active, disabled }} accessibilityLabel={label}
      disabled={disabled || on === null || on === undefined} onPress={onPress}
      style={[s.toggle, active && { backgroundColor: danger ? colors.danger : colors.accentDim, borderColor: danger ? colors.danger : colors.accent }, (disabled || on == null) && { opacity: 0.4 }]}>
      <Text style={s.toggleText}>{active ? (onLabel ?? `${label} ON`) : label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Heading({ children }: { children: React.ReactNode }) {
  return <Text style={s.heading}>{children}</Text>;
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress}
      style={[s.chip, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
      <Text style={[s.chipText, active && { color: colors.background, fontWeight: "700" }]}>{label}</Text>
    </Pressable>
  );
}

/** Persistent connection/console status. Always visible, labelled, never colour-only. */
export function StatusPill() {
  const { conn, mixer } = useSession();
  let text = "Connecting...";
  let color: string = colors.warning;
  if (conn.status === "gateway-unreachable") { text = "Gateway unreachable. Controls locked."; color = colors.danger; }
  else if (conn.status === "online" && mixer) {
    if (mixer.phase === "ready") { text = `Mixer online${mixer.firmware ? ` · fw ${mixer.firmware}` : ""}`; color = colors.accent; }
    else if (mixer.phase === "syncing" || mixer.phase === "connecting") { text = `${mixer.message}`; color = colors.warning; }
    else { text = `Qu-32 offline: ${mixer.message}. Controls locked.`; color = colors.danger; }
  }
  return (
    <View style={s.pill} accessibilityLiveRegion="polite">
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={[s.pillText, { color }]} numberOfLines={2}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 48, borderRadius: radius, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  btnText: { fontSize: 16, fontWeight: "700" },
  toggle: { minHeight: 44, minWidth: 72, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  toggleText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 12 },
  heading: { color: colors.muted, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8, marginTop: 4 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, justifyContent: "center", marginRight: 8, backgroundColor: colors.surface },
  chipText: { color: colors.text, fontSize: 14 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pillText: { fontSize: 13, flexShrink: 1 },
});
