/**
 * Benchmark definitions. All use a dedicated `bench.db`.
 *
 * Data is generated with a seeded PRNG so every run sees identical rows.
 */
import { QuickSQLite, open, type QuickSQLiteConnection } from 'react-native-quick-sqlite';
import type { Benchmark } from './harness';

const DB_NAME = 'bench.db';

/** The database the benchmarks run against; BenchmarkScreen sets the journal mode on it. */
export function benchDb(): QuickSQLiteConnection {
  return open({ name: DB_NAME });
}

export function resetBenchDb(): void {
  // Both databases the cross-db benchmarks use.
  for (const name of [DB_NAME, 'bench_logs.db']) {
    try {
      const existing = open({ name });
      try {
        existing.close();
      } catch {}
      existing.delete();
    } catch {}
  }
}

/** mulberry32 — tiny, fast, deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TABLE_SQL =
  'CREATE TABLE t (id INTEGER PRIMARY KEY, i INTEGER, r REAL, s TEXT, s2 TEXT, n TEXT, b BLOB);';

const INSERT_SQL = 'INSERT INTO t (i, r, s, s2, n, b) VALUES (?, ?, ?, ?, ?, ?);';

interface Row {
  i: number;
  r: number;
  s: string;
  s2: string;
  n: null;
}

function makeRows(count: number): Row[] {
  const rand = mulberry32(42);
  const rows: Row[] = new Array(count);
  for (let idx = 0; idx < count; idx++) {
    rows[idx] = {
      i: Math.floor(rand() * 100000),
      r: rand() * 1000,
      s: `Item ${Math.floor(rand() * 100000)}`,
      s2: `Value ${idx}`,
      n: null,
    };
  }
  return rows;
}

function recreateTable(db: QuickSQLiteConnection): void {
  db.execute('DROP TABLE IF EXISTS t;');
  db.execute(TABLE_SQL);
}

/** Inserts `count` rows with a plain sync execute inside one transaction. */
function insertRowsSync(db: QuickSQLiteConnection, rows: Row[]): void {
  db.execute('BEGIN');
  try {
    for (const row of rows) {
      db.execute(INSERT_SQL, [row.i, row.r, row.s, row.s2, row.n, null]);
    }
    db.execute('COMMIT');
  } catch (err) {
    try {
      db.execute('ROLLBACK');
    } catch {}
    throw err;
  }
}

const TEN_K_ROWS = makeRows(10000);

// ---------------------------------------------------------------------------
// insert benchmarks
// ---------------------------------------------------------------------------

const insertBatch: Benchmark = {
  name: 'insert 10k executeBatch (array-of-arrays)',
  opsPerRun: 10000,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    db.close();
  },
  run: () => {
    const db = benchDb();
    db.executeBatch([
      [INSERT_SQL, TEN_K_ROWS.map((r) => [r.i, r.r, r.s, r.s2, r.n, null])],
    ]);
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();
  },
};

const insertInTransaction: Benchmark = {
  name: 'insert 10k execute in transaction',
  opsPerRun: 10000,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    db.close();
  },
  run: () => {
    const db = benchDb();
    insertRowsSync(db, TEN_K_ROWS);
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();
  },
};

const insertAsyncSequential: Benchmark = {
  name: 'insert 1k executeAsync sequential',
  opsPerRun: 1000,
  iterations: 3,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    db.close();
  },
  run: async () => {
    const db = benchDb();
    db.execute('BEGIN');
    for (let idx = 0; idx < 1000; idx++) {
      const row = TEN_K_ROWS[idx]!;
      await db.executeAsync(INSERT_SQL, [row.i, row.r, row.s, row.s2, row.n, null]);
    }
    db.execute('COMMIT');
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();
  },
};

// ---------------------------------------------------------------------------
// select benchmarks
// ---------------------------------------------------------------------------

const selectSync: Benchmark = {
  name: 'select 10k rows sync',
  opsPerRun: 10000,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    insertRowsSync(db, TEN_K_ROWS);
    db.close();
  },
  run: () => {
    const db = benchDb();
    const res = db.execute('SELECT * FROM t;');
    if (res.rows?.length !== 10000) throw new Error(`expected 10000 rows, got ${res.rows?.length}`);
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();
  },
};

const selectAsync: Benchmark = {
  name: 'select 10k rows async',
  opsPerRun: 10000,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    insertRowsSync(db, TEN_K_ROWS);
    db.close();
  },
  run: async () => {
    const db = benchDb();
    const res = await db.executeAsync('SELECT * FROM t;');
    if (res.rows?.length !== 10000) throw new Error(`expected 10000 rows, got ${res.rows?.length}`);
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();
  },
};

const BLOB_COUNT = 1000;
const BLOB_SQL = 'CREATE TABLE b (id INTEGER PRIMARY KEY, b BLOB);';

const selectBlobs: Benchmark = {
  name: 'select 1k rows with 4KB blobs',
  opsPerRun: BLOB_COUNT,
  setup: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS b;');
    db.execute(BLOB_SQL);
    const blob = new Uint8Array(4096);
    for (let idx = 0; idx < blob.length; idx++) blob[idx] = idx & 0xff;
    db.executeBatch([['INSERT INTO b (b) VALUES (?);', new Array(BLOB_COUNT).fill([blob.buffer])]]);
    db.close();
  },
  run: () => {
    const db = benchDb();
    const res = db.execute('SELECT * FROM b;');
    if (res.rows?.length !== BLOB_COUNT) {
      throw new Error(`expected ${BLOB_COUNT} rows, got ${res.rows?.length}`);
    }
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS b;');
    db.close();
  },
};

const pointLookup: Benchmark = {
  name: 'point lookup by pk x5000',
  opsPerRun: 5000,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    insertRowsSync(db, TEN_K_ROWS);
    db.close();
  },
  run: () => {
    const db = benchDb();
    for (let k = 1; k <= 5000; k++) {
      db.execute('SELECT * FROM t WHERE id = ?;', [k]);
    }
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();
  },
};

// ---------------------------------------------------------------------------
// wide insert benchmark
// ---------------------------------------------------------------------------

const WIDE_COLS = 20;
const WIDE_INSERT =
  `INSERT INTO w (${Array.from({ length: WIDE_COLS }, (_, i) => `c${i}`).join(', ')}) ` +
  `VALUES (${Array.from({ length: WIDE_COLS }, () => '?').join(', ')});`;

const insertWide: Benchmark = {
  name: 'insert with 20 params x2000',
  opsPerRun: 2000,
  setup: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS w;');
    db.execute(
      `CREATE TABLE w (id INTEGER PRIMARY KEY, ${Array.from(
        { length: WIDE_COLS },
        (_, i) => `c${i}`
      ).join(', ')});`
    );
    db.close();
  },
  run: () => {
    const db = benchDb();
    const params = Array.from({ length: WIDE_COLS }, (_, i) => `value ${i}`);
    db.execute('BEGIN');
    for (let idx = 0; idx < 2000; idx++) {
      db.execute(WIDE_INSERT, params);
    }
    db.execute('COMMIT');
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS w;');
    db.close();
  },
};

// ---------------------------------------------------------------------------
// natural_key benchmark
// ---------------------------------------------------------------------------

const naturalKeySort: Benchmark = {
  name: 'natural_key order by 10k',
  opsPerRun: 10000,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    insertRowsSync(db, TEN_K_ROWS);
    db.close();
  },
  run: () => {
    const db = benchDb();
    const res = db.execute('SELECT s FROM t ORDER BY natural_key(s);');
    if (res.rows?.length !== 10000) throw new Error(`expected 10000 rows, got ${res.rows?.length}`);
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();
  },
};

// ---------------------------------------------------------------------------
// batch of distinct statements
// ---------------------------------------------------------------------------

const batchDistinct: Benchmark = {
  name: 'executeBatch 1k distinct statements',
  opsPerRun: 1000,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    db.close();
  },
  run: () => {
    const db = benchDb();
    const commands: string[][] = new Array(1000);
    for (let idx = 0; idx < 1000; idx++) {
      commands[idx] = [`INSERT INTO t (i) VALUES (${idx});`];
    }
    db.executeBatch(commands as any);
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();
  },
};

// ---------------------------------------------------------------------------
// Cross-database benchmarks: a logger flush must not delay the main database
// ---------------------------------------------------------------------------

const LOGS_DB = 'bench_logs.db';

/** Notesnook's logger table, in shape. */
const LOGS_TABLE_SQL =
  'CREATE TABLE logs (id TEXT PRIMARY KEY, timestamp INTEGER, message TEXT, date TEXT, context TEXT, type TEXT);';

/** One 1000-row multi-row INSERT, like the logger's flush. */
function makeLogInsert(count: number): [string, unknown[]] {
  const values: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < count; i++) {
    values.push('(?, ?, ?, ?, ?, ?)');
    params.push(`id-${i}`, 1000 + i, `log message number ${i}`, '2026-10-23', 'sync', 'info');
  }
  return [`INSERT INTO logs (id, timestamp, message, date, context, type) VALUES ${values.join(', ')};`, params];
}

const mainDbDuringLogFlush: Benchmark = {
  name: 'main-db point lookups during logger flush',
  opsPerRun: 200,
  iterations: 3,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    insertRowsSync(db, TEN_K_ROWS);
    db.close();

    const logs = open({ name: LOGS_DB });
    logs.execute('DROP TABLE IF EXISTS logs;');
    logs.execute(LOGS_TABLE_SQL);
    logs.close();
  },
  run: async () => {
    const [sql, params] = makeLogInsert(1000);
    const logs = open({ name: LOGS_DB });
    // Fire the logger flush without awaiting it, then time the main-db lookups.
    const flush = logs.executeAsync(sql, params);
    const db = benchDb();
    for (let k = 1; k <= 200; k++) {
      await db.executeAsync('SELECT * FROM t WHERE id = ?;', [k]);
    }
    db.close();
    await flush;
    logs.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();

    const logs = open({ name: LOGS_DB });
    logs.execute('DROP TABLE IF EXISTS logs;');
    logs.close();
  },
};

const twoDbsInParallel: Benchmark = {
  name: 'async on two dbs in parallel',
  opsPerRun: 2000,
  iterations: 3,
  setup: () => {
    const db = benchDb();
    recreateTable(db);
    db.close();

    const logs = open({ name: LOGS_DB });
    logs.execute('DROP TABLE IF EXISTS logs;');
    logs.execute(LOGS_TABLE_SQL);
    logs.close();
  },
  run: async () => {
    const db = benchDb();
    const logs = open({ name: LOGS_DB });
    const [sql, params] = makeLogInsert(1);
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 1000; i++) {
      work.push(db.executeAsync('INSERT INTO t (i) VALUES (?);', [i]));
      work.push(logs.executeAsync(sql, [`id-${i}`, i, 'm', 'd', 'c', 't']));
    }
    await Promise.all(work);
    db.close();
    logs.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS t;');
    db.close();

    const logs = open({ name: LOGS_DB });
    logs.execute('DROP TABLE IF EXISTS logs;');
    logs.close();
  },
};

// ---------------------------------------------------------------------------
// One-off SQL, like logger bulk inserts whose row count varies
// ---------------------------------------------------------------------------

const loggerVaryingInserts: Benchmark = {
  name: 'logger-style inserts, varying row counts',
  opsPerRun: 50,
  setup: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS l;');
    db.execute('CREATE TABLE l (v INTEGER);');
    db.close();
  },
  run: () => {
    const db = benchDb();
    db.execute('BEGIN');
    for (let n = 1; n <= 50; n++) {
      const placeholders = new Array(n).fill('(?)').join(', ');
      const params = Array.from({ length: n }, (_, i) => i);
      // Each row count produces a different SQL string, so none of these is
      // reused — exactly the shape of the logger's flush.
      db.execute(`INSERT INTO l (v) VALUES ${placeholders};`, params);
    }
    db.execute('COMMIT');
    db.close();
  },
  teardown: () => {
    const db = benchDb();
    db.execute('DROP TABLE IF EXISTS l;');
    db.close();
  },
};

export const benchmarks: Benchmark[] = [
  insertBatch,
  insertInTransaction,
  insertAsyncSequential,
  selectSync,
  selectAsync,
  selectBlobs,
  pointLookup,
  insertWide,
  naturalKeySort,
  batchDistinct,
  mainDbDuringLogFlush,
  twoDbsInParallel,
  loggerVaryingInserts,
];

export function setJournalMode(wal: boolean): void {
  const db = benchDb();
  try {
    const res = db.execute(`PRAGMA journal_mode=${wal ? 'WAL' : 'DELETE'};`);
    console.log(`QSQL_BENCH journal_mode -> ${JSON.stringify(res.rows?.item(0))}`);
  } finally {
    db.close();
  }
}

export { DB_NAME };
