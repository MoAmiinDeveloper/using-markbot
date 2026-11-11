import * as Sharing from 'expo-sharing';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ScoreTable } from '../components/ScoreTable';
import { useLeague } from '../state/LeagueContext';
import { colors } from '../theme';
import { notify } from '../utils/confirm';

export function ScoreboardScreen() {
  const { state, standings } = useLeague();
  const boardRef = useRef<React.ComponentRef<typeof View>>(null);
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        notify('Sharing unavailable', 'This device cannot open the share sheet.');
        return;
      }
      // No width/height given, so the capture uses the screen's native pixel density.
      const uri = await captureRef(boardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: `${state.groupName} — ${state.dayTitle}`,
      });
    } catch (e) {
      notify('Could not share', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Everything inside this view is the shared image; the button sits outside it. */}
        <View ref={boardRef} collapsable={false} style={styles.board}>
          <Text style={styles.group}>{state.groupName}</Text>
          <View style={styles.dayPill}>
            <Text style={styles.day}>{state.dayTitle}</Text>
          </View>
          <ScoreTable standings={standings} />
          <View style={styles.legend}>
            <Legend color={colors.win} label="WIN +3 · 15 km+" />
            <Legend color={colors.close} label="CLOSE +1 · 10 km+" />
            <Legend color={colors.loss} label="LOSS 0 · under 10 km" />
          </View>
        </View>
      </ScrollView>

      <Pressable
        onPress={share}
        accessibilityRole="button"
        accessibilityLabel="Share scoreboard to WhatsApp"
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        {sharing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.fabText}>Share to WhatsApp</Text>}
      </Pressable>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: 96 },
  board: { backgroundColor: colors.background, paddingHorizontal: 8, paddingTop: 14, paddingBottom: 12 },
  group: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dayPill: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 3,
    marginTop: 6,
    marginBottom: 12,
  },
  day: { color: colors.text, fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 12, rowGap: 4, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 10 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    minWidth: 180,
    height: 50,
    paddingHorizontal: 20,
    borderRadius: 25,
    backgroundColor: '#128C7E',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabPressed: { opacity: 0.85 },
  fabText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
