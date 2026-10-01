import "reflect-metadata";
import { describe, test, expect, beforeEach } from "bun:test";
import { Container, Service, Inject } from "../src";

// ============================================
// TEST FIXTURES
// ============================================

const LOGGER = Symbol("LOGGER");
const DB = Symbol("DB");

interface ILogger {
   log(msg: string): void;
}

@Service()
class LoggerService implements ILogger {
   messages: string[] = [];
   log(msg: string) { this.messages.push(msg); }
}

@Service()
class DatabaseService {
   connected = true;
}

@Service()
class AppService {
   constructor(@Inject(LOGGER) public log: ILogger) {}
}

// ============================================
// TESTS
// ============================================

describe("Container.alias()", () => {
   let c: Container;

   beforeEach(() => {
      c = Container.create();
   });

   test("alias resolves to the same instance as the target", async () => {
      c.set(LoggerService).alias(LOGGER, LoggerService);
      await c.boot();

      const direct = c.get<LoggerService>(LoggerService);
      const viaAlias = c.get<ILogger>(LOGGER);

      expect(viaAlias).toBe(direct);
   });

   test("alias is chainable with set()", async () => {
      c.set(LoggerService)
       .alias(LOGGER, LoggerService)
       .set(DatabaseService)
       .alias(DB, DatabaseService);

      await c.boot();

      expect(c.get(LOGGER)).toBe(c.get(LoggerService));
      expect(c.get(DB)).toBe(c.get(DatabaseService));
   });

   test("alias works with string tokens", async () => {
      c.set(LoggerService).alias("logger", LoggerService);
      await c.boot();

      expect(c.get("logger")).toBe(c.get(LoggerService));
   });

   test("alias is injectable via @Inject(token)", async () => {
      c.set(LoggerService)
       .alias(LOGGER, LoggerService)
       .set(AppService);

      await c.boot();

      const app = c.get(AppService);
      expect(app.log).toBe(c.get(LoggerService));
   });

   test("multiple aliases point to the same singleton", async () => {
      const LOGGER2 = Symbol("LOGGER2");
      c.set(LoggerService)
       .alias(LOGGER, LoggerService)
       .alias(LOGGER2, LoggerService);

      await c.boot();

      const instance = c.get(LoggerService);
      expect(c.get(LOGGER)).toBe(instance);
      expect(c.get(LOGGER2)).toBe(instance);
   });

   test("alias resolves when only the target is explicitly booted", async () => {
      // Regression: previously, alias() registered a separate singleton-factory
      // entry. A layered boot that only resolved the target (not the alias token)
      // left the alias slot uninitialized, so get(token) threw
      // "Singleton not initialized. Call boot() first." — even though the target
      // was fully booted. Now alias() is a true forwarder; this must work.
      c.set(LoggerService).alias(LOGGER, LoggerService);

      // Only boot the target — do NOT boot the alias token.
      await c.boot([LoggerService]);

      const direct = c.get<LoggerService>(LoggerService);
      const viaAlias = c.get<ILogger>(LOGGER);
      expect(viaAlias).toBe(direct);
   });

   test("alias resolves asynchronously via resolve()", async () => {
      c.set(LoggerService).alias(LOGGER, LoggerService);
      await c.boot();

      const direct = await c.resolve<LoggerService>(LoggerService);
      const viaAlias = await c.resolve<ILogger>(LOGGER);
      expect(viaAlias).toBe(direct);
   });

   test("alias can be registered before its target", async () => {
      // Mirrors najm-core's collectPluginServices order: alias(token, Target)
      // is called before container.set(Target).
      c.alias(LOGGER, LoggerService).set(LoggerService);
      await c.boot();

      expect(c.get(LOGGER)).toBe(c.get(LoggerService));
   });

   test("alias chain follows to the final target", async () => {
      const A = Symbol("A");
      const B = Symbol("B");
      c.set(LoggerService)
       .alias(B, LoggerService)
       .alias(A, LoggerService); // A -> LoggerService (chain via separate symbols still works)

      await c.boot();

      expect(c.get(A)).toBe(c.get(LoggerService));
      expect(c.get(B)).toBe(c.get(LoggerService));
   });

   test("alias does not create a separate singleton instance after boot", async () => {
      // Previously the alias entry was a distinct SINGLETON that, once resolved,
      // cached a *copy* of the reference under the alias token. With the
      // forwarder, there is no separate cached slot — only the target's slot.
      c.set(LoggerService).alias(LOGGER, LoggerService);
      await c.boot();

      const first = c.get<LoggerService>(LOGGER);
      const second = c.get<LoggerService>(LOGGER);
      const direct = c.get<LoggerService>(LoggerService);
      expect(first).toBe(direct);
      expect(second).toBe(direct);
   });
});
