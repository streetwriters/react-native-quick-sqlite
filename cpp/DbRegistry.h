/*
 * DbRegistry.h
 *
 * One entry per open database. Every operation on a connection must hold
 * `DbConnection::mutex` for its whole duration: that is what stops two threads
 * from stepping statements on the same connection at the same time, and what
 * makes sqlite3_changes / sqlite3_last_insert_rowid / sqlite3_errmsg return the
 * values belonging to the operation that just ran.
 *
 * This code is licensed under the MIT license
 */

#ifndef DbRegistry_h
#define DbRegistry_h

#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <sqlite3.h>

struct DbConnection
{
  sqlite3 *db = nullptr;
  // Held for the whole duration of any operation on this connection.
  std::mutex mutex;

  // Waits for the running operation (takes `mutex`), then closes the handle.
  void close();

  // sqlite3_interrupt on the handle, if it is still open. Does not take `mutex`
  // (the point is to interrupt the query holding it), only `handleMutex`.
  void interrupt();

private:
  // Guards `db` against close() and interrupt() running at the same time:
  // sqlite3_interrupt on a handle that is being closed is undefined behaviour.
  std::mutex handleMutex;
};

/** Returns the connection for `name`, or nullptr if it is not open. */
std::shared_ptr<DbConnection> dbGet(const std::string &name);

/**
 * Stores `conn` under `name` and returns the connection it replaced (or nullptr).
 * A second open() of the same name replaces the old connection, which is the
 * long-standing "last open wins" behaviour.
 */
std::shared_ptr<DbConnection> dbReplace(const std::string &name, std::shared_ptr<DbConnection> conn);

/** Removes and returns the connection for `name`, or nullptr if absent. */
std::shared_ptr<DbConnection> dbTake(const std::string &name);

/** Returns every connection; `remove` also empties the registry. */
std::vector<std::shared_ptr<DbConnection>> dbAll(bool remove);

#endif /* DbRegistry_h */
