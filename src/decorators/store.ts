// ============================================================================
// store.ts - @Store() AlsStore injection decorator
// ============================================================================
// Location: @najm/di/src/decorators/store.ts
// ============================================================================

import { MetaHelper } from './MetaHelper';
import { INJECT_PROPS } from './keys';

// ============================================================================
// DECORATOR
// ============================================================================

/**
 * Inject AlsStore for accessing AsyncLocalStorage context
 *
 * @example
 * ```ts
 * class MyService {
 *   @Store() store: AlsStore;
 *
 *   doSomething() {
 *     const requestId = this.store.get(REQUEST_ID);
 *   }
 * }
 * ```
 */
export function Store(): PropertyDecorator {
   return (target: any, propertyKey: string | symbol) => {
      MetaHelper.append(INJECT_PROPS, { propertyKey, token: 'AlsStore' }, target.constructor);
   };
}
