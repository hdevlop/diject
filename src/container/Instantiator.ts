import { getParameterInjections, getParamTypes, getPropertyInjections } from "../decorators";
import { Constructor, PropsInject, PropertyInjection, Token } from "./types";
import { Container } from "./core";

export class Instantiator {
   private propsInject: PropsInject[] = [];
   private injectorTokens = new Set<string>();

   constructor(private container: Container) { }


   async build<T>(ClassRef: Constructor<T>, requestId?: string, explicitDeps?: Token[]): Promise<T> {
      const deps = await this.resolveDependencies(ClassRef, requestId, explicitDeps);
      const instance = new ClassRef(...deps);

      await this.injectProperties(instance, requestId);
      return instance;
   }

   private async resolveDependencies(ClassRef: Constructor, requestId?: string, explicitDeps?: Token[]): Promise<any[]> {
      if (explicitDeps !== undefined) {
         return Promise.all(
            explicitDeps.map(dep => this.container.resolve(dep, requestId))
         );
      }

      const paramTypes = getParamTypes(ClassRef) || [];
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

   private async injectProperties(instance: any, requestId?: string): Promise<void> {
      const injections: PropertyInjection[] = getPropertyInjections(instance.constructor);

      // Step 1: Resolve properties NOT handled by custom injectors
      await Promise.all(
         injections
            .filter(({ token }) => !this.isInjectorToken(token))
            .map(async ({ propertyKey, token, optional }) => {
               // For optional injections, check if token exists first
               if (optional && !this.container.has(token)) {
                  instance[propertyKey] = undefined;
                  return;
               }
               instance[propertyKey] = await this.container.resolve(token, requestId);
            })
      );

      // Step 2: Run custom injectors (they handle their own tokens)
      await Promise.all(
         this.propsInject.map(async (injector) => {
            const shouldInject = injector.global === true || injector.canInject?.(instance, instance.constructor);
            if (shouldInject) {
               await injector.inject(instance, instance.constructor, this.container.registry, injections);
            }
         })
      );
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
