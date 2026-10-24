/**
 * Tiny benchmark harness: warm-up run, N timed runs, min/median/p95/ops-s.
 *
 * `performance.now()` is the timer. Setup/teardown run around *each* run so
 * every iteration starts from the same state.
 */

export interface Benchmark {
  name: string;
  setup?: () => void | Promise<void>;
  run: () => void | Promise<void>;
  teardown?: () => void | Promise<void>;
  /** timed runs; 1 warm-up run happens on top of this. Default 5. */
  iterations?: number;
  /** logical units of work per run (e.g. rows inserted), used to compute ops/s. */
  opsPerRun?: number;
}

export interface BenchResult {
  name: string;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  opsPerSec?: number;
  runs: number[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function runBenchmark(b: Benchmark): Promise<BenchResult> {
  const iterations = b.iterations ?? 5;

  // 1 untimed warm-up run, with setup/teardown like a real run.
  b.setup?.();
  await b.run();
  b.teardown?.();
  await nextTick();

  const runs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    b.setup?.();
    const start = performance.now();
    await b.run();
    const elapsed = performance.now() - start;
    b.teardown?.();
    runs.push(elapsed);
    await nextTick();
  }

  const sorted = [...runs].sort((a, z) => a - z);
  const medianMs = median(sorted);
  const result: BenchResult = {
    name: b.name,
    minMs: sorted[0] ?? 0,
    medianMs,
    p95Ms: percentile(sorted, 95),
    runs,
  };
  if (b.opsPerRun != null && medianMs > 0) {
    result.opsPerSec = (b.opsPerRun / medianMs) * 1000;
  }
  return result;
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return `${ms.toFixed(0)}ms`;
  return `${ms.toFixed(1)}ms`;
}

export function formatOps(ops?: number): string {
  if (ops == null) return '-';
  if (ops >= 1e6) return `${(ops / 1e6).toFixed(2)}M/s`;
  if (ops >= 1e3) return `${(ops / 1e3).toFixed(1)}k/s`;
  return `${ops.toFixed(0)}/s`;
}
