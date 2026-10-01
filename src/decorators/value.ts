// ============================================================================
// value.ts - @Value() value injection decorator
// ============================================================================
// Location: @najm/di/src/decorators/value.ts
// ============================================================================

import { MetaHelper } from './MetaHelper';
import { INJECT_PROPS } from './keys';

// ============================================================================
// DECORATOR
// ============================================================================

/**
 * Value injection decorator - injects values (strings, objects, numbers) by token
 * Returns undefined if the token is not registered (optional by default)
 *
 * @example
 * ```ts
 * class MyService {
 *   @Value('API_KEY') apiKey?: string;
 *   @Value('CONFIG') config?: { port: number };
 *   @Value(DATABASE_URL) dbUrl?: string;
 * }
 * ```
 */
export function Value(token: any): PropertyDecorator {
   return (target: any, propertyKey: string | symbol) => {
      MetaHelper.append(INJECT_PROPS, {
         propertyKey,
         token,
         optional: true
      }, target.constructor);
   };
}
