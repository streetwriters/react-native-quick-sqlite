/**
 * React Native exposes the `performance` global (Hermes' monotonic clock) but
 * its type is not part of the non-DOM lib this app compiles against.
 */
declare const performance: {
  now(): number;
};
