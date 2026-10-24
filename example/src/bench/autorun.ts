/**
 * Autorun trigger for release-build benchmarks.
 *
 * A release build has no Metro/debugger connection, so the host cannot evaluate
 * JS in the app to start a benchmark run. Instead, the host drops a SQLite file
 * named `bench_autorun.db` into the app's Documents folder:
 *
 *   sqlite3 <container>/Documents/bench_autorun.db \
 *     "CREATE TABLE cfg (wal INTEGER, filter TEXT); INSERT INTO cfg VALUES (0, NULL);"
 *
 * On mount the app notices the file, reads the config, deletes the file, and
 * runs the suite. `{"wal":1,"filter":"select"}` in the table selects WAL mode and
 * a name filter.
 */
import { open, type QuickSQLiteConnection } from 'react-native-quick-sqlite';

const MARKER_DB = 'bench_autorun.db';

export interface AutorunConfig {
  wal: boolean;
  filter?: string;
}

/** Reads (and consumes) the autorun marker. Returns null when absent. */
export function takeAutorunConfig(): AutorunConfig | null {
  let conn: QuickSQLiteConnection | null = null;
  try {
    conn = open({ name: MARKER_DB });
    // A marker file that exists but has no `cfg` table means the app got here
    // before the host finished writing it. Treat that as "no marker" and retry
    // shortly, so the host can write the file and relaunch in either order.
    const row = conn.execute('SELECT wal, filter FROM cfg LIMIT 1;').rows?.item(0);
    if (row == null) return null;
    consume(conn);
    return {
      wal: row.wal === 1 || row.wal === true,
      filter: row.filter == null ? undefined : String(row.filter),
    };
  } catch {
    // No marker: the file does not exist, or this is not the first launch.
    try {
      conn?.close();
    } catch {}
    return null;
  }
}

function consume(conn: QuickSQLiteConnection): void {
  try {
    conn.close();
  } catch {}
  try {
    conn.delete();
  } catch {}
}
