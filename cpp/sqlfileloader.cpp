/**
 * SQL File Loader implementation
 *
 * Each non-empty line is executed as one statement, so a statement may not span
 * lines and only the first statement on a line runs. That behaviour is pinned by
 * tests. The whole import runs in one transaction under one connection lock.
*/
#include "sqlfileloader.h"
#include <fstream>

using namespace std;

SequelBatchOperationResult importSQLFile(string dbName, string fileLocation)
{
  ifstream sqFile(fileLocation);
  if (!sqFile.is_open())
  {
    return {SQLiteError, "[react-native-quick-sqlite][loadSQLFile] Could not open file", 0, 0};
  }

  SequelBatchOperationResult result{SQLiteError, "[react-native-quick-sqlite] Database not opened: " + dbName, 0, 0};

  withConnection(dbName, [&](sqlite3 *db) {
    int affectedRows = 0;
    int commands = 0;

    string error = runInTransaction(db, "import", [&]() -> string {
      string line;
      while (getline(sqFile, line))
      {
        if (line.empty())
        {
          continue;
        }
        auto lineResult = executeLiteralOnDb(db, line);
        if (lineResult.type == SQLiteError)
        {
          return lineResult.message;
        }
        affectedRows += lineResult.affectedRows;
        commands++;
      }
      return "";
    });

    if (error.empty())
    {
      result = {SQLiteOk, "", affectedRows, commands};
    }
    else
    {
      result = {SQLiteError, error, 0, commands};
    }
  });

  return result;
}
