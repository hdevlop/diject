/// <reference path="../node-async-hooks.d.ts" />
import { AsyncLocalStorage } from 'node:async_hooks';
import { Constructor, RegistryEntry, Token } from "./types";
import {
   FactoryWrapper,
   hasOnInit,
   hasOnDestroy,
   isAliasEntry,
   isNamedToken,
   isRegistryEntry,
   hasSingletonInstance,
   isReqScope,
   hasSingletonPending,
   isAlsToken,
   compareValues,
   Scope,
} from "./helpers";
import { Container } from "./core";
import { DIError } from "./DIError";
import { AlsStore } from "./AlsStore";

/**
 * The provider chain currently being built. Lives in its own
 * AsyncLocalStorage so resolution never forks the user's request store.
 */
interface ResolutionContext {
   readonly tokens: readonly Token[];
   readonly scopes: readonly Scope[];
   readonly parent: ResolutionContext | undefined;
   /** Cleared once the provider that owns this context has settled. */
   active: boolean;
}

const ROOT_CONTEXT: ResolutionContext = Object.freeze({
   tokens: [],
   scopes: [],
   parent: undefined,
   active: true,
});

export class Resolver {

   private readonly resolution = new AsyncLocalStorage<ResolutionContext>();
   private instances = new WeakSet<object>();
   private initPromises = new WeakMap<object, Promise<void>>();
   private nameToToken: Map<string, Token>;
   private registry: Map<Token, RegistryEntry | any>;
   private requestScoped: Map<string, Map<Token, any>>;
   private requestPromises: Map<string, Map<Token, Promise<any>>>;
   private store: AlsStore;

   constructor(private container: Container) {
      this.registry = container.registry;
      this.nameToToken = container.nameToToken;
      this.requestScoped = container.requestScoped;
      this.requestPromises = container.requestPromises;
      this.store = container.store;
   }


   getInjections<T>(type: string): T[] {
      const tokens = this.container.find({ type });
      return tokens.map(token => ({
         ...this.registry.get(token),
         ...this.container.getMeta(token),
      })) as T[];
   }

   getInjectionsFor<T>(type: string, target: Constructor, methodName?: string): T[] {
      // Filter before merging: global injectors call this on every class
      // build, and most injections of a type belong to other targets.
      const result: T[] = [];
      for (const token of this.container.find({ type })) {
         const value = this.registry.get(token);
         if (this.injectionField(token, value, 'target') !== target) continue;
         if (methodName !== undefined && this.injectionField(token, value, 'methodName') !== methodName) continue;
         result.push({ ...value, ...this.container.getMeta(token) } as T);
      }
      return result;
   }

   /** Field as `{ ...value, ...meta }` would expose it: metadata wins, then own enumerable props. */
   private injectionField(token: Token, value: any, key: string): any {
      if (this.container.hasMeta(token, key)) return this.container.getMeta(token, key);
      return value != null && Object.prototype.propertyIsEnumerable.call(value, key) ? value[key] : undefined;
   }


   hasInjection(type: string, target: Constructor, methodName?: string): boolean {
      return this.getInjectionsFor(type, target, methodName).length > 0;
   }

   // ============================================
   // HELPER - Get requestId
   // ============================================

   private getRequestId(requestId?: string): string | undefined {
      return requestId ?? this.store.get('requestId');
   }

   // ============================================
   // HELPER - Resolve string to actual token
   // ============================================

   private resolveToken(token: Token): Token {
      if (typeof token === 'string') {
         const actualToken = this.getByName(token);
         if (actualToken) return actualToken;
      }
      return token;
   }

   /**
    * Follow alias entries until a non-alias entry is found.
    * Guards against alias cycles by tracking visited tokens.
    */
   private followAlias(token: Token, first: RegistryEntry | any = this.registry.get(token)): Token {
      // Hot path: the overwhelmingly common case is a non-alias entry, so
      // check once and bail with zero allocations (no Set). Callers that
      // already fetched the entry can pass it to skip the first lookup.
      if (!isAliasEntry(first)) return token;

      // One-hop alias (the common alias shape): the target is not itself an
      // alias, so there is no chain to walk and no cycle possible.
      let current: Token = first.target;
      if (!isAliasEntry(this.registry.get(current))) return current;

      // Slow path (alias chain): walk it with a cycle guard.
      const seen = new Set<Token>([token]);
      // eslint-disable-next-line no-constant-condition
      while (true) {
         if (seen.has(current)) {
            throw DIError.circularDependency([...seen, current]);
         }
         seen.add(current);
         const value = this.registry.get(current);
         if (!isAliasEntry(value)) return current;
         current = value.target;
      }
   }

   // ============================================
   // SYNC GET - Use after boot() completes
   // ============================================

   get<T>(token: string): T;
   get<T>(token: symbol): T;
   get<T>(token: Constructor<T>, requestId?: string): T;
   get<T>(token: Token, requestId?: string): T {
      // Handle AlsToken first
      if (isAlsToken(token)) {
         return this.store.get(token.key) as T;
      }

      // Try to resolve string as class name first
      const initialToken = this.resolveToken(token);

      // Single registry lookup, reused for the existence, alias, and entry
      // checks below (the hot path — a booted class singleton — now does one
      // Map.get instead of has()+get()+get()).
      let value = this.registry.get(initialToken);
      if (value === undefined && !this.registry.has(initialToken)) {
         throw DIError.notRegistered(initialToken);
      }

      // Follow alias chains so get(aliasToken) returns the target's instance.
      // Non-alias entries (overwhelmingly common) skip this with no re-lookup.
      let resolvedToken = initialToken;
      if (isAliasEntry(value)) {
         resolvedToken = this.followAlias(initialToken, value);
         value = this.registry.get(resolvedToken);
         if (value === undefined && !this.registry.has(resolvedToken)) {
            throw DIError.notRegistered(resolvedToken);
         }
      }

      this.checkAvailable(initialToken, resolvedToken);

      const effectiveRequestId = this.getRequestId(requestId);

      if (isNamedToken(resolvedToken)) {
         return this.getBindingSync(resolvedToken);
      }

      // Raw value (not a registry entry)
      if (!isRegistryEntry(value)) {
         return value;
      }

      // Singleton: must be cached after boot()
      if (value.scope === Scope.SINGLETON) {
         if (!hasSingletonInstance(value)) {
            throw DIError.singletonNotInitialized(resolvedToken);
         }
         return value.instance;
      }

      // Request-scoped: must have requestId and be cached
      if (value.scope === Scope.REQUEST) {
         if (effectiveRequestId === undefined) {
            throw DIError.requestIdRequired(resolvedToken);
         }

         if (this.container.closingRequests.has(effectiveRequestId)) {
            throw DIError.scopeViolation(resolvedToken, `request "${effectiveRequestId}" is closing`);
         }

         const cache = this.getReqCache(effectiveRequestId);
         if (cache?.has(resolvedToken)) return cache.get(resolvedToken);

         throw DIError.requestInstanceNotFound(resolvedToken, effectiveRequestId);
      }

      // Transient: always create new (sync not supported)
      throw DIError.transientSyncNotSupported(resolvedToken);
   }

   private getBindingSync<T>(token: Token): T {
      const value = this.registry.get(token);

      if (value instanceof FactoryWrapper) {
         throw DIError.asyncFactoryRequired(token);
      }

      if (isRegistryEntry(value)) {
         if (!hasSingletonInstance(value)) {
            throw DIError.singletonNotInitialized(token);
         }
         return value.instance;
      }

      return value;
   }

   // ============================================
   // ASYNC RESOLVE - Use during boot() or for request-scoped
   // ============================================

   resolve<T>(token: string): Promise<T>;
   resolve<T>(token: symbol): Promise<T>;
   resolve<T>(token: Constructor<T>, requestId?: string): Promise<T>;
   resolve<T>(token: Token, requestId?: string): Promise<T> {
      // Not async: resolveInContext is, so failures still surface as
      // rejections, without an extra wrapper promise per resolution.
      return this.resolveInContext<T>(token, requestId, this.currentContext());
   }

   /**
    * The innermost provider still under construction. Detached work (timers,
    * listeners) started during construction keeps the context it captured
    * after that provider settles; settled contexts are skipped so the work is
    * not treated as part of the chain, while a still-active ancestor keeps its
    * cycle and scope checks.
    */
   private currentContext(): ResolutionContext {
      let context = this.resolution.getStore();
      while (context !== undefined && !context.active) {
         context = context.parent;
      }
      return context ?? ROOT_CONTEXT;
   }

   private async resolveInContext<T>(token: Token, requestId: string | undefined, context: ResolutionContext): Promise<T> {
      // Handle AlsToken first
      if (isAlsToken(token)) {
         return this.store.get(token.key) as T;
      }

      // Try to resolve string as class name first
      const initialToken = this.resolveToken(token);

      this.checkTokenExist(initialToken);

      // Follow alias chains so resolve(aliasToken) yields the target's instance
      const resolvedToken = this.followAlias(initialToken);
      if (resolvedToken !== initialToken) {
         this.checkTokenExist(resolvedToken);
      }

      this.checkAvailable(initialToken, resolvedToken);

      const effectiveRequestId = this.getRequestId(requestId);

      const value = this.registry.get(resolvedToken);

      if (isNamedToken(resolvedToken)) {
         return this.resolveBinding(resolvedToken, value, context);
      }

      // Raw value
      if (!isRegistryEntry(value)) {
         return value;
      }

      // Already cached singleton
      if (hasSingletonInstance(value)) {
         return value.instance;
      }

      if (value.scope === Scope.REQUEST) {
         if (context.scopes.includes(Scope.SINGLETON)) {
            throw DIError.scopeViolation(
               resolvedToken,
               'singleton resolution cannot capture a request-scoped provider'
            );
         }
         if (effectiveRequestId === undefined) {
            throw DIError.requestIdRequired(resolvedToken);
         }
         if (this.container.closingRequests.has(effectiveRequestId)) {
            throw DIError.scopeViolation(resolvedToken, `request "${effectiveRequestId}" is closing`);
         }

         const cache = this.getReqCache(effectiveRequestId);
         if (cache?.has(resolvedToken)) return cache.get(resolvedToken);
      }

      // A pending provider is safe to share across independent top-level
      // resolutions, but recursive access from the same immutable path is a
      // genuine cycle and must fail instead of deadlocking on its own promise.
      this.checkCircularDep(resolvedToken, context);

      if (hasSingletonPending(value)) {
         return value.pending;
      }

      if (isReqScope(value, effectiveRequestId)) {
         const inFlight = this.getReqPromiseCache(effectiveRequestId!)?.get(resolvedToken);
         if (inFlight) return inFlight;
      }

      // Create new instance
      const pending = this.runProvider(
         context,
         resolvedToken,
         value.scope,
         (child) => this.createInstance<T>(resolvedToken as Constructor, value, child, effectiveRequestId)
      );

      // Track pending promise to handle concurrent resolves
      if (value.scope === Scope.SINGLETON) {
         value.pending = pending;
      } else if (isReqScope(value, effectiveRequestId)) {
         const cache = this.ensureReqPromiseCache(effectiveRequestId!);
         cache.set(resolvedToken, pending);
      }

      return pending;
   }

   private async resolveBinding<T>(token: Token, value: any, context: ResolutionContext): Promise<T> {
      if (value instanceof FactoryWrapper) {
         this.checkCircularDep(token, context);
         if (value.pending) {
            return value.pending;
         }

         // The result replaces the factory for good, so it is singleton-lived
         // and must not capture request-scoped providers.
         const promise = this.runProvider(context, token, Scope.SINGLETON, async (child) => {
            try {
               const instance = await value.factory();
               await this.init(instance);
               // A re-registration made while the factory ran wins.
               if (this.registry.get(token) === value) {
                  this.registry.set(token, instance);
               }
               return instance;
            } finally {
               child.active = false;
               delete value.pending;
            }
         });

         value.pending = promise;
         return promise;
      }

      if (isRegistryEntry(value)) {
         if (hasSingletonInstance(value)) return value.instance;
         this.checkCircularDep(token, context);
         if (hasSingletonPending(value)) return value.pending;
         const pending = this.runProvider(
            context,
            token,
            value.scope,
            (child) => this.createInstance<T>(token as any, value, child)
         );
         value.pending = pending;
         return pending;
      }

      return value;
   }

   // ============================================
   // INSTANCE CREATION
   // ============================================

   private async createInstance<T>(
      token: Constructor,
      entry: RegistryEntry,
      context: ResolutionContext,
      requestId?: string
   ): Promise<T> {
      try {
         const instance = await entry.factory(requestId);
         // init() is a no-op without an onInit hook; skip its async frame.
         if (hasOnInit(instance)) await this.init(instance);
         this.cache(token, entry, instance, requestId);
         return instance;
      } finally {
         context.active = false;
         delete entry.pending;

         if (isReqScope(entry, requestId)) {
            this.getReqPromiseCache(requestId!)?.delete(token);
         }
      }
   }

   // ============================================
   // CACHING
   // ============================================

   private cache(token: Token, entry: RegistryEntry, instance: any, requestId: string | undefined): void {
      // Only cache into the registration this build started from: a
      // re-registration made mid-build must not inherit the stale instance.
      if (this.registry.get(token) !== entry) return;

      if (entry.scope === Scope.SINGLETON) {
         entry.instance = instance;
      } else if (entry.scope === Scope.REQUEST && requestId !== undefined) {
         const cache = this.ensureReqCache(requestId);
         cache.set(token, instance);
      }
   }

   // ============================================
   // LIFECYCLE
   // ============================================

   async init(instance: any): Promise<void> {
      if (!this.isObject(instance)) return;
      if (this.instances.has(instance)) return;

      const inFlight = this.initPromises.get(instance);
      if (inFlight) return inFlight;

      if (hasOnInit(instance)) {
         const pending = (async () => {
            await instance.onInit();
            this.instances.add(instance);
         })();
         this.initPromises.set(instance, pending);
         try {
            await pending;
         } finally {
            this.initPromises.delete(instance);
         }
      }
   }

   async destroy(instance: any): Promise<void> {
      if (!hasOnDestroy(instance)) return;

      try {
         await instance.onDestroy();
      } catch {
         // Silently continue - cleanup should not throw
      }
   }

   // ============================================
   // REQUEST SCOPE HELPERS
   // ============================================

   private getReqCache(requestId: string): Map<any, any> | undefined {
      return this.requestScoped.get(requestId);
   }

   private getReqPromiseCache(requestId: string): Map<any, any> | undefined {
      return this.requestPromises.get(requestId);
   }

   private ensureReqPromiseCache(requestId: string): Map<any, any> {
      if (!this.requestPromises.has(requestId)) {
         this.requestPromises.set(requestId, new Map());
      }
      return this.requestPromises.get(requestId)!;
   }

   private ensureReqCache(requestId: string): Map<any, any> {
      if (!this.requestScoped.has(requestId)) {
         this.requestScoped.set(requestId, new Map());
      }
      return this.requestScoped.get(requestId)!;
   }

   getOrdered<T>(token: any, key: keyof T, direction: 'asc' | 'desc' = 'asc'): T[] {
      const items = this.get<T[]>(token) ?? [];

      return [...items].sort((a, b) => {
         const order = compareValues(a[key], b[key]);
         return direction === 'asc' ? order : -order;
      });
   }

   // ============================================
   // UTILITIES
   // ============================================

   private isObject(value: any): boolean {
      return value !== null && typeof value === 'object';
   }

   private checkTokenExist(token: Token): void {
      if (!this.registry.has(token)) {
         throw DIError.notRegistered(token);
      }
   }

   private checkCircularDep(token: Token, context: ResolutionContext): void {
      if (context.tokens.includes(token)) {
         throw DIError.circularDependency([...context.tokens, token]);
      }
   }

   /**
    * Run a provider's build inside a child resolution context. The build must
    * clear `child.active` once it settles (done in its own `finally`, which
    * avoids an extra async wrapper on every instance creation).
    */
   private runProvider<T>(
      context: ResolutionContext,
      token: Token,
      scope: Scope | undefined,
      build: (child: ResolutionContext) => Promise<T>
   ): Promise<T> {
      const child: ResolutionContext = {
         tokens: [...context.tokens, token],
         scopes: scope === undefined ? context.scopes : [...context.scopes, scope],
         parent: context === ROOT_CONTEXT ? undefined : context,
         active: true,
      };
      return this.resolution.run(child, () => build(child));
   }

   private checkAvailable(initialToken: Token, resolvedToken: Token): void {
      if (
         this.container.isClearing
         || this.container.deletingTokens.has(initialToken)
         || this.container.deletingTokens.has(resolvedToken)
      ) {
         throw DIError.notRegistered(initialToken);
      }
   }

   private getByName(name: string): Token | undefined {
      return this.nameToToken.get(name);
   }

   // ============================================
   // FIND ALL
   // ============================================

   /**
    * Get all registered tokens
    */
   findAll(): Token[] {
      return [...this.registry.keys()];
   }

   /**
    * Get all registered values (entries)
    */
   getAll(): any[] {
      return [...this.registry.values()];
   }

   /**
    * Get all entries as [token, value] pairs
    */
   entries(): [Token, any][] {
      return [...this.registry.entries()];
   }

   /**
    * Get only class constructors (filters out symbols, configs, primitives)
    */
   getClasses(): Constructor[] {
      const classes: Constructor[] = [];

      for (const token of this.registry.keys()) {
         if (this.isClass(token)) {
            classes.push(token);
         }
      }

      return classes;
   }

   /**
    * Check if value is a class constructor
    */
   private isClass(value: unknown): value is Constructor {
      return (
         typeof value === 'function' &&
         value.prototype !== undefined &&
         value.prototype.constructor === value
      );
   }
}
