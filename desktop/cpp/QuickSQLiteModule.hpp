#pragma once

#include <memory>
#include <string>

namespace facebook::react {
class CallInvoker;
class TurboModule;
} // namespace facebook::react

std::shared_ptr<facebook::react::TurboModule> create_quick_sqlite_module(
    const std::string& name,
    std::shared_ptr<facebook::react::CallInvoker> jsInvoker);
