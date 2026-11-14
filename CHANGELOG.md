# Changelog

## Unreleased

- Desktop: builds on Windows. Creating the database folder no longer uses POSIX-only `mkdir` and `S_ISDIR`, and accepts `\` separators.

## 8.3.0

- Add desktop support on react-native-gpui.
- Desktop: a database opened without a `location` is created in the app's own folder, `<app data>/<app id>/databases`, instead of the folder `QuickSQLite` that every app shared. An explicit `location` and `RN_GPUI_APP_DATA_DIR` work as before.
