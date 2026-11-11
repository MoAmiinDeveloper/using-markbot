import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdminScreen } from './src/screens/AdminScreen';
import { ScoreboardScreen } from './src/screens/ScoreboardScreen';
import { LeagueProvider, useLeague } from './src/state/LeagueContext';
import { colors } from './src/theme';

type Tab = 'scoreboard' | 'admin';

const TABS: { key: Tab; label: string }[] = [
  { key: 'scoreboard', label: 'Scoreboard' },
  { key: 'admin', label: 'Admin' },
];

function Shell() {
  const insets = useSafeAreaInsets();
  const { ready } = useLeague();
  const [tab, setTab] = useState<Tab>('scoreboard');

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        {!ready ? (
          <ActivityIndicator color={colors.gold} style={styles.content} />
        ) : tab === 'scoreboard' ? (
          <ScoreboardScreen />
        ) : (
          <AdminScreen />
        )}
      </View>
      <View style={[styles.tabBar, { paddingBottom: insets.bottom }]}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.tabMarker, active && styles.tabMarkerActive]} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <LeagueProvider>
        <StatusBar style="light" />
        <Shell />
      </LeagueProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.rowAlt,
    borderTopWidth: 1,
    borderTopColor: colors.goldBorder,
  },
  tab: { flex: 1, alignItems: 'center', height: 54, justifyContent: 'center' },
  tabMarker: { position: 'absolute', top: 0, width: 48, height: 3, borderRadius: 2 },
  tabMarkerActive: { backgroundColor: colors.gold },
  tabLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
  tabLabelActive: { color: colors.gold },
});
