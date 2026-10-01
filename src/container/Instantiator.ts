import { getParameterInjections, getParamTypes, getPropertyInjections } from "../decorators";
import { Constructor, PropsInject, PropertyInjection, Token } from "./types";
import { Container } from "./core";

export class Instantiator {
   private propsInject: PropsInject[] = [];
   private injectorTokens = new Set<string>();

   constructor(private container: Container) { }


   async build<T>(ClassRef: Constructor<T>, requestId?: string, explicitDeps?: Token[]): Promise<T> {
      const deps = this.resolveDependencies(ClassRef, requestId, explicitDeps);
      // No constructor deps: skip awaiting an empty Promise.all.
      const instance = new ClassRef(...(deps === undefined ? [] : await deps));

      const pending = this.injectProperties(instance, requestId);
      if (pending !== undefined) await pending;
      return instance;
   }

   private resolveDependencies(ClassRef: Constructor, requestId?: string, explicitDeps?: Token[]): Promise<any[]> | undefined {
      if (explicitDeps !== undefined) {
         if (explicitDeps.length === 0) return undefined;
         return Promise.all(
            explicitDeps.map(dep => this.container.resolve(dep, requestId))
         );
      }

      const paramTypes = getParamTypes(ClassRef) || [];
      if (paramTypes.length === 0) return undefined;
      const paramInjections = getParameterInjections(ClassRef);

      return Promise.all(
         paramTypes.map(async (Dep: Constructor, index: number) => {
            const injection = paramInjections.find(i => i.index === index);
            if (injection?.token) return this.container.resolve(injection.token, requestId);
            if (Dep && Dep !== Object) return this.container.resolve(Dep, requestId);
            return undefined;
         })
      );
   }

   /** Returns a promise only when there is async work to wait for. */
   private injectProperties(instance: any, requestId?: string): Promise<void> | undefined {
      const injections: PropertyInjection[] = getPropertyInjections(instance.constructor);
      const ownInjections = injections.filter(({ token }) => !this.isInjectorToken(token));

      if (ownInjections.length === 0) {
         return this.runInjectors(instance, injections);
      }

      // Step 1: Resolve properties NOT handled by custom injectors
      return Promise.all(
         ownInjections.map(async ({ propertyKey, token, optional }) => {
            // For optional injections, check if token exists first
            if (optional && !this.container.has(token)) {
               instance[propertyKey] = undefined;
               return;
            }
            instance[propertyKey] = await this.container.resolve(token, requestId);
         })
      ).then(() => this.runInjectors(instance, injections));
   }

   /**
    * Step 2: Run custom injectors (they handle their own tokens). Every
    * matching injector is started even if an earlier one throws; only async
    * results (or failures) produce a promise to wait on.
    */
   private runInjectors(instance: any, injections: PropertyInjection[]): Promise<void> | undefined {
      let pending: Promise<unknown>[] | undefined;

      for (const injector of this.propsInject) {
         let result: unknown;
         try {
            const shouldInject = injector.global === true || injector.canInject?.(instance, instance.constructor);
            if (!shouldInject) continue;
            result = injector.inject(instance, instance.constructor, this.container.registry, injections);
         } catch (error) {
            result = Promise.reject(error);
         }
         if (result instanceof Promise || (result != null && typeof (result as any).then === 'function')) {
            (pending ??= []).push(Promise.resolve(result));
         }
      }

      return pending === undefined ? undefined : Promise.all(pending).then(() => undefined);
   }

   private isInjectorToken(token: any): boolean {
      return typeof token === 'string' && this.injectorTokens.has(token);
   }

   public addInjector(injector: PropsInject): void {
      this.propsInject.push(injector);
   }

   public use(injector: PropsInject): this {
      this.propsInject.push(injector);
      if (injector.name) {
         this.injectorTokens.add(injector.name);
      }
      return this;
   }
}
