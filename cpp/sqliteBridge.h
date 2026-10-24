/*
 * sqliteBridge.h
 *
 * Created by Oscar Franco on 2021/03/07
 * Copyright (c) 2021 Oscar Franco
 *
 * This code is licensed under the MIT license
 */

#ifndef sqliteBridge_h
#define sqliteBridge_h

#include <functional>
#include <string>
#include <vector>

#include "DbRegistry.h"
#include "JSIHelper.h"
#include <sqlite3.h>

using namespace std;
using namespace facebook;

SQLiteOPResult sqliteOpenDb(string const dbName, string const docPath);

SQLiteOPResult sqliteCloseDb(string const dbName);

SQLiteOPResult sqliteRemoveDb(string const dbName, string const docPath);

SQLiteOPResult sqliteAttachDb(string const mainDBName, string const docPath, string const databaseToAttach, string const alias);

SQLiteOPResult sqliteDetachDb(string const mainDBName, string const alias);

SQLiteOPResult sqliteExecute(string const dbName, string const &query, vector<QuickValue> *values, QueryRows *result, vector<QuickColumnMetadata> *metadata);

SequelLiteralUpdateResult sqliteExecuteLiteral(string const dbName, string const &query, vector<QuickValue> *params = nullptr);

void sqliteCloseAll();

/**
 * Calls sqlite3_interrupt on every open connection so an in-flight long-running
 * query returns promptly. Used before a reload joins the worker threads; it does
 * not close anything.
 */
void sqliteInterruptAll();

// ---------------------------------------------------------------------------
// Internal entry points. The CALLER MUST HOLD `conn->mutex` for the connection
// that owns `db` (see withConnection). They let multi-statement operations (a
// batch, a SQL file import) take the lock once and run everything under it.
// ---------------------------------------------------------------------------

/** Binds one value per placeholder. Returns SQLITE_OK or an sqlite error code. */
int bindStatement(sqlite3_stmt *statement, vector<QuickValue> *values);

/** Executes the first statement of `query`. `results` / `metadata` may be null. */
SQLiteOPResult executeOnDb(sqlite3 *db, string const &query, vector<QuickValue> *params, QueryRows *results, vector<QuickColumnMetadata> *metadata);

/** Executes `query`, discarding rows. */
SequelLiteralUpdateResult executeLiteralOnDb(sqlite3 *db, string const &query, vector<QuickValue> *params = nullptr);

/**
 * Runs `body` between BEGIN EXCLUSIVE and COMMIT. `body` returns an error message,
 * or "" on success. On error (or a failed COMMIT of a transaction this call
 * started) it rolls back and returns the message; returns "" on success.
 * `what` names the operation in the commit error ("batch", "import").
 */
string runInTransaction(sqlite3 *db, const char *what, const function<string()> &body);

/**
 * Runs `fn(db)` while holding the connection lock.
 * Returns false (and calls nothing) when `name` is not open.
 */
bool withConnection(const string &name, const function<void(sqlite3 *)> &fn);

#endif /* sqliteBridge_h */
