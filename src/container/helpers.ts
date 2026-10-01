
import { AlsToken } from "./tokens";
import { OnInit, OnDestroy, Constructor, Token, RegistryEntry } from "./types";

export enum Scope {
   SINGLETON = 'singleton',
   REQUEST = 'request',
   TRANSIENT = 'transient',
}

export class FactoryWrapper {
   pending?: Promise<any>;
   constructor(public factory: Function) { }
}

/**
 * Registry entry for a class provider. A class (not a plain object) so that
 * user values shaped like `{ scope, factory }` are never mistaken for one.
 * `instance` and `pending` are declared, not initialized: their presence is
 * meaningful (`hasSingletonInstance` checks for an own `instance`).
 */
export class ProviderEntry implements RegistryEntry {
   declare instance?: any;
   declare pending?: Promise<any>;
   declare deps?: Token[];

   constructor(
      public scope: Scope,
      public factory: (requestId?: string) => any,
      deps?: Token[],
   ) {
      if (deps) this.deps = deps;
   }
}

/**
 * Marker stored in the registry for `container.alias(token, target)`.
 * Resolution follows `target` transparently — the alias does NOT get its
 * own singleton slot, so it works without an explicit boot pass for the
 * alias token itself.
 */
export class AliasEntry {
   constructor(public target: Constructor) { }
}

export function isAliasEntry(value: unknown): value is AliasEntry {
   return value instanceof AliasEntry;
}

export function hasOnInit(instance: any): instance is OnInit {
   return instance && typeof instance.onInit === 'function';
}

export function hasOnDestroy(instance: any): instance is OnDestroy {
   return instance && typeof instance.onDestroy === 'function';
}

export function isNamedToken(token: unknown): token is Token {
   return typeof token === 'string' || typeof token === 'symbol';
}

export function isConstructor(token: unknown): token is Constructor {
   return typeof token === 'function' && token.prototype !== undefined;
}

export function isArrayToken(token: unknown): token is Constructor[] {
   return Array.isArray(token);
}

export function isRegistryEntry(value: unknown): value is RegistryEntry {
   return value instanceof ProviderEntry;
}

/**
 * Comparator for metadata sorting: strings compare lexically, everything
 * else keeps the numeric `a - b` comparison.
 */
export function compareValues(a: any, b: any): number {
   if (typeof a === 'string' && typeof b === 'string') {
      return a < b ? -1 : a > b ? 1 : 0;
   }
   return a - b;
}

export function hasSingletonInstance(entry: RegistryEntry): boolean {
   return entry.scope === Scope.SINGLETON
      && Object.prototype.hasOwnProperty.call(entry, 'instance');
}

export function isReqScope(entry: RegistryEntry, requestId?: string): boolean {
   return entry.scope === Scope.REQUEST && requestId !== undefined;
}

export function hasSingletonPending(entry: RegistryEntry): boolean {
   return entry.scope === Scope.SINGLETON && entry.pending !== undefined;
}

export function hasOnBootComplete(instance: any): instance is { onBootComplete: () => Promise<void> } {
   return (
      instance != null &&
      typeof instance === 'object' &&
      'onBootComplete' in instance &&
      typeof instance.onBootComplete === 'function'
   );
}

export function isAlsToken(token: unknown): token is AlsToken {
   return AlsToken.isAlsToken(token);
}
