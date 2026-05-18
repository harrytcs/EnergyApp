import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../constants/theme';

interface Props {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  subtitle?: string;
  eta?: string;
}

export default function MetricCard({ label, value, unit, color = colors.solar, subtitle, eta }: Props) {
  return (
    <View style={[styles.card, {
      backgroundColor: color + '14',
      borderColor: color + '30',
      borderTopColor: color,
    }]}>
      <Text style={[styles.label, { color: color + 'cc' }]}>{label.toUpperCase()}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color }]}>{value}</Text>
        {unit ? <Text style={[styles.unit, { color }]}>{unit}</Text> : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {eta ? <Text style={[styles.eta, { color }]}>{eta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    padding: 18,
    borderWidth: 1,
    borderTopWidth: 3,
    flex: 1,
    minWidth: 110,
    gap: 6,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  value: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
  },
  unit: {
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  eta: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
    opacity: 0.85,
  },
});
