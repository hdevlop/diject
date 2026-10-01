// ============================================================================
// service.ts - @Service() service decorator
// ============================================================================
// Location: @najm/di/src/decorators/service.ts
// ============================================================================

import { DecoratorMetadata, ServiceOptions } from './types';
import { Scope } from '../container/helpers';
import { MetaHelper } from './MetaHelper';
import { registerDecorated } from './registration';
import { SERVICE } from './keys';
import { setInjectable, setScope, setClassType, mergeMetadata } from './core';

// ============================================================================
// DECORATOR
// ============================================================================

/**
 * Normalize service options to standard format
 * @internal
 */
function normalizeOptions(
   options: Scope | ServiceOptions
): Required<Omit<ServiceOptions, 'metadata'>> & { metadata?: DecoratorMetadata } {
   if (typeof options === 'string') {
      return { scope: options };
   }
   return {
      scope: options.scope ?? Scope.SINGLETON,
      metadata: options.metadata
   };
}

/**
 * Service decorator - marks a class as an injectable service
 *
 * @example
 * ```ts
 * @Service()
 * class UserService {}
 *
 * @Service(Scope.TRANSIENT)
 * class RequestHandler {}
 *
 * @Service({ scope: Scope.SINGLETON, metadata: { layer: 'domain' } })
 * class DomainService {}
 * ```
 */
export function Service(options: Scope | ServiceOptions = Scope.SINGLETON): ClassDecorator {
   return (target) => {
      const opts = normalizeOptions(options);

      // Core metadata
      setInjectable(target, true);
      setScope(target, opts.scope);
      setClassType(target, 'service');

      // Service-specific marker
      MetaHelper.define(SERVICE, true, target);

      // Custom metadata
      if (opts.metadata) {
         mergeMetadata(target, opts.metadata);
      }

      // Register in container
      registerDecorated(target, {
         scope: opts.scope,
         metadata: { type: 'service', ...opts.metadata }
      });
   };
}

// ============================================================================
// METADATA HELPERS
// ============================================================================

export function isService(target: Function): boolean {
   return MetaHelper.get<boolean>(SERVICE, target) === true;
}
