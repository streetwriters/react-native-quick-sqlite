/**
 * Core SQLite smoke tests: open/close, inserts, transactions, batches.
 */
import { assertEqual, assertThrows, freshDb, test, withTimeout } from './harness';

test('basic open, create table & insert', () => {
  const db = freshDb('basic_test.db');
  try {
    db.execute('DROP TABLE IF EXISTS users;');
    db.execute(
      'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT);'
    );
    const insertRes = db.execute('INSERT INTO users (name, email) VALUES (?, ?);', [
      'Alice',
      'alice@notesnook.com',
    ]);
    assertEqual(insertRes.rowsAffected, 1, 'rowsAffected of single insert');

    const selectRes = db.execute('SELECT * FROM users WHERE name = ?;', ['Alice']);
    assertEqual(selectRes.rows?.length, 1, 'row count of select');
    assertEqual(selectRes.rows?.item(0).email, 'alice@notesnook.com', 'selected email');
  } finally {
    db.close();
  }
});

test('transactions persist on commit', async () => {
  const db = freshDb('tx_test.db');
  try {
    db.execute('DROP TABLE IF EXISTS items;');
    db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);');

    await withTimeout(
      db.transaction(async (tx) => {
        tx.execute('INSERT INTO items (title) VALUES (?);', ['Item 1']);
        tx.execute('INSERT INTO items (title) VALUES (?);', ['Item 2']);
      }),
      5000,
      'transaction'
    );

    const countRes = db.execute('SELECT COUNT(*) as count FROM items;');
    assertEqual(countRes.rows?.item(0).count, 2, 'row count after commit');
  } finally {
    db.close();
  }
});

test('transaction rolls back on throw', async () => {
  const db = freshDb('tx_rollback_test.db');
  try {
    db.execute('DROP TABLE IF EXISTS items;');
    db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);');

    let threw = false;
    try {
      await withTimeout(
        db.transaction(async (tx) => {
          tx.execute('INSERT INTO items (title) VALUES (?);', ['Item 1']);
          throw new Error('boom');
        }),
        5000,
        'transaction rollback'
      );
    } catch {
      threw = true;
    }
    assertEqual(threw, true, 'transaction should reject');

    const countRes = db.execute('SELECT COUNT(*) as count FROM items;');
    assertEqual(countRes.rows?.item(0).count, 0, 'row count after rollback');
  } finally {
    db.close();
  }
});

test('executeBatch inserts rows in a transaction', () => {
  const db = freshDb('batch_test.db');
  try {
    db.execute('DROP TABLE IF EXISTS items;');
    db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);');

    const res = db.executeBatch([
      ['INSERT INTO items (title) VALUES (?);', [['a'], ['b'], ['c']]],
    ]);
    assertEqual(res.rowsAffected, 3, 'rowsAffected of batch');

    const countRes = db.execute('SELECT COUNT(*) as count FROM items;');
    assertEqual(countRes.rows?.item(0).count, 3, 'row count after batch');
  } finally {
    db.close();
  }
});

test('close then execute throws', () => {
  const db = freshDb('close_test.db');
  db.execute('CREATE TABLE IF NOT EXISTS t (x);');
  db.close();
  assertThrows(() => db.execute('SELECT 1;'), /not open/i);
});
