// ============================================================================
// injectable.ts - @Injectable() core decorator
// ============================================================================
// Location: @najm/di/src/decorators/injectable.ts
// ============================================================================

import { Scope } from '../container/helpers';
import { setInjectable, setScope } from './core';

// ============================================================================
// DECORATOR
// ============================================================================

/**
 * Core Injectable decorator - marks a class as injectable
 *
 * @internal Use @Service, @Repository, or @Controller instead
 *
 * @example
 * ```ts
 * @Injectable()
 * class GenericService {}
 *
 * @Injectable(Scope.TRANSIENT)
 * class TransientService {}
 * ```
 */
export function Injectable(scope: Scope = Scope.SINGLETON): ClassDecorator {
   return (target) => {
      setInjectable(target, true);
      setScope(target, scope);
   };
}
