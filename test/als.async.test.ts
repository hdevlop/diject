import { describe, expect, test } from "bun:test";
import { AlsStore, Container, lazyValue } from "../src";

type AsyncMiddleware = (next: () => Promise<void>) => Promise<void>;

async function runAsyncMiddlewareChain(
   middlewares: AsyncMiddleware[],
   handler: () => Promise<void>
): Promise<void> {
   const dispatch = async (index: number): Promise<void> => {
      if (index === middlewares.length) {
         await handler();
         return;
      }

      await middlewares[index](() => dispatch(index + 1));
   };

   await dispatch(0);
}

describe("AsyncLocalStorage async propagation", () => {
   test("AlsStore preserves context across awaited middleware chains", async () => {
      const store = new AlsStore<{ parser: string; stage?: string }>();
      const observed: string[] = [];

      await store.run({ parser: "json" }, async () => {
         await runAsyncMiddlewareChain([
            async (next) => {
               observed.push(`global:${store.get("parser")}`);
               await Promise.resolve();
               await next();
            },
            async (next) => {
               observed.push(`route:${store.get("parser")}`);
               store.set("stage", "validated");
               await Promise.resolve();
               await next();
            },
         ], async () => {
            await Promise.resolve();
            observed.push(`handler:${store.get("parser")}:${store.get("stage")}`);
         });
      });

      expect(observed).toEqual([
         "global:json",
         "route:json",
         "handler:json:validated",
      ]);
   });

   test("Container.run preserves ALS context across awaited async work", async () => {
      const container = Container.create();

      const result = await container.run({ userId: "123", role: "admin" }, async () => {
         await Promise.resolve();
         expect(container.store.get("userId")).toBe("123");
         return container.store.get("role");
      });

      expect(result).toBe("admin");
      expect(container.isActive()).toBe(false);
   });
});

describe("lazyValue (opt-in lazy store values)", () => {
   test("factory runs only on first get(), then memoizes", () => {
      const store = new AlsStore<{ session: { id: number } }>();
      let calls = 0;

      store.run({ session: lazyValue(() => ({ id: ++calls })) }, () => {
         expect(calls).toBe(0); // not evaluated until read

         const a = store.get("session");
         expect(calls).toBe(1);
         expect(a).toEqual({ id: 1 });

         const b = store.get("session");
         expect(calls).toBe(1); // memoized — no second call
         expect(b).toBe(a);     // same instance
      });
   });

   test("lazy value is never evaluated if never read", () => {
      const store = new AlsStore<{ heavy: string }>();
      let called = false;

      store.run({ heavy: lazyValue(() => { called = true; return "x"; }) }, () => {
         // read a different (absent) key, never touch 'heavy'
         expect(store.get("other" as any)).toBeUndefined();
      });
      expect(called).toBe(false);
   });

   test("all() unwraps and memoizes lazy values", () => {
      const store = new AlsStore<{ a: number; b: number }>();
      let calls = 0;

      store.run({ a: 1 as any, b: lazyValue(() => ++calls) as any }, () => {
         const dump = store.all();
         expect(dump).toEqual({ a: 1, b: 1 });
         expect(calls).toBe(1);

         // memoized: get() after all() sees the realized value, no re-eval
         expect(store.get("b")).toBe(1);
         expect(calls).toBe(1);
      });
   });

   test("plain object values are not treated as lazy", () => {
      const store = new AlsStore<{ ctx: { userId: string } }>();
      store.run({ ctx: { userId: "u1" } }, () => {
         expect(store.get("ctx")).toEqual({ userId: "u1" });
      });
   });
});
