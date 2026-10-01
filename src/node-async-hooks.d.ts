declare module 'node:async_hooks' {
   export class AsyncLocalStorage<T> {
      getStore(): T | undefined;
      run<R>(store: T, callback: () => R): R;
   }
}

declare global {
   interface ErrorConstructor {
      captureStackTrace?(targetObject: object, constructorOpt?: Function): void;
   }
}

export {};
