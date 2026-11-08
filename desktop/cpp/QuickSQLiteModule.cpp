#include "QuickSQLiteModule.hpp"

#include <QuickSQLiteSpec.h>

#include "bindings.h"

#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <memory>
#include <string>
#include <system_error>
#include <utility>

#if defined(_WIN32)
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

namespace {
namespace jsi = facebook::jsi;
using facebook::react::CallInvoker;
using facebook::react::TurboModule;

// The name of the running program, which names the app's folders when the host
// does not tell the module an app id. It is the same fallback
// @react-native-gpui/fs uses for its app folders.
std::string executableStem() {
  std::filesystem::path executable;
#if defined(_WIN32)
  wchar_t buffer[MAX_PATH];
  const DWORD length = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
  if (length > 0 && length < MAX_PATH) executable = std::wstring(buffer, length);
#elif defined(__APPLE__)
  char buffer[4096];
  uint32_t size = sizeof(buffer);
  if (_NSGetExecutablePath(buffer, &size) == 0) executable = buffer;
#else
  std::error_code error;
  executable = std::filesystem::read_symlink("/proc/self/exe", error);
#endif
  return executable.stem().string();
}

// A folder name that is the same on every system: separators and other
// characters a path cannot hold become dashes, and no dots or dashes lead or
// trail.
std::string folderName(const std::string& id) {
  std::string name;
  for (const char character : id) {
    switch (character) {
      case '/': case '\\': case ':': case '*': case '?': case '"':
      case '<': case '>': case '|': case '\0':
        name += '-';
        break;
      default:
        name += character;
    }
  }
  const auto first = name.find_first_not_of(".- \t");
  if (first == std::string::npos) return {};
  const auto last = name.find_last_not_of(".- \t");
  return name.substr(first, last - first + 1);
}

// The app's own data folder, where @react-native-gpui/fs puts `paths.appData`,
// and its `databases` folder for databases opened without a location.
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
  const char* configuredId = std::getenv("RN_GPUI_APP_ID");
  std::string id = folderName(configuredId ? configuredId : "");
  if (id.empty()) id = folderName(executableStem());
  if (id.empty()) id = "rn-gpui-app";
  return root / id / "databases";
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
