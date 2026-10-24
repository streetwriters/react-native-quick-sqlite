import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { benchmarks } from './benchmarks';
import { runBenchmarks, runOneBenchmark, type BenchRow } from './runner';
import { formatMs, formatOps } from './harness';


export default function BenchmarkScreen() {
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [wal, setWal] = useState(false);
  const [lastJson, setLastJson] = useState<string | null>(null);
  const runningRef = useRef(false);

  const runAll = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRows([]);
    setLastJson(null);
    try {
      const { payload, rows: results } = await runBenchmarks(wal, {
        onResult: (row, index) => {
          setRunning(benchmarks[index]?.name ?? row.name);
        },
      });
      setLastJson(JSON.stringify(payload));
      setRows(results);
    } finally {
      setRunning(null);
      runningRef.current = false;
    }
  }, [wal]);

  const runSingle = useCallback(
    async (index: number) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(benchmarks[index]!.name);
      try {
        const row = await runOneBenchmark(index, wal);
        setRows((prev) => {
          const next = prev.filter((r) => r.name !== row.name);
          next.push(row);
          return next;
        });
      } finally {
        setRunning(null);
        runningRef.current = false;
      }
    },
    [wal]
  );

  const share = useCallback(() => {
    if (lastJson == null) return;
    Share.share({ message: lastJson }).catch(() => {});
  }, [lastJson]);

  // Headless automation (see src/devHooks.ts). The runner is registered at app
  // level; this screen only mirrors the last payload for display.
  useEffect(() => {
    return () => setLastJson(null);
  }, []);

  return (
    <View style={styles.container}>
      {__DEV__ && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>Debug build — numbers not meaningful</Text>
        </View>
      )}

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.button, running != null && styles.buttonDisabled]}
          disabled={running != null}
          onPress={runAll}
        >
          <Text style={styles.buttonText}>Run all</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.toggle} onPress={() => setWal((v) => !v)}>
          <View style={[styles.checkbox, wal && styles.checkboxChecked]}>
            {wal && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.toggleText}>journal_mode=WAL</Text>
        </TouchableOpacity>

        {lastJson != null && (
          <TouchableOpacity style={styles.button} onPress={share}>
            <Text style={styles.buttonText}>Share results</Text>
          </TouchableOpacity>
        )}
      </View>

      {running != null && (
        <View style={styles.runningRow}>
          <ActivityIndicator color="#3b82f6" />
          <Text style={styles.runningText}>{running}</Text>
        </View>
      )}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <View style={styles.tableHeader}>
          <Text style={[styles.cell, styles.cellName, styles.headerCell]}>benchmark</Text>
          <Text style={[styles.cell, styles.cellNum, styles.headerCell]}>median</Text>
          <Text style={[styles.cell, styles.cellNum, styles.headerCell]}>min</Text>
          <Text style={[styles.cell, styles.cellNum, styles.headerCell]}>p95</Text>
          <Text style={[styles.cell, styles.cellOps, styles.headerCell]}>ops/s</Text>
        </View>

        {benchmarks.map((b, idx) => {
          const row = rows.find((r) => r.name === b.name);
          return (
            <View key={b.name} style={styles.tableRow}>
              <TouchableOpacity
                style={styles.nameCell}
                disabled={running != null}
                onPress={() => runSingle(idx)}
              >
                <Text style={styles.cellName} numberOfLines={2}>
                  {b.name}
                </Text>
                <Text style={styles.runHint}>tap to run</Text>
              </TouchableOpacity>
              <Text style={[styles.cell, styles.cellNum]}>
                {row ? formatMs(row.result.medianMs) : '-'}
              </Text>
              <Text style={[styles.cell, styles.cellNum]}>
                {row ? formatMs(row.result.minMs) : '-'}
              </Text>
              <Text style={[styles.cell, styles.cellNum]}>
                {row ? formatMs(row.result.p95Ms) : '-'}
              </Text>
              <Text style={[styles.cell, styles.cellOps]}>
                {row ? formatOps(row.result.opsPerSec) : '-'}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {lastJson != null && (
        <ScrollView style={styles.jsonBox}>
          <Text style={styles.jsonText} selectable>
            {lastJson}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  warning: {
    backgroundColor: '#78350f',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  warningText: {
    color: '#fde68a',
    fontSize: 12,
    fontWeight: '600',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1e293b',
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#475569',
    marginRight: 8,
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
    fontSize: 12,
    color: '#cbd5e1',
  },
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  runningText: {
    color: '#94a3b8',
    fontSize: 12,
    marginLeft: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b55',
  },
  headerCell: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cell: {
    color: '#e2e8f0',
    fontSize: 12,
  },
  cellName: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 12,
  },
  cellNum: {
    width: 58,
    textAlign: 'right',
  },
  cellOps: {
    width: 62,
    textAlign: 'right',
  },
  nameCell: {
    flex: 1,
    paddingRight: 6,
  },
  runHint: {
    color: '#475569',
    fontSize: 9,
    marginTop: 1,
  },
  jsonBox: {
    maxHeight: 150,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    padding: 8,
  },
  jsonText: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'Courier',
  },
});
