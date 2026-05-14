import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../constants/theme';

interface ThermostatState {
  hvac_status: string;
  room_name?: string;
}

interface Props {
  solarW: number;
  batteryW: number;
  loadW: number;
  gridW: number;
  batteryPct: number;
  carChargeW: number;
  thermostats: ThermostatState[];
}

function wToKw(w: number) {
  return Math.abs(w) >= 1000
    ? `${(Math.abs(w) / 1000).toFixed(1)} kW`
    : `${Math.round(Math.abs(w))} W`;
}

interface NodeProps {
  label: string;
  value: string;
  color: string;
  active?: boolean;
}

function Node({ label, value, color, active = true }: NodeProps) {
  return (
    <View style={[styles.node, { borderColor: active ? color : colors.border, opacity: active ? 1 : 0.35 }]}>
      <Text style={[styles.nodeLabel, { color: active ? color : colors.textMuted }]}>{label}</Text>
      <Text style={[styles.nodeValue, { color: active ? colors.textPrimary : colors.textMuted }]}>{value}</Text>
    </View>
  );
}

function FlowArrow({ watts, color }: { watts: number; color: string }) {
  if (Math.abs(watts) < 50) return <View style={styles.arrowPlaceholder} />;
  return (
    <View style={styles.arrowContainer}>
      <View style={[styles.arrowLine, { backgroundColor: color }]} />
      <Text style={[styles.arrowLabel, { color }]}>{wToKw(watts)}</Text>
    </View>
  );
}

export default function PowerFlowDiagram({ solarW, batteryW, loadW, gridW, batteryPct, carChargeW, thermostats }: Props) {
  const gridImport = gridW > 0 ? gridW : 0;
  const batteryCharging = batteryW < 0 ? Math.abs(batteryW) : 0;
  const batteryDischarging = batteryW > 0 ? batteryW : 0;

  const t1 = thermostats[0];
  const t2 = thermostats[1];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LIVE POWER FLOW</Text>

      <View style={styles.topRow}>
        <Node label="SOLAR" value={wToKw(solarW)} color={colors.solar} active={solarW > 50} />
      </View>

      <FlowArrow watts={solarW} color={colors.solar} />

      <View style={styles.middleRow}>
        <Node
          label={gridImport > 0 ? 'GRID IN' : 'GRID OUT'}
          value={wToKw(gridW)}
          color={gridImport > 0 ? colors.grid : colors.gridExport}
          active={Math.abs(gridW) > 50}
        />
        <Node label="HOME" value={wToKw(loadW)} color={colors.home} />
        <Node
          label={`BATTERY ${batteryPct.toFixed(0)}%`}
          value={batteryCharging > 0 ? `+${wToKw(batteryCharging)}` : batteryDischarging > 0 ? `-${wToKw(batteryDischarging)}` : 'Idle'}
          color={colors.battery}
          active={Math.abs(batteryW) > 50}
        />
      </View>

      <View style={styles.bottomRow}>
        <Node
          label="TESLA"
          value={carChargeW > 0 ? wToKw(carChargeW) : 'Idle'}
          color={colors.car}
          active={carChargeW > 0}
        />
        {t1 && (
          <Node
            label={t1.room_name ?? 'HVAC T1'}
            value={t1.hvac_status === 'OFF' ? 'Off' : t1.hvac_status}
            color={colors.hvac}
            active={t1.hvac_status !== 'OFF'}
          />
        )}
        {t2 && (
          <Node
            label={t2.room_name ?? 'HVAC T2'}
            value={t2.hvac_status === 'OFF' ? 'Off' : t2.hvac_status}
            color={colors.hvac}
            active={t2.hvac_status !== 'OFF'}
          />
        )}
        {!t1 && !t2 && (
          <Node
            label="HVAC"
            value="Off"
            color={colors.hvac}
            active={false}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  topRow: { alignItems: 'center' },
  middleRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: 2 },
  bottomRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' },
  node: {
    backgroundColor: colors.bgCardAlt,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    alignItems: 'center',
    minWidth: 90,
    gap: 3,
  },
  nodeLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  nodeValue: { fontSize: 14, fontWeight: '700' },
  arrowContainer: { alignItems: 'center', height: 22, justifyContent: 'center' },
  arrowLine: { width: 2, height: 10, borderRadius: 1 },
  arrowLabel: { fontSize: 10, fontWeight: '600' },
  arrowPlaceholder: { height: 22 },
});
