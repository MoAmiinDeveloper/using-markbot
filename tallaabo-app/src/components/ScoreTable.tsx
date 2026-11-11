import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Standing, Tier } from '../domain/scoring';
import { colors } from '../theme';

const TIER_COLOR: Record<Tier, string> = { WIN: colors.win, CLOSE: colors.close, LOSS: colors.loss };

const fmt = (n: number) => n.toLocaleString('en-US');

export function TierBadge({ tier, points }: { tier: Tier; points: number }) {
  return (
    <View style={[styles.badge, { backgroundColor: TIER_COLOR[tier] }]}>
      <Text style={styles.badgeText}>{tier}</Text>
      <Text style={styles.badgePoints}>+{points}</Text>
    </View>
  );
}

export function ScoreTable({ standings }: { standings: Standing[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={[styles.th, styles.cRank]}>#</Text>
        <Text style={[styles.th, styles.cName]}>PLAYER</Text>
        <Text style={[styles.th, styles.cGp]}>GP</Text>
        <Text style={[styles.th, styles.cToday]}>TODAY</Text>
        <Text style={[styles.th, styles.cTotal]}>STEPS</Text>
        <Text style={[styles.th, styles.cPts]}>PTS</Text>
      </View>
      {standings.map((row, i) => (
        <View key={row.id} style={[styles.row, i % 2 === 1 && styles.rowAlt]}>
          <Text style={[styles.rank, styles.cRank, row.isMvp && styles.gold]}>{row.rank}</Text>
          <View style={styles.cName}>
            <Text style={styles.name} numberOfLines={1}>
              {row.name}
            </Text>
            <View style={styles.tags}>
              <TierBadge tier={row.tier} points={row.todayPoints} />
              {row.isMvp && <Text style={styles.mvp}>★ MVP</Text>}
            </View>
          </View>
          <Text style={[styles.num, styles.cGp]}>{row.gp}</Text>
          <View style={styles.cToday}>
            <Text style={styles.num}>{fmt(row.todaySteps)}</Text>
            <Text style={styles.km}>{row.todayKm} km</Text>
          </View>
          <Text style={[styles.num, styles.cTotal]}>{fmt(row.totalSteps)}</Text>
          <View style={[styles.cPts, styles.ptsCell]}>
            <Text style={styles.pts}>{row.totalPoints}</Text>
          </View>
        </View>
      ))}
      {standings.length === 0 && <Text style={styles.empty}>No members yet. Add them in Admin.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    borderWidth: 1.5,
    borderColor: colors.gold,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gold,
    paddingVertical: 7,
    paddingLeft: 6,
  },
  th: { color: colors.onGold, fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'stretch', paddingLeft: 6, minHeight: 48 },
  rowAlt: { backgroundColor: colors.rowAlt },
  cRank: { width: 22, alignSelf: 'center', textAlign: 'center' },
  cName: { flex: 1, paddingLeft: 6, paddingRight: 2, justifyContent: 'center', textAlign: 'left' },
  cGp: { width: 20, alignSelf: 'center', textAlign: 'center' },
  cToday: { width: 54, alignItems: 'center', justifyContent: 'center' },
  cTotal: { width: 54, alignSelf: 'center', textAlign: 'center' },
  cPts: { width: 40 },
  rank: { color: colors.textMuted, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  name: { color: colors.text, fontSize: 13, fontWeight: '600' },
  mvp: { color: colors.gold, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  gold: { color: colors.gold },
  num: { color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  km: { color: colors.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
  ptsCell: { backgroundColor: colors.goldDim, alignItems: 'center', justifyContent: 'center' },
  pts: { color: colors.gold, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  badgePoints: { color: '#FFFFFF', fontSize: 9, fontWeight: '700', opacity: 0.9 },
  empty: { color: colors.textMuted, textAlign: 'center', padding: 24 },
});
