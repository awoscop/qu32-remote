import React, { useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { colors } from "../theme";

interface Props {
  label: string;
  /** Raw value from the console; undefined = not reported yet (control disabled). */
  value: number | undefined;
  max?: number;
  format: (v: number) => string;
  /** Called while dragging (caller should throttle) and on release. */
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  disabled?: boolean;
  /** Value to mark with a tick (e.g. unity gain). */
  mark?: number;
}

/** Horizontal fader with a 44px+ touch target. Shows console feedback when not being dragged. */
export function Fader({ label, value, max = 127, format, onChange, onCommit, disabled, mark }: Props) {
  const [width, setWidth] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const start = useRef(0);
  const live = useRef({ onChange, onCommit, max, width, disabled: !!disabled || value === undefined });
  live.current = { onChange, onCommit, max, width, disabled: !!disabled || value === undefined };
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  const toValue = (x: number) => {
    const { max: m, width: w } = live.current;
    return Math.round(Math.max(0, Math.min(1, x / w)) * m);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        if (holdTimer.current) clearTimeout(holdTimer.current);
        start.current = e.nativeEvent.locationX;
        const v = toValue(start.current);
        dragRef.current = v;
        setDrag(v);
        live.current.onChange(v);
      },
      onPanResponderMove: (_e, g) => {
        const v = toValue(start.current + g.dx);
        if (v !== dragRef.current) {
          dragRef.current = v;
          setDrag(v);
          live.current.onChange(v);
        }
      },
      onPanResponderRelease: () => {
        const v = dragRef.current;
        if (v !== null) live.current.onCommit?.(v);
        // keep showing the dragged value briefly so the thumb does not jump before feedback arrives
        holdTimer.current = setTimeout(() => { dragRef.current = null; setDrag(null); }, 700);
      },
    }),
  ).current;

  const shown = drag ?? value ?? 0;
  const pct = Math.max(0, Math.min(1, shown / max));
  const off = disabled || value === undefined;

  return (
    <View style={[s.wrap, off && s.off]} accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ text: value === undefined ? "not synced" : format(shown) }}>
      <View style={s.head}>
        <Text style={s.label} numberOfLines={1}>{label}</Text>
        <Text style={s.value}>{value === undefined ? "--" : format(shown)}</Text>
      </View>
      <View style={s.track} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width || 1)} {...pan.panHandlers}>
        <View pointerEvents="none" style={s.rail}>
          <View style={[s.fill, { width: `${pct * 100}%` }]} />
          {mark !== undefined && <View style={[s.mark, { left: `${(mark / max) * 100}%` }]} />}
        </View>
        <View pointerEvents="none" style={[s.thumb, { left: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingVertical: 6 },
  off: { opacity: 0.45 },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  label: { color: colors.text, fontSize: 16, flex: 1, paddingRight: 8 },
  value: { color: colors.accent, fontSize: 14, fontVariant: ["tabular-nums"] },
  track: { height: 44, justifyContent: "center", marginHorizontal: 14 },
  rail: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "visible" },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accentDim },
  mark: { position: "absolute", top: -4, width: 2, height: 16, backgroundColor: colors.muted },
  thumb: { position: "absolute", marginLeft: -14, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accent, borderWidth: 3, borderColor: colors.background },
});
