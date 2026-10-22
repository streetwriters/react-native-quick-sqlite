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

## Installation

```bash
npm install github:streetwriters/react-native-quick-sqlite
```

## Example App

An example application using React Native 0.82.1 is available in the [`example/`](./example) directory to run and test all library features.

## License

MIT © Marc Rousavy & Christoph Pader, Streetwriters (Private) Limited
