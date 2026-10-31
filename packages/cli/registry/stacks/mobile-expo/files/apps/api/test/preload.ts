import { afterAll } from 'bun:test';
import { cleanupDatabases } from './setup';

// Preloading gives this hook whole-run scope, rather than the first file's scope.
afterAll(cleanupDatabases);
