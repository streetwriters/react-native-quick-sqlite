/*
 * sqliteBridge.cpp
 *
 * Created by Oscar Franco on 2021/03/07
 * Copyright (c) 2021 Oscar Franco
 *
 * This code is licensed under the MIT license
 */

#include "sqliteBridge.h"
#include <cerrno>
#include <cstring>
#include <sys/stat.h>

using namespace std;
using namespace facebook;

extern "C" int sqlite3Fts5BetterTrigramInit(sqlite3 *db);
extern "C" int sqlite3Fts5HtmlInit(sqlite3 *db);

static const string kExecutionError = "[react-native-quick-sqlite] SQL execution error: ";

// Pads every digit run to 10 digits so text sorts in natural order. The output
// format is pinned by a behaviour-lock test.
static void sqliteNaturalKeyFunc(sqlite3_context *context, int argc, sqlite3_value **argv) {
  if (argc == 0 || sqlite3_value_type(argv[0]) == SQLITE_NULL) {
    sqlite3_result_null(context);
    return;
  }
  const char *p = reinterpret_cast<const char *>(sqlite3_value_text(argv[0]));
  if (!p) {
    sqlite3_result_text(context, "", 0, SQLITE_STATIC);
    return;
  }
  string result;
  result.reserve(strlen(p) + 16);
  while (*p) {
    if (*p >= '0' && *p <= '9') {
      const char *start = p;
      while (*p >= '0' && *p <= '9') p++;
      size_t len = p - start;
      if (len < 10) result.append(10 - len, '0');
      result.append(start, len);
    } else {
      result.push_back(*p++);
    }
  }
  sqlite3_result_text(context, result.c_str(), static_cast<int>(result.length()), SQLITE_TRANSIENT);
}

// ---------------------------------------------------------------------------
// Paths and directories
// ---------------------------------------------------------------------------

static string buildDbPath(string const &dbName, string const &docPath)
{
  return docPath + "/" + dbName;
}

static bool directoryExists(const string &path)
{
  struct stat buffer;
  return stat(path.c_str(), &buffer) == 0 && S_ISDIR(buffer.st_mode);
}

// mkdir -p. Returns true if the directory exists afterwards.
static bool ensureDirectory(const string &path)
{
  if (path.empty())
  {
    return false;
  }
  if (directoryExists(path))
  {
    return true;
  }
  // mkdir failures are ignored on purpose: a sandboxed container may report
  // EACCES/EPERM for a parent that exists. Only the final check decides.
  for (size_t slash = path.find('/', 1);; slash = path.find('/', slash + 1))
  {
    ::mkdir(path.substr(0, slash).c_str(), 0755);
    if (slash == string::npos)
    {
      break;
    }
  }
  return directoryExists(path);
}

static SQLiteOPResult folderError()
{
  return {SQLiteError, "[react-native-quick-sqlite] Could not create database folder: " + string(strerror(errno))};
}

// ---------------------------------------------------------------------------
// Open / close / remove
// ---------------------------------------------------------------------------

SQLiteOPResult sqliteOpenDb(string const dbName, string const docPath)
{
  if (!ensureDirectory(docPath))
  {
    return folderError();
  }

  // NOMUTEX: every access to this connection already goes through
  // DbConnection::mutex, so SQLite's own per-call mutex is pure overhead.
  sqlite3 *db = nullptr;
  int status = sqlite3_open_v2(buildDbPath(dbName, docPath).c_str(), &db,
                               SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX, nullptr);
  if (status != SQLITE_OK)
  {
    string message = db != nullptr ? sqlite3_errmsg(db) : "Could not open database";
    // The handle is unusable; close it or it leaks. A previous connection with
    // the same name stays registered.
    sqlite3_close(db);
    return {SQLiteError, message};
  }

  // Return codes are ignored, as they always have been: a missing tokenizer or
  // function only surfaces when a query tries to use it.
  sqlite3Fts5BetterTrigramInit(db);
  sqlite3Fts5HtmlInit(db);
  sqlite3_create_function(db, "natural_key", 1, SQLITE_UTF8 | SQLITE_DETERMINISTIC, nullptr, sqliteNaturalKeyFunc, nullptr, nullptr);

  auto conn = make_shared<DbConnection>();
  conn->db = db;

  // "Last open wins": the new connection replaces any previous one with the same
  // name. Close the old handle so it does not leak.
  if (auto previous = dbReplace(dbName, conn))
  {
    previous->close();
  }
  return {SQLiteOk};
}

SQLiteOPResult sqliteCloseDb(string const dbName)
{
  auto conn = dbTake(dbName);
  if (conn == nullptr)
  {
    return {SQLiteError, dbName + " is not open"};
  }
  conn->close();
  return {SQLiteOk};
}

void sqliteCloseAll()
{
  for (auto &conn : dbAll(true))
  {
    conn->close();
  }
}

void sqliteInterruptAll()
{
  for (auto &conn : dbAll(false))
  {
    conn->interrupt();
  }
}

SQLiteOPResult sqliteAttachDb(string const mainDBName, string const docPath, string const databaseToAttach, string const alias)
{
  if (!ensureDirectory(docPath))
  {
    return folderError();
  }

  // The path is bound as a parameter, so an apostrophe in it is harmless.
  // sqliteExecuteLiteral reports a main database that is not open.
  vector<QuickValue> params{buildDbPath(databaseToAttach, docPath)};
  auto result = sqliteExecuteLiteral(mainDBName, "ATTACH DATABASE ? AS " + alias, &params);
  if (result.type == SQLiteError)
  {
    return {SQLiteError, mainDBName + " was unable to attach another database: " + result.message};
  }
  return {SQLiteOk};
}

SQLiteOPResult sqliteDetachDb(string const mainDBName, string const alias)
{
  auto result = sqliteExecuteLiteral(mainDBName, "DETACH DATABASE " + alias);
  if (result.type == SQLiteError)
  {
    return {SQLiteError, mainDBName + " was unable to detach database: " + result.message};
  }
  return {SQLiteOk};
}

SQLiteOPResult sqliteRemoveDb(string const dbName, string const docPath)
{
  // Take the connection out of the registry first so nothing can start using it
  // while the files are being removed.
  if (auto conn = dbTake(dbName))
  {
    conn->close();
  }

  // A WAL-mode database keeps data in -wal until the next clean close, and the
  // -shm / -journal files outlive the .db file. Remove all of them, or a later
  // open() resurrects the "deleted" database.
  string dbPath = buildDbPath(dbName, docPath);
  for (const char *suffix : {"", "-wal", "-shm", "-journal"})
  {
    string path = dbPath + suffix;
    if (remove(path.c_str()) != 0 && errno != ENOENT)
    {
      return {SQLiteError, "[react-native-quick-sqlite] Could not remove " + path + ": " + string(strerror(errno))};
    }
  }
  return {SQLiteOk};
}

// ---------------------------------------------------------------------------
// Statement execution
// ---------------------------------------------------------------------------

int bindStatement(sqlite3_stmt *statement, vector<QuickValue> *values)
{
  for (size_t ii = 0; ii < values->size(); ii++)
  {
    int index = (int)ii + 1;
    const QuickValue &value = (*values)[ii];
    int rc = SQLITE_OK;

    if (std::holds_alternative<std::monostate>(value))
    {
      rc = sqlite3_bind_null(statement, index);
    }
    else if (const int64_t *integer = std::get_if<int64_t>(&value))
    {
      rc = sqlite3_bind_int64(statement, index, *integer);
    }
    else if (const double *real = std::get_if<double>(&value))
    {
      rc = sqlite3_bind_double(statement, index, *real);
    }
    else if (const string *text = std::get_if<string>(&value))
    {
      rc = sqlite3_bind_text(statement, index, text->data(), (int)text->size(), SQLITE_TRANSIENT);
    }
    else if (const vector<uint8_t> *blob = std::get_if<vector<uint8_t>>(&value))
    {
      // A zero-length blob has to be bound explicitly: sqlite3_bind_blob(NULL, 0)
      // is interpreted as a NULL value, not an empty blob.
      rc = blob->empty()
               ? sqlite3_bind_zeroblob(statement, index, 0)
               : sqlite3_bind_blob(statement, index, blob->data(), (int)blob->size(), SQLITE_TRANSIENT);
    }

    if (rc != SQLITE_OK)
    {
      return rc;
    }
  }
  return SQLITE_OK;
}

/** Copies column `i` of the current row. */
static QuickValue readColumn(sqlite3_stmt *statement, int i)
{
  switch (sqlite3_column_type(statement, i))
  {
    case SQLITE_INTEGER:
      // Sent to JS as a double, which holds every integer up to 2^53 exactly.
      // See https://github.com/margelo/react-native-quick-sqlite/issues/16
      return static_cast<int64_t>(sqlite3_column_int64(statement, i));

    case SQLITE_FLOAT:
      return sqlite3_column_double(statement, i);

    case SQLITE_TEXT:
    {
      const char *text = reinterpret_cast<const char *>(sqlite3_column_text(statement, i));
      // Keep the byte length: SQLite text may contain embedded NULs.
      return string(text != nullptr ? text : "", sqlite3_column_bytes(statement, i));
    }

    case SQLITE_BLOB:
    {
      // sqlite3_column_blob returns NULL for a zero-length blob.
      const uint8_t *data = reinterpret_cast<const uint8_t *>(sqlite3_column_blob(statement, i));
      int size = sqlite3_column_bytes(statement, i);
      return data == nullptr || size <= 0 ? vector<uint8_t>() : vector<uint8_t>(data, data + size);
    }

    default:
      return std::monostate{};
  }
}

SQLiteOPResult executeOnDb(sqlite3 *db, string const &query, vector<QuickValue> *params, QueryRows *results, vector<QuickColumnMetadata> *metadata)
{
  // Only the first statement of `query` runs and any tail is dropped; a
  // behaviour test pins it.
  sqlite3_stmt *statement = nullptr;
  if (sqlite3_prepare_v2(db, query.c_str(), -1, &statement, NULL) != SQLITE_OK)
  {
    return {SQLiteError, kExecutionError + sqlite3_errmsg(db)};
  }

  if (params != nullptr && !params->empty())
  {
    // Bind failures are ignored, as always: SQLITE_RANGE for too many params,
    // missing params stay NULL. Only a query error surfaces.
    bindStatement(statement, params);
  }

  int status;
  while ((status = sqlite3_step(statement)) == SQLITE_ROW)
  {
    if (results == nullptr)
    {
      continue;
    }
    // Column names are read once per statement, not once per row.
    int count = sqlite3_column_count(statement);
    if (results->columnNames.empty())
    {
      for (int i = 0; i < count; i++)
      {
        results->columnNames.emplace_back(sqlite3_column_name(statement, i));
      }
    }
    vector<QuickValue> row;
    row.reserve((size_t)count);
    for (int i = 0; i < count; i++)
    {
      row.push_back(readColumn(statement, i));
    }
    results->rows.push_back(std::move(row));
  }

  bool failed = status != SQLITE_DONE;
  if (!failed && metadata != nullptr)
  {
    int count = sqlite3_column_count(statement);
    for (int i = 0; i < count; i++)
    {
      const char *type = sqlite3_column_decltype(statement, i);
      metadata->push_back({sqlite3_column_name(statement, i), i, type != nullptr ? type : "UNKNOWN"});
    }
  }
  sqlite3_finalize(statement);

  if (failed)
  {
    return {SQLiteError, kExecutionError + sqlite3_errmsg(db)};
  }

  // Read straight after the statement runs, as always: a SELECT repeats the
  // previous statement's numbers and an UPDATE the previous INSERT's insertId.
  // Pinned by behaviour tests.
  return {SQLiteOk, "", sqlite3_changes(db), static_cast<double>(sqlite3_last_insert_rowid(db))};
}

SequelLiteralUpdateResult executeLiteralOnDb(sqlite3 *db, string const &query, vector<QuickValue> *params)
{
  SQLiteOPResult result = executeOnDb(db, query, params, nullptr, nullptr);
  return {result.type, result.errorMessage, result.rowsAffected};
}

string runInTransaction(sqlite3 *db, const char *what, const function<string()> &body)
{
  // The BEGIN result is ignored, as it always has been: inside an already-open
  // transaction the body still runs and the COMMIT closes the outer
  // transaction. A behaviour test pins that.
  bool ownsTransaction = executeLiteralOnDb(db, "BEGIN EXCLUSIVE TRANSACTION").type == SQLiteOk;

  string error = body();
  if (error.empty())
  {
    auto commit = executeLiteralOnDb(db, "COMMIT");
    if (commit.type == SQLiteOk || !ownsTransaction)
    {
      return "";
    }
    // Report a failed COMMIT instead of claiming success while nothing was saved.
    error = string("[react-native-quick-sqlite] Could not commit the ") + what + ": " + commit.message;
  }

  auto rollback = executeLiteralOnDb(db, "ROLLBACK");
  if (rollback.type == SQLiteError)
  {
    error += " (rollback also failed: " + rollback.message + ")";
  }
  return error;
}

// ---------------------------------------------------------------------------
// Locking wrappers
// ---------------------------------------------------------------------------

bool withConnection(const string &name, const function<void(sqlite3 *)> &fn)
{
  auto conn = dbGet(name);
  if (conn == nullptr)
  {
    return false;
  }

  // `conn->db` is only read while holding the mutex: close() clears it under
  // the same lock.
  std::lock_guard<std::mutex> lock(conn->mutex);
  if (conn->db == nullptr)
  {
    return false;
  }
  fn(conn->db);
  return true;
}

SQLiteOPResult sqliteExecute(string const dbName, string const &query, vector<QuickValue> *params, QueryRows *results, vector<QuickColumnMetadata> *metadata)
{
  SQLiteOPResult result{SQLiteError, "[react-native-quick-sqlite]: Database " + dbName + " is not open"};
  withConnection(dbName, [&](sqlite3 *db) {
    result = executeOnDb(db, query, params, results, metadata);
  });
  return result;
}

SequelLiteralUpdateResult sqliteExecuteLiteral(string const dbName, string const &query, vector<QuickValue> *params)
{
  SequelLiteralUpdateResult result{SQLiteError, "[react-native-quick-sqlite] Database not opened: " + dbName, 0};
  withConnection(dbName, [&](sqlite3 *db) {
    result = executeLiteralOnDb(db, query, params);
  });
  return result;
}
