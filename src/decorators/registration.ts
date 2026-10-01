// ============================================================================
// registration.ts - Global-container registration for class decorators
// ============================================================================

import 'reflect-metadata';
import { container } from '../container';
import type { Options } from '../container/types';

/** Options a class decorator registered the class with */
const REGISTRATION = Symbol.for('diject:registration');

/**
 * @internal Register a decorated class in the global container and remember
 * the options, so a decorator applied after it can refresh the registration.
 */
export function registerDecorated(target: Function, options: Options): void {
   Reflect.defineMetadata(REGISTRATION, options, target);
   container.set(target as any, options);
}

/**
 * @internal Re-register a decorated class so metadata added after its
 * registering decorator ran (e.g. `@Meta` written above `@Service`) is indexed.
 */
export function refreshDecoratedRegistration(target: Function): void {
   const options: Options | undefined = Reflect.getOwnMetadata(REGISTRATION, target);
   if (options && container.has(target as any)) {
      container.set(target as any, options);
   }
}
