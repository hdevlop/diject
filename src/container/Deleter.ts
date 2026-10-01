import { Container } from "./core";
import { AlsStore } from "./AlsStore";
import { FactoryWrapper, hasOnDestroy, isNamedToken, isRegistryEntry, isAlsToken } from "./helpers";
import { AlsToken } from "./tokens";
import type { Token } from "./types";

export class Deleter {
   private readonly registry: Map<Token, any>;
   private readonly store: AlsStore;
   private readonly nameToToken: Map<string, Token>;
   private readonly requestScoped: Map<string, Map<Token, any>>;
   private readonly requestPromises: Map<string, Map<Token, Promise<any>>>;

   constructor(private readonly container: Container) {
      this.registry = container.registry;
      this.nameToToken = container.nameToToken;
      this.requestScoped = container.requestScoped;
      this.requestPromises = container.requestPromises;
      this.store = container.store;
   }

   // ============================================
   // REQUEST CLEANUP
   // ============================================

   async cleanupReq(requestId?: string): Promise<void> {
      const effectiveRequestId = this.resolveRequestId(requestId);

      if (effectiveRequestId === undefined) {
         // No requestId found - nothing to cleanup
         return;
      }

      // Fast path: nothing in flight and no onDestroy hooks means there is
      // nothing to wait for, so drop the maps without the closing window.
      if (this.canCleanupSync(effectiveRequestId)) {
         this.clearRequestMaps(effectiveRequestId);
         return;
      }

      this.container.closingRequests.add(effectiveRequestId);
      try {
         await this.settleRequestPromises(effectiveRequestId);
         await this.destroyRequestScopedInstances(effectiveRequestId);
         this.clearRequestMaps(effectiveRequestId);
      } finally {
         this.container.closingRequests.delete(effectiveRequestId);
      }
   }

   private canCleanupSync(requestId: string): boolean {
      if (this.requestPromises.get(requestId)?.size) return false;
      const scopedInstances = this.requestScoped.get(requestId);
      if (scopedInstances) {
         for (const instance of scopedInstances.values()) {
            if (hasOnDestroy(instance)) return false;
         }
      }
      return true;
   }

   private async settleRequestPromises(requestId: string): Promise<void> {
      const promises = this.requestPromises.get(requestId);
      if (!promises?.size) return;
      await Promise.allSettled([...promises.values()]);
   }

   private async destroyRequestScopedInstances(requestId: string): Promise<void> {
      const scopedInstances = this.requestScoped.get(requestId);
      if (!scopedInstances) return;

      const destroyPromises = Array.from(scopedInstances.values())
         .map(instance => this.destroy(instance));

      await Promise.all(destroyPromises);
   }

   private clearRequestMaps(requestId: string): void {
      this.requestScoped.delete(requestId);
      this.requestPromises.delete(requestId);
   }

   // ============================================
   // DELETE_SINGLE TOKEN
   // ============================================

   async delete(token: Token): Promise<void> {
      if (isAlsToken(token)) {
         return this.deleteAlsToken(token);
      }

      const resolvedToken = this.resolveToken(token);
      this.container.deletingTokens.add(resolvedToken);
      try {
         if (isNamedToken(resolvedToken)) {
            return await this.deleteNamedToken(resolvedToken);
         }

         return await this.deleteRegistryToken(resolvedToken);
      } finally {
         this.container.deletingTokens.delete(resolvedToken);
      }
   }

   private deleteAlsToken(token: AlsToken): void {
      this.store.delete(token.key);
   }

   private async deleteNamedToken(token: Token): Promise<void> {
      await this.settleTokenPromises(token);
      const value = this.registry.get(token);

      if (this.isDestroyableValue(value)) {
         await this.destroy(value);
      }

      this.container.clearMeta(token);
      this.registry.delete(token);
   }

   private async deleteRegistryToken(token: Token): Promise<void> {
      const hadRegistration = this.registry.has(token);
      const hadRequestInstance = [...this.requestScoped.values()].some(scope => scope.has(token));
      const hadPendingRequest = [...this.requestPromises.values()].some(scope => scope.has(token));
      if (!hadRegistration && !hadRequestInstance && !hadPendingRequest) return;

      await this.settleTokenPromises(token);
      const value = this.registry.get(token);

      // Clean up metadata indexes before deleting
      this.container.clearMeta(token);

      if (this.registry.has(token)) {
         await this.destroyRegistryValue(value);
      }
      await this.cleanTokenFromRequestScopes(token);
      this.removeTokenFromRequestPromises(token);
      this.removeTokenFromMaps(token);
   }

   private async settleTokenPromises(token: Token): Promise<void> {
      const promises = new Set<Promise<any>>();
      const value = this.registry.get(token);

      if (value instanceof FactoryWrapper && value.pending) {
         promises.add(value.pending);
      } else if (isRegistryEntry(value) && value.pending) {
         promises.add(value.pending);
      }

      for (const requestMap of this.requestPromises.values()) {
         const pending = requestMap.get(token);
         if (pending) promises.add(pending);
      }

      if (promises.size) {
         await Promise.allSettled([...promises]);
      }
   }

   private async destroyRegistryValue(value: any): Promise<void> {
      if (isRegistryEntry(value) && value.instance !== undefined) {
         await this.destroy(value.instance);
      } else if (!isRegistryEntry(value)) {
         await this.destroy(value);
      }
   }

   private async cleanTokenFromRequestScopes(token: Token): Promise<void> {
      for (const scope of this.requestScoped.values()) {
         const scopedInstance = scope.get(token);

         if (scope.has(token)) {
            await this.destroy(scopedInstance);
         }

         scope.delete(token);
      }
   }

   private removeTokenFromRequestPromises(token: Token): void {
      for (const promises of this.requestPromises.values()) {
         promises.delete(token);
      }
   }

   private removeTokenFromMaps(token: Token): void {
      this.registry.delete(token);

      if (typeof token === 'function') {
         if (this.nameToToken.get(token.name) === token) {
            this.nameToToken.delete(token.name);
         }
      }
   }

   // ============================================
   // CLEAR ALL
   // ============================================

   async clear(): Promise<void> {
      this.container.isClearing = true;
      try {
         await this.settleAllPromises();

         const instances = this.collectInstancesToDestroy();
         await Promise.all([...instances].map(instance => this.destroy(instance)));

         // Clear metadata indexes
         this.container.clearMetadataIndexes();

         this.clearAllMaps();
      } finally {
         this.container.isClearing = false;
      }
   }

   private async settleAllPromises(): Promise<void> {
      const promises = new Set<Promise<any>>();
      for (const value of this.registry.values()) {
         if (value instanceof FactoryWrapper && value.pending) {
            promises.add(value.pending);
         } else if (isRegistryEntry(value) && value.pending) {
            promises.add(value.pending);
         }
      }
      for (const requestMap of this.requestPromises.values()) {
         for (const pending of requestMap.values()) promises.add(pending);
      }
      if (promises.size) {
         await Promise.allSettled([...promises]);
      }
   }

   /**
    * Every live instance exactly once: the same object can sit behind several
    * tokens (e.g. a named factory that returns a class singleton).
    */
   private collectInstancesToDestroy(): Set<any> {
      const instances = new Set<any>();

      for (const value of this.registry.values()) {
         if (value instanceof FactoryWrapper) continue;

         const instance = this.extractInstance(value);
         if (instance && !this.isBuiltin(instance)) {
            instances.add(instance);
         }
      }

      for (const scopedInstances of this.requestScoped.values()) {
         for (const instance of scopedInstances.values()) {
            instances.add(instance);
         }
      }

      return instances;
   }

   private isBuiltin(value: any): boolean {
      return value === this.container || value === this.container.store;
   }

   private extractInstance(value: any): any | null {
      if (isRegistryEntry(value)) {
         return value.instance ?? null;
      }
      return value ?? null;
   }

   private clearAllMaps(): void {
      this.registry.clear();
      this.requestScoped.clear();
      this.requestPromises.clear();
      this.nameToToken.clear();

      // Keep the container usable after clear(): @DI() and @Store() rely on these
      this.container.registerBuiltins();
   }

   // ============================================
   // DESTROY INSTANCE
   // ============================================

   async destroy(instance: any): Promise<void> {
      if (!hasOnDestroy(instance)) return;

      try {
         await instance.onDestroy();
      } catch (error) {
         // Silently continue cleanup even if onDestroy fails
         // Error is swallowed to prevent cleanup interruption
      }
   }

   // ============================================
   // HELPERS
   // ============================================

   private resolveRequestId(requestId?: string): string | undefined {
      return requestId ?? this.store.get('requestId');
   }

   private resolveToken(token: Token): Token {
      if (typeof token !== 'string') return token;

      return this.nameToToken.get(token) ?? token;
   }

   private isDestroyableValue(value: any): boolean {
      return value != null && !(value instanceof FactoryWrapper);
   }
}
