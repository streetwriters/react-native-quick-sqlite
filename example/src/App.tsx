import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Screen from './Screen';
import TestScreen from './tests/TestScreen';
import BenchmarkScreen from './bench/BenchmarkScreen';
import { runBenchmarks } from './bench/runner';
import { takeAutorunConfig } from './bench/autorun';
import { registerDevHooks } from './devHooks';

type Tab = 'tests' | 'bench';

export default function App() {
  const [tab, setTab] = useState<Tab>('tests');

  // Automation (see src/devHooks.ts). Registered at app level so the benchmark
  // hook works regardless of which tab is currently mounted.
  useEffect(() => {
    registerDevHooks({
      setTab,
      runBenchmarks: async (wal = false, filter?: string) => {
        setTab('bench');
        const { payload } = await runBenchmarks(wal, { filter });
        return payload;
      },
    });

    // Release builds have no debugger connection, so a host that wants
    // benchmarks drops a marker db into Documents instead of calling the hook.
    const config = takeAutorunConfig();
    if (config) {
      setTab('bench');
      // Defer so the first frame renders before the (long) synchronous work.
      setTimeout(() => {
        runBenchmarks(config.wal, { filter: config.filter }).catch(() => {});
      }, 1000);
    }
  }, []);

  return (
    <Screen>
      <View style={styles.titleBar}>
        <Text style={styles.title}>react-native-quick-sqlite</Text>
        <Text style={styles.subtitle}>RN 0.82.1</Text>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'tests' && styles.tabActive]}
          onPress={() => setTab('tests')}
        >
          <Text style={[styles.tabText, tab === 'tests' && styles.tabTextActive]}>Tests</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'bench' && styles.tabActive]}
          onPress={() => setTab('bench')}
        >
          <Text style={[styles.tabText, tab === 'bench' && styles.tabTextActive]}>
            Benchmarks
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'tests' ? <TestScreen /> : <BenchmarkScreen />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: '#0f172a',
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#1e293b',
  },
  tabActive: {
    backgroundColor: '#3b82f6',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  tabTextActive: {
    color: '#ffffff',
  },
});
