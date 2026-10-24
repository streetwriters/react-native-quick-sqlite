#include "bindings.h"
#include "AsyncHelper.h"
#include "JSIHelper.h"
#include "macros.h"
#include "sqlbatchexecutor.h"
#include "sqlfileloader.h"
#include "sqliteBridge.h"
#include <atomic>
#include <mutex>
#include <unordered_map>

using namespace std;
using namespace facebook;

namespace osp {

/** Result of an async execute, handed from the worker thread to the JS thread. */
struct ExecuteAsyncResult
{
  SQLiteOPResult status;
  QueryRows results;
  vector<QuickColumnMetadata> metadata;
};

// `invalidated` is set when the JS runtime is torn down (reload, bridge
// teardown). Worker tasks and JS-thread callbacks check it before touching
// anything that belongs to the runtime: after a reload those are dangling.
static std::atomic<bool> invalidated{false};

// One serial worker per open database: calls on the same database finish in the
// order they were issued, calls on different databases run in parallel. Keyed by
// *name* so the queue survives "last open wins" re-opens of the same name, and so
// a worker thread is never owned by an object the worker itself might destroy.
static std::mutex poolsMutex;
static std::unordered_map<string, std::shared_ptr<ThreadPool>> pools;
// Used for calls on a database that is not open; they only produce an error.
static std::shared_ptr<ThreadPool> fallbackPool;

static std::shared_ptr<ThreadPool> poolFor(const string &dbName)
{
  std::lock_guard<std::mutex> lock(poolsMutex);
  auto &pool = dbGet(dbName) == nullptr ? fallbackPool : pools[dbName];
  if (pool == nullptr)
  {
    pool = std::make_shared<ThreadPool>();
  }
  return pool;
}

bool isInvalidated()
{
  return invalidated.load();
}

string docPathStr;
std::shared_ptr<react::CallInvoker> invoker;

void clearState() {
  // Interrupt in-flight queries first, or joining a worker stuck in a long
  // loadFile/execute would block the reload until that query finished.
  invalidated = true;
  sqliteInterruptAll();

  // Stop the workers before closing the connections. Move them out under the
  // lock and stop them outside it, since stop() joins.
  std::unordered_map<string, std::shared_ptr<ThreadPool>> toStop;
  std::shared_ptr<ThreadPool> fallback;
  {
    std::lock_guard<std::mutex> lock(poolsMutex);
    toStop.swap(pools);
    fallback.swap(fallbackPool);
  }
  for (auto &entry : toStop)
  {
    entry.second->stop();
  }
  if (fallback != nullptr)
  {
    fallback->stop();
  }

  sqliteCloseAll();
}

/** Reads the database name argument, throwing the `fn`-labelled errors. */
static string requireName(jsi::Runtime &rt, const jsi::Value *args, size_t count, const char *fn)
{
  if (count == 0)
  {
    throw jsi::JSError(rt, string("[react-native-quick-sqlite][") + fn + "] database name is required");
  }
  if (!args[0].isString())
  {
    throw jsi::JSError(rt, string("[react-native-quick-sqlite][") + fn + "] database name must be a string");
  }
  return args[0].asString(rt).utf8(rt);
}

/** The documents folder, plus the optional location argument at `index`. */
static string resolveLocation(jsi::Runtime &rt, const jsi::Value *args, size_t count, size_t index, const char *fn)
{
  string path = docPathStr;
  if (count > index && !args[index].isUndefined() && !args[index].isNull())
  {
    if (!args[index].isString())
    {
      throw jsi::JSError(rt, string("[react-native-quick-sqlite][") + fn + "] database location must be a string");
    }
    path += "/" + args[index].asString(rt).utf8(rt);
  }
  return path;
}

static jsi::Value throwIfError(jsi::Runtime &rt, const SQLiteOPResult &result)
{
  if (result.type == SQLiteError)
  {
    throw jsi::JSError(rt, result.errorMessage.c_str());
  }
  return {};
}

/** `{ rowsAffected }`, plus `commands` for file imports. */
static jsi::Value batchResultToJs(jsi::Runtime &rt, const SequelBatchOperationResult &result, bool withCommands)
{
  auto res = jsi::Object(rt);
  res.setProperty(rt, "rowsAffected", jsi::Value(result.affectedRows));
  if (withCommands)
  {
    res.setProperty(rt, "commands", jsi::Value(result.commands));
  }
  return res;
}

void install(jsi::Runtime &rt, std::shared_ptr<react::CallInvoker> jsCallInvoker, const char *docPath)
{
  docPathStr = std::string(docPath);
  invalidated = false;
  invoker = jsCallInvoker;

  auto open = HOSTFN("open", 2) {
    string dbName = requireName(rt, args, count, "open");
    return throwIfError(rt, sqliteOpenDb(dbName, resolveLocation(rt, args, count, 1, "open")));
  });

  auto attach = HOSTFN("attach", 4) {
    if (count < 3)
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][attach] Incorrect number of arguments");
    }
    if (!args[0].isString() || !args[1].isString() || !args[2].isString())
    {
      throw jsi::JSError(rt, "dbName, databaseToAttach and alias must be a strings");
    }
    string location = resolveLocation(rt, args, count, 3, "attach");
    string dbName = args[0].asString(rt).utf8(rt);
    string databaseToAttach = args[1].asString(rt).utf8(rt);
    string alias = args[2].asString(rt).utf8(rt);
    return throwIfError(rt, sqliteAttachDb(dbName, location, databaseToAttach, alias));
  });

  auto detach = HOSTFN("detach", 2) {
    if (count < 2)
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][detach] Incorrect number of arguments");
    }
    if (!args[0].isString() || !args[1].isString())
    {
      throw jsi::JSError(rt, "dbName, databaseToAttach and alias must be a strings");
    }
    return throwIfError(rt, sqliteDetachDb(args[0].asString(rt).utf8(rt), args[1].asString(rt).utf8(rt)));
  });

  auto close = HOSTFN("close", 1) {
    return throwIfError(rt, sqliteCloseDb(requireName(rt, args, count, "close")));
  });

  // The "[open]" labels on delete's errors are long-standing; keep them.
  auto remove = HOSTFN("delete", 2) {
    string dbName = requireName(rt, args, count, "open");
    return throwIfError(rt, sqliteRemoveDb(dbName, resolveLocation(rt, args, count, 1, "open")));
  });

  auto execute = HOSTFN("execute", 3) {
    if (count < 2)
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][execute] Incorrect parameter count");
    }
    if (!args[0].isString())
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][execute] database name must be a string");
    }
    if (!args[1].isString())
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][execute] query must be a string");
    }

    const string dbName = args[0].asString(rt).utf8(rt);
    const string query = args[1].asString(rt).utf8(rt);
    vector<QuickValue> params;
    if (count >= 3)
    {
      jsiQueryArgumentsToSequelParam(rt, args[2], &params);
    }

    QueryRows results;
    vector<QuickColumnMetadata> metadata;
    try {
      auto status = sqliteExecute(dbName, query, &params, &results, &metadata);
      if (status.type == SQLiteError)
      {
        throw jsi::JSError(rt, status.errorMessage);
      }
      return createSequelQueryExecutionResult(rt, status, &results, &metadata);
    } catch (std::exception &e) {
      // The error is re-wrapped from `what()`, so error.message carries the
      // JSError's "message + stack" text. Pinned by a behaviour test.
      throw jsi::JSError(rt, e.what());
    }
  });

  auto executeAsync = HOSTFN("executeAsync", 3) {
    // Two arguments is an error here even though the sync version accepts them.
    // Pinned by a behaviour test.
    if (count < 3)
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][executeAsync] Incorrect arguments for executeAsync");
    }

    const string dbName = args[0].asString(rt).utf8(rt);
    const string query = args[1].asString(rt).utf8(rt);
    auto params = std::make_shared<vector<QuickValue>>();
    jsiQueryArgumentsToSequelParam(rt, args[2], params.get());

    using Result = std::shared_ptr<ExecuteAsyncResult>;
    // `work` runs on the worker thread and must not touch `rt`.
    auto work = [dbName, query, params]() {
      auto result = std::make_shared<ExecuteAsyncResult>();
      result->status = sqliteExecute(dbName, query, params.get(), &result->results, &result->metadata);
      return result;
    };
    auto toJs = [](jsi::Runtime &rt, Result &result) -> jsi::Value {
      if (result->status.type == SQLiteError)
      {
        throw std::runtime_error(result->status.errorMessage);
      }
      return createSequelQueryExecutionResult(rt, result->status, &result->results, &result->metadata);
    };
    return runAsync<Result>(rt, invoker, poolFor(dbName), std::move(work), std::move(toJs));
  });

  // Execute a batch of SQL queries in a transaction
  // Parameters can be: [[sql: string, arguments: any[] | arguments: any[][] ]]
  auto executeBatch = HOSTFN("executeBatch", 2) {
    if (count < 2)
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][executeBatch] - Incorrect parameter count");
    }
    if (args[1].isNull() || args[1].isUndefined())
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][executeBatch] - An array of SQL commands or parameters is needed");
    }
    const string dbName = args[0].asString(rt).utf8(rt);
    vector<QuickQueryArguments> commands;
    jsiBatchParametersToQuickArguments(rt, args[1].asObject(rt).asArray(rt), &commands);

    auto batchResult = sqliteExecuteBatch(dbName, &commands);
    if (batchResult.type == SQLiteError)
    {
      throw jsi::JSError(rt, batchResult.message);
    }
    return batchResultToJs(rt, batchResult, false);
  });

  auto executeBatchAsync = HOSTFN("executeBatchAsync", 2) {
    if (count < 2)
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][executeAsyncBatch] Incorrect parameter count");
    }
    if (args[1].isNull() || args[1].isUndefined())
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][executeAsyncBatch] - An array of SQL commands or parameters is needed");
    }
    const string dbName = args[0].asString(rt).utf8(rt);
    auto commands = std::make_shared<vector<QuickQueryArguments>>();
    jsiBatchParametersToQuickArguments(rt, args[1].asObject(rt).asArray(rt), commands.get());

    using Result = std::shared_ptr<SequelBatchOperationResult>;
    auto work = [dbName, commands]() {
      return std::make_shared<SequelBatchOperationResult>(sqliteExecuteBatch(dbName, commands.get()));
    };
    auto toJs = [](jsi::Runtime &rt, Result &result) -> jsi::Value {
      if (result->type == SQLiteError)
      {
        throw std::runtime_error(result->message);
      }
      return batchResultToJs(rt, *result, false);
    };
    return runAsync<Result>(rt, invoker, poolFor(dbName), std::move(work), std::move(toJs));
  });

  auto loadFile = HOSTFN("loadFile", 2) {
    if (count < 2)
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][loadFile] Incorrect parameter count");
    }
    if (!args[0].isString())
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][loadFile] database name must be a string");
    }
    if (!args[1].isString())
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][loadFile] file name must be a string");
    }

    auto importResult = importSQLFile(args[0].asString(rt).utf8(rt), args[1].asString(rt).utf8(rt));
    if (importResult.type == SQLiteError)
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][loadFile] Could not open file");
    }
    return batchResultToJs(rt, importResult, true);
  });

  // Load SQL File from disk in another thread
  auto loadFileAsync = HOSTFN("loadFileAsync", 2) {
    if (count < 2)
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][loadFileAsync] Incorrect parameter count");
    }
    if (!args[0].isString() || !args[1].isString())
    {
      throw jsi::JSError(rt, "[react-native-quick-sqlite][loadFileAsync] database name and file name must be strings");
    }

    const string dbName = args[0].asString(rt).utf8(rt);
    const string sqlFileName = args[1].asString(rt).utf8(rt);

    using Result = std::shared_ptr<SequelBatchOperationResult>;
    auto work = [dbName, sqlFileName]() {
      return std::make_shared<SequelBatchOperationResult>(importSQLFile(dbName, sqlFileName));
    };
    auto toJs = [](jsi::Runtime &rt, Result &result) -> jsi::Value {
      if (result->type == SQLiteError)
      {
        throw std::runtime_error(result->message);
      }
      return batchResultToJs(rt, *result, true);
    };
    return runAsync<Result>(rt, invoker, poolFor(dbName), std::move(work), std::move(toJs));
  });

  jsi::Object module = jsi::Object(rt);
  module.setProperty(rt, "open", std::move(open));
  module.setProperty(rt, "close", std::move(close));
  module.setProperty(rt, "attach", std::move(attach));
  module.setProperty(rt, "detach", std::move(detach));
  module.setProperty(rt, "delete", std::move(remove));
  module.setProperty(rt, "execute", std::move(execute));
  module.setProperty(rt, "executeAsync", std::move(executeAsync));
  module.setProperty(rt, "executeBatch", std::move(executeBatch));
  module.setProperty(rt, "executeBatchAsync", std::move(executeBatchAsync));
  module.setProperty(rt, "loadFile", std::move(loadFile));
  module.setProperty(rt, "loadFileAsync", std::move(loadFileAsync));
  rt.global().setProperty(rt, "__QuickSQLiteProxy", std::move(module));
}

} // namespace osp
