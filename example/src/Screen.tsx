import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

/**
 * Screen container that keeps content out from under the notch / status bar.
 *
 * Uses `react-native-safe-area-context` (the replacement React Native itself
 * recommends now that RN's own `SafeAreaView` is deprecated). The example app
 * lists it as a dependency, so it is autolinked by `pod install` and available
 * on Android too.
 */
export default function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
        <View style={styles.content}>{children}</View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
});
