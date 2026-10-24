/**
 * Minimal test harness: registry + sequential runner + assertions.
 *
 * The test screen calls `runAll()` on mount. Every result is also logged to the
 * Metro console in a machine readable form so a CI/agent can read them:
 *
 *   QSQL_TEST pass <name>
 *   QSQL_TEST fail <name> :: <message>
 *   QSQL_TESTS_DONE passed=N failed=M
 */
import { QuickSQLite, open, type QuickSQLiteConnection } from 'react-native-quick-sqlite';
import { recordResult } from '../results';

export type TestFn = () => void | Promise<void>;

interface RegisteredTest {
  name: string;
  fn: TestFn;
}

export interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
  skipped?: boolean;
  durationMs: number;
}

/**
 * Thrown by `skip()`; the runner reports these as skipped, not failed.
 */
export class SkipError extends Error {
  constructor(message = 'skipped') {
    super(message);
    this.name = 'SkipError';
  }
}

const DEFAULT_TIMEOUT_MS = 5000;

const tests: RegisteredTest[] = [];

export function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

export function getTests(): RegisteredTest[] {
  return tests;
}

export function skip(reason = 'skipped'): never {
  throw new SkipError(reason);
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${e} but got ${a}`);
  }
}

export function assertThrows(fn: () => unknown, match?: RegExp): void {
  let threw = false;
  let message = '';
  try {
    fn();
  } catch (err) {
    threw = true;
    message = errorMessage(err);
  }
  if (!threw) {
    throw new Error('expected function to throw, but it did not');
  }
  if (match && !match.test(message)) {
    throw new Error(`expected thrown message to match ${match} but got ${describe(message)}`);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function assertRejects(
  p: Promise<unknown>,
  match?: RegExp,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<void> {
  let settled: { rejected: boolean; message?: string } | undefined;
  try {
    await withTimeout(p, timeoutMs, 'assertRejects');
    settled = { rejected: false };
  } catch (err) {
    settled = { rejected: true, message: errorMessage(err) };
  }
  if (settled.rejected === false) {
    throw new Error('expected promise to reject, but it resolved');
  }
  if (match && !match.test(settled.message ?? '')) {
    throw new Error(
      `expected rejection to match ${match} but got ${describe(settled.message ?? '')}`
    );
  }
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runAll(onResult?: (r: TestResult) => void): Promise<TestResult[]> {
  const results: TestResult[] = [];
  recordResult('run', 'tests', 'started');

  for (const registered of tests) {
    const start = performance.now();
    let result: TestResult;
    try {
      await withTimeout(
        Promise.resolve().then(() => registered.fn()),
        // Async tests are expected to add their own finer grained timeouts; this
        // is a last resort so one hanging test cannot freeze the whole runner.
        60000,
        `test "${registered.name}"`
      );
      result = { name: registered.name, passed: true, durationMs: performance.now() - start };
      console.log(`QSQL_TEST pass ${registered.name}`);
    } catch (err) {
      const durationMs = performance.now() - start;
      if (err instanceof SkipError) {
        result = {
          name: registered.name,
          passed: true,
          skipped: true,
          message: err.message,
          durationMs,
        };
        console.log(`QSQL_TEST skip ${registered.name} :: ${err.message}`);
      } else {
        const message = errorMessage(err);
        result = { name: registered.name, passed: false, message, durationMs };
        console.log(`QSQL_TEST fail ${registered.name} :: ${message}`);
      }
    }
    results.push(result);
    recordResult('test', result.name, {
      passed: result.passed,
      skipped: result.skipped ?? false,
      message: result.message ?? null,
      durationMs: result.durationMs,
    });
    onResult?.(result);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`QSQL_TESTS_DONE passed=${passed} failed=${failed}`);
  recordResult('summary', 'tests', { passed, failed, total: results.length });
  return results;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

const openedDbs = new Set<string>();

/** Opens `name` on a clean slate: any previous file (and lock state) is removed. */
export function freshDb(name: string, location?: string): QuickSQLiteConnection {
  try {
    const old = open({ name, location });
    try {
      old.close();
    } catch {}
    old.delete();
  } catch {}

  const db = open({ name, location });
  openedDbs.add(name);
  return db;
}

/** Closes every db opened through `freshDb`, swallowing errors (used between runs). */
export function closeAllFreshDbs(): void {
  for (const name of openedDbs) {
    try {
      QuickSQLite.close(name);
    } catch {}
  }
  openedDbs.clear();
}
