import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  ActivityIndicator, Platform, ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart } from 'react-native-gifted-charts';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { api, DashboardData, SavingsData } from '../../services/api';
import MetricCard from '../../components/MetricCard';
import PowerFlowDiagram from '../../components/PowerFlowDiagram';
import { colors, spacing, radius } from '../../constants/theme';
import { fmtETA } from '../../utils/time';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CAR_KWH = 75;

function EnergyBackground() {
  // On web, use position:fixed so the image stays viewport-sized regardless of scroll height.
  // On native, absoluteFillObject fills the screen correctly already.
  const fixedStyle: any = Platform.OS === 'web'
    ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: -1 }
    : StyleSheet.absoluteFillObject;

  return (
    <ImageBackground
      source={require('../../assets/bg.jpg')}
      style={fixedStyle}
      resizeMode="cover"
      imageStyle={Platform.OS === 'web' ? { objectFit: 'cover', objectPosition: 'center 60%' } as any : undefined}
    >
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(5,10,20,0.68)' }]} />
      <LinearGradient
        colors={['transparent', 'rgba(7,16,29,0.55)']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0.3 }}
        end={{ x: 0, y: 1 }}
        pointerEvents="none"
      />
    </ImageBackground>
  );
}

function useNextCycleCountdown(lastRunUnix: number | null | undefined): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    function tick() {
      if (!lastRunUnix) { setLabel(''); return; }
      const secsLeft = (lastRunUnix + 300) - Math.floor(Date.now() / 1000);
      if (secsLeft <= 0) {
        setLabel('Running…');
      } else {
        const m = Math.floor(secsLeft / 60);
        const s = secsLeft % 60;
        setLabel(m > 0 ? `Next cycle in ${m}m ${s}s` : `Next cycle in ${s}s`);
      }
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [lastRunUnix]);
  return label;
}

function hoursSinceMidnight(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  return Math.max(1, (now.getTime() - midnight.getTime()) / 3_600_000);
}

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [savings, setSavings] = useState<SavingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const nextCycleLabel = useNextCycleCountdown(data?.events?.last_automation_run);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [d, sv] = await Promise.all([api.getDashboard(Math.ceil(hoursSinceMidnight())), api.getSavings()]);
      setData(d);
      setSavings(sv);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, []);

  if (loading) {
    return (
      <View style={styles.container}>
        <EnergyBackground />
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.solar} />
        </SafeAreaView>
      </View>
    );
  }

  const r = data?.latest ?? data?.history?.[0] ?? null;
  const s = data?.summary;
  const autoPaused = data?.settings.overrides?.automation_paused ?? false;

  const currentYear = new Date().getFullYear();

  // Monthly bar chart data — all months from Jul 2025 onwards
  const barData = (savings?.monthly ?? []).map(m => ({
    value: m.solar_to_home_kwh,
    label: m.year !== currentYear
      ? `${MONTH_NAMES[m.month - 1]}'${String(m.year).slice(2)}`
      : MONTH_NAMES[m.month - 1],
    frontColor: m.year !== currentYear ? colors.solar + 'AA' : colors.solar,
    topLabelComponent: () => (
      <Text style={{ color: colors.textMuted, fontSize: 8, marginBottom: 2 }}>
        {m.solar_to_home_kwh.toFixed(0)}
      </Text>
    ),
  }));

  return (
    <View style={styles.container}>
      <EnergyBackground />
      <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          Platform.OS === 'web' && { maxWidth: 840, width: '100%', alignSelf: 'center' as const },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.solar} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>EnergyApp</Text>
          <View style={[styles.badge, { backgroundColor: autoPaused ? colors.danger + '22' : colors.success + '22' }]}>
            <View style={[styles.dot, { backgroundColor: autoPaused ? colors.danger : colors.success }]} />
            <Text style={[styles.badgeText, { color: autoPaused ? colors.danger : colors.success }]}>
              {autoPaused ? 'Auto Paused' : 'Auto On'}
            </Text>
          </View>
        </View>

        {/* Stale data warning */}
        {(() => {
          const lastRun = data?.events?.last_automation_run;
          const stale = !lastRun || (Math.floor(Date.now() / 1000) - lastRun) > 900;
          if (!stale) return null;
          const noData = !r;
          return (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                {noData
                  ? '⚠ No data — automation may be down. Check API connections.'
                  : '⚠ Data is stale — automation hasn\'t run in 15+ min. Check API connections.'}
              </Text>
            </View>
          );
        })()}

        {/* Live Power Flow */}
        {r && (
          <PowerFlowDiagram
            solarW={r.solar_power_w}
            batteryW={r.battery_power_w}
            loadW={r.load_power_w}
            gridW={r.grid_power_w}
            batteryPct={r.battery_percentage}
            carChargeW={r.car_charge_power_w}
            thermostats={data?.thermostats ?? []}
          />
        )}

        {/* Live Metrics */}
        <View style={styles.grid}>
          <MetricCard
            label="Solar"
            value={r ? (r.solar_power_w / 1000).toFixed(1) : '--'}
            unit="kW" color={colors.solar}
            subtitle={s ? `${s.solar_kwh.toFixed(1)} kWh generated` : ''}
            icon={<Ionicons name="sunny" size={18} color={colors.solar} />}
          />
          <MetricCard
            label="Powerwall"
            value={r ? `${r.battery_percentage.toFixed(0)}` : '--'}
            unit="%" color={colors.battery}
            subtitle={r ? (r.battery_power_w < 0 ? `Charging ${(Math.abs(r.battery_power_w) / 1000).toFixed(1)} kW` : r.battery_power_w > 0 ? 'Discharging' : 'Standby') : ''}
            eta={(() => {
              const eta = data?.events?.powerwall_full_eta;
              if (!eta || !r || r.battery_power_w >= -50) return undefined;
              return `Full by ${new Date(eta * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
            })()}
            icon={<MaterialCommunityIcons name="battery-charging-80" size={18} color={colors.battery} />}
          />
          <MetricCard
            label="Home Load"
            value={r ? ((r.home_load_w ?? Math.max(0, r.load_power_w - (r.car_charge_power_w ?? 0))) / 1000).toFixed(1) : '--'}
            unit="kW" color={colors.home}
            subtitle={r?.car_charge_power_w > 0 ? `Car using ${(r.car_charge_power_w / 1000).toFixed(1)} kW` : ''}
            icon={<Ionicons name="home" size={18} color={colors.home} />}
          />
          <MetricCard
            label="Tesla"
            value={r ? `${r.car_battery_level}` : '--'}
            unit="%" color={colors.car}
            subtitle={r?.car_charging_state ?? ''}
            eta={(() => {
              if (!r || r.car_charging_state !== 'Charging' || (r.car_charge_power_w ?? 0) < 100) return undefined;
              const solarEta = data?.events?.car_full_eta;
              if (solarEta) {
                return `Full by ${new Date(solarEta * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (solar)`;
              }
              const chargeLimit = data?.settings?.car_charge_limit_percent ?? 90;
              const remainingKwh = ((chargeLimit - r.car_battery_level) / 100) * CAR_KWH;
              return remainingKwh > 0 ? fmtETA(remainingKwh / (r.car_charge_power_w / 1000)) : 'Almost done';
            })()}
            icon={<MaterialCommunityIcons name="car-electric" size={18} color={colors.car} />}
          />
          {(data?.thermostats ?? []).length > 0
            ? (data?.thermostats ?? []).map((t, i) => (
                <MetricCard
                  key={t.id ?? i}
                  label={t.room_name ? `HVAC · ${t.room_name}` : `HVAC T${i + 1}`}
                  value={`${t.current_temp_f.toFixed(0)}`}
                  unit="°F"
                  color={colors.hvac}
                  subtitle={t.mode !== 'OFF'
                    ? `Set ${t.cool_setpoint_f.toFixed(0)}°F · ${t.hvac_status === 'COOLING' ? 'Cooling' : t.hvac_status === 'HEATING' ? 'Heating' : 'Standby'}`
                    : `Set ${t.cool_setpoint_f.toFixed(0)}°F · Off`}
                  icon={<MaterialCommunityIcons name="air-conditioner" size={18} color={colors.hvac} />}
                />
              ))
            : (
                <MetricCard
                  label="HVAC"
                  value={r ? `${r.hvac_current_temp_f.toFixed(0)}` : '--'}
                  unit="°F" color={colors.hvac}
                  subtitle={r?.hvac_status ?? ''}
                  icon={<MaterialCommunityIcons name="air-conditioner" size={18} color={colors.hvac} />}
                />
              )
          }
        </View>

        {/* Today summary strip */}
        {r && (
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>SOLAR → HOME</Text>
              <Text style={[styles.summaryValue, { color: colors.solar }]}>
                {s ? `${Math.max(0, s.solar_kwh - s.grid_exported_kwh).toFixed(1)} kWh` : '--'}
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>GRID DRAW</Text>
              <Text style={[styles.summaryValue, { color: colors.grid }]}>
                {s ? `${s.grid_imported_kwh.toFixed(1)} kWh` : '--'}
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>SURPLUS NOW</Text>
              <Text style={[styles.summaryValue, { color: r.solar_surplus_w > 0 ? colors.gridExport : colors.textMuted }]}>
                {r.solar_surplus_w > 0 ? `${(r.solar_surplus_w / 1000).toFixed(1)} kW` : 'None'}
              </Text>
            </View>
          </View>
        )}

        {/* MTD / YTD savings */}
        {savings && (
          <>
            <Text style={styles.sectionTitle}>SAVINGS</Text>
            <View style={styles.savingsCard}>
              <View style={styles.savingsRow}>
                <View style={styles.savingsCol}>
                  <Text style={styles.savingsLabel}>THIS MONTH</Text>
                  <Text style={[styles.savingsBig, { color: colors.solar }]}>${savings.mtd.savings_usd.toFixed(0)}</Text>
                  <Text style={styles.savingsSub}>{savings.mtd.solar_to_home_kwh} kWh solar used</Text>
                  <Text style={styles.savingsSub}>{savings.mtd.grid_imported_kwh} kWh from grid</Text>
                </View>
                <View style={styles.savingsDivider} />
                <View style={styles.savingsCol}>
                  <Text style={styles.savingsLabel}>THIS YEAR</Text>
                  <Text style={[styles.savingsBig, { color: colors.solar }]}>${savings.ytd.savings_usd.toFixed(0)}</Text>
                  <Text style={styles.savingsSub}>{savings.ytd.solar_to_home_kwh} kWh solar used</Text>
                  <Text style={styles.savingsSub}>{savings.ytd.grid_imported_kwh} kWh from grid</Text>
                </View>
              </View>

              {barData.length > 0 && (
                <>
                  <View style={styles.chartDivider} />
                  <Text style={styles.chartLabel}>SOLAR USED AT HOME — kWh BY MONTH (faded = 2025)</Text>
                  <BarChart
                    data={barData}
                    height={120}
                    barWidth={22}
                    spacing={6}
                    hideRules
                    yAxisColor={colors.border}
                    xAxisColor={colors.border}
                    yAxisTextStyle={{ color: colors.textMuted, fontSize: 9 }}
                    xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 8 }}
                    noOfSections={3}
                    barBorderRadius={3}
                    backgroundColor={colors.bgCard}
                    isAnimated
                    scrollToEnd
                  />
                </>
              )}
            </View>
          </>
        )}

        {/* Footer */}
        <View style={styles.footerRow}>
          <Text style={styles.updated}>
            Updated {data ? new Date(data.generated_at * 1000).toLocaleTimeString() : '--'}
          </Text>
          {!!nextCycleLabel && (
            <Text style={styles.countdown}>{nextCycleLabel}</Text>
          )}
        </View>
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing.md, gap: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sectionTitle: {
    color: colors.textMuted, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.2, marginTop: spacing.xs,
  },
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 5 },
  summaryDivider: { width: 1, backgroundColor: colors.border },
  summaryLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  summaryValue: { fontSize: 16, fontWeight: '700' },
  savingsCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  savingsRow: { flexDirection: 'row', gap: spacing.md },
  savingsCol: { flex: 1, gap: 4 },
  savingsDivider: { width: 1, backgroundColor: colors.border },
  savingsLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  savingsBig: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  savingsSub: { color: colors.textSecondary, fontSize: 12 },
  chartDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  chartLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: spacing.xs },
  warningBanner: {
    backgroundColor: colors.danger + '18',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger + '44',
    padding: spacing.sm,
  },
  warningText: { color: colors.danger, fontSize: 13, fontWeight: '500' },
  footerRow: { alignItems: 'center', gap: 4 },
  updated: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
  countdown: { color: colors.solar, fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
