import "reflect-metadata";
import { describe, test, expect } from "bun:test";
import { Container, Meta, Scope, Service } from "../src";

// ============================================
// TEST FIXTURES
// ============================================

// Request scoped
@Service()
class RequestContext {
   id = Math.random().toString(36).slice(2);
   destroyCalled = false;

   async onDestroy() {
      this.destroyCalled = true;
   }
}

// ============================================
// INTEGRATION: Full Application Flow
// ============================================

describe("Integration", () => {
   test("complete application lifecycle", async () => {
      const container = new Container();
      const events: string[] = [];

      // Services
      @Service()
      class AppConfig {
         constructor() { events.push("config"); }
      }

      @Service()
      class AppLogger {
         constructor() { events.push("logger"); }
         log(msg: string) { events.push(`log:${msg}`); }
      }

      @Service()
      class AppDB {
         connected = false;
         async onInit() {
            events.push("db:init");
            this.connected = true;
         }
         async onDestroy() {
            events.push("db:destroy");
            this.connected = false;
         }
      }

      @Service()
      @Meta({ type: 'repository' })
      class AppRepo {
         constructor(public db: AppDB) {
            events.push("repo");
         }
      }

      @Service()
      class AppService {
         constructor(public repo: AppRepo, public logger: AppLogger) {
            events.push("service");
         }
      }

      @Service()
      @Meta({ type: 'controller', path: '/app' })
      class AppController {
         constructor(public service: AppService) {
            events.push("controller");
         }

         async index() {
            return "ok";
         }
      }

      // Register all
      container.set([
         AppConfig,
         AppLogger,
         AppDB,
         AppRepo,
         AppService,
         AppController
      ]);

      // Boot
      await container.boot();

      // Verify order
      const dbInitIdx = events.indexOf("db:init");
      const repoIdx = events.indexOf("repo");
      const serviceIdx = events.indexOf("service");
      const controllerIdx = events.indexOf("controller");

      expect(dbInitIdx).toBeLessThan(repoIdx);
      expect(repoIdx).toBeLessThan(serviceIdx);
      expect(serviceIdx).toBeLessThan(controllerIdx);

      // Verify structure
      const ctrl = container.get(AppController);
      expect(ctrl.service.repo.db.connected).toBe(true);

      // Service method works
      const method = ctrl.index.bind(ctrl);
      const result = await method();
      expect(result).toBe("ok");

      // Cleanup
      await container.clear();
      expect(events).toContain("db:destroy");
   });

   test("request-scoped workflow", async () => {
      const container = new Container();

      @Service()
      class RequestLogger {
         constructor(public ctx: RequestContext) { }
      }

      container.set(RequestContext, Scope.REQUEST);
      container.set(RequestLogger, { scope: Scope.REQUEST, deps: [RequestContext] });

      // Request 1
      const logger1 = await container.resolve(RequestLogger, "req-1");
      const ctx1a = await container.resolve(RequestContext, "req-1");
      const ctx1b = await container.resolve(RequestContext, "req-1");

      expect(logger1.ctx).toBe(ctx1a);
      expect(ctx1a).toBe(ctx1b);

      // Request 2
      const logger2 = await container.resolve(RequestLogger, "req-2");
      const ctx2 = await container.resolve(RequestContext, "req-2");

      expect(logger2).not.toBe(logger1);
      expect(ctx2).not.toBe(ctx1a);
      expect(logger2.ctx).toBe(ctx2);

      // Cleanup
      await container.cleanupReq("req-1");
      await container.cleanupReq("req-2");

      expect(ctx1a.destroyCalled).toBe(true);
      expect(ctx2.destroyCalled).toBe(true);
   });

   test("mixed scopes and complex dependencies", async () => {
      const container = new Container();

      @Service()
      class GlobalConfig {
         value = "global";
      }

      @Service()
      class RequestData {
         value = Math.random();
      }

      @Service()
      class MixedService {
         constructor(
            public config: GlobalConfig,
            public data: RequestData
         ) { }
      }

      container.set(GlobalConfig, Scope.SINGLETON);
      container.set(RequestData, Scope.REQUEST);
      container.set(MixedService, {
         scope: Scope.REQUEST,
         deps: [GlobalConfig, RequestData]
      });

      await container.boot();

      const config = container.get(GlobalConfig);

      const svc1 = await container.resolve(MixedService, "req-1");
      const svc2 = await container.resolve(MixedService, "req-2");

      // Global config is shared
      expect(svc1.config).toBe(config);
      expect(svc2.config).toBe(config);

      // Request data is unique
      expect(svc1.data).not.toBe(svc2.data);
      expect(svc1.data.value).not.toBe(svc2.data.value);
   });
});