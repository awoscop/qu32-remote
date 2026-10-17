import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Btn } from "../components/ui";
import { useSession } from "../session";
import { colors, radius } from "../theme";

export function LoginScreen() {
  const { signIn, gatewayUrl } = useSession();
  const [url, setUrl] = useState(gatewayUrl || "https://192.168.1.50:8443");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await signIn(url, username, password);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.logo}>QU32</Text>
        <Text style={s.sub}>SECURE REMOTE</Text>
        <Text style={s.tag}>Control your sound securely on your local Wi-Fi.</Text>

        <Text style={s.label}>Gateway address</Text>
        <TextInput style={s.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false}
          keyboardType="url" placeholder="https://192.168.1.50:8443" placeholderTextColor={colors.muted} accessibilityLabel="Gateway address" />
        <Text style={s.label}>Username</Text>
        <TextInput style={s.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}
          placeholder="engineer or your name" placeholderTextColor={colors.muted} accessibilityLabel="Username" />
        <Text style={s.label}>Password</Text>
        <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
          onSubmitEditing={go} placeholderTextColor={colors.muted} accessibilityLabel="Password" />

        {err && <Text style={s.err} accessibilityLiveRegion="assertive">{err}</Text>}
        <View style={{ height: 12 }} />
        {busy ? <ActivityIndicator color={colors.accent} /> : <Btn title="Connect & sign in" onPress={go} disabled={!username || !password || !url} />}
        <Text style={s.note}>Connections are HTTPS only. Your phone must trust the gateway's certificate (see setup guide).</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  body: { padding: 24, paddingTop: 64 },
  logo: { color: colors.accent, fontSize: 44, fontWeight: "800", textAlign: "center" },
  sub: { color: colors.text, fontSize: 14, letterSpacing: 6, textAlign: "center", marginBottom: 8 },
  tag: { color: colors.muted, textAlign: "center", marginBottom: 32 },
  label: { color: colors.muted, fontSize: 13, marginTop: 14, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius, color: colors.text, fontSize: 16, minHeight: 50, paddingHorizontal: 14 },
  err: { color: colors.danger, marginTop: 14 },
  note: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 20 },
});
