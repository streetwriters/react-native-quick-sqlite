import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
// Side-effect import: registers every test file, then re-exports the harness.
import { getTests, runAll, type TestResult } from './index';
import { registerDevHooks } from '../devHooks';
import { clearResults } from '../results';

export default function TestScreen() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [failuresOnly, setFailuresOnly] = useState(false);
  // Guards against a second run being started while one is in flight and
  // against state updates after unmount.
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setResults([]);
    clearResults();

    const collected: TestResult[] = [];
    try {
      await runAll((result) => {
        collected.push(result);
        if (mountedRef.current) setResults([...collected]);
      });
    } finally {
      runningRef.current = false;
      if (mountedRef.current) setRunning(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  // Headless automation (see src/devHooks.ts).
  useEffect(() => {
    registerDevHooks({ runTests: run });
  }, [run]);

  const total = results.length;
  const passed = results.filter((r) => r.passed && !r.skipped).length;
  const failed = results.filter((r) => !r.passed).length;
  const skipped = results.filter((r) => r.skipped).length;
  const registered = getTests().length;

  const visible = failuresOnly ? results.filter((r) => !r.passed) : results;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.stats} testID="test-stats">
            {passed} passed / {failed} failed
            {skipped > 0 ? ` / ${skipped} skipped` : ''} / {registered} total
          </Text>
          {running && <Text style={styles.runningText}>running…</Text>}
        </View>
        <TouchableOpacity
          style={[styles.button, running && styles.buttonDisabled]}
          disabled={running}
          onPress={run}
        >
          <Text style={styles.buttonText}>Run again</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.toggleRow}
        onPress={() => setFailuresOnly((v) => !v)}
      >
        <View style={[styles.checkbox, failuresOnly && styles.checkboxChecked]}>
          {failuresOnly && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <Text style={styles.toggleText}>Show failures only</Text>
      </TouchableOpacity>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {visible.length === 0 && !running && (
          <Text style={styles.emptyText}>
            {total === 0 ? 'No tests registered.' : 'No failures. 🎉'}
          </Text>
        )}
        {visible.map((res) => (
          <View
            key={res.name}
            style={[
              styles.card,
              res.passed ? styles.cardPassed : styles.cardFailed,
              res.skipped && styles.cardSkipped,
            ]}
          >
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.dot,
                  res.passed ? styles.dotPassed : styles.dotFailed,
                  res.skipped && styles.dotSkipped,
                ]}
              />
              <Text style={styles.cardTitle}>{res.name}</Text>
              <Text style={styles.cardDuration}>{res.durationMs.toFixed(0)}ms</Text>
            </View>
            {res.skipped && <Text style={styles.skipText}>skipped: {res.message}</Text>}
            {!res.passed && res.message && (
              <Text style={styles.errorText} selectable>
                {res.message}
              </Text>
            )}
          </View>
        ))}
        {running && (
          <View style={styles.spinner}>
            <ActivityIndicator color="#3b82f6" />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1e293b',
  },
  headerText: {
    flex: 1,
    marginRight: 12,
  },
  stats: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  runningText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    flexShrink: 0,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#475569',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  toggleText: {
    fontSize: 13,
    color: '#cbd5e1',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 12,
  },
  emptyText: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: 24,
  },
  card: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
  },
  cardPassed: {
    backgroundColor: '#064e3b22',
    borderColor: '#059669',
  },
  cardFailed: {
    backgroundColor: '#7f1d1d22',
    borderColor: '#dc2626',
  },
  cardSkipped: {
    backgroundColor: '#33415522',
    borderColor: '#64748b',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  dotPassed: {
    backgroundColor: '#10b981',
  },
  dotFailed: {
    backgroundColor: '#ef4444',
  },
  dotSkipped: {
    backgroundColor: '#94a3b8',
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#f1f5f9',
  },
  cardDuration: {
    fontSize: 11,
    color: '#64748b',
  },
  errorText: {
    marginTop: 8,
    fontSize: 12,
    color: '#fca5a5',
    fontFamily: 'Courier',
  },
  skipText: {
    marginTop: 6,
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  spinner: {
    paddingVertical: 20,
  },
});
