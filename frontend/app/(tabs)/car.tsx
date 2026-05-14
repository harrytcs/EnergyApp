import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  Switch, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart } from 'react-native-gifted-charts';
import { api, DashboardData, HistoryData, Settings } from '../../services/api';
import MetricCard from '../../components/MetricCard';
import { colors, spacing, radius } from '../../constants/theme';
import { fmtTime, fmtETA } from '../../utils/time';

const CAR_KWH = 75; // Tesla Model 3 approximate usable capacity

export default function CarScreen() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [d, h, s] = await Promise.all([
      api.getDashboard(24),
      api.getHistory(['car_battery_level', 'car_charge_power_w'], 24),
      api.getSettings(),
    ]);
    setDashboard(d);
    setHistory(h);
    setSettings(s);
  }

  useEffect(() => {
    load().catch(console.error).finally(() => setLoading(false));
  }, []);

  async function toggleForceCharge(value: boolean) {
    setSaving(true);
    try {
      await api.setOverride('car_force_charge', value);
      setSettings(prev => prev ? { ...prev, overrides: { ...prev.overrides, car_force_charge: value } } : prev);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function enableTripMode(targetPercent: number) {
    setSaving(true);
    try {
      await api.updateSettings({
        overrides: { ...settings?.overrides, car_trip_mode: true, car_trip_target_percent: targetPercent },
      });
      setSettings(prev => prev ? {
        ...prev,
        overrides: { ...prev.overrides, car_trip_mode: true, car_trip_target_percent: targetPercent },
      } : prev);
      Alert.alert('Trip Mode On', `Car will charge to ${targetPercent}% using grid + solar. Auto-disables when done.`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function disableTripMode() {
    setSaving(true);
    try {
      await api.updateSettings({ overrides: { ...settings?.overrides, car_trip_mode: false } });
      setSettings(prev => prev ? {
        ...prev, overrides: { ...prev.overrides, car_trip_mode: false },
      } : prev);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  const r = dashboard?.latest;
  const chartData = history?.series.car_battery_level?.map((v, i) => ({
    value: Math.round(v),
    label: i % 12 === 0 ? new Date(history.timestamps[i] * 1000).getHours() + 'h' : '',
  })) ?? [];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={colors.car} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  const chargeLevel = r?.car_battery_level ?? 0;
  const chargingState = r?.car_charging_state ?? 'Unknown';
  const isCharging = chargingState === 'Charging';
  const forceCharge = settings?.overrides.car_force_charge ?? false;
  const tripMode = settings?.overrides.car_trip_mode ?? false;
  const tripTarget = settings?.overrides.car_trip_target_percent ?? 100;

  const chargePowerKw = (r?.car_charge_power_w ?? 0) / 1000;
  const chargeLimit = settings?.car_charge_limit_percent ?? 90;
  let carETA: string | null = null;
  if (isCharging && chargePowerKw > 0.1) {
    const remainingKwh = ((chargeLimit - chargeLevel) / 100) * CAR_KWH;
    carETA = remainingKwh > 0 ? fmtETA(remainingKwh / chargePowerKw) : 'almost done';
  }

  const startedAt = fmtTime(dashboard?.events?.car_charge_started_at);
  const stoppedAt = fmtTime(dashboard?.events?.car_charge_stopped_at);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          Platform.OS === 'web' && { maxWidth: 840, width: '100%', alignSelf: 'center' as const },
        ]}
      >
        <Text style={styles.title}>Tesla Model 3</Text>

        <View style={styles.gaugeCard}>
          <Text style={styles.gaugeLabel}>BATTERY LEVEL</Text>
          <Text style={[styles.gaugeValue, {
            color: chargeLevel > 50 ? colors.car : chargeLevel > 20 ? colors.warning : colors.danger,
          }]}>
            {chargeLevel}%
          </Text>
          <View style={styles.gaugeBar}>
            <View style={[styles.gaugeFill, {
              width: `${chargeLevel}%` as any,
              backgroundColor: isCharging ? colors.car : chargeLevel > 50 ? colors.car : chargeLevel > 20 ? colors.warning : colors.danger,
            }]} />
          </View>
          <View style={[styles.statusBadge, { backgroundColor: isCharging ? colors.car + '22' : colors.bgElevated }]}>
            <Text style={[styles.statusText, { color: isCharging ? colors.car : colors.textSecondary }]}>
              {chargingState}
            </Text>
          </View>
          {carETA && (
            <Text style={styles.etaLine}>{carETA}</Text>
          )}
          {(startedAt || stoppedAt) && (
            <View style={styles.eventRow}>
              {startedAt && (
                <Text style={styles.eventText}>Started {startedAt}</Text>
              )}
              {stoppedAt && (
                <Text style={styles.eventText}>Paused {stoppedAt}</Text>
              )}
            </View>
          )}
        </View>

        <View style={styles.grid}>
          <MetricCard
            label="Charge Power"
            value={(r?.car_charge_power_w ?? 0) > 0 ? ((r!.car_charge_power_w) / 1000).toFixed(1) : '0'}
            unit="kW" color={colors.car}
          />
          <MetricCard
            label="Charge Limit"
            value={`${settings?.car_charge_limit_percent ?? 90}`}
            unit="%" color={colors.textSecondary}
            subtitle="Solar mode target"
          />
        </View>

        <View style={styles.controlCard}>
          <Text style={styles.controlTitle}>OVERRIDES</Text>

          <View style={styles.controlRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.controlLabel}>Force Charge Now</Text>
              <Text style={styles.controlSubtitle}>
                {forceCharge ? 'Charging regardless of solar — using grid if needed' : 'Waiting for solar surplus'}
              </Text>
            </View>
            <Switch
              value={forceCharge}
              onValueChange={toggleForceCharge}
              disabled={saving}
              trackColor={{ false: colors.border, true: colors.car + '88' }}
              thumbColor={forceCharge ? colors.car : colors.textMuted}
            />
          </View>
          {forceCharge && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>Override active — may draw from grid</Text>
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.controlRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.controlLabel}>Trip Mode</Text>
              <Text style={styles.controlSubtitle}>
                {tripMode
                  ? `Charging to ${tripTarget}% on grid + solar — auto-disables when done`
                  : 'Charge to a target % before a trip'}
              </Text>
            </View>
            <Switch
              value={tripMode}
              onValueChange={v => v ? enableTripMode(100) : disableTripMode()}
              disabled={saving}
              trackColor={{ false: colors.border, true: colors.solar + '88' }}
              thumbColor={tripMode ? colors.solar : colors.textMuted}
            />
          </View>

          {!tripMode && (
            <View style={styles.tripButtons}>
              <Text style={styles.tripLabel}>CHARGE TO:</Text>
              {[80, 90, 100].map(pct => (
                <TouchableOpacity
                  key={pct}
                  style={[styles.tripBtn, chargeLevel >= pct && styles.tripBtnDone]}
                  onPress={() => enableTripMode(pct)}
                  disabled={saving || chargeLevel >= pct}
                >
                  <Text style={[styles.tripBtnText, chargeLevel >= pct && { color: colors.textMuted }]}>
                    {pct}%
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {tripMode && (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                Charging at full speed to {tripTarget}% · Currently {chargeLevel}%
              </Text>
            </View>
          )}
        </View>

        {chartData.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>BATTERY LEVEL — LAST 24 HOURS (%)</Text>
            <LineChart
              data={chartData}
              height={160}
              width={320}
              color={colors.car}
              thickness={2}
              curved
              hideRules
              yAxisColor={colors.border}
              xAxisColor={colors.border}
              yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
              xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 10 }}
              backgroundColor={colors.bgCard}
              noOfSections={5}
              maxValue={100}
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
  gaugeCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.sm,
  },
  gaugeLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  gaugeValue: { fontSize: 64, fontWeight: '800', letterSpacing: -2 },
  gaugeBar: {
    width: '100%', height: 8,
    backgroundColor: colors.bg,
    borderRadius: 4, overflow: 'hidden',
  },
  gaugeFill: { height: '100%', borderRadius: 4 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5 },
  statusText: { fontSize: 13, fontWeight: '600' },
  etaLine: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  eventRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap', justifyContent: 'center' },
  eventText: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  grid: { flexDirection: 'row', gap: spacing.sm },
  controlCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  controlTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  controlLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  controlSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border },
  warningBanner: {
    backgroundColor: colors.warning + '18',
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.warning + '33',
  },
  warningText: { color: colors.warning, fontSize: 12, fontWeight: '500' },
  tripButtons: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  tripLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  tripBtn: {
    backgroundColor: colors.solar + '18',
    borderRadius: radius.sm,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.solar + '55',
  },
  tripBtnDone: { backgroundColor: colors.bgElevated, borderColor: colors.border },
  tripBtnText: { color: colors.solar, fontWeight: '700', fontSize: 13 },
  chartCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chartTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
});
