/*
 * DbRegistry.cpp
 *
 * This code is licensed under the MIT license
 */

#include "DbRegistry.h"

#include <unordered_map>

namespace
{
std::mutex registryMutex;
std::unordered_map<std::string, std::shared_ptr<DbConnection>> registry;
} // namespace

void DbConnection::close()
{
  std::lock_guard<std::mutex> lock(mutex);
  std::lock_guard<std::mutex> handleLock(handleMutex);
  // In certain cases, this will return SQLITE_OK, mark the database connection as an unusable "zombie",
  // and deallocate the connection later.
  sqlite3_close_v2(db);
  db = nullptr;
}

void DbConnection::interrupt()
{
  std::lock_guard<std::mutex> lock(handleMutex);
  if (db != nullptr)
  {
    sqlite3_interrupt(db);
  }
}

std::shared_ptr<DbConnection> dbGet(const std::string &name)
{
  std::lock_guard<std::mutex> lock(registryMutex);
  auto it = registry.find(name);
  return it == registry.end() ? nullptr : it->second;
}

std::shared_ptr<DbConnection> dbReplace(const std::string &name, std::shared_ptr<DbConnection> conn)
{
  std::lock_guard<std::mutex> lock(registryMutex);
  auto &slot = registry[name];
  slot.swap(conn);
  return conn;
}

std::shared_ptr<DbConnection> dbTake(const std::string &name)
{
  std::lock_guard<std::mutex> lock(registryMutex);
  auto it = registry.find(name);
  if (it == registry.end())
  {
    return nullptr;
  }
  auto conn = it->second;
  registry.erase(it);
  return conn;
}

std::vector<std::shared_ptr<DbConnection>> dbAll(bool remove)
{
  std::lock_guard<std::mutex> lock(registryMutex);
  std::vector<std::shared_ptr<DbConnection>> all;
  all.reserve(registry.size());
  for (auto &entry : registry)
  {
    all.push_back(entry.second);
  }
  if (remove)
  {
    registry.clear();
  }
  return all;
}
