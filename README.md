# react-native-quick-sqlite

Fast, encrypted SQLite with JSI bindings for React Native, maintained by [Streetwriters](https://github.com/streetwriters) for [Notesnook](https://notesnook.com).

## Upstream Origin

This repository is forked and migrated from the original `react-native-quick-sqlite` codebase:
- **Upstream tree:** [`https://github.com/margelo/react-native-nitro-sqlite/tree/react-native-quick-sqlite`](https://github.com/margelo/react-native-nitro-sqlite/tree/react-native-quick-sqlite)
- **Original authors:** Marc Rousavy & Christoph Pader ([Margelo](https://github.com/margelo))

## Features & Notesnook Customizations

In addition to standard `react-native-quick-sqlite` capabilities, this distribution contains custom extensions required for Notesnook:

- **SQLite3 Multiple Ciphers**: Transparent database encryption supporting SQLCipher (AES-256), ChaCha20-Poly1305, and other encryption algorithms.
- **FTS5 `better-trigram`**: Enhanced trigram tokenizer with better multi-language and CJK tokenization support.
- **FTS5 `sqlite3-fts5-html`**: Custom HTML stripper tokenizer powered by [Lexbor](https://github.com/lexbor/lexbor), enabling direct and fast full-text indexing of rich text note content.
- **`natural_key` Function**: Built-in deterministic SQLite function for natural sorting of alphanumeric titles and strings (e.g. `Item 2` before `Item 10`).

## Installation

```bash
npm install github:streetwriters/react-native-quick-sqlite
```

## Desktop (react-native-gpui)

On desktop the library runs on [react-native-gpui](https://github.com/streetwriters/react-native-gpui) and is autolinked. A database opened without a `location` is created in the app's own folder, `<app data>/<app id>/databases`, where `<app data>` is `~/Library/Application Support` on macOS, `%APPDATA%` on Windows and `$XDG_DATA_HOME` (`~/.local/share`) on Linux, and the app id is `RN_GPUI_APP_ID` or, without it, the name of the executable. This is the folder `paths.appData` of `@react-native-gpui/fs` names, so two apps never share a database. An explicit `location` is appended to that folder as on mobile, and `RN_GPUI_APP_DATA_DIR` replaces the whole folder. Databases that an earlier version created in the shared `QuickSQLite` folder are not moved.

## Example App

An example application using React Native 0.82.1 is available in the [`example/`](./example) directory to run and test all library features.

## License

MIT © Marc Rousavy & Christoph Pader, Streetwriters (Private) Limited
