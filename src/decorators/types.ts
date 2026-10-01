import { Scope } from "../container/helpers";
import { Token, Factory } from "../container/types";


export type NextFunction = () => void;
export interface InjectableType {
    token: Token;
    index: number;
}

export interface InjectableOptions {
    scope?: Scope;
}

export interface Registration {
   factory: Factory;
   scope: Scope;
}

export type DecoratorMetadata = Record<string, any>;

export interface ServiceOptions {
   scope?: Scope;
   metadata?: DecoratorMetadata;
}

export interface ControllerOptions {
   path?: string;
   metadata?: DecoratorMetadata;
}

export interface RepositoryOptions {
   database?: string;
   metadata?: DecoratorMetadata;
}

