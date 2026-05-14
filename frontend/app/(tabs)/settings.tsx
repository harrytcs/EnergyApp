import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Switch,
  TouchableOpacity, ActivityIndicator, Alert, Platform, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, Settings } from '../../services/api';
import { auth } from '../../services/auth';
import { useRouter } from 'expo-router';
import { colors, spacing, radius } from '../../constants/theme';

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function SettingRow({
  label, subtitle, value, onToggle, disabled = false,
}: {
  label: string; subtitle?: string; value: boolean;
  onToggle: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.solar + '88' }}
        thumbColor={value ? colors.solar : colors.textMuted}
      />
    </View>
  );
}

const PRIORITY_INFO: Record<string, { label: string; subtitle: string }> = {
  powerwall: { label: 'Powerwall', subtitle: 'Charges battery — blocks lower items until full' },
  car:       { label: 'Tesla Car', subtitle: 'Charges on available solar surplus' },
  hvac:      { label: 'HVAC',      subtitle: 'Runs on available solar surplus' },
};

interface PriorityItemProps {
  rank: number;
  label: string;
  subtitle: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  saving: boolean;
}

function PriorityItem({ rank, label, subtitle, canMoveUp, canMoveDown, onMoveUp, onMoveDown, saving }: PriorityItemProps) {
  return (
    <View style={styles.priorityItem}>
      <View style={[styles.rankBadge, styles.rankMovable]}>
        <Text style={[styles.rankText, { color: colors.solar }]}>{rank}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.priorityLabel}>{label}</Text>
        <Text style={styles.prioritySubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.arrowGroup}>
        <TouchableOpacity
          onPress={onMoveUp}
          disabled={!canMoveUp || saving}
          style={[styles.arrowBtn, !canMoveUp && styles.arrowBtnDisabled]}
        >
          <Ionicons name="chevron-up" size={16} color={canMoveUp ? colors.solar : colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onMoveDown}
          disabled={!canMoveDown || saving}
          style={[styles.arrowBtn, !canMoveDown && styles.arrowBtnDisabled]}
        >
          <Ionicons name="chevron-down" size={16} color={canMoveDown ? colors.solar : colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function FixedItem({ rank, label, subtitle }: { rank: number; label: string; subtitle: string }) {
  return (
    <View style={styles.priorityItem}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{rank}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.priorityLabel}>{label}</Text>
        <Text style={styles.prioritySubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.fixedTag}>Fixed</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [latStr, setLatStr] = useState('');
  const [lonStr, setLonStr] = useState('');
  const router = useRouter();

  useEffect(() => {
    api.getSettings()
      .then(s => {
        setSettings(s);
        setLatStr(s.latitude != null ? String(s.latitude) : '');
        setLonStr(s.longitude != null ? String(s.longitude) : '');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function update(patch: Partial<Settings>) {
    if (!settings) return;
    setSaveError(null);
    // Optimistic update so toggles respond immediately
    const prev = settings;
    setSettings(s => s ? { ...s, ...patch, overrides: { ...s.overrides, ...(patch.overrides ?? {}) }, notifications: { ...s.notifications, ...(patch.notifications ?? {}) } } : s);
    setSaving(true);
    try {
      const updated = await api.updateSettings(patch);
      setSettings(updated);
    } catch (e: any) {
      setSettings(prev);  // revert
      setSaveError(e.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function updateNotification(key: keyof Settings['notifications'], value: boolean) {
    if (!settings) return;
    await update({ notifications: { ...settings.notifications, [key]: value } });
  }

  async function movePriority(index: number, direction: 'up' | 'down') {
    if (!settings) return;
    const order = [...(settings.priority_order ?? ['powerwall', 'car', 'hvac'])];
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    [order[index], order[swapWith]] = [order[swapWith], order[index]];
    // Optimistic update
    setSettings(prev => prev ? { ...prev, priority_order: order } : prev);
    setSaving(true);
    try {
      const updated = await api.updateSettings({ priority_order: order });
      setSettings(updated);
    } catch (e: any) {
      setSettings(prev => prev ? { ...prev, priority_order: settings.priority_order } : prev);
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    const doSignOut = async () => {
      await auth.signOut();
      router.replace('/(auth)/login');
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Sign out?')) doSignOut();
    } else {
      Alert.alert('Sign Out', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: doSignOut },
      ]);
    }
  }

  if (loading || !settings) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={colors.solar} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  const n = settings.notifications;
  const order = settings.priority_order ?? ['powerwall', 'car', 'hvac'];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          Platform.OS === 'web' && { maxWidth: 840, width: '100%', alignSelf: 'center' as const },
        ]}
      >
        <Text style={styles.title}>Settings</Text>

        {saveError && (
          <Text style={styles.saveError}>{saveError}</Text>
        )}

        {/* Automation */}
        <SectionHeader title="AUTOMATION" />
        <View style={styles.card}>
          <SettingRow
            label="Pause Automation"
            subtitle="Stop all automatic car/HVAC actions (solar still charges powerwall)"
            value={settings.overrides.automation_paused}
            onToggle={v => update({ overrides: { ...settings.overrides, automation_paused: v } })}
            disabled={saving}
          />
        </View>

        {/* Priority Chain */}
        <SectionHeader title="PRIORITY CHAIN" />
        <Text style={styles.sectionDesc}>
          Order in which solar surplus is allocated. Use arrows to reorder Powerwall, Car, and HVAC.
        </Text>
        <View style={styles.card}>
          <FixedItem rank={1} label="Home Devices" subtitle="Always first — managed by Tesla Gateway" />
          {order.map((item, index) => {
            const info = PRIORITY_INFO[item] ?? { label: item, subtitle: '' };
            return (
              <View key={item}>
                <View style={styles.divider} />
                <PriorityItem
                  rank={index + 2}
                  label={info.label}
                  subtitle={info.subtitle}
                  canMoveUp={index > 0}
                  canMoveDown={index < order.length - 1}
                  onMoveUp={() => movePriority(index, 'up')}
                  onMoveDown={() => movePriority(index, 'down')}
                  saving={saving}
                />
              </View>
            );
          })}
          <View style={styles.divider} />
          <FixedItem rank={5} label="Grid Export" subtitle="Always last — remaining surplus exported" />
        </View>

        {/* Notifications */}
        <SectionHeader title="NOTIFICATIONS" />
        <View style={styles.card}>
          <SettingRow
            label="Car charging started"
            value={n.car_charging_started}
            onToggle={v => updateNotification('car_charging_started', v)}
            disabled={saving}
          />
          <View style={styles.divider} />
          <SettingRow
            label="Car charging stopped"
            subtitle="When paused due to low solar"
            value={n.car_charging_stopped}
            onToggle={v => updateNotification('car_charging_stopped', v)}
            disabled={saving}
          />
          <View style={styles.divider} />
          <SettingRow
            label="Car fully charged"
            value={n.car_fully_charged}
            onToggle={v => updateNotification('car_fully_charged', v)}
            disabled={saving}
          />
          <View style={styles.divider} />
          <SettingRow
            label="Powerwall low"
            subtitle={`Alert below ${n.powerwall_low_threshold}%`}
            value={n.powerwall_low}
            onToggle={v => updateNotification('powerwall_low', v)}
            disabled={saving}
          />
          <View style={styles.divider} />
          <SettingRow
            label="HVAC activated on solar"
            value={n.hvac_solar_activated}
            onToggle={v => updateNotification('hvac_solar_activated', v)}
            disabled={saving}
          />
          <View style={styles.divider} />
          <SettingRow
            label="Solar production low"
            subtitle={`Alert below ${n.solar_low_threshold_w}W`}
            value={n.solar_low}
            onToggle={v => updateNotification('solar_low', v)}
            disabled={saving}
          />
        </View>

        {/* Location */}
        <SectionHeader title="LOCATION" />
        <Text style={styles.sectionDesc}>
          Used to fetch solar irradiance forecasts for weather-aware charging ETAs.
          Find your coordinates at maps.google.com (right-click your home).
        </Text>
        <View style={styles.card}>
          <View style={styles.locationRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Latitude</Text>
              <TextInput
                style={styles.locationInput}
                value={latStr}
                onChangeText={setLatStr}
                placeholder="e.g. 33.84"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Longitude</Text>
              <TextInput
                style={styles.locationInput}
                value={lonStr}
                onChangeText={setLonStr}
                placeholder="e.g. -118.34"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.locationSaveBtn}
            disabled={saving}
            onPress={() => {
              const lat = parseFloat(latStr);
              const lon = parseFloat(lonStr);
              if (isNaN(lat) || isNaN(lon)) {
                Alert.alert('Invalid', 'Enter valid decimal coordinates.');
                return;
              }
              update({ latitude: lat, longitude: lon });
            }}
          >
            <Text style={styles.locationSaveText}>{saving ? 'Saving…' : 'Save Location'}</Text>
          </TouchableOpacity>
        </View>

        {/* Account */}
        <SectionHeader title="ACCOUNT" />
        <View style={styles.card}>
          <TouchableOpacity style={styles.dangerRow} onPress={handleSignOut}>
            <Text style={styles.dangerText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>EnergyApp · Torrance, CA · SCE TOU-D-PRIME</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, gap: spacing.sm },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginBottom: spacing.sm },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingHorizontal: 4,
    paddingTop: spacing.sm,
  },
  sectionDesc: {
    color: colors.textSecondary,
    fontSize: 13,
    paddingHorizontal: 4,
    marginTop: -spacing.xs,
    marginBottom: spacing.xs,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.md, gap: spacing.md,
  },
  rowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
  rowSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md },
  // Priority chain
  priorityItem: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.md, gap: spacing.md,
  },
  rankBadge: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  rankFixed: { backgroundColor: colors.bgElevated },
  rankMovable: { backgroundColor: colors.solar + '18', borderWidth: 1, borderColor: colors.solar + '55' },
  rankText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  priorityLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  prioritySubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  fixedTag: { color: colors.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  arrowGroup: { flexDirection: 'column', gap: 2 },
  arrowBtn: {
    padding: 5, borderRadius: radius.sm,
    backgroundColor: colors.solar + '15',
    borderWidth: 1, borderColor: colors.solar + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  arrowBtnDisabled: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
  },
  // Location
  locationRow: { flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  locationInput: {
    marginTop: spacing.xs,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  locationSaveBtn: { padding: spacing.md, alignItems: 'center' },
  locationSaveText: { color: colors.solar, fontSize: 15, fontWeight: '600' },
  // Account
  dangerRow: { padding: spacing.md, alignItems: 'center' },
  dangerText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  footer: { color: colors.textMuted, fontSize: 11, textAlign: 'center', paddingVertical: spacing.md },
  saveError: { color: colors.danger, fontSize: 13, textAlign: 'center', paddingVertical: spacing.sm },
});
