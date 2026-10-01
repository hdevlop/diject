// ============================================================================
// Container Module - Barrel Exports
// ============================================================================

// Core Container class and convenience functions
export * from './core';

// Type definitions
export type {
   Constructor,
   Factory,
   AsyncFactory,
   OnInit,
   OnDestroy,
   OnBootComplete,
   Metadata,
   MetadataQuery,
   RegistryEntry,
   Token,
   Options,
   PropertyInjection,
   PropsInject,
   RegEntryOpts,
   TStore,
   InjectionDefinition,
} from './types';

// Tokens and token utilities
export { AlsToken, createAlsToken } from './tokens';

// Helpers (Scope enum, type guards, etc.)
export {
   Scope,
   FactoryWrapper,
   hasOnInit,
   hasOnDestroy,
   isNamedToken,
   isConstructor,
   isArrayToken,
   isRegistryEntry,
   hasSingletonInstance,
   isReqScope,
   hasSingletonPending,
   hasOnBootComplete,
   isAlsToken,
} from './helpers';

// Error handling
export { BaseError, DIError, DI_CODES } from './DIError';

// AsyncLocalStorage store
export { AlsStore, lazyValue } from './AlsStore';
export type { LazyValue, StoreInput } from './AlsStore';

// Metadata manager
export { MetadataManager } from './Metadata';


// Internal delegates (not typically needed by consumers, but available if needed)
export { Register } from './Register';
export { Resolver } from './Resolver';
export { Instantiator } from './Instantiator';
export { Deleter } from './Deleter';
