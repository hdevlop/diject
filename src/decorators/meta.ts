// ============================================================================
// meta.ts - @Meta() stackable metadata decorator
// ============================================================================
// Location: @najm/di/src/decorators/meta.ts
// ============================================================================

import { DecoratorMetadata } from './types';
import { mergeMetadata } from './core';
import { refreshDecoratedRegistration } from './registration';

// ============================================================================
// DECORATOR
// ============================================================================

/**
 * Stackable metadata decorator for classes
 *
 * @example
 * ```ts
 * @Service()
 * @Meta({ layer: 'domain', priority: 10 })
 * @Meta({ tags: ['critical'] })
 * class UserService {}
 * ```
 */
export function Meta(metadata: DecoratorMetadata): ClassDecorator {
   return (target) => {
      mergeMetadata(target, metadata);
      // Decorators apply bottom-up: when @Meta sits above @Service, the class
      // is already registered, so refresh it to pick up this metadata.
      refreshDecoratedRegistration(target);
   };
}
