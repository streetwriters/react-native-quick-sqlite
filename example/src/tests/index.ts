/**
 * Imports every test file so that it registers itself with the harness.
 * Adding a new *.test.ts file requires adding a line here.
 */
import './basic.test';
import './features.test';
import './regressions.test';
import './behaviour.test';

export * from './harness';
