import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Switch,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart } from 'react-native-gifted-charts';
import { api, DashboardData, HistoryData, Settings, ThermostatState } from '../../services/api';
import { colors, spacing, radius } from '../../constants/theme';
import { fmtTime } from '../../utils/time';

function hvacColor(status: string) {
  if (status === 'COOLING') return colors.car;
  if (status === 'HEATING') return colors.danger;
  return colors.textMuted;
}

function ThermostatCard({ t, index }: { t: ThermostatState; index: number }) {
  const isActive = t.hvac_status === 'COOLING' || t.hvac_status === 'HEATING';
  const color = hvacColor(t.hvac_status);

  return (
    <View style={styles.thermostatCard}>
      <View style={styles.thermostatHeader}>
        <Text style={styles.thermostatTitle}>{t.room_name || `Thermostat ${index + 1}`}</Text>
        <View style={[styles.statusBadge, { backgroundColor: isActive ? color + '22' : colors.bgElevated }]}>
          <Text style={[styles.statusText, { color: isActive ? color : colors.textSecondary }]}>
            {t.hvac_status === 'COOLING' ? 'Cooling' :
             t.hvac_status === 'HEATING' ? 'Heating' : 'Standby'}
          </Text>
        </View>
      </View>

      <View style={styles.tempRow}>
        <View style={styles.tempBlock}>
          <Text style={styles.tempLabel}>CURRENT</Text>
          <Text style={[styles.tempValue, { color: colors.textPrimary }]}>
            {t.current_temp_f.toFixed(0)}°
          </Text>
        </View>
        <View style={styles.tempDivider} />
        <View style={styles.tempBlock}>
          <Text style={styles.tempLabel}>COOL SET</Text>
          <Text style={[styles.tempValue, { color: colors.car }]}>
            {t.cool_setpoint_f.toFixed(0)}°
          </Text>
        </View>
        <View style={styles.tempDivider} />
        <View style={styles.tempBlock}>
          <Text style={styles.tempLabel}>HUMIDITY</Text>
          <Text style={[styles.tempValue, { color: colors.textSecondary }]}>
            {t.humidity_percent}%
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Mode: {t.mode}</Text>
        <Text style={[styles.metaText, {
          color: t.connectivity === 'ONLINE' ? colors.success : colors.danger,
        }]}>
          {t.connectivity === 'ONLINE' ? '● Online' : '● Offline'}
        </Text>
      </View>
    </View>
  );
}

export default function HvacScreen() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getDashboard(),
      api.getHistory(['hvac_current_temp_f'], 24),
      api.getSettings(),
    ])
      .then(([d, h, s]) => { setDashboard(d); setHistory(h); setSettings(s); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function toggleForceHvac(value: boolean) {
    setSaving(true);
    try {
      await api.setOverride('hvac_force_on', value);
      setSettings(prev => prev ? { ...prev, overrides: { ...prev.overrides, hvac_force_on: value } } : prev);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  const thermostats = dashboard?.thermostats ?? [];
  const forceHvac = settings?.overrides.hvac_force_on ?? false;
  const hvacActivatedAt = fmtTime(dashboard?.events?.hvac_activated_at);
  const hvacDeactivatedAt = fmtTime(dashboard?.events?.hvac_deactivated_at);

  const chartData = history?.series.hvac_current_temp_f?.map((v, i) => ({
    value: Math.round(v),
    label: i % 12 === 0 ? new Date(history.timestamps[i] * 1000).getHours() + 'h' : '',
  })) ?? [];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={colors.hvac} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          Platform.OS === 'web' && { maxWidth: 840, width: '100%', alignSelf: 'center' as const },
        ]}
      >
        <Text style={styles.title}>
          HVAC · {thermostats.length} Thermostat{thermostats.length !== 1 ? 's' : ''}
        </Text>

        {thermostats.map((t, i) => (
          <ThermostatCard key={t.id} t={t} index={i} />
        ))}

        {thermostats.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No thermostats found. Make sure your Nest account is connected.</Text>
          </View>
        )}

        <View style={styles.controlCard}>
          <Text style={styles.controlTitle}>OVERRIDE</Text>
          <View style={styles.controlRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.controlLabel}>Force All HVAC On</Text>
              <Text style={styles.controlSubtitle}>
                {forceHvac
                  ? `All ${thermostats.length} thermostats running regardless of solar`
                  : `Thermostats activate automatically on solar surplus`}
              </Text>
            </View>
            <Switch
              value={forceHvac}
              onValueChange={toggleForceHvac}
              disabled={saving}
              trackColor={{ false: colors.border, true: colors.hvac + '88' }}
              thumbColor={forceHvac ? colors.hvac : colors.textMuted}
            />
          </View>
          {forceHvac && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>Override active — HVAC may run on grid power</Text>
            </View>
          )}

          {(hvacActivatedAt || hvacDeactivatedAt) && (
            <View style={styles.eventRow}>
              {hvacActivatedAt && (
                <Text style={styles.eventText}>Activated {hvacActivatedAt}</Text>
              )}
              {hvacDeactivatedAt && (
                <Text style={styles.eventText}>Stopped {hvacDeactivatedAt}</Text>
              )}
            </View>
          )}
        </View>

        {chartData.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>THERMOSTAT 1 TEMP — LAST 24 HOURS (°F)</Text>
            <LineChart
              data={chartData}
              height={160}
              width={320}
              color={colors.hvac}
              thickness={2}
              curved
              hideRules
              yAxisColor={colors.border}
              xAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
              xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 10 }}
              backgroundColor={colors.bgCard}
              noOfSections={4}
              initialSpacing={0}
              endSpacing={0}
              dataPointsRadius={0}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, gap: spacing.md },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  thermostatCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  thermostatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  thermostatTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  statusBadge: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  statusText: { fontSize: 12, fontWeight: '600' },
  tempRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm },
  tempBlock: { alignItems: 'center', gap: 4, flex: 1 },
  tempLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  tempValue: { fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  tempDivider: { width: 1, height: 44, backgroundColor: colors.border },
  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  metaText: { color: colors.textSecondary, fontSize: 12 },
  emptyCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  controlCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.sm,
  },
  controlTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  controlLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  controlSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  warningBanner: {
    backgroundColor: colors.warning + '18', borderRadius: radius.sm, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.warning + '33',
  },
  warningText: { color: colors.warning, fontSize: 12, fontWeight: '500' },
  eventRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  eventText: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  chartCard: {
    backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  chartTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
  bgElevated: { backgroundColor: colors.bgElevated },
});
