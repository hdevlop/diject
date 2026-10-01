import { getDecoratorMetadata, getScope, getClassType } from "../decorators";
import { Constructor, Factory, Metadata, Options, RegEntryOpts, Token, InjectionDefinition } from "./types";
import { AliasEntry, FactoryWrapper, ProviderEntry, isArrayToken, isConstructor, isNamedToken, isAlsToken, Scope, isRegistryEntry } from "./helpers";
import { Container } from "./core";
import { Instantiator } from "./Instantiator";
import { DIError } from "./DIError";
import { AlsToken } from "./tokens";
import { AlsStore } from "./AlsStore";
import { MetadataManager } from "./Metadata";

export class Register {
   private registry: Map<any, any>;
   private nameToToken: Map<string, Token>;
   private instantiator: Instantiator;
   private store: AlsStore;

   public readonly metadata: MetadataManager;

   // Add default metadata configuration
   private defaultMetadata: Metadata = {};

   constructor(private container: Container) {
      this.registry = container.registry;
      this.instantiator = container.instantiator;
      this.nameToToken = container.nameToToken;
      this.store = container.store;
      this.metadata = new MetadataManager(this.registry);
   }

   setDefaults(metadata: Metadata): this {
      this.defaultMetadata = { ...this.defaultMetadata, ...metadata };
      return this;
   }


   push<T>(token: Token, ...items: T[]): void {
      const existing = this.registry.get(token);
      if (isRegistryEntry(existing)) {
         throw DIError.cannotPushToClass(token);
      }
      const arr: T[] = existing ?? [];
      arr.push(...items);
      this.registry.set(token, arr);
   }

   filter<T>(token: Token, predicate: (item: T) => boolean): T[] {
      const arr = this.registry.get(token);
      if (!Array.isArray(arr)) return [];
      return arr.filter(predicate);
   }


   setInjection(definition: InjectionDefinition): Token {
      const { type, target, methodName, propertyKey, order, scope, name, ...data } = definition;

      const tokenId = [type, target?.name, methodName ?? propertyKey, name ?? Date.now()].filter(Boolean).join(':');
      const token = Symbol(tokenId);

      this.registry.set(token, { target, methodName, propertyKey, ...data });
      this.metadata.set(token, { type, targetName: target?.name, methodName, propertyKey, order: order ?? 999, scope, name });

      return token;
   }


   // ============================================
   // PUBLIC API
   // ============================================

   set<T>(token: string, input: T): this;
   set<T>(token: symbol, value: T): this;
   set<T>(token: Constructor[], options?: Scope | Options): this;
   set<T>(token: Constructor, input?: Scope | Options): this;
   set<T>(token: AlsToken<T>, input: T): this;
   set<T>(token: Token | Constructor[], input?: Scope | Options): this {
      if (isArrayToken(token)) {
         return this.handleArrayToken(token, this.cleanInput(input));
      }

      if (isAlsToken(token)) {
         return this.handleAlsToken(token, input);
      }

      if (isNamedToken(token)) {
         return this.handleNamedToken(token, input);
      }

      if (isConstructor(token)) {
         return this.handleConstructor(token, this.cleanInput(input));
      }

      return this;
   }

   // ============================================
   // REGISTRATION METHODS
   // ============================================

   private registerEntry(options: RegEntryOpts): void {
      const { token, type, scope, factory, deps, input, metadata } = options;

      // Re-registration must remove the previous entry from every metadata
      // index before replacing it, otherwise old queries keep ghost tokens.
      this.metadata.removeToken(token);

      if (input !== undefined) {
         this.registry.set(token, input);
         return;
      }

      // Registry entry holds only runtime concerns
      this.registry.set(token, new ProviderEntry(scope ?? Scope.SINGLETON, factory, deps));

      // Type goes ONLY in metadata
      // Merge: defaults < type < provided metadata
      const resolvedType = type ?? "service";
      const finalMetadata: Metadata = {
         ...this.defaultMetadata,
         type: resolvedType,
         ...metadata
      };
      this.metadata.set(token, finalMetadata);
   }

   // ============================================
   // HANDLERS
   // ============================================

   private handleConstructor(token: Constructor, input?: unknown): this {
      const ctx = this.resolveCtx(token, input);

      // Merge decorator metadata with options metadata
      const decoratorMeta = getDecoratorMetadata(token);
      const mergedMetadata = { ...decoratorMeta, ...ctx.metadata };
      const finalCtx = { ...ctx, metadata: mergedMetadata };

      this.nameToToken.set(token.name, token);

      // If type is already provided in options, use it
      if (finalCtx.type) {
         this.validateType(finalCtx);
         this.registerEntry(finalCtx);
         return this;
      }

      // If it's an instance, register as-is
      if (this.isInstance(input)) {
         this.registerEntry({ token, input });
         return this;
      }

      // Read the generic TYPE from decorator metadata
      const decoratorType = getClassType(token);

      if (decoratorType) {
         // Use whatever type the decorator declared
         this.registerEntry({ ...finalCtx, type: decoratorType });
         return this;
      }

      // Default to 'service' if no decorator type
      this.registerEntry({ ...finalCtx, type: "service" });
      return this;
   }

   private handleArrayToken(tokens: Constructor[], options?: unknown): this {
      for (const token of tokens) {
         this.set(token, options as Scope | Options);
      }
      return this;
   }

   private handleNamedToken(token: Token, input: unknown): this {
      this.metadata.removeToken(token);
      const wrapped = typeof input === "function"
         ? new FactoryWrapper(input)
         : input;

      // Named values may legitimately be null, undefined, or an empty object.
      // Write them directly so undefined is not confused with a class provider.
      this.registry.set(token, wrapped);
      return this;
   }

   private handleAlsToken(token: AlsToken, input: unknown): this {
      this.store.set(token.key, input);
      return this;
   }

   private validateType(ctx: any): void {
      if (!ctx.type) return;

      const actualType = getClassType(ctx.token);
      if (!actualType) return;

      if (actualType !== ctx.type) {
         throw DIError.typeMismatch(ctx.token, ctx.type, actualType);
      }
   }

   // ============================================
   // HELPERS
   // ============================================

   private resolveCtx(token: Constructor, input?: unknown) {
      const options = this.asOptions(input);

      let factory: (requestId?: string) => any;
      if (this.isFactory(input)) {
         const directFactory = input;
         factory = (requestId?: string) => directFactory(requestId);
      } else if (options?.factory) {
         const optionsFactory = options.factory;
         factory = options.deps !== undefined
            ? async (requestId?: string) => {
               const deps = await Promise.all(
                  options.deps!.map(dep => this.container.resolve(dep, requestId))
               );
               return optionsFactory(...deps);
            }
            : (requestId?: string) => optionsFactory(requestId);
      } else {
         factory = (requestId?: string) => this.instantiator.build(token, requestId, options?.deps);
      }

      return {
         token,
         factory,
         scope: this.resolveScope(token, input, options),
         deps: options?.deps,
         type: options?.metadata?.type as string | undefined,
         metadata: options?.metadata
      };
   }

   /**
    * Resolve scope with priority:
    * 1. Explicit scope passed to set() (e.g., container.set(Svc, Scope.REQUEST))
    * 2. Scope in options object (e.g., container.set(Svc, { scope: Scope.REQUEST }))
    * 3. Scope from decorator (e.g., @Service(Scope.REQUEST))
    * 4. Default: SINGLETON
    */
   private resolveScope(token: Constructor, value: unknown, options?: Options): Scope {
      // 1. Explicit scope passed directly
      if (this.isScope(value)) return value;

      // 2. Scope in options object
      if (options?.scope) return options.scope;

      // 3. Scope from decorator (getScope already defaults to SINGLETON)
      return getScope(token);
   }

   private isFactory(value: unknown): value is Factory {
      if (typeof value === "function" && !isConstructor(value)) {
         return true;
      }
      return false;
   }

   private isScope(value: unknown): value is Scope {
      return Object.values(Scope).includes(value as Scope);
   }

   private asOptions(value: unknown): Options | undefined {
      // Only plain object literals are options. Class instances are values to
      // register as-is, even when they carry `metadata`, `deps`, or `factory`.
      if (!this.isPlainObject(value)) return undefined;

      const obj = value as Record<string, unknown>;
      const has = (key: string) => Object.prototype.hasOwnProperty.call(obj, key);
      const hasValidKey = ["scope", "deps", "factory", "metadata"].some(has);

      if (!hasValidKey) return undefined;

      if (has("scope") && obj.scope != null && !this.isScope(obj.scope)) {
         return undefined;
      }
      if (has("deps") && obj.deps != null && !Array.isArray(obj.deps)) {
         return undefined;
      }
      if (has("factory") && obj.factory != null && typeof obj.factory !== "function") {
         return undefined;
      }
      if (has("metadata") && obj.metadata != null && typeof obj.metadata !== "object") {
         return undefined;
      }

      return value as Options;
   }

   private isPlainObject(value: unknown): boolean {
      if (value === null || typeof value !== "object") return false;
      const proto = Object.getPrototypeOf(value);
      return proto === Object.prototype || proto === null;
   }

   private isInstance(value: unknown): boolean {
      return (
         value != null &&
         typeof value === "object" &&
         !this.isScope(value) &&
         !this.asOptions(value)
      );
   }

   private cleanInput(value: unknown): unknown {
      if (value == null) return undefined;

      if (typeof value === "object") {
         if (!this.isPlainObject(value)) return value;

         const keys = Object.keys(value as object);
         if (keys.length === 0) return undefined;

         const options = this.asOptions(value);
         if (options) {
            return this.cleanOptions(options);
         }
      }

      return value;
   }

   private cleanOptions(options: Options): Options | undefined {
      const cleaned: Options = {};

      if (options.scope != null) {
         cleaned.scope = options.scope;
      }
      if (options.factory != null) {
         cleaned.factory = options.factory;
      }
      if (Array.isArray(options.deps)) {
         const filtered = options.deps.filter(d => d != null);
         if (filtered.length > 0 || options.deps.length === 0) {
            cleaned.deps = filtered;
         }
      }
      if (options.metadata != null && typeof options.metadata === "object") {
         cleaned.metadata = options.metadata;
      }

      return Object.keys(cleaned).length > 0 ? cleaned : undefined;
   }


   alias(token: Token, target: Constructor): this {
      // True forwarder: get/resolve(token) follows to target.
      // No separate singleton slot, so the alias works without an explicit
      // boot pass for the alias token itself.
      this.metadata.removeToken(token);
      this.registry.set(token, new AliasEntry(target));
      return this;
   }

   getByName(name: string): Token | undefined {
      return this.nameToToken.get(name);
   }
}
