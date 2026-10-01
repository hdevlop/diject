import { Constructor, Metadata, MetadataQuery, RegistryEntry, Token, Options, TStore, InjectionDefinition } from "./types";
import { Register } from "./Register";
import { Resolver } from "./Resolver";
import { Deleter } from "./Deleter";
import { Instantiator } from "./Instantiator";
import { hasOnBootComplete, hasSingletonInstance, isRegistryEntry, isAlsToken, compareValues, Scope } from "./helpers";
import { AlsStore, StoreInput } from "./AlsStore";
import { AlsToken } from "./tokens";


export class Container {
   private static instance: Container | null = null;

   // Core registries
   public readonly registry = new Map<Token, RegistryEntry>();
   public readonly nameToToken = new Map<string, Token>();
   public readonly requestScoped = new Map<string, Map<Token, any>>();
   public readonly requestPromises = new Map<string, Map<Token, Promise<any>>>();
   /** @internal Tokens and request scopes currently being torn down. */
   public readonly deletingTokens = new Set<Token>();
   public readonly closingRequests = new Set<string>();
   /** @internal Prevents new resolutions while clear() is settling providers. */
   public isClearing = false;

   // Delegates
   public readonly instantiator: Instantiator;
   private readonly register: Register;
   public readonly resolver: Resolver;
   private readonly deleter: Deleter;

   // AsyncLocalStorage store
   public readonly store = new AlsStore<TStore>();

   constructor() {
      this.instantiator = new Instantiator(this);
      this.resolver = new Resolver(this);
      this.register = new Register(this);
      this.deleter = new Deleter(this);

      this.registerBuiltins();
   }

   /** @internal Built-in tokens every container starts with; restored by clear(). */
   registerBuiltins(): void {
      this.set(Container, this);
      this.set('Container', this);
      this.set('AlsStore', this.store);
   }

   // ============================================
   // SINGLETON + FACTORY PATTERN
   // ============================================

   /**
    * Get the global singleton container instance
    * Creates one if it doesn't exist
    */
   static getInstance(): Container {
      if (!Container.instance) {
         Container.instance = new Container();
      }
      return Container.instance;
   }

   /**
    * Create a new isolated container instance
    * Useful for testing to avoid shared state
    * @example
    * const testContainer = Container.create();
    */
   static create(): Container {
      return new Container();
   }

   /**
    * Reset the global singleton instance
    * Clears all registrations and creates a fresh container
    * Primarily for testing cleanup
    */
   static async reset(): Promise<Container> {
      const previous = Container.instance;
      if (previous) {
         await previous.clear();
      }

      const fresh = new Container();
      Container.instance = fresh;
      container = fresh;
      return fresh;
   }

   /**
    * Check if a global instance exists
    */
   static hasInstance(): boolean {
      return Container.instance !== null;
   }

   // ============================================
   // REGISTRATION (delegated to Register)
   // ============================================

   set<T>(token: Token, value: T): this;
   set<T>(token: string, value: T): this;
   set<T>(token: symbol, value: T): this;
   set<T>(token: Constructor[], options?: Scope | Options): this;
   set<T>(token: Constructor, value?: T | Scope | Options): this;
   set<T>(token: Token | Constructor[], value?: T | Scope | Options): this {
      this.register.set(token as any, value);
      return this;
   }

   alias(token: Token, target: Constructor): this {
      this.register.alias(token, target);
      return this;
   }

   use(injector: any): this {
      this.instantiator.use(injector);
      return this;
   }

   // ============================================
   // SYNC GET - Use after boot() completes
   // ============================================

   get<T>(token: AlsToken<T>): T | undefined;
   get<T>(token: Constructor<T>, requestId?: string): T;
   get<T = any>(token: string): T;
   get<T = any>(token: symbol): T;
   get<T>(token: Token, requestId?: string): T {
      return this.resolver.get(token as any, requestId);
   }

   // ============================================
   // ASYNC RESOLVE - Use during boot() or lazy init
   // ============================================

   resolve<T>(token: AlsToken<T>): Promise<T | undefined>;
   resolve<T>(token: Token | Constructor<T>, requestId?: string): Promise<T>;
   resolve<T = any>(token: string): Promise<T>;
   resolve<T = any>(token: symbol): Promise<T>;
   resolve<T>(token: Token, requestId?: string): Promise<T> {
      // Forward the resolver's promise as-is: an async wrapper here would add
      // a promise and microtask hops to every (nested) resolution.
      return this.resolver.resolve(token as any, requestId);
   }

   push<T>(token: Token, ...items: T[]): this {
      this.register.push(token, ...items);
      return this;
   }

   filter<T>(token: Token, predicate: (item: T) => boolean): T[] {
      return this.register.filter(token, predicate);
   }


   setInjection(definition: InjectionDefinition): Token {
      return this.register.setInjection(definition);
   }


   getInjections<T extends { type: string }>(type: T['type']): T[] {
      return this.resolver.getInjections(type);
   }


   getInjectionsFor<T extends { type: string; target?: Constructor; methodName?: string }>(
      type: T['type'],
      target: Constructor,
      methodName?: string
   ): T[] {
      return this.resolver.getInjectionsFor(type, target, methodName);
   }

   getOrdered<T>(token: Token, key: keyof T, direction: 'asc' | 'desc' = 'asc'): T[] {
      return this.resolver.getOrdered(token, key, direction);
   }
   // ============================================
   // HAS CHECK
   // ============================================

   has(token: Token): boolean {
      if (isAlsToken(token)) {
         return this.store.has(token.key);
      }
      if (this.registry.has(token)) return true;
      return typeof token === 'string' && this.nameToToken.has(token);
   }


   async delete(token: Token): Promise<void> {
      await this.deleter.delete(token);
   }

   // ============================================
   // REQUEST CONTEXT (ALS Store delegation)
   // ============================================

   run<R>(data: StoreInput<TStore>, fn: () => R): R {
      return this.store.run(data, fn);
   }

   isActive(): boolean {
      return this.store.isActive();
   }

   all(): Partial<TStore> | undefined {
      return this.store.all();
   }

   clearStore(): void {
      this.store.clear();
   }

   // ============================================
   // CLEANUP (delegated to Deleter)
   // ============================================

   /**
    * Sync check for whether any request-scoped state exists for a request.
    * Resolves the effective requestId from the active store when omitted.
    * Lets callers skip cleanupReq() on requests that never created a
    * request-scoped instance (the common case on a hot path).
    * @example
    * if (container.hasRequestScope()) await container.cleanupReq();
    */
   hasRequestScope(requestId?: string): boolean {
      const effectiveRequestId = requestId ?? this.store.get('requestId');
      if (effectiveRequestId === undefined) return false;
      return this.requestScoped.has(effectiveRequestId)
         || this.requestPromises.has(effectiveRequestId);
   }

   async cleanupReq(requestId?: string): Promise<void> {
      // Fast path: nothing request-scoped was ever created — skip the whole
      // Deleter async chain (map lookups + destroy walk).
      if (!this.hasRequestScope(requestId)) return;
      await this.deleter.cleanupReq(requestId);
   }

   async bulkRemove(items: Constructor[]): Promise<this> {
      if (!items?.length) return this;
      await Promise.all(items.map(item => this.delete(item)));
      return this;
   }

   async clear(): Promise<void> {
      await this.deleter.clear();
   }

   // ============================================
   // METADATA API (delegated to MetadataManager)
   // ============================================

   /**
    * Configure default metadata values that will be applied to all future registrations
    * @param metadata - Default metadata to merge with existing defaults
    * @example
    * container.setDefaults({ layer: 'core', priority: 10 })
    * container.setDefaults({ domain: 'auth', critical: true })
    */
   setDefaults(metadata: Metadata): this {
      this.register.setDefaults(metadata);
      return this;
   }

   /**
    * Set metadata on a token
    * @example
    * container.setMeta(UserService, 'layer', 'domain')
    * container.setMeta(UserService, { layer: 'domain', priority: 5 })
    */
   setMeta(token: Token, key: string, value: any): this;
   setMeta(token: Token, metadata: Metadata): this;
   setMeta(token: Token, keyOrMetadata: string | Metadata, value?: any): this {
      if (typeof keyOrMetadata === 'string') {
         this.register.metadata.set(token, keyOrMetadata, value);
      } else {
         this.register.metadata.set(token, keyOrMetadata);
      }
      return this;
   }

   /**
    * Get metadata from a token
    * @example
    * container.getMeta(UserService, 'layer') // 'domain'
    * container.getMeta(UserService) // { layer: 'domain', priority: 5 }
    */
   getMeta(token: Token, key?: string): any {
      return this.register.metadata.get(token, key);
   }

   /**
    * Check if token has metadata key
    */
   hasMeta(token: Token, key: string): boolean {
      return this.register.metadata.has(token, key);
   }

   /**
    * Delete metadata from a token
    */
   deleteMeta(token: Token, key: string): this {
      this.register.metadata.delete(token, key);
      return this;
   }

   /**
    * Clear all metadata from a token
    */
   clearMeta(token: Token): this {
      this.register.metadata.clear(token);
      return this;
   }

   /**
    * Clear all metadata indexes (used during full container reset)
    */
   clearMetadataIndexes(): void {
      this.register.metadata.clearIndexes();
   }

   /**
    * Find tokens by metadata query
    * @example
    * container.find({ layer: 'core' })
    * container.find({ layer: 'domain', priority: (p) => p > 5 })
    * container.find({ type: 'controller' })
    * container.find({ type: 'service' })
    */
   find(query: MetadataQuery): Token[] {
      return this.register.metadata.find(query);
   }



   /**
    * Find tokens that have a specific metadata key
    * @example
    * container.findByKey('priority')
    */
   findByKey(key: string): Token[] {
      return this.register.metadata.findByKey(key);
   }

   /**
    * Group tokens by a metadata key
    * @example
    * container.groupBy('layer') // Map { 'core' => [...], 'domain' => [...] }
    * container.groupBy('type')  // Map { 'controller' => [...], 'service' => [...] }
    */
   groupBy(key: string): Map<any, Token[]> {
      return this.register.metadata.groupBy(key);
   }

   /**
    * Get all unique values for a metadata key
    * @example
    * container.getValues('layer') // Set { 'core', 'domain', 'app' }
    * container.getValues('type')  // Set { 'controller', 'service', 'repository' }
    */
   getValues(key: string): Set<any> {
      return this.register.metadata.getValues(key);
   }

   /**
    * Filter tokens with custom predicate
    * @example
    * container.filterBy((meta) => meta.tags?.includes('critical'))
    */
   filterBy(predicate: (metadata: Metadata, token: Token) => boolean): Token[] {
      return this.register.metadata.filter(predicate);
   }

   /**
    * Bulk set metadata on multiple tokens
    * @example
    * container.bulkSetMeta([UserService, OrderService], { layer: 'domain' })
    */
   bulkSetMeta(tokens: Token[], metadata: Metadata): this {
      this.register.metadata.bulkSet(tokens, metadata);
      return this;
   }



   // ============================================
   // BOOTSTRAP
   // ============================================

   async boot<T = any>(services?: Token[] | Constructor[]): Promise<T[]> {
      const resolved: T[] = [];

      if (services && services.length > 0) {
         for (const Svc of services) {
            resolved.push(await this.resolve(Svc));
         }
      } else {
         for (const [token, entry] of this.registry) {
            if (isRegistryEntry(entry) && entry.scope === Scope.SINGLETON) {
               resolved.push(await this.resolve(token as Constructor));
            }
         }
      }

      await this.notifyBootComplete();
      return resolved;
   }

   /**
    * Boot services by metadata query
    * @example
    * await container.bootBy({ layer: 'core' })
    * await container.bootBy({ type: 'controller' })
    * await container.bootBy({ critical: true })
    */
   async bootBy(query: MetadataQuery): Promise<void> {
      const tokens = this.find(query);

      for (const token of tokens) {
         const entry = this.registry.get(token);
         if (isRegistryEntry(entry) && entry.scope === Scope.SINGLETON) {
            await this.resolve(token as Constructor);
         }
      }
   }

   /**
    * Boot services in phases based on metadata
    * @example
    * await container.bootPhased('layer', ['core', 'domain', 'app'])
    * await container.bootPhased('type', ['service', 'controller'])
    */
   async bootPhased(key: string, phases: any[]): Promise<void> {
      for (const phase of phases) {
         await this.bootBy({ [key]: phase });
      }

      await this.notifyBootComplete();
   }

   /**
    * Boot with custom ordering by metadata key
    * @example
    * await container.bootOrdered('priority', 'desc')
    */
   async bootOrdered(key: string, order: 'asc' | 'desc' = 'asc'): Promise<void> {
      const tokens = this.findByKey(key);

      // Sort by metadata value
      const sorted = tokens.sort((a, b) => {
         const result = compareValues(this.getMeta(a, key) ?? 0, this.getMeta(b, key) ?? 0);
         return order === 'asc' ? result : -result;
      });

      for (const token of sorted) {
         const entry = this.registry.get(token);
         if (isRegistryEntry(entry) && entry.scope === Scope.SINGLETON) {
            await this.resolve(token as Constructor);
         }
      }

      await this.notifyBootComplete();
   }

   private async notifyBootComplete(): Promise<void> {
      const promises: Promise<void>[] = [];

      for (const [token, entry] of this.registry) {
         if (!isRegistryEntry(entry)) continue;
         if (entry.scope !== Scope.SINGLETON) continue;
         if (!hasSingletonInstance(entry)) continue;

         if (hasOnBootComplete(entry.instance)) {
            promises.push(
               Promise.resolve(entry.instance.onBootComplete())
            );
         }
      }

      await Promise.all(promises);
   }

   async load(providers: Constructor[]): Promise<void> {
      for (const p of providers) {
         await this.resolve(p);
      }
   }

   // ============================================
   // FIND ALL / GET ALL
   // ============================================

   /**
    * Get all registered tokens
    * @example
    * container.findAll() // [UserService, Symbol(config), 'myToken', ...]
    */
   findAll(): Token[] {
      return this.resolver.findAll();
   }

   /**
    * Get all registered values/entries
    * @example
    * container.getAll() // [RegistryEntry, configValue, ...]
    */
   getAll(): any[] {
      return this.resolver.getAll();
   }

   /**
    * Get all entries as [token, value] pairs
    * @example
    * container.entries() // [[UserService, entry], [Symbol(config), value], ...]
    */
   entries(): [Token, any][] {
      return this.resolver.entries();
   }

   /**
    * Get only class constructors (filters out symbols, configs, primitives)
    * Useful for scanning decorators on classes
    * @example
    * container.getClasses() // [UserService, OrderController, AuthRepository, ...]
    */
   getClasses(): Constructor[] {
      return this.resolver.getClasses();
   }
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export let container = Container.getInstance();

export function set<T>(token: AlsToken<T>, value: T): Container;
export function set<T>(token: string, value: T): Container;
export function set<T>(token: symbol, value: T): Container;
export function set<T>(token: Constructor[], options?: Scope | Options): Container;
export function set<T>(token: Constructor<T>, value?: T | Scope | Options): Container;
export function set<T>(token: Token | Constructor[], value?: T | Scope | Options): Container {
   return container.set(token as any, value);
}

export function get<T>(token: AlsToken<T>): T | undefined;
export function get<T>(token: Constructor<T>, requestId?: string): T;
export function get<T = any>(token: string): T;
export function get<T = any>(token: symbol): T;
export function get<T>(token: Token, requestId?: string): T {
   return container.get(token as any, requestId);
}

export async function resolve<T>(token: AlsToken<T>): Promise<T | undefined>;
export async function resolve<T>(token: Constructor<T>, requestId?: string): Promise<T>;
export async function resolve<T = any>(token: string): Promise<T>;
export async function resolve<T = any>(token: symbol): Promise<T>;
export async function resolve<T>(token: Token, requestId?: string): Promise<T> {
   return container.resolve(token as any, requestId);
}

export function has(token: Token): boolean {
   return container.has(token);
}

export function alias(token: Token, target: Constructor): Container {
   return container.alias(token, target);
}

export async function boot(services?: Constructor[]) {
   return await container.boot(services);
}

export async function reset(): Promise<Container> {
   return Container.reset();
}

export function findAll(): Token[] {
   return container.findAll();
}

export function getAll(): any[] {
   return container.getAll();
}

export function getClasses(): Constructor[] {
   return container.getClasses();
}
