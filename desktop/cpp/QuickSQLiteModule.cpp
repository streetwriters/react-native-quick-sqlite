#include "QuickSQLiteModule.hpp"

#include <QuickSQLiteSpec.h>

#include "bindings.h"

#include <cstdlib>
#include <filesystem>
#include <memory>
#include <string>
#include <system_error>
#include <utility>

namespace {
namespace jsi = facebook::jsi;
using facebook::react::CallInvoker;
using facebook::react::TurboModule;

std::filesystem::path dataDirectory() {
  if (const char* configured = std::getenv("RN_GPUI_APP_DATA_DIR")) {
    return configured;
  }
#if defined(_WIN32)
  const char* base = std::getenv("APPDATA");
  std::filesystem::path root = base ? base : std::filesystem::temp_directory_path();
#elif defined(__APPLE__)
  const char* home = std::getenv("HOME");
  std::filesystem::path root = home
      ? std::filesystem::path(home) / "Library" / "Application Support"
      : std::filesystem::temp_directory_path();
#else
  const char* data = std::getenv("XDG_DATA_HOME");
  const char* home = std::getenv("HOME");
  std::filesystem::path root = data ? std::filesystem::path(data)
      : home                        ? std::filesystem::path(home) / ".local" / "share"
                                    : std::filesystem::temp_directory_path();
#endif
  return root / "QuickSQLite";
}

class QuickSQLiteModule final
    : public facebook::react::NativeQuickSQLiteSpec<QuickSQLiteModule> {
 public:
  explicit QuickSQLiteModule(std::shared_ptr<CallInvoker> jsInvoker)
      : NativeQuickSQLiteSpec(jsInvoker), callInvoker_(std::move(jsInvoker)) {}

  ~QuickSQLiteModule() {
    if (installed_) osp::clearState();
  }

  bool install(jsi::Runtime& runtime) {
    if (installed_) return true;
    const auto directory = dataDirectory();
    std::error_code error;
    std::filesystem::create_directories(directory, error);
    if (error) return false;
    const auto path = directory.string();
    osp::install(runtime, callInvoker_, path.c_str());
    installed_ = true;
    return true;
  }

 private:
  std::shared_ptr<CallInvoker> callInvoker_;
  bool installed_ = false;
};
} // namespace

std::shared_ptr<TurboModule> create_quick_sqlite_module(
    const std::string& name,
    std::shared_ptr<CallInvoker> jsInvoker) {
  return rngpui::provideTurboModule<QuickSQLiteModule>(name, std::move(jsInvoker));
}
