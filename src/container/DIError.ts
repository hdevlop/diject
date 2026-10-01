import { Token, Constructor } from "./types";

export class BaseError extends Error {
  public name = "BaseError";

  constructor(
    public readonly code: string,
    public message: string,
    public readonly status?: number
  ) {
    super(message);
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON(): Record<string, any> {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
    };
  }

  toResponse(): Response {
    return new Response(JSON.stringify(this.toJSON()), {
      status: this.status ?? 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  static is(error: unknown): error is BaseError {
    return error instanceof BaseError;
  }

  static hasCode(error: unknown, code: string): boolean {
    return this.is(error) && error.code === code;
  }

  static from(error: unknown, fallbackStatus = 500): BaseError {
    if (error instanceof BaseError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new BaseError("UNKNOWN", message, fallbackStatus);
  }
}

export const DI_CODES = {
  MISSING_PROVIDER: "DI_001",
  CIRCULAR_DEPENDENCY: "DI_002",
  NOT_INJECTABLE: "DI_003",
  SCOPE_VIOLATION: "DI_004",
  CONSTRUCTOR_RESOLUTION: "DI_005",
  TYPE_MISMATCH: "DI_006",
  NOT_REGISTERED: "DI_007",
  SINGLETON_NOT_INITIALIZED: "DI_008",
  REQUEST_ID_REQUIRED: "DI_009",
  REQUEST_INSTANCE_NOT_FOUND: "DI_010",
  TRANSIENT_SYNC_NOT_SUPPORTED: "DI_011",
  ASYNC_FACTORY_REQUIRED: "DI_012",
  CANNOT_PUSH_TO_CLASS: "DI_013",
} as const;

const getTokenName = (token: any): string => {
  if (typeof token === "function") return token.name || "Anonymous";
  if (typeof token === "symbol") return token.toString();
  return String(token);
};

export const DIError = {
  missingProvider: (token: Token, context?: string): never => {
    const name = getTokenName(token);
    const message = context
      ? `Cannot resolve "${name}" while resolving "${context}"`
      : `No provider for: "${name}"`;
    throw new BaseError(DI_CODES.MISSING_PROVIDER, message);
  },

  circularDependency: (chain: Token[]): never => {
    const path = chain.map(getTokenName).join(" → ");
    throw new BaseError(DI_CODES.CIRCULAR_DEPENDENCY, `Circular dependency: ${path}`);
  },

  notInjectable: (target: Constructor): never => {
    const name = getTokenName(target);
    throw new BaseError(DI_CODES.NOT_INJECTABLE, `"${name}" missing @Injectable()`);
  },

  scopeViolation: (token: Token, reason: string): never => {
    const name = getTokenName(token);
    throw new BaseError(DI_CODES.SCOPE_VIOLATION, `Scope violation "${name}": ${reason}`);
  },

  constructorResolve: (target: Constructor, index: number): never => {
    const name = getTokenName(target);
    throw new BaseError(
      DI_CODES.CONSTRUCTOR_RESOLUTION,
      `Failed to resolve param [${index}] for "${name}"`
    );
  },

  typeMismatch: (target: Constructor, expected: string, actual: string): never => {
    const name = getTokenName(target);
    throw new BaseError(DI_CODES.TYPE_MISMATCH, `"${name}": expected @${expected}, got @${actual}`);
  },

  notRegistered: (token: Token): never => {
    const name = getTokenName(token);
    throw new BaseError(DI_CODES.NOT_REGISTERED, `Not registered: "${name}"`);
  },

  singletonNotInitialized: (token: Token): never => {
    const name = getTokenName(token);
    throw new BaseError(DI_CODES.SINGLETON_NOT_INITIALIZED, `Singleton "${name}" not initialized. Call boot() first.`);
  },

  requestIdRequired: (token: Token): never => {
    const name = getTokenName(token);
    throw new BaseError(DI_CODES.REQUEST_ID_REQUIRED, `Request-scoped "${name}" requires requestId`);
  },

  requestInstanceNotFound: (token: Token, requestId: string): never => {
    const name = getTokenName(token);
    throw new BaseError(DI_CODES.REQUEST_INSTANCE_NOT_FOUND, `Request-scoped "${name}" not found for "${requestId}". Use resolve().`);
  },

  transientSyncNotSupported: (token: Token): never => {
    const name = getTokenName(token);
    throw new BaseError(DI_CODES.TRANSIENT_SYNC_NOT_SUPPORTED, `Transient "${name}" requires resolve()`);
  },

  asyncFactoryRequired: (token: Token): never => {
    const name = getTokenName(token);
    throw new BaseError(DI_CODES.ASYNC_FACTORY_REQUIRED, `"${name}" is a factory that has not been resolved yet. Use resolve() first.`);
  },

  cannotPushToClass: (token: Token): never => {
    const name = getTokenName(token);
    throw new BaseError(DI_CODES.CANNOT_PUSH_TO_CLASS, `Cannot push to class token: "${name}"`);
  },
};

