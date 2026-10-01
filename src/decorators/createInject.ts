// ============================================================================
// createInject.ts - Factory for creating shorthand inject decorators
// ============================================================================

import { MetaHelper } from './MetaHelper';
import { INJECT_PROPS } from './keys';

export interface CreateInjectOptions {
   optional?: boolean;
}

/**
 * Creates a reusable property inject decorator bound to a specific token.
 *
 * @example
 * ```ts
 * // Define once:
 * const InjectScene = createInject(Scene);
 *
 * // Use everywhere:
 * @Service()
 * class HoverBox {
 *   @InjectScene() scene: Scene;
 *   @InjectScene({ optional: true }) scene?: Scene;
 * }
 * ```
 */
export function createInject(token: any): (opts?: CreateInjectOptions) => PropertyDecorator {
   return (opts?: CreateInjectOptions): PropertyDecorator => {
      return (target: any, propertyKey: string | symbol) => {
         MetaHelper.append(INJECT_PROPS, {
            propertyKey,
            token,
            optional: opts?.optional,
         }, target.constructor);
      };
   };
}
