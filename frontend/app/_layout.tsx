import { useEffect, useState } from 'react';
import { Platform, LogBox } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Hub } from 'aws-amplify/utils';
import { configureAmplify, auth } from '../services/auth';

// Suppress react-native-svg web prop leak — harmless, not a real error
LogBox.ignoreLogs(['Unknown event handler property']);
if (Platform.OS === 'web') {
  const _err = console.error.bind(console);
  console.error = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('onStartShouldSetResponder')) return;
    if (typeof args[0] === 'string' && args[0].includes('Unknown event handler property')) return;
    _err(...args);
  };
}

configureAmplify();

export default function RootLayout() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    auth.getCurrentUser()
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false));

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn') setIsAuthenticated(true);
      if (payload.event === 'signedOut') setIsAuthenticated(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isAuthenticated === null) return;
    const inAuth = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuth) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuth) {
      router.replace('/(tabs)/');
    }
  }, [isAuthenticated, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
