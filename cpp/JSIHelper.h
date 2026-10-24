//
//  JSIHelper.hpp
//  react-native-quick-sqlite
//
//  Created by Oscar on 13.03.22.
//

#ifndef JSIHelper_h
#define JSIHelper_h

#include <cstdint>
#include <string>
#include <variant>
#include <vector>

#include <jsi/jsilib.h>
#include <jsi/jsi.h>

using namespace std;
using namespace facebook;

/**
 * A single SQLite value: NULL, integer, real, text or blob.
 *
 * This owns its data. Text is a std::string (so it can hold embedded NULs) and
 * blobs are a std::vector<uint8_t> copy of the source bytes — the old struct
 * kept a raw pointer to JS-owned memory and freed it with `delete`, which
 * corrupted the heap for every blob parameter.
 */
using QuickValue = std::variant<std::monostate, int64_t, double, std::string, std::vector<uint8_t>>;

/**
 * Rows of a SELECT, stored by column index rather than as a map per row.
 *
 * Column names are collected once per statement (not once per row), and building
 * a std::map per row is what used to dominate `select 10k rows`.
 */
struct QueryRows
{
  vector<string> columnNames;
  vector<vector<QuickValue>> rows;
};

/**
 * Various structs to help with the results of the SQLite operations
 */
enum ResultType
{
  SQLiteOk,
  SQLiteError
};

struct SQLiteOPResult
{
  ResultType type;
  string errorMessage;
  int rowsAffected = 0;
  double insertId = 0;
};

struct SequelLiteralUpdateResult
{
  ResultType type;
  string message;
  int affectedRows;
};

struct SequelBatchOperationResult
{
  ResultType type;
  string message;
  int affectedRows;
  int commands;
};

/**
 * Describe column information of a resultset
 */
struct QuickColumnMetadata
{
  string columnName;
  int columnIndex;
  string columnDeclaredType;
};

/**
 * Fill the target vector with parsed parameters
 * */
void jsiQueryArgumentsToSequelParam(jsi::Runtime &rt, jsi::Value const &args, vector<QuickValue> *target);

/**
 * Converts a SQLiteOPResult plus the collected rows/metadata into the JS object
 * `{ rowsAffected, insertId?, rows: { _array, length }, metadata? }`.
 * Throws std::invalid_argument when `status.type == SQLiteError`.
 */
jsi::Value createSequelQueryExecutionResult(jsi::Runtime &rt, SQLiteOPResult status, QueryRows *results, vector<QuickColumnMetadata> *metadata);

#endif /* JSIHelper_h */
