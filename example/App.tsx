import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QuickSQLite, open } from 'react-native-quick-sqlite';

interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
  durationMs?: number;
}

export default function App() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  const runTests = async () => {
    setRunning(true);
    const testResults: TestResult[] = [];

    const runTest = async (name: string, fn: () => Promise<void> | void) => {
      const start = Date.now();
      try {
        await fn();
        testResults.push({
          name,
          passed: true,
          durationMs: Date.now() - start,
        });
      } catch (err: any) {
        testResults.push({
          name,
          passed: false,
          message: err?.message || String(err),
          durationMs: Date.now() - start,
        });
      }
    };

    // Test 1: Basic DB Open, Create Table & Insert
    await runTest('Basic SQLite: Open & Insert', () => {
      const db = open({ name: 'basic_test.db' });
      db.execute('DROP TABLE IF EXISTS users;');
      db.execute(
        'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT);'
      );
      const insertRes = db.execute(
        'INSERT INTO users (name, email) VALUES (?, ?);',
        ['Alice', 'alice@notesnook.com']
      );
      if (insertRes.rowsAffected !== 1) {
        throw new Error(`Expected 1 row affected, got ${insertRes.rowsAffected}`);
      }
      const selectRes = db.execute('SELECT * FROM users WHERE name = ?;', ['Alice']);
      if (!selectRes.rows || selectRes.rows.length !== 1) {
        throw new Error('Failed to query inserted row');
      }
      if (selectRes.rows.item(0).email !== 'alice@notesnook.com') {
        throw new Error('Retrieved data does not match inserted values');
      }
      db.close();
    });

    // Test 2: Transactions and Batch Execution
    await runTest('Transactions & Batch Execution', async () => {
      const db = open({ name: 'tx_test.db' });
      db.execute('DROP TABLE IF EXISTS items;');
      db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);');

      await db.transaction((tx) => {
        tx.execute('INSERT INTO items (title) VALUES (?);', ['Item 1']);
        tx.execute('INSERT INTO items (title) VALUES (?);', ['Item 2']);
      });

      const countRes = db.execute('SELECT COUNT(*) as count FROM items;');
      if (countRes.rows?.item(0).count !== 2) {
        throw new Error('Transaction commit did not persist items');
      }
      db.close();
    });

    // Test 3: SQLite3 Multiple Ciphers Encryption (PRAGMA key)
    await runTest('SQLite3 Multiple Ciphers Encryption', () => {
      const encDbName = 'encrypted_test.db';
      const key = 'notesnook_secure_key_123';

      // Clean up previous test database if present
      try {
        const cleanup = open({ name: encDbName });
        cleanup.close();
        cleanup.delete();
      } catch {}

      // Create encrypted database
      const db = open({ name: encDbName });
      db.execute(`PRAGMA key = '${key}';`);
      db.execute('DROP TABLE IF EXISTS secrets;');
      db.execute('CREATE TABLE secrets (id INTEGER PRIMARY KEY, secret TEXT);');
      db.execute('INSERT INTO secrets (secret) VALUES (?);', ['Top Secret Note']);
      db.close();

      // Reopen with correct key
      const dbAuth = open({ name: encDbName });
      dbAuth.execute(`PRAGMA key = '${key}';`);
      const authRes = dbAuth.execute('SELECT * FROM secrets;');
      if (!authRes.rows || authRes.rows.length !== 1) {
        throw new Error('Failed to read from encrypted database with valid key');
      }
      dbAuth.close();

      // Open with invalid key should fail when querying
      let wrongKeyFailed = false;
      try {
        const dbWrong = open({ name: encDbName });
        dbWrong.execute("PRAGMA key = 'wrong_password';");
        dbWrong.execute('SELECT * FROM secrets;');
        dbWrong.close();
      } catch {
        wrongKeyFailed = true;
      }

      if (!wrongKeyFailed) {
        throw new Error('Query succeeded with wrong key; expected decryption failure');
      }
    });

    // Test 4: FTS5 with better_trigram Tokenizer
    await runTest('FTS5 better_trigram Tokenizer', () => {
      const db = open({ name: 'fts_trigram_test.db' });
      db.execute('DROP TABLE IF EXISTS notes_trigram;');
      db.execute(
        "CREATE VIRTUAL TABLE notes_trigram USING fts5(content, tokenize = 'better_trigram');"
      );
      db.execute(
        'INSERT INTO notes_trigram (content) VALUES (?);',
        ['React Native Quick SQLite on Android and iOS']
      );
      db.execute(
        'INSERT INTO notes_trigram (content) VALUES (?);',
        ['Notesnook encrypted note-taking application']
      );

      const searchRes = db.execute(
        'SELECT * FROM notes_trigram WHERE notes_trigram MATCH ?;',
        ['Notesnook']
      );
      if (!searchRes.rows || searchRes.rows.length !== 1) {
        throw new Error('better_trigram FTS5 search failed to return expected result');
      }
      db.close();
    });

    // Test 5: FTS5 with sqlite3-fts5-html (Lexbor) Tokenizer
    await runTest('FTS5 html (Lexbor) Tokenizer', () => {
      const db = open({ name: 'fts_html_test.db' });
      db.execute('DROP TABLE IF EXISTS notes_html;');
      // html is a wrapper tokenizer that strips HTML and passes text to an inner tokenizer (e.g. unicode61)
      db.execute(
        "CREATE VIRTUAL TABLE notes_html USING fts5(content, tokenize = 'html unicode61');"
      );

      const htmlContent =
        '<div class="note"><p>Meeting with <b>Engineering Team</b> about <i>encryption</i></p></div>';
      db.execute('INSERT INTO notes_html (content) VALUES (?);', [htmlContent]);

      // Search for text inside tags
      const matchRes = db.execute(
        'SELECT * FROM notes_html WHERE notes_html MATCH ?;',
        ['Engineering']
      );
      if (!matchRes.rows || matchRes.rows.length !== 1) {
        throw new Error('fts5-html failed to match text stripped of HTML tags');
      }

      // Search for HTML tags themselves should NOT match
      const tagSearch = db.execute(
        'SELECT * FROM notes_html WHERE notes_html MATCH ?;',
        ['div']
      );
      if (tagSearch.rows && tagSearch.rows.length > 0) {
        throw new Error('HTML tags should have been stripped and not indexed');
      }
      db.close();
    });

    setResults(testResults);
    setRunning(false);
  };

  useEffect(() => {
    runTests();
  }, []);

  const totalPassed = results.filter((r) => r.passed).length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>react-native-quick-sqlite</Text>
        <Text style={styles.subtitle}>Test Runner (RN 0.82.1)</Text>
      </View>

      <View style={styles.statsContainer}>
        <Text style={styles.statsText}>
          {running
            ? 'Running tests...'
            : `${totalPassed} / ${results.length} Tests Passed`}
        </Text>
        <TouchableOpacity
          style={[styles.button, running && styles.buttonDisabled]}
          disabled={running}
          onPress={runTests}
        >
          <Text style={styles.buttonText}>Re-run Tests</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list}>
        {results.map((res, idx) => (
          <View
            key={idx}
            style={[
              styles.card,
              res.passed ? styles.cardPassed : styles.cardFailed,
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardIcon}>{res.passed ? '✅' : '❌'}</Text>
              <Text style={styles.cardTitle}>{res.name}</Text>
              {res.durationMs != null && (
                <Text style={styles.cardDuration}>{res.durationMs}ms</Text>
              )}
            </View>
            {!res.passed && res.message && (
              <Text style={styles.errorText}>{res.message}</Text>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#1e293b',
  },
  statsText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  list: {
    flex: 1,
    padding: 16,
  },
  card: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  cardPassed: {
    backgroundColor: '#064e3b22',
    borderColor: '#059669',
  },
  cardFailed: {
    backgroundColor: '#7f1d1d22',
    borderColor: '#dc2626',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#f1f5f9',
  },
  cardDuration: {
    fontSize: 12,
    color: '#64748b',
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    color: '#fca5a5',
    fontFamily: 'monospace',
  },
});
