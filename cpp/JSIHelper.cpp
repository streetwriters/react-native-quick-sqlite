//
//  JSIHelper.cpp
//  react-native-quick-sqlite
//
//  Created by Oscar on 13.03.22.
//

#include "JSIHelper.h"
#include <algorithm>
#include <cmath>

using namespace std;
using namespace facebook;

namespace
{
/**
 * Wraps a std::vector's storage in the jsi::MutableBuffer an ArrayBuffer needs,
 * so the bytes are handed to JS without a second copy.
 */
class VectorBuffer : public jsi::MutableBuffer
{
public:
  explicit VectorBuffer(std::vector<uint8_t> &&data) : data_(std::move(data)) {}

  size_t size() const override
  {
    return data_.size();
  }

  uint8_t *data() override
  {
    return data_.data();
  }

private:
  std::vector<uint8_t> data_;
};

jsi::Value makeArrayBuffer(jsi::Runtime &rt, std::vector<uint8_t> &&blob)
{
  // A zero-length ArrayBuffer is valid and its data() pointer is unused, so the
  // nullptr a default-constructed vector may return is fine here.
  return jsi::Value(rt, jsi::ArrayBuffer(rt, std::make_shared<VectorBuffer>(std::move(blob))));
}
} // namespace

void jsiQueryArgumentsToSequelParam(jsi::Runtime &rt, jsi::Value const &params, vector<QuickValue> *target)
{
  if (params.isNull() || params.isUndefined())
  {
    return;
  }

  jsi::Array values = params.asObject(rt).asArray(rt);
  size_t len = values.length(rt);
  target->reserve(len);

  for (size_t ii = 0; ii < len; ii++)
  {
    jsi::Value value = values.getValueAtIndex(rt, ii);
    if (value.isNull() || value.isUndefined())
    {
      target->emplace_back(std::monostate{});
    }
    else if (value.isBool())
    {
      target->emplace_back(static_cast<int64_t>(value.getBool() ? 1 : 0));
    }
    else if (value.isNumber())
    {
      double d = value.asNumber();
      // 2^53: the largest range where every integer is exactly representable as a
      // double. Outside it (and for NaN/Infinity) `(int64_t)d` would be UB, so
      // those are bound as REAL instead.
      constexpr double kMaxSafe = 9007199254740992.0;
      if (std::isfinite(d) && std::trunc(d) == d && d >= -kMaxSafe && d <= kMaxSafe)
      {
        target->emplace_back(static_cast<int64_t>(d));
      }
      else
      {
        target->emplace_back(d);
      }
    }
    else if (value.isString())
    {
      target->emplace_back(value.asString(rt).utf8(rt));
    }
    else if (value.isObject())
    {
      auto obj = value.asObject(rt);
      if (obj.isArrayBuffer(rt))
      {
        auto buf = obj.getArrayBuffer(rt);
        // Copy: the JS ArrayBuffer may be collected while the statement is alive.
        const uint8_t *data = buf.data(rt);
        target->emplace_back(std::vector<uint8_t>(data, data + buf.size(rt)));
      }
      else
      {
        // Any other object is dropped entirely, which shifts every later
        // parameter by one. That is long-standing behaviour, pinned by a
        // behaviour-lock test; fixing it here would change what queries see.
      }
    }
    else
    {
      target->emplace_back(std::monostate{});
    }
  }
}

jsi::Value createSequelQueryExecutionResult(jsi::Runtime &rt, SQLiteOPResult status, QueryRows *results, vector<QuickColumnMetadata> *metadata)
{
  if (status.type == SQLiteError)
  {
    throw std::invalid_argument(status.errorMessage);
  }

  jsi::Object res = jsi::Object(rt);

  jsi::PropNameID rowsAffectedName = jsi::PropNameID::forAscii(rt, "rowsAffected");
  jsi::PropNameID insertIdName = jsi::PropNameID::forAscii(rt, "insertId");
  jsi::PropNameID rowsName = jsi::PropNameID::forAscii(rt, "rows");
  jsi::PropNameID arrayName = jsi::PropNameID::forAscii(rt, "_array");
  jsi::PropNameID lengthName = jsi::PropNameID::forAscii(rt, "length");
  jsi::PropNameID metadataName = jsi::PropNameID::forAscii(rt, "metadata");

  res.setProperty(rt, rowsAffectedName, jsi::Value(status.rowsAffected));
  if (status.rowsAffected > 0 && status.insertId != 0)
  {
    res.setProperty(rt, insertIdName, jsi::Value(status.insertId));
  }

  // The JS object keys must stay in alphabetical order with the last duplicate
  // winning, exactly like the std::map this replaced. Compute that order once per
  // query (not per row) and reuse it for every row.
  const vector<string> &columnNames = results->columnNames;
  vector<size_t> order(columnNames.size());
  for (size_t i = 0; i < order.size(); i++)
  {
    order[i] = i;
  }
  std::stable_sort(order.begin(), order.end(), [&columnNames](size_t a, size_t b) {
    return columnNames[a] < columnNames[b];
  });
  // For duplicate names the last column wins, so keep only the highest index of
  // each run of equal names.
  {
    vector<size_t> deduped;
    deduped.reserve(order.size());
    for (size_t i = 0; i < order.size(); i++)
    {
      if (i + 1 < order.size() && columnNames[order[i]] == columnNames[order[i + 1]])
      {
        continue;
      }
      deduped.push_back(order[i]);
    }
    order.swap(deduped);
  }

  // Build the property names once per statement, not once per cell.
  vector<jsi::PropNameID> names;
  names.reserve(order.size());
  for (size_t index : order)
  {
    names.push_back(jsi::PropNameID::forUtf8(rt, columnNames[index]));
  }

  size_t rowCount = results->rows.size();
  jsi::Object rows = jsi::Object(rt);
  if (rowCount > 0)
  {
    auto array = jsi::Array(rt, rowCount);
    for (size_t i = 0; i < rowCount; i++)
    {
      vector<QuickValue> &row = results->rows[i];
      jsi::Object rowObject = jsi::Object(rt);
      for (size_t n = 0; n < names.size(); n++)
      {
        size_t c = order[n];
        if (c >= row.size())
        {
          continue;
        }
        QuickValue &value = row[c];
        if (const std::string *text = std::get_if<std::string>(&value))
        {
          // Using the std::string overload of createFromUtf8 keeps the length,
          // so strings with embedded NULLs survive the round trip.
          rowObject.setProperty(rt, names[n], jsi::String::createFromUtf8(rt, *text));
        }
        else if (const int64_t *integer = std::get_if<int64_t>(&value))
        {
          // JS cannot represent the full int64 range; a double keeps every
          // integer up to 2^53 exactly, which is more than the old 32-bit int.
          rowObject.setProperty(rt, names[n], jsi::Value(static_cast<double>(*integer)));
        }
        else if (const double *real = std::get_if<double>(&value))
        {
          rowObject.setProperty(rt, names[n], jsi::Value(*real));
        }
        else if (std::vector<uint8_t> *blob = std::get_if<std::vector<uint8_t>>(&value))
        {
          // Move the bytes into the ArrayBuffer instead of copying them again.
          rowObject.setProperty(rt, names[n], makeArrayBuffer(rt, std::move(*blob)));
        }
        else
        {
          rowObject.setProperty(rt, names[n], jsi::Value(nullptr));
        }
      }
      array.setValueAtIndex(rt, i, move(rowObject));
    }
    rows.setProperty(rt, arrayName, move(array));
    res.setProperty(rt, rowsName, move(rows));
  }

  if (metadata != NULL)
  {
    size_t column_count = metadata->size();
    auto column_array = jsi::Array(rt, column_count);
    jsi::PropNameID columnNameName = jsi::PropNameID::forAscii(rt, "columnName");
    jsi::PropNameID columnDeclaredTypeName = jsi::PropNameID::forAscii(rt, "columnDeclaredType");
    jsi::PropNameID columnIndexName = jsi::PropNameID::forAscii(rt, "columnIndex");
    for (size_t i = 0; i < column_count; i++)
    {
      auto &column = metadata->at(i);
      jsi::Object column_object = jsi::Object(rt);
      column_object.setProperty(rt, columnNameName, jsi::String::createFromUtf8(rt, column.columnName.c_str()));
      column_object.setProperty(rt, columnDeclaredTypeName, jsi::String::createFromUtf8(rt, column.columnDeclaredType.c_str()));
      column_object.setProperty(rt, columnIndexName, jsi::Value(column.columnIndex));
      column_array.setValueAtIndex(rt, i, move(column_object));
    }
    res.setProperty(rt, metadataName, move(column_array));
  }
  rows.setProperty(rt, lengthName, jsi::Value((int)rowCount));

  return move(res);
}
