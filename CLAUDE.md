# diject

Lightweight TypeScript DI container with decorators, scopes, metadata queries, and AsyncLocalStorage support.

## Commands

- `bun test` — run all tests
- `bun run build` — build with tsup (ESM only, outputs to `dist/`)
- `bun test --watch` — watch mode

## Architecture

The container (`src/container/core.ts`) is a thin facade delegating to:

- **Register** — registration, metadata defaults, token handling
- **Resolver** — sync `get()` and async `resolve()`, circular dep detection, caching
- **Instantiator** — class instantiation, constructor/property injection, custom injectors
- **Deleter** — cleanup, `onDestroy` lifecycle, request scope eviction
- **MetadataManager** — dual key/value indexed metadata with query system

Decorators live in `src/decorators/` and use `reflect-metadata` for type introspection.

## Key design decisions

- `reflect-metadata` is a peer dependency — consumers must install and import it
- ESM-only build (`.mjs`), no CJS output
- AsyncLocalStorage is imported from `node:async_hooks` (Node.js 18+)
- Default metadata is empty `{}` — consumers opt in via `setDefaults()`
- Metadata queries use `$sort: { key: 'asc' | 'desc' }` for sorting (not value-level `'asc'`/`'desc'`)
- `onDestroy` errors are swallowed during cleanup to prevent interrupting teardown
- Class providers are `ProviderEntry` instances; never identify internal entries by shape (user values can look like `{ scope, factory }`)
- The resolution chain (cycle/scope checks) lives in the Resolver's own AsyncLocalStorage, never in the user's store; a context goes inactive once its provider settles
- Metadata lives in `MetadataManager`'s side map, never as a property on registered values
- Scopes: SINGLETON (one per container), REQUEST (one per requestId), TRANSIENT (new per resolve)

## Token types

Class constructors, strings, symbols, and `AlsToken` (branded type for ALS context values).

## Testing

Tests use bun's built-in test runner. Test files are in `test/` and cover core, meta, errors, aliases, ALS, decorators, and integration scenarios.
