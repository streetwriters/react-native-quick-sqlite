/**
 * Behaviour-lock tests.
 *
 * These record what the library does today, including its quirks, so that later
 * changes cannot alter it by accident. Where a test in `regressions.test.ts`
 * asserts a bug was fixed, these assert the intentionally preserved behaviour.
 *
 * Rule: never edit these to make a change pass. If one breaks, the change is
 * wrong.
 */
import { QuickSQLite, open } from 'react-native-quick-sqlite';
import { assert, assertEqual, assertThrows, freshDb, test } from './harness';

test('lock: multi-statement execute runs only the first', () => {
  const db = freshDb('lock_multistmt.db');
  try {
    db.execute('CREATE TABLE a(x); CREATE TABLE b(x);');
    assertEqual(
      db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'a';").rows?.length,
      1,
      'a exists'
    );
    assertEqual(
      db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'b';").rows?.length,
      0,
      'b does not exist'
    );
  } finally {
    db.close();
  }
});

test('lock: row keys are alphabetical', () => {
  const db = freshDb('lock_key_order.db');
  try {
    const row = db.execute('SELECT 1 AS b, 2 AS a, 3 AS c;').rows?.item(0);
    assertEqual(Object.keys(row), ['a', 'b', 'c'], 'key order');
  } finally {
    db.close();
  }
});

test('lock: duplicate column names, last wins', () => {
  const db = freshDb('lock_dupes.db');
  try {
    const row = db.execute('SELECT 1 AS x, 2 AS x;').rows?.item(0);
    assertEqual(row.x, 2, 'last duplicate wins');
  } finally {
    db.close();
  }
});

test('lock: SELECT after INSERT keeps the previous rowsAffected/insertId', () => {
  const db = freshDb('lock_stale_meta.db');
  try {
    db.execute('CREATE TABLE t (x);');
    const insert = db.execute('INSERT INTO t (x) VALUES (1);');
    const select = db.execute('SELECT * FROM t;');
    assertEqual(select.rowsAffected, insert.rowsAffected, 'rowsAffected carried over');
    assertEqual(select.insertId, insert.insertId, 'insertId carried over');
  } finally {
    db.close();
  }
});

test('lock: UPDATE returns the previous insertId', () => {
  const db = freshDb('lock_update_insertid.db');
  try {
    db.execute('CREATE TABLE t (x);');
    const insert = db.execute('INSERT INTO t (x) VALUES (1), (2);');
    const update = db.execute('UPDATE t SET x = 5 WHERE x = 1;');
    assertEqual(update.rowsAffected, 1, 'update rowsAffected');
    assertEqual(update.insertId, insert.insertId, 'stale insertId');
  } finally {
    db.close();
  }
});

test('lock: too few params bind NULL', () => {
  const db = freshDb('lock_few_params.db');
  try {
    db.execute('CREATE TABLE t (a, b);');
    db.execute('INSERT INTO t (a, b) VALUES (?, ?);', [1]);
    const row = db.execute('SELECT a, b FROM t;').rows?.item(0);
    assertEqual(row.b, null, 'missing param bound as NULL');
  } finally {
    db.close();
  }
});

test('lock: too many params are ignored', () => {
  const db = freshDb('lock_many_params.db');
  try {
    const res = db.execute('SELECT ? AS v;', [1, 2]);
    assertEqual(res.rows?.item(0).v, 1, 'first param wins, extra ignored');
  } finally {
    db.close();
  }
});

test('lock: unknown object param is skipped', () => {
  const db = freshDb('lock_object_param.db');
  try {
    const res = db.execute('SELECT ? AS a, ? AS b;', [{}, 'x']);
    const row = res.rows?.item(0);
    assertEqual(row.a, 'x', 'x shifted into ?1');
    assertEqual(row.b, null, '?2 left NULL');
  } finally {
    db.close();
  }
});

test('lock: integers and reals come back as numbers', () => {
  const db = freshDb('lock_number_types.db');
  try {
    const row = db.execute('SELECT 5 AS i, 1.5 AS r;').rows?.item(0);
    assertEqual(typeof row.i, 'number', 'integer type');
    assertEqual(row.i, 5, 'integer value');
    assertEqual(typeof row.r, 'number', 'real type');
    assertEqual(row.r, 1.5, 'real value');
  } finally {
    db.close();
  }
});

test('lock: natural_key output format', () => {
  const db = freshDb('lock_natural_key.db');
  try {
    const row = db.execute(
      "SELECT natural_key('Item 7') AS a, natural_key('a10b2') AS b, natural_key('x12345678901') AS c, natural_key('Item 10') AS d;"
    ).rows?.item(0);
    assertEqual(row.a, 'Item 0000000007', 'single digit padded to 10');
    assertEqual(row.b, 'a0000000010b0000000002', 'two digit runs');
    assertEqual(row.c, 'x12345678901', '11-digit run untouched');
    assertEqual(row.d, 'Item 0000000010', 'two digits padded');
  } finally {
    db.close();
  }
});

test('lock: executeAsync without params resolves through the wrapper', async () => {
  // The native host function still throws for a two-argument call, but
  // src/index.ts overwrites `QuickSQLite.executeAsync` on the same object with a
  // wrapper that always forwards three arguments, so the native check is never
  // reachable from JS. Lock the behaviour that is observable.
  const db = freshDb('lock_async_noparams.db');
  try {
    db.execute('CREATE TABLE t (x);');
    db.execute('INSERT INTO t VALUES (1);');
    const res = await db.executeAsync('SELECT * FROM t;');
    assertEqual(res.rows?.length, 1, 'resolved without params');
  } finally {
    db.close();
  }
});

test('lock: error message formats', () => {
  const db = freshDb('lock_errors.db');
  try {
    db.execute('CREATE TABLE t (x);');
    assertThrows(() => db.execute('NOSUCHFUNC(1);'), /^\[react-native-quick-sqlite\] SQL execution error:/);
  } finally {
    db.close();
  }
  assertThrows(
    () => QuickSQLite.execute('lock_never_opened.db', 'SELECT 1;'),
    /^\[react-native-quick-sqlite\]: Database lock_never_opened\.db is not open/
  );
});

test('lock: open same name twice, the second location wins', () => {
  const name = 'lock_relocate.db';
  try {
    const stale1 = open({ name, location: 'l1' });
    stale1.close();
    stale1.delete();
    const stale2 = open({ name, location: 'l2' });
    stale2.close();
    stale2.delete();
  } catch {}

  const first = open({ name, location: 'l1' });
  try {
    first.execute('CREATE TABLE x (v);');
    // Opening the same name in a different folder currently *replaces* the
    // connection, so the table created in l1 is not visible.
    const second = open({ name, location: 'l2' });
    try {
      assertThrows(() => second.execute('SELECT * FROM x;'), /no such table/i);
    } finally {
      second.close();
    }
  } finally {
    try {
      first.close();
    } catch {}
  }
});

test('lock: executeBatch inside an open transaction succeeds', () => {
  const db = freshDb('lock_batch_in_tx.db');
  try {
    db.execute('CREATE TABLE t (x);');
    db.execute('BEGIN');
    // The batch's BEGIN fails silently and its COMMIT closes the outer
    // transaction; the row survives. Preserved on purpose.
    const res = db.executeBatch([['INSERT INTO t (x) VALUES (1);']]);
    assertEqual(res.rowsAffected, 1, 'batch rowsAffected');
    assertEqual(db.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c, 1, 'row is there');
  } finally {
    db.close();
  }
});

test('lock: delete missing db does not throw', () => {
  const db = freshDb('lock_delete_missing.db');
  db.close();
  db.delete();
  db.delete();
});

test('lock: attach and detach work', () => {
  const db = freshDb('lock_attach.db');
  try {
    try {
      const stale = open({ name: 'lock_attached.db', location: 'plain' });
      stale.close();
      stale.delete();
    } catch {}
    db.attach('lock_attached.db', 'aux', 'plain');
    db.execute('CREATE TABLE aux.t (x);');
    db.execute('INSERT INTO aux.t VALUES (1);');
    assertEqual(db.execute('SELECT count(*) AS c FROM aux.t;').rows?.item(0).c, 1, 'attached row');
    db.detach('aux');
  } finally {
    db.close();
  }
});

test('lock: executeBatch rowsAffected ignores trigger changes', () => {
  const db = freshDb('lock_batch_affected.db');
  try {
    db.execute('CREATE TABLE t (x INTEGER);');
    db.execute('CREATE TABLE audit (n INTEGER);');
    // A trigger that inserts one row per insert. sqlite3_changes() after the
    // INSERT reports 1 (the outer statement only), while sqlite3_total_changes()
    // would report 2. The batch must keep reporting 1 per command.
    db.execute(
      'CREATE TRIGGER audit_t AFTER INSERT ON t BEGIN INSERT INTO audit (n) VALUES (1); END;'
    );
    const res = db.executeBatch([
      ['INSERT INTO t (x) VALUES (?);', [[1], [2], [3]]],
    ]);
    assertEqual(res.rowsAffected, 3, 'trigger rows are not counted');
    assertEqual(db.execute('SELECT count(*) AS c FROM audit;').rows?.item(0).c, 3, 'trigger fired');
  } finally {
    db.close();
  }
});

test('lock: executeBatch affectedRows ignores stale counts on non-changing commands', () => {
  const db = freshDb('lock_batch_stale.db');
  try {
    db.execute('CREATE TABLE t (x INTEGER);');
    // A CREATE contributes whatever sqlite3_changes() happens to hold; with a
    // fresh connection that is 0.
    const res = db.executeBatch([['CREATE TABLE u (y INTEGER);']]);
    assertEqual(res.rowsAffected, 0, 'CREATE alone reports 0');
  } finally {
    db.close();
  }
});

test('lock: executeBatch ignores bind errors', () => {
  const db = freshDb('lock_batch_bind.db');
  try {
    db.execute('CREATE TABLE t (a, b);');
    // Too many params: SQLITE_RANGE from the bind is ignored, and the missing
    // one binds NULL. The command still succeeds.
    const res = db.executeBatch([['INSERT INTO t (a, b) VALUES (?, ?);', [[1], [1, 2, 3]]]]);
    assertEqual(res.rowsAffected, 2, 'both inserts ran');
    const rows = db.execute('SELECT a, b FROM t ORDER BY rowid;').rows;
    assertEqual(rows?.item(0).a, 1, 'first row a');
    assertEqual(rows?.item(0).b, null, 'missing param is NULL');
    assertEqual(rows?.item(1).b, 2, 'extra param ignored');
  } finally {
    db.close();
  }
});

test('lock: batch on a missing db uses the old error text', () => {
  assertThrows(
    () => QuickSQLite.executeBatch('lock_batch_missing.db', [['SELECT 1;']]),
    /^\[react-native-quick-sqlite\]: Database lock_batch_missing\.db is not open/
  );
});

test('lock: sync execute error carries the JSError stack', () => {
  const db = freshDb('lock_execute_error.db');
  try {
    let message = '';
    try {
      db.execute('NOSUCHFUNC(1);');
    } catch (err: any) {
      message = err.message;
    }
    // The old code re-wrapped its own JSError from what(), which appends the
    // stack after a blank line; keep that shape.
    assert(message.startsWith('[react-native-quick-sqlite] SQL execution error:'), 'prefix');
    assert(message.includes('\n\n'), 'message still contains the stack separator');
  } finally {
    db.close();
  }
});

test('lock: open into an existing folder works', () => {
  // The folder exists before open; ensureDirectory must accept it without
  // needing to create it (and must not fail on an EACCES/EEXIST style result).
  const first = open({ name: 'lock_existing_folder.db', location: 'lock_existing' });
  first.execute('CREATE TABLE t (x);');
  first.close();
  first.delete();

  const second = open({ name: 'lock_existing_folder.db', location: 'lock_existing' });
  try {
    second.execute('CREATE TABLE t (x);');
    assertEqual(second.execute('SELECT count(*) AS c FROM t;').rows?.item(0).c, 0, 'table is empty');
  } finally {
    second.close();
    second.delete();
  }
});

test('lock: PRAGMA key can be issued repeatedly', () => {
  const db = freshDb('lock_pragma_key.db');
  try {
    db.execute("PRAGMA key = 'some_secret_key';");
    db.execute('CREATE TABLE s (v TEXT);');
    db.execute('INSERT INTO s (v) VALUES (?);', ['x']);
    assertEqual(db.execute('SELECT v FROM s;').rows?.item(0).v, 'x', 'cipher db still works');
    // Re-issuing it must also work.
    db.execute("PRAGMA key = 'some_secret_key';");
    assertEqual(db.execute('SELECT v FROM s;').rows?.item(0).v, 'x', 'still readable');
  } finally {
    db.close();
  }
});
