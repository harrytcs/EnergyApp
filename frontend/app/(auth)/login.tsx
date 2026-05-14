import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { auth } from '../../services/auth';
import { colors, spacing, radius } from '../../constants/theme';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup' | 'confirm' | 'forgot'>('login');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function showError(msg: string) {
    setError(msg);
  }

  async function handleLogin() {
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      const result = await auth.signIn(email, password);
      if (result.isSignedIn) {
        router.replace('/(tabs)/');
      } else {
        showError('Sign in incomplete — please try again.');
      }
    } catch (e: any) {
      showError(e.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp() {
    setLoading(true);
    setError(null);
    try {
      await auth.signUp(email, password);
      setMode('confirm');
    } catch (e: any) {
      showError(e.message ?? 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await auth.confirmSignUp(email, code);
      const result = await auth.signIn(email, password);
      if (result.isSignedIn) router.replace('/(tabs)/');
    } catch (e: any) {
      showError(e.message ?? 'Confirmation failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.card}>
        <Text style={styles.logo}>⚡ EnergyApp</Text>
        <Text style={styles.subtitle}>
          {mode === 'login' ? 'Sign in to your account' :
           mode === 'signup' ? 'Create account' :
           mode === 'confirm' ? 'Enter verification code' : 'Reset password'}
        </Text>

        {mode !== 'confirm' && (
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        )}

        {(mode === 'login' || mode === 'signup') && (
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        )}

        {mode === 'confirm' && (
          <TextInput
            style={styles.input}
            placeholder="Verification code"
            placeholderTextColor={colors.textMuted}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
          />
        )}

        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignUp : handleConfirm}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Verify'}
            </Text>
          )}
        </TouchableOpacity>

        {mode === 'login' && (
          <TouchableOpacity onPress={() => setMode('signup')} style={styles.link}>
            <Text style={styles.linkText}>Don't have an account? Sign up</Text>
          </TouchableOpacity>
        )}

        {mode === 'signup' && (
          <TouchableOpacity onPress={() => setMode('login')} style={styles.link}>
            <Text style={styles.linkText}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logo: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    fontSize: 14,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.solar,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 16,
  },
  link: { marginTop: spacing.md, alignItems: 'center' },
  linkText: { color: colors.solar, fontSize: 14 },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
});
