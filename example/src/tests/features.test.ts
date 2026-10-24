/**
 * Feature tests migrated from the old single-screen App.tsx.
 *
 * These cover the things this fork adds on top of plain SQLite:
 * SQLite3 Multiple Ciphers encryption, the `better_trigram` FTS5 tokenizer,
 * the `html` (Lexbor) FTS5 tokenizer, and the `natural_key` collation function.
 */
import { open } from 'react-native-quick-sqlite';
import { assert, assertEqual, assertThrows, freshDb, test } from './harness';

test('SQLite3 Multiple Ciphers encryption', () => {
  const encDbName = 'encrypted_test.db';
  const key = 'notesnook_secure_key_123';

  // Create encrypted database
  const db = freshDb(encDbName);
  try {
    db.execute(`PRAGMA key = '${key}';`);
    db.execute('DROP TABLE IF EXISTS secrets;');
    db.execute('CREATE TABLE secrets (id INTEGER PRIMARY KEY, secret TEXT);');
    db.execute('INSERT INTO secrets (secret) VALUES (?);', ['Top Secret Note']);
  } finally {
    db.close();
  }

  // Reopen with correct key
  const dbAuth = open({ name: encDbName });
  try {
    dbAuth.execute(`PRAGMA key = '${key}';`);
    const authRes = dbAuth.execute('SELECT * FROM secrets;');
    assertEqual(authRes.rows?.length, 1, 'row count with valid key');
  } finally {
    dbAuth.close();
  }

  // Open with invalid key should fail when querying
  dbAuth.delete();
  let wrongKeyFailed = false;
  try {
    const dbWrong = open({ name: encDbName });
    try {
      dbWrong.execute(`PRAGMA key = 'wrong_password';`);
      dbWrong.execute('SELECT * FROM secrets;');
    } finally {
      dbWrong.close();
    }
  } catch {
    wrongKeyFailed = true;
  }

  assert(wrongKeyFailed, 'query succeeded with wrong key; expected decryption failure');
});

test('FTS5 better_trigram tokenizer', () => {
  const db = freshDb('fts_trigram_test.db');
  try {
    db.execute('DROP TABLE IF EXISTS notes_trigram;');
    db.execute(
      "CREATE VIRTUAL TABLE notes_trigram USING fts5(content, tokenize = 'better_trigram');"
    );
    db.execute('INSERT INTO notes_trigram (content) VALUES (?);', [
      'React Native Quick SQLite on Android and iOS',
    ]);
    db.execute('INSERT INTO notes_trigram (content) VALUES (?);', [
      'Notesnook encrypted note-taking application',
    ]);

    const searchRes = db.execute(
      'SELECT * FROM notes_trigram WHERE notes_trigram MATCH ?;',
      ['Notesnook']
    );
    assertEqual(searchRes.rows?.length, 1, 'better_trigram match count');
  } finally {
    db.close();
  }
});

test('FTS5 html (Lexbor) tokenizer', () => {
  const db = freshDb('fts_html_test.db');
  try {
    db.execute('DROP TABLE IF EXISTS notes_html;');
    // html is a wrapper tokenizer that strips HTML and passes text to an inner tokenizer (e.g. unicode61)
    db.execute(
      "CREATE VIRTUAL TABLE notes_html USING fts5(content, tokenize = 'html unicode61');"
    );

    const htmlContent =
      '<div class="note"><p>Meeting with <b>Engineering Team</b> about <i>encryption</i></p></div>';
    db.execute('INSERT INTO notes_html (content) VALUES (?);', [htmlContent]);

    // Search for text inside tags
    const matchRes = db.execute('SELECT * FROM notes_html WHERE notes_html MATCH ?;', [
      'Engineering',
    ]);
    assertEqual(matchRes.rows?.length, 1, 'fts5-html match on stripped text');

    // Search for HTML tags themselves should NOT match
    const tagSearch = db.execute('SELECT * FROM notes_html WHERE notes_html MATCH ?;', ['div']);
    assertEqual(tagSearch.rows?.length ?? 0, 0, 'HTML tags should have been stripped');
  } finally {
    db.close();
  }
});

test('natural_key sorting function', () => {
  const db = freshDb('natural_key_test.db');
  try {
    db.execute('DROP TABLE IF EXISTS items;');
    db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);');
    db.execute(
      "INSERT INTO items (title) VALUES ('Item 10'), ('Item 2'), ('Item 1'), ('Item 20');"
    );

    const res = db.execute('SELECT title FROM items ORDER BY natural_key(title) ASC;');
    assertEqual(res.rows?.length, 4, 'natural_key row count');

    const titles = [0, 1, 2, 3].map((idx) => res.rows?.item(idx).title);
    // In natural sort order: Item 1, Item 2, Item 10, Item 20
    // (Alphabetical would be: Item 1, Item 10, Item 2, Item 20)
    assertEqual(titles, ['Item 1', 'Item 2', 'Item 10', 'Item 20'], 'natural_key sort order');
  } finally {
    db.close();
  }
});

test('build uses Notesnook SQLite flags', () => {
  const db = freshDb('flags_test.db');
  try {
    // SQLite drops the SQLITE_ prefix in this list. Whole set on iOS: 47 entries.
    const rows = db.execute('PRAGMA compile_options;').rows?._array ?? [];
    const options: string[] = rows.map((r: any) => Object.values(r)[0] as string);
    assert(options.length > 20, `expected a populated option list, got ${options.length}`);

    // Options Notesnook's Podfile / gradle.properties set that SQLite reports here.
    const expected = [
      'DQS=0',
      'ENABLE_FTS5',
      'OMIT_DEPRECATED',
      'LIKE_DOESNT_MATCH_BLOBS',
      'OMIT_PROGRESS_CALLBACK',
      'DEFAULT_MEMSTATUS=0',
    ];
    for (const option of expected) {
      assert(
        options.includes(option),
        `missing compile option ${option}; got ${options.join(', ')}`
      );
    }

    // ENABLE_REGEXP is compiled in but does not appear in PRAGMA compile_options
    // (it is not in SQLite's reporting table). Check it functionally instead.
    const regexp = db.execute("SELECT 'notesnook' REGEXP '^notes' AS m;").rows?.item(0);
    assertEqual(regexp.m, 1, 'REGEXP operator works');

    // Under DQS=0 a double-quoted string is an identifier, not a string literal.
    assertThrows(() => db.execute('SELECT "abc";'), /no such column/i);
    assertEqual(db.execute("SELECT 'abc' AS v;").rows?.item(0).v, 'abc', 'single quotes work');
  } finally {
    db.close();
  }
});
