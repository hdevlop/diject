import "reflect-metadata";
import { describe, test, expect } from "bun:test";
import { Container, Inject, Scope, Service } from "../src";

@Service()
class Dep { }

describe("custom property injectors", () => {
   test("run after regular property injection, with the instance and ctor", async () => {
      @Service(Scope.TRANSIENT)
      class Target {
         @Inject() dep!: Dep;
      }
      const c = Container.create();
      c.set(Dep);
      c.set(Target);

      const seen: { depSet: boolean; ctor: any }[] = [];
      c.use({
         global: true,
         inject: (instance: any, ctor: any) => { seen.push({ depSet: instance.dep instanceof Dep, ctor }); },
      });

      await c.resolve(Target);
      expect(seen.filter(s => s.ctor === Target)).toEqual([{ depSet: true, ctor: Target }]);
   });

   test("canInject filters per instance; named injector tokens skip regular resolution", async () => {
      @Service(Scope.TRANSIENT)
      class Target {
         @Inject("Tx") tx!: string;
      }
      @Service(Scope.TRANSIENT)
      class Other { }
      const c = Container.create();
      c.set(Target);
      c.set(Other);

      c.use({
         name: "Tx",
         canInject: (instance: any) => instance instanceof Target,
         inject: (instance: any) => { instance.tx = "injected"; },
      });

      const target = await c.resolve<Target>(Target);
      const other = await c.resolve<any>(Other);
      expect(target.tx).toBe("injected");
      expect(other.tx).toBeUndefined();
   });

   test("async injectors are awaited before resolve settles", async () => {
      @Service(Scope.TRANSIENT)
      class Target { ready = false; }
      const c = Container.create();
      c.set(Target);
      c.use({
         global: true,
         inject: async (instance: any) => {
            await new Promise(r => setTimeout(r, 5));
            instance.ready = true;
         },
      });

      const target = await c.resolve<Target>(Target);
      expect(target.ready).toBe(true);
   });

   test("a throwing injector rejects resolve but every matching injector still runs", async () => {
      @Service(Scope.TRANSIENT)
      class Target { }
      const c = Container.create();
      c.set(Target);

      const calls: string[] = [];
      c.use({ global: true, inject: () => { calls.push("first"); throw new Error("boom"); } });
      c.use({ canInject: () => { throw new Error("guard"); }, inject: () => { calls.push("never"); } });
      c.use({ global: true, inject: () => { calls.push("third"); } });

      await expect(c.resolve(Target)).rejects.toThrow("boom");
      expect(calls).toEqual(["first", "third"]);
   });

   test("an injector registered during a pass runs from the next build on", async () => {
      @Service(Scope.TRANSIENT)
      class Target { }
      const c = Container.create();
      c.set(Target);

      const calls: string[] = [];
      let added = false;
      c.use({
         global: true,
         inject: () => {
            calls.push("outer");
            if (!added) {
               added = true;
               c.use({ global: true, inject: () => { calls.push("late"); } });
            }
         },
      });

      await c.resolve(Target);
      expect(calls).toEqual(["outer"]);
      await c.resolve(Target);
      expect(calls).toEqual(["outer", "outer", "late"]);
   });

   test("a thenable whose then getter throws rejects without skipping later injectors", async () => {
      @Service(Scope.TRANSIENT)
      class Target { }
      const c = Container.create();
      c.set(Target);

      const calls: string[] = [];
      c.use({
         global: true,
         inject: () => {
            calls.push("first");
            return { get then() { throw new Error("bad thenable"); } } as any;
         },
      });
      c.use({ global: true, inject: () => { calls.push("second"); } });

      await expect(c.resolve(Target)).rejects.toThrow("bad thenable");
      expect(calls).toEqual(["first", "second"]);
   });

   test("a failing property dependency skips injectors", async () => {
      @Service(Scope.TRANSIENT)
      class Target {
         @Inject("missing") value!: unknown;
      }
      const c = Container.create();
      c.set(Target);

      let ran = false;
      c.use({ global: true, inject: () => { ran = true; } });

      await expect(c.resolve(Target)).rejects.toThrow();
      expect(ran).toBe(false);
   });
});
