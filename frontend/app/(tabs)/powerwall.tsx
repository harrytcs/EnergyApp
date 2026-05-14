import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart } from 'react-native-gifted-charts';
import { api, HistoryData, DashboardData } from '../../services/api';
import MetricCard from '../../components/MetricCard';
import { colors, spacing, radius } from '../../constants/theme';
import { fmtETA } from '../../utils/time';

const POWERWALL_KWH = 13.5; // Powerwall 2 usable capacity

export default function PowerwallScreen() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getDashboard(24),
      api.getHistory(['battery_percentage', 'battery_power_w'], 24),
    ])
      .then(([d, h]) => { setDashboard(d); setHistory(h); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const r = dashboard?.latest ?? dashboard?.history?.[0] ?? null;
  const batteryPct = r?.battery_percentage ?? 0;
  const batteryPower = r?.battery_power_w ?? 0;
  // Tesla convention: negative = charging, positive = discharging
  const isCharging = batteryPower < -50;
  const isDischarging = batteryPower > 50;
  const batteryStatus = isCharging ? 'Charging' : isDischarging ? 'Discharging' : 'Standby';

  // ETA calculations
  let etaLine: string | null = null;
  if (isCharging) {
    const chargingKw = Math.abs(batteryPower) / 1000;
    const remainingKwh = ((100 - batteryPct) / 100) * POWERWALL_KWH;
    const hours = remainingKwh / chargingKw;
    etaLine = fmtETA(hours);
  } else if (isDischarging) {
    const dischargingKw = batteryPower / 1000;
    const remainingKwh = (batteryPct / 100) * POWERWALL_KWH;
    const hours = remainingKwh / dischargingKw;
    etaLine = `empty in ${fmtETA(hours).split(' · ')[0]} (by ${fmtETA(hours).split('by ')[1]})`;
  }

  const chartData = history?.series.battery_percentage?.map((v, i) => ({
    value: Math.round(v),
    label: i % 12 === 0 ? new Date(history.timestamps[i] * 1000).getHours() + 'h' : '',
  })) ?? [];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={colors.battery} style={{ flex: 1 }} />
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
        <Text style={styles.title}>Powerwall</Text>

        <View style={styles.gaugeCard}>
          <Text style={styles.gaugeLabel}>STATE OF CHARGE</Text>
          <Text style={[styles.gaugeValue, {
            color: batteryPct > 50 ? colors.battery : batteryPct > 20 ? colors.warning : colors.danger,
          }]}>
            {batteryPct.toFixed(0)}%
          </Text>
          <View style={styles.gaugeBar}>
            <View style={[styles.gaugeFill, {
              width: `${batteryPct}%` as any,
              backgroundColor: isCharging ? colors.success : isDischarging ? colors.warning : colors.battery,
            }]} />
          </View>
          <Text style={[styles.gaugeStatus, {
            color: isCharging ? colors.success : isDischarging ? colors.warning : colors.textSecondary,
          }]}>
            {batteryStatus}
          </Text>
          {etaLine && (
            <Text style={styles.etaLine}>{etaLine}</Text>
          )}
        </View>

        <View style={styles.grid}>
          <MetricCard
            label="Power"
            value={(Math.abs(batteryPower) / 1000).toFixed(1)} unit="kW"
            color={isCharging ? colors.success : isDischarging ? colors.warning : colors.textMuted}
            subtitle={batteryStatus}
          />
          <MetricCard
            label="Capacity"
            value={((batteryPct / 100) * POWERWALL_KWH).toFixed(1)}
            unit="kWh"
            color={colors.battery}
            subtitle={`of ${POWERWALL_KWH} kWh total`}
          />
        </View>

        {chartData.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>BATTERY % — LAST 24 HOURS</Text>
            <LineChart
              data={chartData}
              height={160}
              width={320}
              color={colors.battery}
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
  gaugeStatus: { fontSize: 15, fontWeight: '600' },
  etaLine: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    marginTop: -spacing.xs,
  },
  grid: { flexDirection: 'row', gap: spacing.sm },
  chartCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chartTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
});
