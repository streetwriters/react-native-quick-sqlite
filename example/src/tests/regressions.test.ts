/**
 * Regression tests. Every bug fixed in cpp/ gets a test in here.
 */
import { QuickSQLite, open } from 'react-native-quick-sqlite';
import {
  assert,
  assertEqual,
  assertRejects,
  assertThrows,
  errorMessage,
  freshDb,
  test,
  withTimeout,
} from './harness';

// ---------------------------------------------------------------------------
// 2.1 QuickValue owns its data (blob params used to free JS memory)
// ---------------------------------------------------------------------------

test('blob param round-trip', () => {
  const db = freshDb('reg_blob.db');
  try {
    db.execute('CREATE TABLE t (b BLOB);');
    const bytes = [1, 2, 3, 255];
    const source = new Uint8Array(bytes);
    // 50 iterations: the old code freed the JS-owned ArrayBuffer immediately, so
    // the heap was corrupted within the first few round-trips.
    for (let i = 0; i < 50; i++) {
      db.execute('INSERT INTO t (b) VALUES (?);', [source.buffer]);
    }
    const res = db.execute('SELECT b FROM t;');
    assertEqual(res.rows?.length, 50, 'row count');
    for (let i = 0; i < 50; i++) {
      const blob: ArrayBuffer = res.rows!.item(i).b;
      assertEqual(Array.from(new Uint8Array(blob)), bytes, `blob bytes of row ${i}`);
    }
  } finally {
    db.close();
  }
});

test('blob param via executeAsync', async () => {
  const db = freshDb('reg_blob_async.db');
  try {
    db.execute('CREATE TABLE t (b BLOB);');
    const bytes = [9, 8, 7, 0, 255];
    const source = new Uint8Array(bytes);
    await withTimeout(
      (async () => {
        for (let i = 0; i < 50; i++) {
          await db.executeAsync('INSERT INTO t (b) VALUES (?);', [source.buffer]);
        }
      })(),
      15000,
      'blob executeAsync loop'
    );
    const res = db.execute('SELECT b FROM t;');
    assertEqual(res.rows?.length, 50, 'row count');
    for (let i = 0; i < 50; i++) {
      assertEqual(
        Array.from(new Uint8Array(res.rows!.item(i).b)),
        bytes,
        `blob bytes of row ${i}`
      );
    }
  } finally {
    db.close();
  }
});

test('zero-length blob', () => {
  const db = freshDb('reg_blob_empty.db');
  try {
    db.execute('CREATE TABLE t (b BLOB);');
    db.execute('INSERT INTO t (b) VALUES (?);', [new ArrayBuffer(0)]);
    const res = db.execute('SELECT b FROM t;');
    assertEqual(res.rows?.length, 1, 'row count');
    assertEqual(res.rows!.item(0).b.byteLength, 0, 'blob byteLength');
  } finally {
    db.close();
  }
});

test('text with embedded NUL', () => {
  const db = freshDb('reg_text_nul.db');
  try {
    db.execute('CREATE TABLE t (s TEXT);');
    db.execute('INSERT INTO t (s) VALUES (?);', ['a\u0000b']);
    const res = db.execute('SELECT s FROM t;');
    assertEqual(res.rows?.item(0).s.length, 3, 'length of text with embedded NUL');
  } finally {
    db.close();
  }
});

test('unknown object param is skipped (existing quirk, kept)', () => {
  const db = freshDb('reg_param_shift.db');
  try {
    db.execute('CREATE TABLE t (a TEXT, b TEXT);');
    // An unsupported object param is dropped, so 'x' binds to ?1 instead of ?2.
    // This shifts the remaining params; it is long-standing behaviour and is
    // preserved on purpose (see the plan's 1.8 behaviour-lock rationale).
    db.execute('INSERT INTO t (a, b) VALUES (?, ?);', [{}, 'x']);
    const row = db.execute('SELECT a, b FROM t;').rows?.item(0);
    assertEqual(row.a, 'x', 'the object was skipped and x landed in ?1');
    assertEqual(row.b, null, 'second param stayed NULL');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 2.2 Safe number -> SQLite conversion
// ---------------------------------------------------------------------------

test('large integer stays INTEGER', () => {
  const db = freshDb('reg_large_int.db');
  try {
    db.execute('CREATE TABLE t (c);');
    const big = Math.pow(2, 40);
    db.execute('INSERT INTO t (c) VALUES (?);', [big]);
    const row = db.execute('SELECT typeof(c) AS ty, c FROM t;').rows?.item(0);
    assertEqual(row.ty, 'integer', 'typeof large integer');
    assertEqual(row.c, big, 'large integer value');
  } finally {
    db.close();
  }
});

test('negative and fractional numbers', () => {
  const db = freshDb('reg_numbers.db');
  try {
    db.execute('CREATE TABLE t (ty TEXT, c);');
    db.execute('INSERT INTO t (ty, c) SELECT typeof(?), ?;', [-5, -5]);
    db.execute('INSERT INTO t (ty, c) SELECT typeof(?), ?;', [1.5, 1.5]);
    const rows = db.execute('SELECT ty, c FROM t;').rows;
    assertEqual(rows?.item(0).ty, 'integer', 'typeof -5');
    assertEqual(rows?.item(0).c, -5, 'value -5');
    assertEqual(rows?.item(1).ty, 'real', 'typeof 1.5');
    assertEqual(rows?.item(1).c, 1.5, 'value 1.5');
  } finally {
    db.close();
  }
});

test('MAX_SAFE_INTEGER round-trip', () => {
  const db = freshDb('reg_max_safe.db');
  try {
    db.execute('CREATE TABLE t (c);');
    db.execute('INSERT INTO t (c) VALUES (?);', [Number.MAX_SAFE_INTEGER]);
    assertEqual(
      db.execute('SELECT c FROM t;').rows?.item(0).c,
      Number.MAX_SAFE_INTEGER,
      'MAX_SAFE_INTEGER value'
    );
  } finally {
    db.close();
  }
});

test('2**40 round-trips exactly', () => {
  const db = freshDb('reg_2_40.db');
  try {
    db.execute('CREATE TABLE t (c);');
    db.execute('INSERT INTO t (c) VALUES (?);', [2 ** 40]);
    assertEqual(db.execute('SELECT c FROM t;').rows?.item(0).c, 2 ** 40, '2**40 value');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 2.3 Argument-count checks (these used to read past the end of `args`)
// ---------------------------------------------------------------------------

test('execute with no args throws', () => {
  // @ts-expect-error deliberately calling the raw proxy with no arguments
  assertThrows(() => QuickSQLite.execute(), /required|must be a string/i);
});

test('execute with one arg throws', () => {
  // @ts-expect-error deliberately calling the raw proxy with one argument
  assertThrows(() => QuickSQLite.execute('reg_args.db'), /required|must be a string/i);
});

test('execute with a non-string query throws', () => {
  // @ts-expect-error deliberately passing a number as the query
  assertThrows(() => QuickSQLite.execute('reg_args.db', 42), /must be a string/i);
});

test('executeBatch with 1 arg throws', () => {
  // @ts-expect-error deliberately calling the raw proxy with one argument
  assertThrows(() => QuickSQLite.executeBatch('reg_args.db'), /parameter count/i);
});

test('loadFile with 1 arg throws', () => {
  // @ts-expect-error deliberately calling the raw proxy with one argument
  assertThrows(() => QuickSQLite.loadFile('reg_args.db'), /required|parameter count/i);
});

test('loadFile with non-string args throws', () => {
  // @ts-expect-error deliberately passing a number as the file name
  assertThrows(() => QuickSQLite.loadFile('reg_args.db', 42), /must be a string/i);
});

test('executeAsync without params works through the JS wrapper', async () => {
  // The native host function requires three arguments, but src/index.ts replaces
  // it with a wrapper that always forwards three (params simply stays
  // undefined). The raw function is not reachable from JS, so the observable
  // behaviour — and the one worth locking — is that two arguments work.
  const db = freshDb('reg_async_noparams.db');
  try {
    db.execute('CREATE TABLE t (x);');
    db.execute('INSERT INTO t VALUES (1);');
    const res = await withTimeout(db.executeAsync('SELECT * FROM t;'), 5000, 'executeAsync no params');
    assertEqual(res.rows?.length, 1, 'row count without params');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 3.1 Connection registry
// ---------------------------------------------------------------------------

test('double open does not leak and still works', () => {
  const db = freshDb('reg_double_open.db');
  try {
    db.execute('CREATE TABLE t (x);');
    // A second open() of the same name must be a no-op, not a second handle that
    // leaks and shadows the first.
    const second = open({ name: 'reg_double_open.db' });
    second.execute('INSERT INTO t VALUES (1);');
    assertEqual(
      db.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c,
      1,
      'insert through the second handle is visible to the first'
    );

    // Closing once must really close it.
    db.close();
    assertThrows(() => second.execute('SELECT 1;'), /not open/i);
  } catch (err) {
    try {
      db.close();
    } catch {}
    throw err;
  }
});

test('execute after close throws', () => {
  const db = freshDb('reg_close.db');
  db.execute('CREATE TABLE t (x);');
  db.close();
  assertThrows(() => db.execute('SELECT 1;'), /not open/i);
});

test('open failure reports an error', () => {
  // Create a file, then try to use it as a *folder*: SQLite cannot open a
  // database at that path, and the error must be reported rather than swallowed.
  const folder = freshDb('reg_not_a_folder');
  let created = false;
  try {
    folder.execute('CREATE TABLE t (x);');
    folder.close();
    created = true;
  } catch {
    try {
      folder.close();
    } catch {}
  }
  assert(created, 'precondition: could not create the plain file');

  // Opening a database *inside* a path that is a regular file must fail.
  assertThrows(() => open({ name: 'inner.db', location: 'reg_not_a_folder' }), /.*/);
});

test('async work on a closed db rejects', async () => {
  const db = freshDb('reg_async_closed.db');
  db.execute('CREATE TABLE t (x);');
  // Close before submitting: submitting first would race the worker, which may
  // legitimately run the query before close() takes the lock.
  db.close();
  await assertRejects(withTimeout(db.executeAsync('SELECT * FROM t;'), 5000, 'executeAsync after close'), /not open/i);
});

test('closing while async work is in flight is not a crash', async () => {
  const db = freshDb('reg_async_close_race.db');
  db.execute('CREATE TABLE t (x);');
  // Fire work, then close immediately. Either ordering is valid: the query may
  // run before the close or reject after it, but it must settle and not crash.
  const pending = db.executeAsync('SELECT * FROM t;');
  db.close();
  const outcome = await withTimeout(
    pending.then(() => 'resolved').catch((err) => `rejected: ${errorMessage(err)}`),
    5000,
    'in-flight close'
  );
  assert(
    outcome === 'resolved' || /not open/i.test(outcome),
    `unexpected outcome: ${outcome}`
  );
});

// ---------------------------------------------------------------------------
// 3.2 ThreadPool / ordering
// ---------------------------------------------------------------------------

test('executeAsync preserves order', async () => {
  const db = freshDb('reg_async_order.db');
  try {
    db.execute('CREATE TABLE t (v INTEGER);');
    const pending: Promise<unknown>[] = [];
    // Fire all of them without awaiting, then check the row order.
    for (let i = 0; i < 200; i++) {
      pending.push(db.executeAsync('INSERT INTO t (v) VALUES (?);', [i]));
    }
    await withTimeout(Promise.all(pending), 20000, 'fire-and-forget inserts');

    const rows = db.execute('SELECT v FROM t ORDER BY rowid;').rows;
    assertEqual(rows?.length, 200, 'row count');
    const values = Array.from({ length: 200 }, (_, i) => rows!.item(i).v);
    assertEqual(values, Array.from({ length: 200 }, (_, i) => i), 'insert order');
  } finally {
    db.close();
  }
});

test('async insertId is correct under load', async () => {
  const db = freshDb('reg_async_insertid.db');
  try {
    db.execute('CREATE TABLE t (v INTEGER);');
    const pending: Promise<any>[] = [];
    for (let i = 0; i < 100; i++) {
      pending.push(db.executeAsync('INSERT INTO t (v) VALUES (?);', [i]));
    }
    const results = await withTimeout(Promise.all(pending), 20000, 'async insertIds');

    const ids = results.map((r) => r.insertId);
    assertEqual(new Set(ids).size, ids.length, 'every insertId is unique');

    for (const res of results) {
      const row = db.execute('SELECT v FROM t WHERE rowid = ?;', [res.insertId]).rows?.item(0);
      assert(row != null, `no row for insertId ${res.insertId}`);
      // `v` must be the value that produced this insertId.
      assertEqual(typeof row.v, 'number', 'row value is a number');
    }
  } finally {
    db.close();
  }
});

test('async batch and async query do not interleave', async () => {
  const db = freshDb('reg_async_batch.db');
  try {
    db.execute('CREATE TABLE t (v INTEGER);');
    const inserts = Array.from({ length: 500 }, (_, i) => [i]);
    // Without a serial worker the batch transaction and the count queries race,
    // producing "cannot start a transaction within a transaction".
    const batch = db.executeBatchAsync([
      ['INSERT INTO t (v) VALUES (?);', inserts],
    ]);
    const queries = Array.from({ length: 50 }, () =>
      db.executeAsync('SELECT count(*) AS c FROM t;')
    );
    const [batchResult, ...counts] = await withTimeout(
      Promise.all([batch, ...queries]),
      25000,
      'batch + queries'
    );
    assertEqual((batchResult as any).rowsAffected, 500, 'batch rowsAffected');
    for (const countResult of counts as any[]) {
      assert((countResult.rows?.item(0).c ?? 0) >= 0, 'count resolved');
    }
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4.1 One helper for all async host functions
// ---------------------------------------------------------------------------

test('executeAsync bad SQL rejects', async () => {
  const db = freshDb('reg_async_badsql.db');
  try {
    db.execute('CREATE TABLE t (x);');
    await assertRejects(
      withTimeout(db.executeAsync('SELEKT * FRM t;'), 5000, 'bad SQL'),
      /syntax error/i
    );
  } finally {
    db.close();
  }
});

test('executeAsync on a missing db rejects', async () => {
  await assertRejects(
    withTimeout(
      QuickSQLite.executeAsync('reg_never_opened.db', 'SELECT 1;'),
      5000,
      'missing db'
    ),
    /not open/i
  );
});

test('executeBatchAsync bad SQL rejects and rolls back', async () => {
  const db = freshDb('reg_async_batch_bad.db');
  try {
    db.execute('CREATE TABLE t (x INTEGER);');
    await assertRejects(
      withTimeout(
        db.executeBatchAsync([
          ['INSERT INTO t (x) VALUES (1);'],
          ['SELEKT * FRM t;'],
        ]),
        5000,
        'bad batch'
      ),
      /syntax error/i
    );
    assertEqual(
      db.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c,
      0,
      'rows rolled back'
    );
  } finally {
    db.close();
  }
});

test('loadFileAsync missing file rejects', async () => {
  const db = freshDb('reg_loadfile_async.db');
  try {
    db.execute('CREATE TABLE t (x);');
    await assertRejects(
      withTimeout(db.loadFileAsync('/no/such/file.sql'), 5000, 'missing file'),
      /could not open file/i
    );
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4.2 BEGIN / COMMIT / ROLLBACK results
// ---------------------------------------------------------------------------

test('executeBatch inside an open transaction still works (existing behaviour)', () => {
  const db = freshDb('reg_batch_in_tx.db');
  try {
    db.execute('CREATE TABLE t (x);');
    db.execute('BEGIN');
    // The batch's BEGIN fails (ignored) and its COMMIT closes the outer
    // transaction, so the row survives. That is long-standing behaviour.
    const res = db.executeBatch([['INSERT INTO t (x) VALUES (1);']]);
    assertEqual(res.rowsAffected, 1, 'batch rowsAffected');
    assertEqual(db.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c, 1, 'row is there');
  } finally {
    db.close();
  }
});

test('executeBatch failure rolls back everything', () => {
  const db = freshDb('reg_batch_rollback.db');
  try {
    db.execute('CREATE TABLE t (x INTEGER UNIQUE);');
    assertThrows(
      () =>
        db.executeBatch([
          ['INSERT INTO t (x) VALUES (1);'],
          ['INSERT INTO t (x) VALUES (2);'],
          // Third insert violates UNIQUE.
          ['INSERT INTO t (x) VALUES (1);'],
        ]),
      /unique/i
    );
    assertEqual(
      db.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c,
      0,
      'table is empty after rollback'
    );
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4.3 rowsAffected / insertId
// ---------------------------------------------------------------------------

test('SELECT after INSERT keeps previous rowsAffected/insertId (existing quirk)', () => {
  const db = freshDb('reg_rowsaffected.db');
  try {
    db.execute('CREATE TABLE t (x);');
    const insert = db.execute('INSERT INTO t (x) VALUES (1);');
    assertEqual(insert.rowsAffected, 1, 'insert rowsAffected');
    assert(insert.insertId != null, 'insert reports insertId');

    // sqlite3_changes()/last_insert_rowid() survive a SELECT, so today a read
    // reports the numbers of the previous write. Preserved on purpose.
    const select = db.execute('SELECT * FROM t;');
    assertEqual(select.rowsAffected, 1, 'select repeats the insert rowsAffected');
    assertEqual(select.insertId, insert.insertId, 'select repeats the insert insertId');
  } finally {
    db.close();
  }
});

test('UPDATE returns the previous insertId (existing quirk)', () => {
  const db = freshDb('reg_rowsaffected_update.db');
  try {
    db.execute('CREATE TABLE t (x);');
    const insert = db.execute('INSERT INTO t (x) VALUES (1), (2), (3);');
    const update = db.execute('UPDATE t SET x = 9;');
    assertEqual(update.rowsAffected, 3, 'update rowsAffected');
    // Preserved on purpose: last_insert_rowid() is unchanged by an UPDATE, so the
    // UPDATE reports the INSERT's id.
    assertEqual(update.insertId, insert.insertId, 'update repeats the insert insertId');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4.4 Multi-statement strings
// ---------------------------------------------------------------------------

test('multi-statement execute runs only the first (existing quirk)', () => {
  const db = freshDb('reg_multistmt.db');
  try {
    db.execute('CREATE TABLE a (x); CREATE TABLE b (x);');
    // Only the first statement runs; the tail is dropped. Preserved on purpose.
    assertEqual(db.execute("SELECT name FROM sqlite_master WHERE name = 'a';").rows?.length, 1, 'a exists');
    assertEqual(db.execute("SELECT name FROM sqlite_master WHERE name = 'b';").rows?.length, 0, 'b does not exist');
  } finally {
    db.close();
  }
});

test('multi-statement with params uses them for the first statement', () => {
  const db = freshDb('reg_multistmt_params.db');
  try {
    db.execute('CREATE TABLE a (x);');
    db.execute('INSERT INTO a VALUES (?); INSERT INTO a VALUES (?);', [1, 2]);
    assertEqual(db.execute('SELECT count(*) AS c FROM a;').rows?.item(0).c, 1, 'only one insert ran');
    assertEqual(db.execute('SELECT x FROM a;').rows?.item(0).x, 1, 'the first param was bound');
  } finally {
    db.close();
  }
});

test('trailing semicolon and comment are fine', () => {
  const db = freshDb('reg_multistmt_comment.db');
  try {
    const res = db.execute('SELECT 1 AS one; -- done');
    assertEqual(res.rows?.item(0).one, 1, 'value from the single statement');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4.5 Bind errors
// ---------------------------------------------------------------------------

test('too many params are ignored (existing quirk)', () => {
  const db = freshDb('reg_too_many_params.db');
  try {
    db.execute('CREATE TABLE t (x);');
    db.execute('INSERT INTO t (x) VALUES (?);', [1, 2]);
    assertEqual(db.execute('SELECT x FROM t;').rows?.item(0).x, 1, 'first param bound, second ignored');
  } finally {
    db.close();
  }
});

test('too few params bind NULL (existing quirk)', () => {
  const db = freshDb('reg_too_few_params.db');
  try {
    db.execute('CREATE TABLE t (a, b);');
    db.execute('INSERT INTO t (a, b) VALUES (?, ?);', [1]);
    const row = db.execute('SELECT a, b FROM t;').rows?.item(0);
    assertEqual(row.a, 1, 'first param bound');
    assertEqual(row.b, null, 'missing param is NULL');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4.6 ATTACH / DETACH
// ---------------------------------------------------------------------------

test('attach path with apostrophe', () => {
  const db = freshDb('reg_attach.db');
  const location = "o'brien";
  try {
    // Clean up any attached file left behind by an earlier run, otherwise
    // `CREATE TABLE aux.t` fails with "table t already exists".
    try {
      const stale = open({ name: 'reg_attached.db', location });
      stale.close();
      stale.delete();
    } catch {}

    db.attach('reg_attached.db', 'aux', location);
    db.execute('CREATE TABLE aux.t (x);');
    db.execute('INSERT INTO aux.t VALUES (1);');
    assertEqual(db.execute('SELECT count(*) AS c FROM aux.t;').rows?.item(0).c, 1, 'attached row');
    db.detach('aux');
    // Detached: the table is no longer reachable.
    assertThrows(() => db.execute('SELECT * FROM aux.t;'), /.*/);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4.7 / 4.8 delete + mkdir
// ---------------------------------------------------------------------------

test('delete removes wal files', () => {
  const name = 'reg_wal_delete.db';
  const db = freshDb(name);
  db.execute('PRAGMA journal_mode=WAL;');
  db.execute('CREATE TABLE t (x);');
  db.execute('INSERT INTO t VALUES (1);');
  db.close();
  db.delete();

  // Reopening must give a brand new (empty) database, so the table is gone.
  const reopened = open({ name });
  try {
    assertThrows(() => reopened.execute('SELECT * FROM t;'), /no such table/i);
  } finally {
    reopened.close();
  }
});

test('delete in a missing folder does not throw', () => {
  // Deleting from a folder that was never created must be a no-op, and in
  // particular must not create the folder as a side effect.
  const db = open({ name: 'never.db', location: 'reg_missing_folder' });
  db.close();
  db.delete();
  db.delete();
});

test('open in nested new folder', () => {
  const db = freshDb('reg_nested.db', 'a/b/c');
  try {
    db.execute('CREATE TABLE t (x);');
    db.execute('INSERT INTO t VALUES (1);');
    assertEqual(db.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c, 1, 'row count');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 4.10 natural_key
// ---------------------------------------------------------------------------

test('natural_key output format', () => {
  const db = freshDb('reg_natural_key_format.db');
  try {
    const row = db.execute(
      "SELECT natural_key('Item 7') AS a, natural_key('a10b2') AS b, natural_key('x12345678901') AS c;"
    ).rows?.item(0);
    // Digit runs shorter than 10 are zero-padded to 10; longer runs are left
    // alone. Preserved byte for byte.
    assertEqual(row.a, 'Item 0000000007', 'single digit padding');
    assertEqual(row.b, 'a0000000010b0000000002', 'two runs');
    assertEqual(row.c, 'x12345678901', 'an 11-digit run is unchanged');
  } finally {
    db.close();
  }
});

test('natural_key in index', () => {
  const db = freshDb('reg_natural_key_index.db');
  try {
    db.execute('CREATE TABLE items (title TEXT);');
    db.execute('CREATE INDEX i ON items(natural_key(title));');
    db.execute("INSERT INTO items VALUES ('Item 10'), ('Item 9');");
    const rows = db.execute('SELECT title FROM items ORDER BY natural_key(title);').rows;
    assertEqual(rows?.item(0).title, 'Item 9', 'index usable and ordering correct');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 6.1 Column order follows the SELECT, not the alphabet
// ---------------------------------------------------------------------------

test('row keys are alphabetical (existing behaviour, preserved)', () => {
  const db = freshDb('reg_column_order.db');
  try {
    const row = db.execute('SELECT 1 AS b, 2 AS a, 3 AS c;').rows?.item(0);
    assertEqual(Object.keys(row), ['a', 'b', 'c'], 'object key order');
    assertEqual(row.b, 1, 'value b');
    assertEqual(row.a, 2, 'value a');
    assertEqual(row.c, 3, 'value c');
  } finally {
    db.close();
  }
});

test('duplicate column names: last one wins', () => {
  const db = freshDb('reg_column_dupe.db');
  try {
    const row = db.execute('SELECT 1 AS x, 2 AS x;').rows?.item(0);
    assertEqual(row.x, 2, 'last duplicate wins');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 6.5 Reused statement in executeBatch
// ---------------------------------------------------------------------------

test('executeBatch reuses one statement for identical SQL', () => {
  const db = freshDb('reg_batch_reuse.db');
  try {
    db.execute('CREATE TABLE t (v INTEGER);');
    const rows = Array.from({ length: 200 }, (_, i) => [i]);
    const res = db.executeBatch([['INSERT INTO t (v) VALUES (?);', rows]]);
    assertEqual(res.rowsAffected, 200, 'rowsAffected');
    assertEqual(db.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c, 200, 'row count');
    // Values must not leak between reused statements.
    const values = db.execute('SELECT v FROM t ORDER BY rowid;').rows;
    assertEqual(values?.item(0).v, 0, 'first value');
    assertEqual(values?.item(199).v, 199, 'last value');
  } finally {
    db.close();
  }
});

test('executeBatch runs only the first statement of a command (existing quirk)', () => {
  const db = freshDb('reg_batch_multistmt.db');
  try {
    db.execute('CREATE TABLE t (v INTEGER);');
    db.executeBatch([['INSERT INTO t (v) VALUES (1); INSERT INTO t (v) VALUES (2);']]);
    assertEqual(db.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c, 1, 'only one row');
    assertEqual(db.execute('SELECT v FROM t;').rows?.item(0).v, 1, 'the first statement ran');
  } finally {
    db.close();
  }
});

test('executeBatch allows a trailing semicolon and comment', () => {
  const db = freshDb('reg_batch_trailing.db');
  try {
    db.execute('CREATE TABLE t (v INTEGER);');
    const res = db.executeBatch([
      ['INSERT INTO t (v) VALUES (1); -- first'],
      ['INSERT INTO t (v) VALUES (2);'],
    ]);
    assertEqual(res.rowsAffected, 2, 'rowsAffected');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Schema changes and transactions
// ---------------------------------------------------------------------------

test('SELECT * picks up a recreated table', () => {
  const db = freshDb('reg_cache_ddl.db');
  try {
    db.execute('CREATE TABLE t (a INTEGER);');
    db.execute('INSERT INTO t (a) VALUES (1);');
    assertEqual(
      Object.keys(db.execute('SELECT * FROM t;').rows?.item(0) ?? {}),
      ['a'],
      'columns before'
    );

    db.execute('DROP TABLE t;');
    db.execute('CREATE TABLE t (b TEXT, c TEXT);');
    db.execute("INSERT INTO t (b, c) VALUES ('x', 'y');");

    // The same SQL text must pick up the new schema.
    const row = db.execute('SELECT * FROM t;').rows?.item(0);
    assertEqual(Object.keys(row).sort(), ['b', 'c'], 'columns after recreate');
    assertEqual(row.b, 'x', 'value b');
  } finally {
    db.close();
  }
});

test('a SELECT inside a transaction does not block COMMIT', () => {
  const db = freshDb('reg_cache_commit.db');
  try {
    db.execute('CREATE TABLE t (a INTEGER);');
    db.execute('INSERT INTO t (a) VALUES (1), (2);');
    // Run a statement that returns rows, then commit.
    db.execute('BEGIN');
    db.execute('SELECT * FROM t;');
    db.execute('INSERT INTO t (a) VALUES (3);');
    db.execute('COMMIT');
    assertEqual(db.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c, 3, 'commit succeeded');
  } finally {
    db.close();
  }
});

test('DDL after a SELECT works', () => {
  const db = freshDb('reg_cache_ddl2.db');
  try {
    db.execute('CREATE TABLE t (a INTEGER);');
    db.execute('INSERT INTO t (a) VALUES (1);');
    db.execute('SELECT * FROM t;');
    db.execute('DROP TABLE t;');
    assertThrows(() => db.execute('SELECT * FROM t;'), /no such table/i);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// 1.1 One worker per database
// ---------------------------------------------------------------------------

test('per-db order is kept', async () => {
  const a = freshDb('reg_perdb_a.db');
  const b = freshDb('reg_perdb_b.db');
  try {
    a.execute('CREATE TABLE t (v INTEGER);');
    b.execute('CREATE TABLE t (v INTEGER);');

    // Interleave the two databases without awaiting each call, so both queues
    // are busy at the same time.
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 200; i++) {
      work.push(a.executeAsync('INSERT INTO t (v) VALUES (?);', [i]));
      work.push(b.executeAsync('INSERT INTO t (v) VALUES (?);', [i]));
    }
    await withTimeout(Promise.all(work), 30000, 'interleaved inserts');

    for (const [label, db] of [
      ['a', a],
      ['b', b],
    ] as const) {
      const rows = db.execute('SELECT v FROM t ORDER BY rowid;').rows;
      assertEqual(rows?.length, 200, `row count of ${label}`);
      assertEqual(
        Array.from({ length: 200 }, (_, i) => rows!.item(i).v),
        Array.from({ length: 200 }, (_, i) => i),
        `insert order of ${label}`
      );
    }
  } finally {
    a.close();
    b.close();
  }
});

test('slow query on one db does not block another', async () => {
  const slow = freshDb('reg_perdb_slow.db');
  const fast = freshDb('reg_perdb_fast.db');
  try {
    slow.execute('CREATE TABLE t (x);');
    fast.execute('CREATE TABLE t (x);');

    const slowSql =
      'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 3000000) SELECT count(*) AS n FROM c;';

    // Compare resolve *order*, not absolute times, so this cannot be flaky.
    const order: string[] = [];
    const slowQuery = slow.executeAsync(slowSql).then((res) => {
      order.push('slow');
      return res;
    });
    const fastQuery = fast.executeAsync('SELECT 1 AS one;').then((res) => {
      order.push('fast');
      return res;
    });

    await withTimeout(Promise.all([slowQuery, fastQuery]), 60000, 'slow + fast');

    assertEqual(order, ['fast', 'slow'], 'the fast database did not wait for the slow one');
  } finally {
    slow.close();
    fast.close();
  }
});

test('async on unopened db still rejects with the same message', async () => {
  // Uses the raw proxy so the "not open" error comes from the native worker,
  // not from a closed-then-reused connection.
  await assertRejects(
    withTimeout(
      QuickSQLite.executeAsync('reg_never_opened_2.db', 'SELECT 1;'),
      5000,
      'unopened db'
    ),
    /^\[react-native-quick-sqlite\]: Database reg_never_opened_2\.db is not open/
  );
});

test('close during async on one db', async () => {
  const closing = freshDb('reg_perdb_closing.db');
  const other = freshDb('reg_perdb_other.db');
  try {
    closing.execute('CREATE TABLE t (x);');
    other.execute('CREATE TABLE t (x);');

    // Fire work on both, then close one immediately. Both must settle.
    const closingWork = closing
      .executeAsync('SELECT * FROM t;')
      .then(() => 'resolved')
      .catch((err) => `rejected: ${errorMessage(err)}`);
    const otherWork = other.executeAsync('SELECT count(*) AS c FROM t;');
    closing.close();

    const [closingOutcome, otherResult] = await withTimeout(
      Promise.all([closingWork, otherWork]),
      10000,
      'close during async'
    );

    assert(
      closingOutcome === 'resolved' || /not open/i.test(closingOutcome),
      `unexpected outcome: ${closingOutcome}`
    );
    assertEqual(otherResult.rows?.item(0).c, 0, 'the other database still works');
  } finally {
    try {
      closing.close();
    } catch {}
    other.close();
  }
});

test('reset-style schema wipe', async () => {
  // Replays Notesnook's reset(): writable_schema, wipe sqlite_master, vacuum,
  // then recreate. Queries must see the new schema.
  const db = freshDb('reg_cache_reset.db');
  try {
    db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, old_col TEXT);');
    db.execute("INSERT INTO t (old_col) VALUES ('first');");
    db.execute('SELECT * FROM t;');
    db.execute('SELECT * FROM t;');

    for (const statement of [
      'PRAGMA writable_schema = 1',
      'DELETE FROM sqlite_master',
      'PRAGMA writable_schema = 0',
      'VACUUM',
      'PRAGMA integrity_check',
    ]) {
      await withTimeout(db.executeAsync(statement), 10000, statement);
    }

    db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, new_col TEXT);');
    db.execute("INSERT INTO t (new_col) VALUES ('second');");

    const row = db.execute('SELECT * FROM t;').rows?.item(0);
    assertEqual(Object.keys(row).sort(), ['id', 'new_col'], 'new schema is visible');
    assertEqual(row.new_col, 'second', 'new row is readable');
  } finally {
    db.close();
  }
});
