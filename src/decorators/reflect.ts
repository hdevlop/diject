// ============================================================================
// reflect.ts - Reflect-metadata utilities
// ============================================================================
// Location: @najm/di/src/decorators/reflect.ts
// ============================================================================

import 'reflect-metadata';
import { DESIGN_PARAMTYPES, DESIGN_TYPE, DESIGN_RETURNTYPE } from './keys';

// ============================================================================
// PARAMETER TYPES
// ============================================================================

/**
 * Get constructor or method parameter types via reflect-metadata
 * 
 * @example
 * ```ts
 * // Constructor params
 * getParamTypes(MyClass) // [UserRepo, Logger]
 * 
 * // Method params
 * getParamTypes(MyClass.prototype, 'someMethod') // [string, number]
 * ```
 */
export function getParamTypes(target: any, propertyKey?: string | symbol): any[] {
   if (propertyKey) {
      return Reflect.getMetadata(DESIGN_PARAMTYPES, target, propertyKey) || [];
   }
   return Reflect.getMetadata(DESIGN_PARAMTYPES, target) || [];
}

// ============================================================================
// PROPERTY TYPE
// ============================================================================

/**
 * Get the declared type of a property via reflect-metadata
 * 
 * @example
 * ```ts
 * class MyService {
 *   @Inject() userRepo: UserRepository;
 * }
 * 
 * getPropertyType(MyService.prototype, 'userRepo') // UserRepository
 * ```
 */
export function getPropertyType(target: any, propertyKey: string | symbol): any {
   return Reflect.getMetadata(DESIGN_TYPE, target, propertyKey);
}

// ============================================================================
// RETURN TYPE
// ============================================================================

/**
 * Get the return type of a method via reflect-metadata
 * 
 * @example
 * ```ts
 * class MyService {
 *   getUser(): User { ... }
 * }
 * 
 * getReturnType(MyService.prototype, 'getUser') // User
 * ```
 */
export function getReturnType(target: any, propertyKey: string | symbol): any {
   return Reflect.getMetadata(DESIGN_RETURNTYPE, target, propertyKey);
}

// ============================================================================
// COMBINED HELPER (backwards compatibility)
// ============================================================================

/**
 * Get property or return type via reflect-metadata
 * 
 * @deprecated Use getPropertyType() or getReturnType() instead
 */
export function getReflectType(
   target: any,
   propertyKey: string | symbol,
   kind: 'property' | 'return' = 'property'
): any {
   const metadataKey = kind === 'return' ? DESIGN_RETURNTYPE : DESIGN_TYPE;
   return Reflect.getMetadata(metadataKey, target, propertyKey);
}
