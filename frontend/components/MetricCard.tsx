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
    <View style={styles.card}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color }]}>{value}</Text>
        {unit ? <Text style={[styles.unit, { color }]}>{unit}</Text> : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {eta ? <Text style={styles.eta}>{eta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    flex: 1,
    minWidth: 110,
    gap: 6,
  },
  label: {
    color: colors.textMuted,
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
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.75,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  eta: {
    color: colors.solar,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
});
