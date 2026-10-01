// ============================================================================
// repository.ts - @Repository() repository decorator
// ============================================================================
// Location: @najm/di/src/decorators/repository.ts
// ============================================================================

import { DecoratorMetadata, RepositoryOptions } from './types';
import { Scope } from '../container/helpers';
import { MetaHelper } from './MetaHelper';
import { registerDecorated } from './registration';
import { REPOSITORY, DATABASE } from './keys';
import { setInjectable, setScope, setClassType, mergeMetadata } from './core';

// ============================================================================
// DECORATOR
// ============================================================================

/**
 * Normalize repository options to standard format
 * @internal
 */
function normalizeOptions(
   options: string | RepositoryOptions
): Required<Omit<RepositoryOptions, 'metadata'>> & { metadata?: DecoratorMetadata } {
   if (typeof options === 'string') {
      return { database: options };
   }
   return {
      database: options.database ?? 'default',
      metadata: options.metadata
   };
}

/**
 * Repository decorator for data access layer
 *
 * @example
 * ```ts
 * @Repository()
 * class UserRepository {}
 *
 * @Repository('postgres')
 * class PostgresUserRepository {}
 *
 * @Repository({ database: 'mongodb', metadata: { layer: 'data' } })
 * class MongoUserRepository {}
 * ```
 */
export function Repository(options: string | RepositoryOptions = 'default'): ClassDecorator {
   return (target) => {
      const opts = normalizeOptions(options);

      // Core metadata
      setInjectable(target, true);
      setScope(target, Scope.SINGLETON);
      setClassType(target, 'repository');

      // Repository-specific
      MetaHelper.define(REPOSITORY, true, target);
      MetaHelper.define(DATABASE, opts.database, target);

      // Custom metadata
      if (opts.metadata) {
         mergeMetadata(target, opts.metadata);
      }

      // Register in container
      registerDecorated(target, {
         scope: Scope.SINGLETON,
         metadata: { type: 'repository', database: opts.database, ...opts.metadata }
      });
   };
}

// ============================================================================
// METADATA HELPERS
// ============================================================================

export function isRepository(target: Function): boolean {
   return MetaHelper.get<boolean>(REPOSITORY, target) === true;
}

export function getDatabase(target: Function): string | undefined {
   return MetaHelper.get<string>(DATABASE, target);
}
