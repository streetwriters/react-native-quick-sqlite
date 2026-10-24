/**
 * Automation hooks for the example app.
 *
 * The app exposes a small global that a CDP client can call, so the test and
 * benchmark suites can be driven headlessly (the simulator offers no way to
 * inject taps from the command line):
 *
 *   __QSQL__.setTab('bench')
 *   __QSQL__.runBenchmarks(true)   // true = WAL; logs QSQL_BENCH <json>
 *   __QSQL__.runTests()
 *
 * Registered in release builds too, because benchmarks are only meaningful in a
 * release build. This is a test-harness app, not a shipped one.
 * Nothing here changes library behaviour; it only drives the example app.
 */
export interface DevHooks {
  setTab?: (tab: 'tests' | 'bench') => void;
  runBenchmarks?: (wal?: boolean, filter?: string) => Promise<unknown>;
  runTests?: () => Promise<unknown>;
}

declare global {
  // eslint-disable-next-line no-var
  var __QSQL__: DevHooks | undefined;
}

export function registerDevHooks(hooks: DevHooks): void {
  globalThis.__QSQL__ = { ...(globalThis.__QSQL__ ?? {}), ...hooks };
}
