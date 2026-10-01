/// <reference path="../node-async-hooks.d.ts" />
import { AsyncLocalStorage } from 'node:async_hooks';

type AsyncContext<T> = {
    getStore(): T | undefined;
    run<R>(store: T, callback: () => R): R;
};

// ============================================
// LAZY STORE VALUES (opt-in)
// ============================================

const LAZY = Symbol('diject:lazy');

export type LazyValue<T> = { readonly [LAZY]: () => T };
export type StoreInput<T extends Record<string, any>> = {
    [K in keyof T]?: T[K] | LazyValue<T[K]>;
};

/**
 * Wrap a sync factory so the value is constructed on first `get()` of its key
 * and then memoized in the store. Lets callers stash expensive per-request
 * context without paying for it on requests that never read it.
 *
 * The thunk MUST be sync — `get()` stays synchronous.
 *
 * @example
 * container.run({ requestId, session: lazyValue(() => loadSession(req)) }, fn);
 * // session is only built if something calls get('session') / get(SESSION).
 */
export function lazyValue<T>(factory: () => T): LazyValue<T> {
   // Memoize in the wrapper, not only in the store: a nested run() copies the
   // store, and each copy must still see a single evaluation.
   let evaluated = false;
   let value: T;
   return {
      [LAZY]: () => {
         if (!evaluated) {
            value = factory();
            evaluated = true;
         }
         return value;
      },
   };
}

export class AlsStore<T extends Record<string, any> = any> {

    protected readonly als: AsyncContext<Map<PropertyKey, any>> =
        new AsyncLocalStorage<Map<PropertyKey, any>>();

    run<R>(data: StoreInput<T>, fn: () => R): R {
        const currentStore = this.als.getStore();

        // Hot path (najm's case): no parent store — one flat request scope, no
        // nesting. Build the Map straight from the object's own enumerable
        // keys; skip the parent copy and inherited properties.
        if (currentStore === undefined) {
            const newStore = new Map<PropertyKey, any>();
            for (const key of Object.keys(data)) {
                newStore.set(key, (data as Record<string, any>)[key]);
            }
            return this.als.run(newStore, fn);
        }

        // Nested run(): inherit the parent store, then overlay the new data.
        const newStore = new Map<PropertyKey, any>(currentStore);
        for (const key of Object.keys(data)) {
            newStore.set(key, (data as Record<string, any>)[key]);
        }
        return this.als.run(newStore, fn);
    }

    get<K extends keyof T>(key: K): T[K] | undefined {
        const store = this.als.getStore();
        if (!store) return undefined;

        const raw = store.get(key as PropertyKey);
        // Fast path: non-lazy values (the common case) fall straight through.
        // Only objects carrying the LAZY symbol are unwrapped + memoized.
        if (raw !== null && typeof raw === 'object' && LAZY in raw) {
            const value = (raw as any)[LAZY]();
            store.set(key as PropertyKey, value);
            return value;
        }
        return raw;
    }

    set<K extends keyof T>(key: K, data: T[K]): void;
    set(data: Partial<T>): void;
    set<K extends keyof T>(keyOrData: K | Partial<T>, data?: T[K]): void {
        const store = this.als.getStore();
        if (!store) {
            throw new Error('No active AsyncLocalStorage context. Use run() first.');
        }
        if (typeof keyOrData === 'object' && data === undefined) {
            for (const [key, val] of Object.entries(keyOrData)) {
                store.set(key, val);
            }
        }
        else {
            store.set(keyOrData as PropertyKey, data);
        }
    }

    has(key: keyof T): boolean {
        const store = this.als.getStore();
        return store?.has(key as PropertyKey) ?? false;
    }


    isActive(): boolean {
        return this.als.getStore() !== undefined;
    }

    all(): Partial<T> | undefined {
        const store = this.als.getStore();
        if (!store) return undefined;

        // Decision: all() unwraps + memoizes lazy values, so a dump always
        // returns realized values (and subsequent get() reuses the cached
        // result). This DOES force evaluation of every pending lazy — all()
        // is a debug/inspection dump, not a hot path, so that trade is fine.
        const out: Record<string, any> = {};
        for (const [key, raw] of store) {
            if (typeof key !== 'string') continue;
            if (raw !== null && typeof raw === 'object' && LAZY in raw) {
                const value = (raw as any)[LAZY]();
                store.set(key, value);
                out[key] = value;
            } else {
                out[key] = raw;
            }
        }
        return out as Partial<T>;
    }

    delete(key: keyof T): void {
        const store = this.als.getStore();
        if (!store) {
            throw new Error('No active AsyncLocalStorage context. Use run() first.');
        }
        store.delete(key as PropertyKey);
    }

    clear(): void {
        const store = this.als.getStore();
        if (!store) {
            throw new Error('No active AsyncLocalStorage context. Use run() first.');
        }
        store.clear();
    }
}
