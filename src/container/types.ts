import { Scope } from "./helpers";
import { AlsToken } from "./tokens";

export type Constructor<T = any> = new (...args: any[]) => T;

/**
 * Provider factory. When `Options.deps` is present, the resolved dependencies
 * are passed as positional arguments. Without `deps`, class-token factories
 * retain the legacy `(requestId?: string)` calling convention.
 */
export type Factory<T = any> = (...args: any[]) => T;

export type AsyncFactory<T = any> = (...args: any[]) => Promise<T>;

// Lifecycle hook interfaces
export interface OnInit {
   onInit(): void | Promise<void>;
}

export interface OnDestroy {
   onDestroy(): void | Promise<void>;
}

export interface OnBootComplete {
   onBootComplete(): void | Promise<void>;
}

// ============================================
// METADATA SYSTEM
// ============================================

export type Metadata = Record<string, any>;

export interface MetadataQuery {
   $sort?: Record<string, 'asc' | 'desc'>;
   [key: string]: any | ((value: any) => boolean);
}

// ============================================
// REGISTRY
// ============================================

export interface RegistryEntry {
   scope: Scope;
   factory: (requestId?: string) => any;
   pending?: Promise<any>;
   instance?: any;
   metadata?: Metadata;
}

export type Token = Constructor | string | symbol | AlsToken;

export type Options = {
   scope?: Scope;
   deps?: Token[];
   factory?: Factory | AsyncFactory;
   metadata?: Metadata;
};

export interface PropertyInjection {
   propertyKey: string | symbol;
   token: any;
   optional?: boolean;
}

export interface PropsInject {
   name?: string;
   global?: boolean;
   canInject?(instance: any, constructor: Constructor): boolean;
   inject(
      instance: any,
      constructor?: Constructor,
      registry?: Map<any, any>,
      injections?: PropertyInjection[]
   ): void | Promise<void>;
}

export interface RegEntryOpts {
   token: Token | Constructor;
   type?: string;  // Internal use only - derived from decorator or metadata
   scope?: Scope;
   factory?: Factory | AsyncFactory;
   deps?: Token[];
   input?: unknown;
   metadata?: Metadata;
}

export type TStore = Record<string, any>;

export interface InjectionDefinition {
   type: string;
   target?: Constructor;
   methodName?: string;
   propertyKey?: string | symbol;
   handler?: Function;
   options?: any;
   order?: number;
   scope?: 'global' | 'controller' | 'method' ;
   name?: string;
   [key: string]: any;
}
