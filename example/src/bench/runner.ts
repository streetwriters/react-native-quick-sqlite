/**
 * Benchmark runner shared by the screen and the `__DEV__` automation hook.
 */
import { Platform } from 'react-native';
import { benchmarks, resetBenchDb, setJournalMode } from './benchmarks';
import { runBenchmark, type Benchmark, type BenchResult } from './harness';
import { recordResult } from '../results';

export interface BenchRow {
  name: string;
  result: BenchResult;
}

export interface BenchPayload {
  platform: string;
  mode: 'debug' | 'release';
  wal: boolean;
  results: {
    name: string;
    minMs: number;
    medianMs: number;
    p95Ms: number;
    opsPerSec?: number;
    runs: number[];
  }[];
}

export const BENCH_DONE = 'QSQL_BENCH';

/**
 * Auto-run the benchmark suite when `bench.autorun` exists in the app's Documents
 * folder. This is how a release build is driven from the host: there is no Metro
 * connection to evaluate JS through, so the trigger has to be a file.
 *
 * Contents may be a JSON object: `{"wal": true, "filter": "select"}`.
 */
export const AUTORUN_MARKER = 'bench.autorun';

export interface RunOptions {
  /** Only run benchmarks whose name matches this substring. */
  filter?: string;
  onResult?: (row: BenchRow, index: number) => void;
}

/**
 * Runs benchmarks and logs a single `QSQL_BENCH <json>` line.
 *
 * A benchmark that throws is logged as `QSQL_BENCH_ERROR` and skipped rather
 * than aborting the whole suite (a debug-build crash still takes the app down;
 * that is what the crash log is for).
 */
export async function runBenchmarks(
  wal: boolean,
  options: RunOptions = {}
): Promise<{ payload: BenchPayload; rows: BenchRow[] }> {
  resetBenchDb();
  setJournalMode(wal);

  const selected = options.filter
    ? benchmarks.filter((b) => b.name.includes(options.filter!))
    : benchmarks;

  console.log(`QSQL_BENCH_START ${JSON.stringify(selected.map((b) => b.name))}`);

  const rows: BenchRow[] = [];
  for (let idx = 0; idx < selected.length; idx++) {
    const bench = selected[idx]!;
    try {
      console.log(`QSQL_BENCH_RUN ${bench.name}`);
      const result = await runBenchmark(bench);
      const row: BenchRow = { name: result.name, result };
      rows.push(row);
      options.onResult?.(row, idx);
    } catch (err) {
      console.log(`QSQL_BENCH_ERROR ${bench.name} :: ${String(err)}`);
      recordResult('bench_error', bench.name, String(err));
    }
  }

  const payload: BenchPayload = {
    platform: Platform.OS,
    mode: __DEV__ ? 'debug' : 'release',
    wal,
    results: rows.map((r) => ({
      name: r.name,
      minMs: r.result.minMs,
      medianMs: r.result.medianMs,
      p95Ms: r.result.p95Ms,
      opsPerSec: r.result.opsPerSec,
      runs: r.result.runs,
    })),
  };
  console.log(`${BENCH_DONE} ${JSON.stringify(payload)}`);
  recordResult('bench', 'all', payload);
  return { payload, rows };
}

export function benchmarkAt(index: number): Benchmark | undefined {
  return benchmarks[index];
}

/** Runs a single benchmark by index and logs the same payload shape for it. */
export async function runOneBenchmark(index: number, wal: boolean): Promise<BenchRow> {
  const bench = benchmarks[index]!;
  resetBenchDb();
  setJournalMode(wal);
  const result = await runBenchmark(bench);
  const payload: BenchPayload = {
    platform: Platform.OS,
    mode: __DEV__ ? 'debug' : 'release',
    wal,
    results: [
      {
        name: result.name,
        minMs: result.minMs,
        medianMs: result.medianMs,
        p95Ms: result.p95Ms,
        opsPerSec: result.opsPerSec,
        runs: result.runs,
      },
    ],
  };
  console.log(`${BENCH_DONE} ${JSON.stringify(payload)}`);
  recordResult('bench', result.name, payload);
  return { name: result.name, result };
}
