import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { TierBadge } from '../components/ScoreTable';
import { estKm, pointsFor, tierFor } from '../domain/scoring';
import { createSeedState } from '../domain/seed';
import { usePedometer } from '../hooks/usePedometer';
import { useLeague } from '../state/LeagueContext';
import { colors } from '../theme';
import { confirmAction } from '../utils/confirm';

const PEDOMETER_MESSAGE = {
  idle: 'Read steps from this phone’s motion sensor.',
  connecting: 'Connecting…',
  unavailable: 'No step sensor is available on this device.',
  denied: 'Motion permission was denied. Allow it in system settings.',
} as const;

export function AdminScreen() {
  const { state, dispatch } = useLeague();
  const pedometer = usePedometer();
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [pickOpen, setPickOpen] = useState(false);

  const addMember = () => {
    if (!newName.trim()) return;
    dispatch({ type: 'addMember', id: `m-${Date.now()}`, name: newName });
    setNewName('');
    setAddOpen(false);
  };

  const rollOver = () =>
    confirmAction(
      'Roll over to next day?',
      `This locks the points for “${state.dayTitle}” into the standings, adds a game played for everyone, and resets today’s steps to 0.`,
      'Roll over',
      () => dispatch({ type: 'rollOver', closedAt: new Date().toISOString() }),
    );

  const reset = () =>
    confirmAction(
      'Reset league?',
      'This deletes all changes and restores the original 13-member roster.',
      'Reset',
      () => dispatch({ type: 'hydrate', state: createSeedState() }),
    );

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Group name</Text>
        <TextInput
          style={styles.input}
          value={state.groupName}
          onChangeText={(value) => dispatch({ type: 'setGroupName', value })}
          placeholder="Group name"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.label}>Day title</Text>
        <TextInput
          style={styles.input}
          value={state.dayTitle}
          onChangeText={(value) => dispatch({ type: 'setDayTitle', value })}
          placeholder="Day 1 · Nov 7"
          placeholderTextColor={colors.textMuted}
        />

        <View style={styles.card}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Phone pedometer</Text>
            <Text style={styles.cardBody}>
              {pedometer.status === 'ready'
                ? `${pedometer.steps.toLocaleString('en-US')} steps ${
                    pedometer.sinceMidnight ? 'today' : 'since connecting'
                  }`
                : PEDOMETER_MESSAGE[pedometer.status]}
            </Text>
          </View>
          {pedometer.status === 'ready' ? (
            <SmallButton label="Apply to…" onPress={() => setPickOpen(true)} />
          ) : (
            <SmallButton label="Connect" onPress={pedometer.connect} disabled={pedometer.status === 'connecting'} />
          )}
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.section}>Today’s steps</Text>
          <SmallButton label="+ Add Member" onPress={() => setAddOpen(true)} />
        </View>

        {state.members.map((m, i) => (
          <View key={m.id} style={[styles.memberRow, i % 2 === 1 && styles.rowAlt]}>
            <View style={styles.flex}>
              <Text style={styles.memberName} numberOfLines={1}>
                {m.name}
              </Text>
              <View style={styles.memberMeta}>
                <TierBadge tier={tierFor(m.todaySteps)} points={pointsFor(m.todaySteps)} />
                <Text style={styles.km}>{estKm(m.todaySteps)} km</Text>
              </View>
            </View>
            <TextInput
              style={styles.stepsInput}
              value={m.todaySteps ? String(m.todaySteps) : ''}
              onChangeText={(text) =>
                dispatch({ type: 'setSteps', id: m.id, steps: Number(text.replace(/\D/g, '')) })
              }
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={6}
              selectTextOnFocus
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={`Steps today for ${m.name}`}
            />
            <Pressable
              onPress={() =>
                confirmAction(
                  `Remove ${m.name}?`,
                  'Their points and steps will be deleted from the league.',
                  'Remove',
                  () => dispatch({ type: 'removeMember', id: m.id }),
                )
              }
              hitSlop={8}
              style={styles.remove}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${m.name}`}
            >
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}

        <Pressable onPress={rollOver} style={({ pressed }) => [styles.rollOver, pressed && styles.pressed]}>
          <Text style={styles.rollOverText}>Roll Over to Next Day</Text>
        </Pressable>
        <Text style={styles.hint}>
          {state.history.length === 0
            ? 'No days rolled over on this phone yet.'
            : `Last rolled over: ${state.history[state.history.length - 1].title} · ${state.history.length} day${
                state.history.length === 1 ? '' : 's'
              } saved on this phone.`}
        </Text>

        <Pressable onPress={reset} style={styles.reset}>
          <Text style={styles.resetText}>Reset league to starting data</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.dialog}>
            <Text style={styles.cardTitle}>Add member</Text>
            <TextInput
              style={[styles.input, styles.dialogInput]}
              value={newName}
              onChangeText={setNewName}
              placeholder="Member name"
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={addMember}
            />
            <View style={styles.dialogActions}>
              <SmallButton label="Cancel" onPress={() => setAddOpen(false)} />
              <SmallButton label="Add" onPress={addMember} disabled={!newName.trim()} solid />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={pickOpen} transparent animationType="fade" onRequestClose={() => setPickOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.cardTitle}>Apply {pedometer.steps.toLocaleString('en-US')} steps to</Text>
            <ScrollView style={styles.pickList}>
              {state.members.map((m) => (
                <Pressable
                  key={m.id}
                  style={styles.pickRow}
                  onPress={() => {
                    dispatch({ type: 'setSteps', id: m.id, steps: pedometer.steps });
                    setPickOpen(false);
                  }}
                >
                  <Text style={styles.memberName}>{m.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.dialogActions}>
              <SmallButton label="Cancel" onPress={() => setPickOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function SmallButton(props: { label: string; onPress: () => void; disabled?: boolean; solid?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.smallButton,
        props.solid && styles.smallButtonSolid,
        (pressed || props.disabled) && styles.pressed,
      ]}
    >
      <Text style={[styles.smallButtonText, props.solid && styles.smallButtonTextSolid]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 12, paddingBottom: 40 },
  flex: { flex: 1 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 4, marginTop: 8 },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 8,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 12,
    height: 46,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.rowAlt,
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cardBody: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 8,
  },
  section: { color: colors.gold, fontSize: 16, fontWeight: '800' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  rowAlt: { backgroundColor: colors.rowAlt },
  memberName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  memberMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  km: { color: colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  stepsInput: {
    width: 104,
    height: 46,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    borderRadius: 8,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
    paddingHorizontal: 10,
    fontVariant: ['tabular-nums'],
  },
  remove: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.textMuted, fontSize: 16 },
  rollOver: {
    backgroundColor: colors.gold,
    borderRadius: 10,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  rollOverText: { color: colors.onGold, fontSize: 16, fontWeight: '800' },
  hint: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 8 },
  reset: { alignSelf: 'center', padding: 12, marginTop: 20 },
  resetText: { color: colors.loss, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  smallButton: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonSolid: { backgroundColor: colors.gold },
  smallButtonText: { color: colors.gold, fontSize: 13, fontWeight: '700' },
  smallButtonTextSolid: { color: colors.onGold },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  dialog: {
    backgroundColor: colors.rowAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    padding: 16,
    maxHeight: '80%',
  },
  dialogInput: { marginTop: 12 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  pickList: { marginTop: 8 },
  pickRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
});
