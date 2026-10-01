
// ============================================================================
// decorators/shared/metadata.ts
// ============================================================================
import 'reflect-metadata';

export class MetaHelper {
   static get<T>(key: symbol, target: any, propertyKey?: string | symbol): T |any {
      return propertyKey
         ? Reflect.getMetadata(key, target, propertyKey)
         : Reflect.getMetadata(key, target);
   }

   static define(key: symbol, value: any, target: any, propertyKey?: string | symbol): void {
      if (propertyKey) {
         Reflect.defineMetadata(key, value, target, propertyKey);
      } else {
         Reflect.defineMetadata(key, value, target);
      }
   }

   static append<T>(key: symbol, value: T, target: any, propertyKey?: string): void {
      const existing = this.get<T[]>(key, target, propertyKey) || [];
      this.define(key, [...existing, value], target, propertyKey);
   }

   static appendMany<T>(key: symbol, values: T[], target: any, propertyKey?: string | symbol): void {
      const existing = this.get<T[]>(key, target, propertyKey) || [];
      this.define(key, [...existing, ...values], target, propertyKey);
   }

   static merge<T extends Record<string, any>>(
      key: symbol,
      value: T,
      target: any,
      propertyKey?: string
   ): void {
      const existing = this.get<T>(key, target, propertyKey) || {} as T;
      this.define(key, { ...existing, ...value }, target, propertyKey);
   }
}
