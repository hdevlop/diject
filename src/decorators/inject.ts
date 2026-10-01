// ============================================================================
// inject.ts - @Inject() dependency injection decorator
// ============================================================================
// Location: @najm/di/src/decorators/inject.ts
// ============================================================================

import 'reflect-metadata';
import { MetaHelper } from './MetaHelper';
import { INJECT_PROPS, INJECT_PARAMS, DESIGN_TYPE } from './keys';

// ============================================================================
// DECORATOR
// ============================================================================

/**
 * Core Inject decorator - injects dependencies into properties and constructor parameters
 *
 * @example
 * ```ts
 * class MyService {
 *   @Inject() userRepo: UserRepository;
 *   @Inject('config') config: any;
 *
 *   constructor(@Inject('db') db: Database) {}
 * }
 * ```
 */
export function Inject(token?: any): any {
   return (target: any, keyOrUndefined?: string | symbol, indexOrDescriptor?: number | PropertyDescriptor) => {
      // Constructor parameter injection
      if (typeof indexOrDescriptor === 'number') {
         if (token !== undefined) {
            MetaHelper.append(INJECT_PARAMS, { index: indexOrDescriptor, token }, target);
         }
         return;
      }

      // Property injection
      const type = Reflect.getMetadata(DESIGN_TYPE, target, keyOrUndefined as string);
      MetaHelper.append(INJECT_PROPS, { propertyKey: keyOrUndefined, token: token ?? type }, target.constructor);
   };
}

// ============================================================================
// METADATA HELPERS
// ============================================================================

export function getPropertyInjections(target: Function): any[] {
   return MetaHelper.get<any[]>(INJECT_PROPS, target) || [];
}

export function getParameterInjections(target: Function): any[] {
   return MetaHelper.get<any[]>(INJECT_PARAMS, target) || [];
}
