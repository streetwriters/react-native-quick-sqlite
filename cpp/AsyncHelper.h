/*
 * AsyncHelper.h
 *
 * One implementation of "run work on the worker thread, then build the JS value
 * on the JS thread", shared by every async host function.
 *
 * This code is licensed under the MIT license
 */

#ifndef AsyncHelper_h
#define AsyncHelper_h

#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>

#include <jsi/jsilib.h>
#include <jsi/jsi.h>

#include "ThreadPool.h"

namespace osp
{

// `invalidated` lives in bindings.cpp; checked on both sides of every hop.
bool isInvalidated();

namespace detail
{

// Calls reject(new Error(message)). Never throws: it runs inside invokeAsync,
// where an escaping exception would call std::terminate().
inline void rejectWith(jsi::Runtime &rt, const jsi::Value &reject, const std::string &message)
{
  try
  {
    auto error = rt.global().getPropertyAsFunction(rt, "Error").callAsConstructor(rt, jsi::String::createFromUtf8(rt, message));
    reject.asObject(rt).asFunction(rt).call(rt, std::move(error));
  }
  catch (...)
  {
  }
}

} // namespace detail

/**
 * Runs `work` on the worker thread. On success, `toJs` builds the value on the
 * JS thread and the promise resolves with it. Any exception from either step
 * rejects with an Error.
 *
 * `work` must not touch the jsi::Runtime.
 */
template <typename R>
jsi::Value runAsync(jsi::Runtime &rt,
                    std::shared_ptr<react::CallInvoker> invoker,
                    std::shared_ptr<ThreadPool> pool,
                    std::function<R()> work,
                    std::function<jsi::Value(jsi::Runtime &, R &)> toJs)
{
  auto workShared = std::make_shared<std::function<R()>>(std::move(work));
  auto toJsShared = std::make_shared<std::function<jsi::Value(jsi::Runtime &, R &)>>(std::move(toJs));

  auto executor = jsi::Function::createFromHostFunction(
      rt,
      jsi::PropNameID::forAscii(rt, "executor"),
      2,
      [invoker, pool, workShared, toJsShared](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t) -> jsi::Value {
        // resolve/reject are moved from the worker task into the JS-thread
        // callback, so the worker never holds (or destroys) a jsi::Value.
        auto resolve = std::make_shared<jsi::Value>(rt, args[0]);
        auto reject = std::make_shared<jsi::Value>(rt, args[1]);

        pool->queueWork([invoker, workShared, toJsShared, resolve = std::move(resolve), reject = std::move(reject)]() mutable {
          std::optional<R> result;
          std::string error;
          try
          {
            result.emplace((*workShared)());
          }
          catch (const std::exception &e)
          {
            // Copy: the exception object is gone by the time the JS thread runs.
            error = e.what();
          }
          catch (...)
          {
            error = "Unknown error";
          }

          if (isInvalidated())
          {
            return;
          }

          invoker->invokeAsync([result = std::move(result), error = std::move(error), toJsShared,
                                resolve = std::move(resolve), reject = std::move(reject)](jsi::Runtime &rt) mutable {
            // The runtime may have been torn down (reload) while this was queued.
            if (isInvalidated())
            {
              return;
            }
            if (!result)
            {
              detail::rejectWith(rt, *reject, error);
              return;
            }
            try
            {
              auto value = (*toJsShared)(rt, *result);
              resolve->asObject(rt).asFunction(rt).call(rt, std::move(value));
            }
            catch (const std::exception &e)
            {
              detail::rejectWith(rt, *reject, e.what());
            }
            catch (...)
            {
              detail::rejectWith(rt, *reject, "Unknown error");
            }
          });
        });

        return {};
      });

  return rt.global().getPropertyAsFunction(rt, "Promise").callAsConstructor(rt, std::move(executor));
}

} // namespace osp

#endif /* AsyncHelper_h */
