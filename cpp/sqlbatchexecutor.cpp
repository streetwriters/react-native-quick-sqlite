/**
 * Batch execution implementation
*/
#include "sqlbatchexecutor.h"

static void pushCommand(jsi::Runtime &rt, const string &query, const jsi::Value &params, vector<QuickQueryArguments> *commands)
{
  auto values = make_shared<vector<QuickValue>>();
  jsiQueryArgumentsToSequelParam(rt, params, values.get());
  commands->push_back(QuickQueryArguments{query, std::move(values)});
}

void jsiBatchParametersToQuickArguments(jsi::Runtime &rt, jsi::Array const &batchParams, vector<QuickQueryArguments> *commands)
{
  size_t length = batchParams.length(rt);
  for (size_t i = 0; i < length; i++)
  {
    jsi::Array command = batchParams.getValueAtIndex(rt, i).asObject(rt).asArray(rt);
    size_t commandLength = command.length(rt);
    if (commandLength == 0)
    {
      continue;
    }

    string query = command.getValueAtIndex(rt, 0).asString(rt).utf8(rt);
    jsi::Value params = commandLength > 1 ? command.getValueAtIndex(rt, 1) : jsi::Value::undefined();
    if (params.isUndefined())
    {
      pushCommand(rt, query, params, commands);
      continue;
    }

    jsi::Object paramsObject = params.asObject(rt);
    if (paramsObject.isArray(rt))
    {
      jsi::Array paramsArray = paramsObject.asArray(rt);
      size_t paramsLength = paramsArray.length(rt);
      // An array of arrays is a batch update: one command per inner array.
      if (paramsLength > 0 && paramsArray.getValueAtIndex(rt, 0).isObject())
      {
        for (size_t x = 0; x < paramsLength; x++)
        {
          pushCommand(rt, query, paramsArray.getValueAtIndex(rt, x), commands);
        }
        continue;
      }
    }
    pushCommand(rt, query, params, commands);
  }
}

SequelBatchOperationResult sqliteExecuteBatch(std::string dbName, vector<QuickQueryArguments> *commands)
{
  if (commands->empty())
  {
    return {SQLiteError, "No SQL commands provided", 0, 0};
  }

  int commandCount = (int)commands->size();
  SequelBatchOperationResult result{SQLiteError, "[react-native-quick-sqlite]: Database " + dbName + " is not open", 0, 0};

  // One lock for the whole transaction, so nothing interleaves between BEGIN and COMMIT.
  withConnection(dbName, [&](sqlite3 *db) {
    int affectedRows = 0;

    string error = runInTransaction(db, "batch", [&]() -> string {
      // Consecutive commands with the same SQL reuse one prepared statement: a
      // batch of 10 000 rows normally has a single distinct statement. Only the
      // first statement of each SQL string runs; the tail is ignored.
      sqlite3_stmt *statement = nullptr;
      const string *statementSql = nullptr;
      string failure;

      for (const auto &command : *commands)
      {
        if (statement != nullptr && *statementSql == command.sql)
        {
          sqlite3_reset(statement);
          sqlite3_clear_bindings(statement);
        }
        else
        {
          sqlite3_finalize(statement);
          statement = nullptr;
          if (sqlite3_prepare_v2(db, command.sql.c_str(), (int)command.sql.size(), &statement, nullptr) != SQLITE_OK || statement == nullptr)
          {
            failure = "[react-native-quick-sqlite] SQL execution error: " + string(sqlite3_errmsg(db));
            break;
          }
          statementSql = &command.sql;
        }

        if (command.params != nullptr && !command.params->empty())
        {
          // Bind failures are ignored, exactly as `execute` ignores them.
          bindStatement(statement, command.params.get());
        }

        int status;
        while ((status = sqlite3_step(statement)) == SQLITE_ROW)
        {
        }
        if (status != SQLITE_DONE)
        {
          failure = "[react-native-quick-sqlite] SQL execution error: " + string(sqlite3_errmsg(db));
          break;
        }
        // Each statement's own count, as always: sqlite3_total_changes would
        // also count rows changed by triggers. Pinned by a behaviour test.
        affectedRows += sqlite3_changes(db);
      }

      // Finalize before COMMIT/ROLLBACK so the statement holds no lock.
      sqlite3_finalize(statement);
      return failure;
    });

    if (error.empty())
    {
      result = {SQLiteOk, "", affectedRows, commandCount};
    }
    else
    {
      result = {SQLiteError, error, 0, commandCount};
    }
  });

  return result;
}
