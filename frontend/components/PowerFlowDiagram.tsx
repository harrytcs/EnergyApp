import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
  icon?: React.ReactNode;
}

function Node({ label, value, color, active = true, icon }: NodeProps) {
  return (
    <View style={[styles.node, {
      borderColor: active ? color + '55' : colors.border,
      borderTopColor: active ? color : colors.border,
      backgroundColor: active ? color + '18' : colors.bgCardAlt,
      opacity: active ? 1 : 0.4,
    }]}>
      {icon && <View style={{ marginBottom: 1 }}>{icon}</View>}
      <Text style={[styles.nodeLabel, { color: active ? color + 'cc' : colors.textMuted }]}>{label}</Text>
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
    <LinearGradient
      colors={[colors.bgCardAlt, colors.bgCard]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <Text style={styles.title}>LIVE POWER FLOW</Text>

      <View style={styles.topRow}>
        <Node
          label="SOLAR"
          value={wToKw(solarW)}
          color={colors.solar}
          active={solarW > 50}
          icon={<Ionicons name="sunny" size={20} color={colors.solar} />}
        />
      </View>

      <FlowArrow watts={solarW} color={colors.solar} />

      <View style={styles.middleRow}>
        <Node
          label={gridImport > 0 ? 'GRID IN' : 'GRID OUT'}
          value={wToKw(gridW)}
          color={gridImport > 0 ? colors.grid : colors.gridExport}
          active={Math.abs(gridW) > 50}
          icon={<MaterialCommunityIcons name="transmission-tower" size={18} color={gridImport > 0 ? colors.grid : colors.gridExport} />}
        />
        <Node
          label="HOME"
          value={wToKw(loadW)}
          color={colors.home}
          icon={<Ionicons name="home" size={18} color={colors.home} />}
        />
        <Node
          label={`BATTERY ${batteryPct.toFixed(0)}%`}
          value={batteryCharging > 0 ? `+${wToKw(batteryCharging)}` : batteryDischarging > 0 ? `-${wToKw(batteryDischarging)}` : 'Idle'}
          color={colors.battery}
          active={Math.abs(batteryW) > 50}
          icon={<MaterialCommunityIcons name="battery-charging-80" size={18} color={colors.battery} />}
        />
      </View>

      <View style={styles.bottomRow}>
        <Node
          label="TESLA"
          value={carChargeW > 0 ? wToKw(carChargeW) : 'Idle'}
          color={colors.car}
          active={carChargeW > 0}
          icon={<MaterialCommunityIcons name="car-electric" size={18} color={colors.car} />}
        />
        {t1 && (
          <Node
            label={t1.room_name ?? 'HVAC T1'}
            value={t1.hvac_status === 'OFF' ? 'Off' : t1.hvac_status}
            color={colors.hvac}
            active={t1.hvac_status !== 'OFF'}
            icon={<MaterialCommunityIcons name="air-conditioner" size={18} color={colors.hvac} />}
          />
        )}
        {t2 && (
          <Node
            label={t2.room_name ?? 'HVAC T2'}
            value={t2.hvac_status === 'OFF' ? 'Off' : t2.hvac_status}
            color={colors.hvac}
            active={t2.hvac_status !== 'OFF'}
            icon={<MaterialCommunityIcons name="air-conditioner" size={18} color={colors.hvac} />}
          />
        )}
        {!t1 && !t2 && (
          <Node
            label="HVAC"
            value="Off"
            color={colors.hvac}
            active={false}
            icon={<MaterialCommunityIcons name="air-conditioner" size={18} color={colors.hvac} />}
          />
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
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
    borderRadius: radius.md,
    borderWidth: 1,
    borderTopWidth: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    alignItems: 'center',
    minWidth: 90,
    gap: 3,
  },
  nodeLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  nodeValue: { fontSize: 14, fontWeight: '700' },
  arrowContainer: { alignItems: 'center', height: 26, justifyContent: 'center', gap: 2 },
  arrowLine: { width: 3, height: 12, borderRadius: 2 },
  arrowLabel: { fontSize: 11, fontWeight: '700' },
  arrowPlaceholder: { height: 26 },
});
