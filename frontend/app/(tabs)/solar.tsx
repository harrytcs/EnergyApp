import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart } from 'react-native-gifted-charts';
import { api, HistoryData } from '../../services/api';
import MetricCard from '../../components/MetricCard';
import { colors, spacing, radius } from '../../constants/theme';

export default function SolarScreen() {
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);

  // Hours from local midnight to now, so "Today" means current calendar day
  const hoursSinceMidnight = (() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    return Math.max(1, (now.getTime() - midnight.getTime()) / 3_600_000);
  })();

  useEffect(() => {
    api.getHistory(['solar_power_w', 'grid_power_w', 'solar_surplus_w'], Math.ceil(hoursSinceMidnight))
      .then(setHistory)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const chartData = history?.series.solar_power_w?.map((v, i) => ({
    value: Math.round(v / 100) / 10,
    label: i % 12 === 0 ? new Date(history.timestamps[i] * 1000).getHours() + 'h' : '',
  })) ?? [];

  const peak = history ? Math.max(...history.series.solar_power_w) : 0;
  const totalKwh = history
    ? history.series.solar_power_w.reduce((a, b) => a + b, 0) / 1000 / 12
    : 0;
  const exportKwh = history
    ? history.series.grid_power_w.reduce((a, v) => a + Math.max(0, -v), 0) / 1000 / 12
    : 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={colors.solar} style={{ flex: 1 }} />
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
        <Text style={styles.title}>Solar Production</Text>

        <View style={styles.grid}>
          <MetricCard label="Today" value={totalKwh.toFixed(1)} unit="kWh" color={colors.solar} />
          <MetricCard label="Peak" value={(peak / 1000).toFixed(1)} unit="kW" color={colors.solarLight} />
          <MetricCard label="Exported" value={exportKwh.toFixed(1)} unit="kWh" color={colors.gridExport} />
        </View>

        {chartData.length > 0 && (
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>TODAY'S SOLAR OUTPUT (kW)</Text>
            <LineChart
              data={chartData}
              height={180}
              width={320}
              color={colors.solar}
              thickness={2}
              dataPointsRadius={0}
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
            />
          </View>
        )}

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>YOUR SETUP</Text>
          <View style={styles.infoRows}>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Panels</Text>
              <Text style={styles.infoRowValue}>17</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Location</Text>
              <Text style={styles.infoRowValue}>Torrance, CA</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Utility</Text>
              <Text style={styles.infoRowValue}>SCE TOU · NEM 3.0</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, gap: spacing.md },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chartCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chartTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: spacing.sm },
  infoCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  infoTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  infoRows: { gap: spacing.xs },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  infoDivider: { height: 1, backgroundColor: colors.border },
  infoRowLabel: { color: colors.textSecondary, fontSize: 14 },
  infoRowValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
});
