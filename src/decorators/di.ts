// ============================================================================
// di.ts - @DI() container injection decorator
// ============================================================================
// Location: @najm/di/src/decorators/di.ts
// ============================================================================

import { MetaHelper } from './MetaHelper';
import { INJECT_PROPS } from './keys';

// ============================================================================
// DECORATOR
// ============================================================================

/**
 * Inject the DI Container itself
 *
 * @example
 * ```ts
 * class MyService {
 *   @DI() container: Container;
 *
 *   doSomething() {
 *     const config = this.container.get('config');
 *   }
 * }
 * ```
 */
export function DI(): PropertyDecorator {
   return (target: any, propertyKey: string | symbol) => {
      MetaHelper.append(INJECT_PROPS, { propertyKey, token: 'Container' }, target.constructor);
   };
}
