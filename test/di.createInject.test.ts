import "reflect-metadata";
import { describe, test, expect, beforeEach } from "bun:test";
import { Container, Service, Inject, createInject } from "../src";
import { Scope } from "../src";

// ============================================
// TEST FIXTURES
// ============================================

@Service()
class Logger {
   logs: string[] = [];
   log(msg: string) { this.logs.push(msg); }
}

@Service()
class Config {
   port = 3000;
}

@Service()
class Database {
   connected = false;
   async onInit() { this.connected = true; }
   query(sql: string) { return { sql, rows: [] }; }
}

// ============================================
// createInject
// ============================================

describe("createInject", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   test("injects a class token via created decorator", async () => {
      const InjectLogger = createInject(Logger);

      @Service()
      class MyService {
         @InjectLogger() logger!: Logger;
      }

      container.set([Logger, MyService]);
      await container.boot();

      const svc = container.get(MyService);
      expect(svc.logger).toBeInstanceOf(Logger);
   });

   test("injects a string token via created decorator", async () => {
      const InjectApiKey = createInject("API_KEY");

      @Service()
      class ApiClient {
         @InjectApiKey() key!: string;
      }

      container.set("API_KEY", "secret-123");
      container.set(ApiClient);
      await container.boot();

      const client = container.get(ApiClient);
      expect(client.key).toBe("secret-123");
   });

   test("injects a symbol token via created decorator", async () => {
      const DB_URL = Symbol("DB_URL");
      const InjectDbUrl = createInject(DB_URL);

      @Service()
      class DbClient {
         @InjectDbUrl() url!: string;
      }

      container.set(DB_URL, "postgres://localhost/test");
      container.set(DbClient);
      await container.boot();

      const client = container.get(DbClient);
      expect(client.url).toBe("postgres://localhost/test");
   });

   test("singleton: same instance injected in multiple consumers", async () => {
      const InjectLogger = createInject(Logger);

      @Service()
      class ServiceA {
         @InjectLogger() logger!: Logger;
      }

      @Service()
      class ServiceB {
         @InjectLogger() logger!: Logger;
      }

      container.set([Logger, ServiceA, ServiceB]);
      await container.boot();

      const a = container.get(ServiceA);
      const b = container.get(ServiceB);
      expect(a.logger).toBe(b.logger);
   });

   test("multiple properties with different created decorators", async () => {
      const InjectLogger = createInject(Logger);
      const InjectConfig = createInject(Config);

      @Service()
      class AppService {
         @InjectLogger() logger!: Logger;
         @InjectConfig() config!: Config;
      }

      container.set([Logger, Config, AppService]);
      await container.boot();

      const svc = container.get(AppService);
      expect(svc.logger).toBeInstanceOf(Logger);
      expect(svc.config).toBeInstanceOf(Config);
      expect(svc.config.port).toBe(3000);
   });

   test("works alongside regular @Inject()", async () => {
      const InjectLogger = createInject(Logger);

      @Service()
      class MixedService {
         @InjectLogger() logger!: Logger;
         @Inject() config!: Config;
      }

      container.set([Logger, Config, MixedService]);
      await container.boot();

      const svc = container.get(MixedService);
      expect(svc.logger).toBeInstanceOf(Logger);
      expect(svc.config).toBeInstanceOf(Config);
   });

   test("works alongside constructor injection", async () => {
      const InjectLogger = createInject(Logger);

      @Service()
      class HybridService {
         @InjectLogger() logger!: Logger;
         constructor(public db: Database) {}
      }

      container.set([Logger, Database, HybridService]);
      await container.boot();

      const svc = container.get(HybridService);
      expect(svc.logger).toBeInstanceOf(Logger);
      expect(svc.db).toBeInstanceOf(Database);
      expect(svc.db.connected).toBe(true);
   });

   test("optional: true returns undefined for missing token", async () => {
      const MISSING = Symbol("missing");
      const InjectMissing = createInject(MISSING);

      @Service()
      class OptionalService {
         @InjectMissing({ optional: true }) value?: string;
      }

      container.set(OptionalService);
      await container.boot();

      const svc = container.get(OptionalService);
      expect(svc.value).toBeUndefined();
   });

   test("optional: false (default) throws for missing token", async () => {
      const MISSING = Symbol("missing");
      const InjectMissing = createInject(MISSING);

      @Service()
      class StrictService {
         @InjectMissing() value!: string;
      }

      container.set(StrictService);
      await expect(container.boot()).rejects.toThrow();
   });

   test("reuse same decorator across unrelated classes", async () => {
      const InjectDb = createInject(Database);

      @Service()
      class RepoA {
         @InjectDb() db!: Database;
         findUsers() { return this.db.query("SELECT * FROM users"); }
      }

      @Service()
      class RepoB {
         @InjectDb() db!: Database;
         findOrders() { return this.db.query("SELECT * FROM orders"); }
      }

      container.set([Database, RepoA, RepoB]);
      await container.boot();

      const a = container.get(RepoA);
      const b = container.get(RepoB);

      expect(a.db).toBe(b.db);
      expect(a.db.connected).toBe(true);
      expect(a.findUsers()).toEqual({ sql: "SELECT * FROM users", rows: [] });
      expect(b.findOrders()).toEqual({ sql: "SELECT * FROM orders", rows: [] });
   });
});
