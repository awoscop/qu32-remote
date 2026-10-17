import { StatusBar } from "expo-status-bar";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Chip, StatusPill } from "./src/components/ui";
import { ENGINEER_TABS, EngineerScreen, type EngineerTab } from "./src/screens/EngineerScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MonitorScreen } from "./src/screens/MonitorScreen";
import { SessionProvider, useSession } from "./src/session";
import { colors } from "./src/theme";
import { MONITOR_BUSES } from "@qu32/sdk";

function Shell() {
  const { booting, user, signOut } = useSession();
  const [mode, setMode] = useState<"full" | "monitor">("full");
  const [tab, setTab] = useState<EngineerTab>("channels");
  const [previewBus, setPreviewBus] = useState(0);

  if (booting) return <View style={s.center}><ActivityIndicator color={colors.accent} /></View>;
  if (!user) return <LoginScreen />;

  const engineer = user.role === "engineer";
  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <Text style={s.brand}>QU32</Text>
        <StatusPill />
        <Pressable onPress={signOut} accessibilityRole="button" accessibilityLabel="Sign out" style={s.user}>
          <Text style={s.userText}>{user.username} · Sign out</Text>
        </Pressable>
      </View>

      {engineer ? (
        <>
          <View style={s.modes}>
            <Chip label="Full console" active={mode === "full"} onPress={() => setMode("full")} />
            <Chip label="Monitor preview" active={mode === "monitor"} onPress={() => setMode("monitor")} />
          </View>
          {mode === "full" ? (
            <>
              <View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
                  {ENGINEER_TABS.map((t) => <Chip key={t.id} label={t.label} active={tab === t.id} onPress={() => setTab(t.id)} />)}
                </ScrollView>
              </View>
              <EngineerScreen tab={tab} />
            </>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
                {MONITOR_BUSES.map((b) => <Chip key={b.busIndex} label={b.name} active={previewBus === b.busIndex} onPress={() => setPreviewBus(b.busIndex)} />)}
              </ScrollView>
              <MonitorScreen busIndex={previewBus} />
            </>
          )}
        </>
      ) : (
        <MonitorScreen busIndex={user.busIndex ?? -1} />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <SafeAreaView style={s.root} edges={["top", "left", "right", "bottom"]}>
          <StatusBar style="light" />
          <Shell />
        </SafeAreaView>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  brand: { color: colors.accent, fontWeight: "800", fontSize: 18 },
  user: { marginLeft: "auto", minHeight: 44, justifyContent: "center" },
  userText: { color: colors.muted, fontSize: 12 },
  modes: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 10 },
  tabs: { paddingHorizontal: 16, paddingVertical: 10 },
});

