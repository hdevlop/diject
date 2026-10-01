// ============================================================================
// controller.ts - @Controller() controller decorator
// ============================================================================
// Location: @najm/di/src/decorators/controller.ts
// ============================================================================

import { ControllerOptions } from './types';
import { Scope } from '../container/helpers';
import { MetaHelper } from './MetaHelper';
import { registerDecorated } from './registration';
import { CONTROLLER, CONTROLLER_PATH } from './keys';
import { setInjectable, setScope, setClassType, mergeMetadata } from './core';

// ============================================================================
// DECORATOR
// ============================================================================

/**
 * Normalize controller options to standard format
 * @internal
 */
function normalizeOptions(options: string | ControllerOptions) {
   if (typeof options === 'string') {
      return { path: options };
   }
   return {
      path: options.path ?? '',
      metadata: options.metadata
   };
}

/**
 * Controller decorator with optional metadata
 *
 * @example
 * ```ts
 * @Controller('/users')
 * class UserController {}
 *
 * @Controller({ path: '/api/users', metadata: { version: 'v1' } })
 * class UserApiController {}
 * ```
 */
export function Controller(options: string | ControllerOptions = ''): ClassDecorator {
   return (target) => {
      const opts = normalizeOptions(options);

      // Core metadata
      setInjectable(target, true);
      setScope(target, Scope.SINGLETON);
      setClassType(target, 'controller');

      // Controller-specific
      MetaHelper.define(CONTROLLER, true, target);
      MetaHelper.define(CONTROLLER_PATH, opts.path, target);

      // Custom metadata
      if (opts.metadata) {
         mergeMetadata(target, opts.metadata);
      }

      // Register in container
      registerDecorated(target, {
         scope: Scope.SINGLETON,
         metadata: { type: 'controller', path: opts.path, ...opts.metadata }
      });
   };
}

// ============================================================================
// METADATA HELPERS
// ============================================================================

export function isController(target: Function): boolean {
   return MetaHelper.get<boolean>(CONTROLLER, target) === true;
}

export function getPath(target: Function): string | undefined {
   return MetaHelper.get<string>(CONTROLLER_PATH, target);
}
