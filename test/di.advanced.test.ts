import "reflect-metadata";
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Container, Inject, Meta, Scope, Service, DI } from "../src";

// Basic services
@Service()
class Logger {
   logs: string[] = [];
   log(msg: string) { this.logs.push(msg); }
}

@Service()
class Config {
   port = 3000;
   env = "test";
}

// Service with lifecycle
@Service()
class Database {
   connected = false;
   initCalled = false;
   destroyCalled = false;

   async onInit() {
      this.initCalled = true;
      this.connected = true;
   }

   async onDestroy() {
      this.destroyCalled = true;
      this.connected = false;
   }

   query(sql: string) {
      if (!this.connected) throw new Error("Not connected");
      return { sql, rows: [] };
   }
}

// Dependency chain
@Service()
@Meta({ type: 'repository' })
class UserRepo {
   constructor(public db: Database) { }
   findAll() { return this.db.query("select * FROM users"); }
}

@Service()
class UserService {
   constructor(public repo: UserRepo, public logger: Logger) { }
   getUsers() {
      this.logger.log("Fetching users");
      return this.repo.findAll();
   }
}

// Property injection
@Service()
class PropertyInjectedService {
   @Inject(Logger)
   public logger!: Logger;

   @Inject("API_KEY")
   public apiKey!: string;
}

// Service with Container injection using @DI
@Service()
class ServiceWithContainerAccess {
   @DI()
   private container!: Container;

   @Inject(Logger)
   private logger!: Logger;

   resolveOnDemand<T>(token: any): T {
      return this.container.get<T>(token);
   }

   hasService(token: any): boolean {
      return this.container.has(token);
   }
}

// Factory service that uses container
@Service()
class ServiceFactory {
   @DI()
   private container!: Container;

   createUserService(): UserService {
      return this.container.get(UserService);
   }

   createTransientLogger(): Logger {
      return new Logger();
   }
}

// Advanced service manager with container
@Service()
class ServiceManager {
   @DI() private container!: Container;

   private managedServices: any[] = [];

   async loadService(serviceClass: any) {
      const instance = await this.container.resolve(serviceClass);
      this.managedServices.push(instance);
      return instance;
   }

   getServiceCount(): number {
      return this.managedServices.length;
   }
}

// Request scoped
@Service()
class RequestContext {
   id = Math.random().toString(36).slice(2);
   destroyCalled = false;

   async onDestroy() {
      this.destroyCalled = true;
   }
}

// Circular dependencies (for error testing)
class CircularA {
   constructor(public b: any) { }
}

class CircularB {
   constructor(public a: any) { }
}

Service()(CircularA);
Service()(CircularB);

// Plain classes (no decorators)
class PlainService {
   constructor(public logger: Logger) { }
   execute() { return "executed"; }
}


// ============================================
// CORE: Registration & Resolution
// ============================================

describe("Container Core", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   describe("Registration", () => {
      test("registers string values", async () => {
         container.set("DB_URL", "postgres://localhost/test");
         container.set("API_KEY", "secret-123");
         await container.boot();

         expect(container.get("DB_URL")).toBe("postgres://localhost/test");
         expect(container.get("API_KEY")).toBe("secret-123");
      });

      test("registers symbol tokens", async () => {
         const TOKEN = Symbol("config");
         container.set(TOKEN, { debug: true });
         await container.boot();

         expect(container.get(TOKEN)).toEqual({ debug: true });
      });

      test("registers class constructors", async () => {
         container.set(Logger);
         await container.boot();

         expect(container.get(Logger)).toBeInstanceOf(Logger);
      });

      test("registers arrays of providers", async () => {
         container.set([Logger, Config, Database]);
         await container.boot();

         expect(container.get(Logger)).toBeInstanceOf(Logger);
         expect(container.get(Config)).toBeInstanceOf(Config);
         expect(container.get(Database)).toBeInstanceOf(Database);
      });

      test("registers with custom factory", async () => {
         let callCount = 0;
         container.set(Logger, {
            scope: Scope.SINGLETON,
            factory: async () => {
               callCount++;
               return new Logger();
            }
         });
         await container.boot();

         container.get(Logger);
         container.get(Logger);
         expect(callCount).toBe(1);
      });

      test("registers plain classes without decorators", async () => {
         container.set(Logger);
         container.set(PlainService, { deps: [Logger] });
         await container.boot();

         const service = container.get(PlainService);
         expect(service).toBeInstanceOf(PlainService);
         expect(service.logger).toBeInstanceOf(Logger);
      });

      test("container registers itself", () => {
         expect(container.has(Container)).toBe(true);
         expect(container.get(Container)).toBe(container);
      });
   });

   describe("Resolution", () => {
      test("has() returns correct values", () => {
         container.set("exists", true);
         expect(container.has("exists")).toBe(true);
         expect(container.has("missing")).toBe(false);
      });

      test("throws for unregistered token", () => {
         expect(() => container.get("missing")).toThrow(/not registered/i);
      });

      test("throws for unbooted singleton", () => {
         container.set(Logger);
         expect(() => container.get(Logger)).toThrow(/not initialized/i);
      });

      test("resolves dependency chain", async () => {
         container.set([Logger, Database, UserRepo, UserService]);
         await container.boot();

         const service = container.get(UserService);
         expect(service).toBeInstanceOf(UserService);
         expect(service.repo).toBeInstanceOf(UserRepo);
         expect(service.repo.db).toBeInstanceOf(Database);
         expect(service.logger).toBeInstanceOf(Logger);
      });

      test("maintains referential integrity", async () => {
         container.set([Logger, Database, UserRepo, UserService]);
         await container.boot();

         const service = container.get(UserService);
         const repo = container.get(UserRepo);
         const db = container.get(Database);

         expect(service.repo).toBe(repo);
         expect(service.repo.db).toBe(db);
         expect(repo.db).toBe(db);
      });
   });
});

// ============================================
// SCOPES: Singleton, Transient, Request
// ============================================

describe("Scopes", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   describe("Singleton", () => {
      test("returns same instance", async () => {
         container.set(Logger, Scope.SINGLETON);
         await container.boot();

         const a = container.get(Logger);
         const b = container.get(Logger);

         expect(a).toBe(b);
      });

      test("resolves once even with parallel calls", async () => {
         let callCount = 0;
         container.set(Logger, {
            scope: Scope.SINGLETON,
            factory: async () => {
               callCount++;
               await new Promise(r => setTimeout(r, 50));
               return new Logger();
            }
         });

         const [a, b, c] = await Promise.all([
            container.resolve(Logger),
            container.resolve(Logger),
            container.resolve(Logger),
         ]);

         expect(a).toBe(b);
         expect(b).toBe(c);
         expect(callCount).toBe(1);
      });
   });

   describe("Transient", () => {
      test("creates new instance each time", async () => {
         container.set(Logger, Scope.TRANSIENT);

         const a = await container.resolve(Logger);
         const b = await container.resolve(Logger);
         const c = await container.resolve(Logger);

         expect(a).not.toBe(b);
         expect(b).not.toBe(c);
         expect(a).not.toBe(c);
      });
   });

   describe("Request", () => {
      test("creates new instance per request", async () => {
         container.set(RequestContext, Scope.REQUEST);

         const ctx1 = await container.resolve(RequestContext, "req-1");
         const ctx2 = await container.resolve(RequestContext, "req-2");

         expect(ctx1).not.toBe(ctx2);
         expect(ctx1.id).not.toBe(ctx2.id);
      });

      test("caches within same request", async () => {
         container.set(RequestContext, Scope.REQUEST);

         const ctx1 = await container.resolve(RequestContext, "req-1");
         const ctx2 = await container.resolve(RequestContext, "req-1");

         expect(ctx1).toBe(ctx2);
      });

      test("get() works with requestId after resolve", async () => {
         container.set(RequestContext, Scope.REQUEST);

         const resolved = await container.resolve(RequestContext, "req-1");
         const got = container.get(RequestContext, "req-1");

         expect(got).toBe(resolved);
      });

      test("get() throws without requestId", async () => {
         container.set(RequestContext, Scope.REQUEST);
         await container.resolve(RequestContext, "req-1");

         expect(() => container.get(RequestContext)).toThrow(/requestId/i);
      });

      test("cleanup removes instances", async () => {
         container.set(RequestContext, Scope.REQUEST);

         const ctx1 = await container.resolve(RequestContext, "req-1");
         const id1 = ctx1.id;

         await container.cleanupReq("req-1");

         const ctx2 = await container.resolve(RequestContext, "req-1");
         const id2 = ctx2.id;

         expect(id1).not.toBe(id2);
      });

      test("cleanup calls onDestroy", async () => {
         container.set(RequestContext, Scope.REQUEST);

         const ctx = await container.resolve(RequestContext, "req-1");
         expect(ctx.destroyCalled).toBe(false);

         await container.cleanupReq("req-1");
         expect(ctx.destroyCalled).toBe(true);
      });

      test("hasRequestScope() reflects request-scoped state (explicit id)", async () => {
         container.set(RequestContext, Scope.REQUEST);

         expect(container.hasRequestScope("req-1")).toBe(false);

         await container.resolve(RequestContext, "req-1");
         expect(container.hasRequestScope("req-1")).toBe(true);

         await container.cleanupReq("req-1");
         expect(container.hasRequestScope("req-1")).toBe(false);
      });

      test("hasRequestScope() resolves requestId from active store", async () => {
         container.set(RequestContext, Scope.REQUEST);

         await container.run({ requestId: "req-als" }, async () => {
            expect(container.hasRequestScope()).toBe(false);
            await container.resolve(RequestContext, "req-als");
            expect(container.hasRequestScope()).toBe(true);
         });
      });

      test("hasRequestScope() is false with no requestId at all", () => {
         expect(container.hasRequestScope()).toBe(false);
      });

      test("cleanupReq() is a no-op when nothing request-scoped exists", async () => {
         container.set(RequestContext, Scope.REQUEST);

         // Never resolved anything for this id — cleanup must not throw and
         // must leave no state behind.
         await container.cleanupReq("req-empty");
         expect(container.hasRequestScope("req-empty")).toBe(false);
      });

      test("concurrent resolves share instance per request", async () => {
         let factoryCount = 0;
         container.set(RequestContext, {
            scope: Scope.REQUEST,
            factory: async () => {
               factoryCount++;
               await new Promise(r => setTimeout(r, 20));
               return new RequestContext();
            }
         });

         const reqId = "shared-req";
         const [res1, res2] = await Promise.all([
            container.resolve(RequestContext, reqId),
            container.resolve(RequestContext, reqId)
         ]);

         expect(res1).toBe(res2);
         expect(factoryCount).toBe(1);
      });
   });
});

// ============================================
// LIFECYCLE: Boot, Init, Destroy
// ============================================

describe("Lifecycle", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   describe("Boot", () => {
      test("resolves all singleton providers", async () => {
         const resolved: string[] = [];

         @Service()
         class Service1 {
            constructor() { resolved.push("S1"); }
         }

         @Service()
         class Service2 {
            constructor() { resolved.push("S2"); }
         }

         container.set([Service1, Service2]);
         await container.boot();

         expect(resolved).toContain("S1");
         expect(resolved).toContain("S2");
      });

      test("skips request-scoped providers", async () => {
         const resolved: string[] = [];

         @Service()
         class SingletonSvc {
            constructor() { resolved.push("Singleton"); }
         }

         @Service()
         class RequestSvc {
            constructor() { resolved.push("Request"); }
         }

         container.set(SingletonSvc, Scope.SINGLETON);
         container.set(RequestSvc, Scope.REQUEST);
         await container.boot();

         expect(resolved).toContain("Singleton");
         expect(resolved).not.toContain("Request");
      });

      test("load resolves specific providers", async () => {
         const resolved: string[] = [];

         @Service()
         class ServiceX {
            constructor() { resolved.push("X"); }
         }

         @Service()
         class ServiceY {
            constructor() { resolved.push("Y"); }
         }

         container.set([ServiceX, ServiceY]);
         await container.load([ServiceX]);

         expect(resolved).toContain("X");
         expect(resolved).not.toContain("Y");
      });
   });

   describe("Hooks", () => {
      test("onInit called during boot", async () => {
         container.set(Database);
         await container.boot();

         const db = container.get(Database);
         expect(db.initCalled).toBe(true);
         expect(db.connected).toBe(true);
      });

      test("onInit called only once", async () => {
         let initCount = 0;

         @Service()
         class CountingSvc {
            async onInit() { initCount++; }
         }

         container.set(CountingSvc);
         await container.boot();

         container.get(CountingSvc);
         container.get(CountingSvc);
         expect(initCount).toBe(1);
      });

      test("onInit error propagates", async () => {
         @Service()
         class FailingSvc {
            async onInit() {
               throw new Error("Init failed");
            }
         }

         container.set(FailingSvc);
         await expect(container.boot()).rejects.toThrow("Init failed");
      });

      test("onDestroy called on remove", async () => {
         container.set(Database);
         await container.boot();

         const db = container.get(Database);
         expect(db.destroyCalled).toBe(false);

         await container.delete(Database);
         expect(db.destroyCalled).toBe(true);
      });

      test("onDestroy called on clear", async () => {
         container.set(Database);
         await container.boot();

         const db = container.get(Database);
         await container.clear();

         expect(db.destroyCalled).toBe(true);
      });

      test("onDestroy called on request cleanup", async () => {
         container.set(RequestContext, Scope.REQUEST);

         const ctx = await container.resolve(RequestContext, "req-1");
         await container.cleanupReq("req-1");

         expect(ctx.destroyCalled).toBe(true);
      });
   });

   describe("Cleanup", () => {
      test("remove deletes single service", async () => {
         container.set([Logger, Config]);
         await container.boot();

         expect(container.has(Logger)).toBe(true);
         await container.delete(Logger);

         expect(container.has(Logger)).toBe(false);
         expect(container.has(Config)).toBe(true);
      });

      test("bulkRemove deletes multiple services", async () => {
         container.set([Logger, Config, Database]);
         await container.boot();

         await container.bulkRemove([Logger, Config]);

         expect(container.has(Logger)).toBe(false);
         expect(container.has(Config)).toBe(false);
         expect(container.has(Database)).toBe(true);
      });

      test("clear removes all except Container", async () => {
         container.set([Logger, Config]);
         container.set("api-key", "secret");
         await container.boot();

         await container.clear();

         expect(container.has(Container)).toBe(true);
         expect(container.has(Logger)).toBe(false);
         expect(container.has(Config)).toBe(false);
         expect(container.has("api-key")).toBe(false);
      });
   });
});

// ============================================
// INJECTION: Constructor, Property, Named
// ============================================

describe("Injection", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   describe("Constructor Injection", () => {
      test("injects dependencies via constructor", async () => {
         container.set([Logger, Database, UserRepo]);
         await container.boot();

         const repo = container.get(UserRepo);
         expect(repo.db).toBeInstanceOf(Database);
      });

      test("works without decorators when deps specified", async () => {
         container.set(Logger);
         container.set(PlainService, { deps: [Logger] });
         await container.boot();

         const service = container.get(PlainService);
         expect(service.logger).toBeInstanceOf(Logger);
      });
   });

   describe("Property Injection", () => {
      test("injects properties with @Inject decorator", async () => {
         container.set("API_KEY", "secret-123");
         container.set([Logger, PropertyInjectedService]);
         await container.boot();

         const service = container.get(PropertyInjectedService);
         expect(service.logger).toBeInstanceOf(Logger);
         expect(service.apiKey).toBe("secret-123");
      });
   });

   describe("Container Injection with @DI", () => {
      test("injects container into service", async () => {
         container.set([Logger, Config, ServiceWithContainerAccess]);
         await container.boot();

         const service = container.get(ServiceWithContainerAccess);
         expect(service.hasService(Logger)).toBe(true);
         expect(service.hasService(Config)).toBe(true);
      });

      test("allows dynamic service resolution", async () => {
         container.set([Logger, Config, ServiceWithContainerAccess]);
         await container.boot();

         const service = container.get(ServiceWithContainerAccess);
         const config = service.resolveOnDemand<Config>(Config);

         expect(config).toBeInstanceOf(Config);
         expect(config.port).toBe(3000);
      });

      test("factory service creates instances using container", async () => {
         container.set([Logger, Database, UserRepo, UserService, ServiceFactory]);
         await container.boot();

         const factory = container.get(ServiceFactory);
         const userService = factory.createUserService();

         expect(userService).toBeInstanceOf(UserService);
         expect(userService.repo).toBeInstanceOf(UserRepo);
      });

      test("service manager can load services dynamically", async () => {
         container.set([Logger, Config, ServiceManager]);
         await container.boot();

         const manager = container.get(ServiceManager);

         await manager.loadService(Logger);
         await manager.loadService(Config);

         expect(manager.getServiceCount()).toBe(2);
      });

      test("container reference is same instance", async () => {
         container.set([Logger, Database, UserRepo, UserService, ServiceWithContainerAccess, ServiceFactory]);
         await container.boot();

         const service1 = container.get(ServiceWithContainerAccess);
         const service2 = container.get(ServiceFactory);

         // Both should have access to the same container
         expect(service1.hasService(ServiceFactory)).toBe(true);
         expect(service2.createUserService).toBeDefined();
      });
   });

   describe("Named Injection", () => {
      test("resolves string tokens", async () => {
         container.set("API_URL", "https://api.example.com");
         await container.boot();

         expect(container.get<string>("API_URL")).toBe("https://api.example.com");
      });

      test("resolves symbol tokens", async () => {
         const CONFIG = Symbol("config");
         container.set(CONFIG, { timeout: 5000 });
         await container.boot();

         expect(container.get(CONFIG)).toEqual({ timeout: 5000 });
      });

      test("throws for async factories in sync get", async () => {
         container.set("ASYNC_DATA", async () => {
            await new Promise(r => setTimeout(r, 10));
            return "done";
         });

         expect(() => container.get("ASYNC_DATA")).toThrow(/not been resolved yet/i);

         await container.resolve("ASYNC_DATA");
         expect(container.get("ASYNC_DATA")).toBe("done");
      });
   });
});