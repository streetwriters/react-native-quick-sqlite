/**
 * Persist test/benchmark results to a SQLite file.
 *
 * In a release build the app has no Metro connection, so `console.log` output
 * cannot be read from the host. Results are therefore also written to
 * `results.db` in the app's data folder, where `xcrun simctl get_app_container`
 * + `sqlite3` can read them:
 *
 *   sqlite3 <container>/Documents/results.db 'select * from results'
 */
import { open, type QuickSQLiteConnection } from 'react-native-quick-sqlite';

const DB_NAME = 'results.db';

let db: QuickSQLiteConnection | null = null;

function resultsDb(): QuickSQLiteConnection | null {
  if (db) return db;
  try {
    db = open({ name: DB_NAME });
    db.execute(
      'CREATE TABLE IF NOT EXISTS results (kind TEXT, name TEXT, payload TEXT, ts INTEGER);'
    );
    return db;
  } catch {
    db = null;
    return null;
  }
}

/** Writes one result row. Never throws — logging must not break a test run. */
export function recordResult(kind: string, name: string, payload: unknown): void {
  try {
    const conn = resultsDb();
    if (!conn) return;
    conn.execute('INSERT INTO results (kind, name, payload, ts) VALUES (?, ?, ?, ?);', [
      kind,
      name,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      Date.now(),
    ]);
  } catch {}
}

/** Clears everything recorded so far, so each run starts clean. */
export function clearResults(): void {
  try {
    resultsDb()?.execute('DELETE FROM results;');
  } catch {}
}

export function closeResults(): void {
  try {
    db?.close();
  } catch {}
  db = null;
}
