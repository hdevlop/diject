import "reflect-metadata";
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { AlsStore, AlsToken, Container, createAlsToken, Scope, Service, Repository, Controller, Inject, Value } from "../src";

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

// Repository with direct decorator
@Repository()
class UserRepo {
   constructor(public db: Database) { }
   findAll() { return this.db.query("SELECT * FROM users"); }
   findById(id: number) { return this.db.query(`SELECT * FROM users WHERE id = ${id}`); }
}

@Repository()
class ProductRepo {
   constructor(public db: Database, public logger: Logger) { }
   findAll() { 
      this.logger.log("Finding all products");
      return this.db.query("SELECT * FROM products"); 
   }
}

// Controller examples
@Controller()
class UserController {
   constructor(
      public userRepo: UserRepo,
      public logger: Logger
   ) { }

   getAll() {
      this.logger.log("UserController.getAll");
      return this.userRepo.findAll();
   }

   getById(id: number) {
      this.logger.log(`UserController.getById(${id})`);
      return this.userRepo.findById(id);
   }
}

@Controller()
class ProductController {
   constructor(
      public productRepo: ProductRepo,
      public logger: Logger
   ) { }

   getAll() {
      this.logger.log("ProductController.getAll");
      return this.productRepo.findAll();
   }
}

// Property injection examples
@Service()
class CacheService {
   data: Map<string, any> = new Map();
   
   get(key: string) { return this.data.get(key); }
   set(key: string, value: any) { this.data.set(key, value); }
}

@Service()
class PropertyInjectionService {
   @Inject()
   logger!: Logger;

   @Inject()
   cache!: CacheService;

   execute() {
      this.logger.log("PropertyInjectionService executed");
      return "executed";
   }
}

@Controller()
class PropertyInjectionController {
   @Inject()
   logger!: Logger;

   @Inject()
   userRepo!: UserRepo;

   constructor(public config: Config) { }

   getUsers() {
      this.logger.log("Getting users with property injection");
      return this.userRepo.findAll();
   }
}

// Mixed injection (constructor + property)
@Service()
class MixedInjectionService {
   @Inject()
   logger!: Logger;

   constructor(public config: Config, public db: Database) { }

   run() {
      this.logger.log(`Running with port ${this.config.port}`);
      return this.db.query("SELECT 1");
   }
}

// Optional injection using @Value
@Service()
class OptionalInjectionService {
   @Value(Logger)
   optionalLogger?: Logger;

   @Inject()
   requiredCache!: CacheService;

   hasOptional() {
      return this.optionalLogger !== undefined;
   }
}

// Token-based injection
const API_KEY = Symbol("API_KEY");
const DATABASE_URL = "DATABASE_URL";

@Service()
class TokenInjectionService {
   @Inject(API_KEY)
   apiKey!: string;

   @Inject(DATABASE_URL)
   dbUrl!: string;

   getConfig() {
      return { apiKey: this.apiKey, dbUrl: this.dbUrl };
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

class PlainRepo {
   findAll() { return ["item1", "item2"]; }
}

// ============================================
// DECORATOR TESTS
// ============================================

describe("Decorators - Repository, Controller, Inject", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   describe("@Repository() Decorator", () => {
      test("registers repository with dependencies", async () => {
         container.set([Database, UserRepo]);
         await container.boot();

         const repo = container.get(UserRepo);
         expect(repo).toBeInstanceOf(UserRepo);
         expect(repo.db).toBeInstanceOf(Database);
      });

      test("repository can access database methods", async () => {
         container.set([Database, UserRepo]);
         await container.boot();

         const repo = container.get(UserRepo);
         const result = repo.findAll();
         expect(result.sql).toContain("SELECT * FROM users");
      });

      test("multiple repositories share singleton database", async () => {
         container.set([Database, Logger, UserRepo, ProductRepo]);
         await container.boot();

         const userRepo = container.get(UserRepo);
         const productRepo = container.get(ProductRepo);

         expect(userRepo.db).toBe(productRepo.db);
      });

      test("repository with multiple dependencies", async () => {
         container.set([Database, Logger, ProductRepo]);
         await container.boot();

         const repo = container.get(ProductRepo);
         expect(repo.db).toBeInstanceOf(Database);
         expect(repo.logger).toBeInstanceOf(Logger);

         repo.findAll();
         expect(repo.logger.logs).toContain("Finding all products");
      });
   });

   describe("@Controller() Decorator", () => {
      test("registers controller with dependencies", async () => {
         container.set([Database, Logger, UserRepo, UserController]);
         await container.boot();

         const controller = container.get(UserController);
         expect(controller).toBeInstanceOf(UserController);
         expect(controller.userRepo).toBeInstanceOf(UserRepo);
         expect(controller.logger).toBeInstanceOf(Logger);
      });

      test("controller can use repository methods", async () => {
         container.set([Database, Logger, UserRepo, UserController]);
         await container.boot();

         const controller = container.get(UserController);
         const result = controller.getAll();

         expect(result.sql).toContain("SELECT * FROM users");
         expect(controller.logger.logs).toContain("UserController.getAll");
      });

      test("multiple controllers work independently", async () => {
         container.set([
            Database, Logger, 
            UserRepo, ProductRepo,
            UserController, ProductController
         ]);
         await container.boot();

         const userCtrl = container.get(UserController);
         const productCtrl = container.get(ProductController);

         userCtrl.getAll();
         productCtrl.getAll();

         expect(userCtrl.logger.logs).toContain("UserController.getAll");
         expect(productCtrl.logger.logs).toContain("ProductController.getAll");
      });

      test("controller with method parameters", async () => {
         container.set([Database, Logger, UserRepo, UserController]);
         await container.boot();

         const controller = container.get(UserController);
         const result = controller.getById(123);

         expect(result.sql).toContain("WHERE id = 123");
         expect(controller.logger.logs).toContain("UserController.getById(123)");
      });
   });

   describe("@Inject() Decorator - Property Injection", () => {
      test("injects properties into service", async () => {
         container.set([Logger, CacheService, PropertyInjectionService]);
         await container.boot();

         const service = container.get(PropertyInjectionService);
         expect(service.logger).toBeInstanceOf(Logger);
         expect(service.cache).toBeInstanceOf(CacheService);

         service.execute();
         expect(service.logger.logs).toContain("PropertyInjectionService executed");
      });

      test("property injection in controller", async () => {
         container.set([Database, Config, Logger, UserRepo, PropertyInjectionController]);
         await container.boot();

         const controller = container.get(PropertyInjectionController);
         expect(controller.logger).toBeInstanceOf(Logger);
         expect(controller.userRepo).toBeInstanceOf(UserRepo);
         expect(controller.config).toBeInstanceOf(Config);

         controller.getUsers();
         expect(controller.logger.logs).toContain("Getting users with property injection");
      });

      test("mixed constructor and property injection", async () => {
         container.set([Config, Database, Logger, MixedInjectionService]);
         await container.boot();

         const service = container.get(MixedInjectionService);
         
         // Constructor injections
         expect(service.config).toBeInstanceOf(Config);
         expect(service.db).toBeInstanceOf(Database);
         
         // Property injection
         expect(service.logger).toBeInstanceOf(Logger);

         service.run();
         expect(service.logger.logs).toContain(`Running with port ${service.config.port}`);
      });
   });

   describe("@Inject() with Tokens", () => {
      test("inject string token values", async () => {
         container.set(DATABASE_URL, "postgres://localhost/mydb");
         container.set(API_KEY, "secret-key-123");
         container.set(TokenInjectionService);
         await container.boot();

         const service = container.get(TokenInjectionService);
         const config = service.getConfig();

         expect(config.apiKey).toBe("secret-key-123");
         expect(config.dbUrl).toBe("postgres://localhost/mydb");
      });

      test("inject symbol token values", async () => {
         const DB_POOL = Symbol("DB_POOL");
         
         @Service()
         class PoolService {
            @Inject(DB_POOL)
            pool!: any;
         }

         container.set(DB_POOL, { max: 10, min: 2 });
         container.set(PoolService);
         await container.boot();

         const service = container.get(PoolService);
         expect(service.pool).toEqual({ max: 10, min: 2 });
      });

      test("inject custom class with token", async () => {
         const CUSTOM_LOGGER = Symbol("CUSTOM_LOGGER");

         @Service()
         class CustomService {
            @Inject(CUSTOM_LOGGER)
            customLogger!: Logger;
         }

         const specialLogger = new Logger();
         specialLogger.log("I'm special");

         container.set(CUSTOM_LOGGER, specialLogger);
         container.set(CustomService);
         await container.boot();

         const service = container.get(CustomService);
         expect(service.customLogger).toBe(specialLogger);
         expect(service.customLogger.logs).toContain("I'm special");
      });
   });

   describe("@Inject() Optional Dependencies", () => {
      test("optional dependency not registered returns undefined", async () => {
         container.set([CacheService, OptionalInjectionService]);
         await container.boot();

         const service = container.get(OptionalInjectionService);
         expect(service.hasOptional()).toBe(false);
         expect(service.optionalLogger).toBeUndefined();
         expect(service.requiredCache).toBeInstanceOf(CacheService);
      });

      test("optional dependency when registered is injected", async () => {
         container.set([Logger, CacheService, OptionalInjectionService]);
         await container.boot();

         const service = container.get(OptionalInjectionService);
         expect(service.hasOptional()).toBe(true);
         expect(service.optionalLogger).toBeInstanceOf(Logger);
      });

      test("missing required dependency throws error", async () => {
         // Only register OptionalInjectionService without CacheService
         container.set(OptionalInjectionService);

         await expect(container.boot()).rejects.toThrow();
      });
   });

   describe("@Inject() Edge Cases", () => {
      test("inject into class with no constructor", async () => {
         @Service()
         class NoConstructorService {
            @Inject()
            logger!: Logger;

            @Inject()
            config!: Config;
         }

         container.set([Logger, Config, NoConstructorService]);
         await container.boot();

         const service = container.get(NoConstructorService);
         expect(service.logger).toBeInstanceOf(Logger);
         expect(service.config).toBeInstanceOf(Config);
      });

      test("multiple properties injected in correct order", async () => {
         @Service()
         class MultiService {
            @Inject()
            first!: Logger;

            @Inject()
            second!: Config;

            @Inject()
            third!: Database;

            checkAll() {
               return [
                  this.first instanceof Logger,
                  this.second instanceof Config,
                  this.third instanceof Database
               ];
            }
         }

         container.set([Logger, Config, Database, MultiService]);
         await container.boot();

         const service = container.get(MultiService);
         expect(service.checkAll()).toEqual([true, true, true]);
      });

      test("inject same dependency multiple times", async () => {
         @Service()
         class DuplicateService {
            @Inject()
            logger1!: Logger;

            @Inject()
            logger2!: Logger;
         }

         container.set([Logger, DuplicateService]);
         await container.boot();

         const service = container.get(DuplicateService);
         // Should get the same singleton instance
         expect(service.logger1).toBe(service.logger2);
      });

      test("inheritance with property injection", async () => {
         @Service()
         class BaseService {
            @Inject()
            logger!: Logger;
         }

         @Service()
         class DerivedService extends BaseService {
            @Inject()
            config!: Config;

            test() {
               return {
                  hasLogger: this.logger instanceof Logger,
                  hasConfig: this.config instanceof Config
               };
            }
         }

         container.set([Logger, Config, DerivedService]);
         await container.boot();

         const service = container.get(DerivedService);
         const result = service.test();
         
         expect(result.hasLogger).toBe(true);
         expect(result.hasConfig).toBe(true);
      });
   });

   describe("Integration - Repository + Controller + Inject", () => {
      test("full stack with all decorators", async () => {
         @Repository()
         class OrderRepo {
            @Inject()
            logger!: Logger;

            constructor(public db: Database) { }

            findOrders() {
               this.logger.log("Finding orders");
               return this.db.query("SELECT * FROM orders");
            }
         }

         @Controller()
         class OrderController {
            @Inject()
            logger!: Logger;

            constructor(public orderRepo: OrderRepo) { }

            getOrders() {
               this.logger.log("OrderController.getOrders");
               return this.orderRepo.findOrders();
            }
         }

         container.set([Database, Logger, OrderRepo, OrderController]);
         await container.boot();

         const controller = container.get(OrderController);
         const result = controller.getOrders();

         expect(result.sql).toContain("SELECT * FROM orders");
         expect(controller.logger.logs).toContain("OrderController.getOrders");
         expect(controller.orderRepo.logger.logs).toContain("Finding orders");
      });

      test("complex dependency graph", async () => {
         @Service()
         class AuthService {
            @Inject()
            logger!: Logger;

            authenticate(token: string) {
               this.logger.log(`Authenticating ${token}`);
               return true;
            }
         }

         @Repository()
         class AccountRepo {
            @Inject()
            cache!: CacheService;

            constructor(public db: Database) { }

            getAccount(id: number) {
               const cached = this.cache.get(`account:${id}`);
               if (cached) return cached;

               const result = this.db.query(`SELECT * FROM accounts WHERE id = ${id}`);
               this.cache.set(`account:${id}`, result);
               return result;
            }
         }

         @Controller()
         class AccountController {
            @Inject()
            logger!: Logger;

            @Inject()
            authService!: AuthService;

            constructor(public accountRepo: AccountRepo) { }

            getAccount(id: number, token: string) {
               this.logger.log(`Request for account ${id}`);
               
               if (!this.authService.authenticate(token)) {
                  throw new Error("Unauthorized");
               }

               return this.accountRepo.getAccount(id);
            }
         }

         container.set([
            Database, Logger, CacheService,
            AuthService, AccountRepo, AccountController
         ]);
         await container.boot();

         const controller = container.get(AccountController);
         const result = controller.getAccount(123, "valid-token");

         expect(result.sql).toContain("SELECT * FROM accounts WHERE id = 123");
         expect(controller.logger.logs).toContain("Request for account 123");
         expect(controller.authService.logger.logs).toContain("Authenticating valid-token");
      });

      test("transient scoped services with property injection", async () => {
         @Service({ scope: Scope.TRANSIENT })
         class TransientService {
            @Inject()
            logger!: Logger;

            id = Math.random();
         }

         container.set([Logger, TransientService]);
         await container.boot();

         const s1 = await container.resolve(TransientService);
         const s2 = await container.resolve(TransientService);

         expect(s1).not.toBe(s2);
         expect(s1.id).not.toBe(s2.id);
         // But logger should be the same singleton
         expect(s1.logger).toBe(s2.logger);
      });
   });
});

// ============================================
// SET API TESTS (from original)
// ============================================

describe("Set API - Comprehensive Coverage", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   describe("Plain Classes - All Variations", () => {
      test("null, undefined, empty object", async () => {
         container.set(PlainRepo, null);
         container.set(Logger, undefined);
         container.set(Config, {});
         await container.boot();

         expect(container.get(PlainRepo)).toBeInstanceOf(PlainRepo);
         expect(container.get(Logger)).toBeInstanceOf(Logger);
         expect(container.get(Config)).toBeInstanceOf(Config);
      });

      test("instance registration", async () => {
         const customLogger = new Logger();
         customLogger.log("pre-created");

         container.set(Logger, customLogger);
         await container.boot();

         expect(container.get(Logger)).toBe(customLogger);
         expect(container.get(Logger).logs).toContain("pre-created");
      });

      test("object with properties", async () => {
         container.set(Config, { prop: 'value', data: 123 });
         await container.boot();

         const config = container.get(Config);
         expect((config as any).prop).toBe('value');
         expect((config as any).data).toBe(123);
      });

      test("direct factory function", async () => {
         let callCount = 0;
         container.set(Logger, () => {
            callCount++;
            const logger = new Logger();
            logger.log("factory");
            return logger;
         });

         const logger = await container.resolve(Logger);
         expect(logger.logs).toContain("factory");
         expect(callCount).toBe(1);
      });

      test("scope + deps combination", async () => {
         container.set(Logger);
         container.set(PlainService, {
            scope: Scope.SINGLETON,
            deps: [Logger]
         });

         await container.boot();
         const service = container.get(PlainService);
         expect(service.logger).toBeInstanceOf(Logger);
      });

      test("deps + factory combination", async () => {
         container.set(Logger);
         container.set(PlainService, {
            deps: [Logger],
            factory: (logger: Logger) => {
               const service = new PlainService(logger);
               (service as any).fromFactory = true;
               return service;
            }
         });

         await container.boot();
         expect((container.get(PlainService) as any).fromFactory).toBe(true);
      });

      test("scope + deps + factory combination", async () => {
         container.set(Logger);
         container.set(PlainService, {
            scope: Scope.TRANSIENT,
            deps: [Logger],
            factory: (logger: Logger) => new PlainService(logger)
         });

         const a = await container.resolve(PlainService);
         const b = await container.resolve(PlainService);
         expect(a).not.toBe(b);
      });
   });

   describe("String/Symbol Tokens", () => {
      test("primitive values", async () => {
         container.set("str", "hello");
         container.set("num", 123);
         container.set("bool", true);
         await container.boot();

         expect(container.get("str")).toBe("hello");
         expect(container.get("num")).toBe(123);
         expect(container.get("bool")).toBe(true);
      });

      test("symbol tokens with values", async () => {
         const sym1 = Symbol("config");
         const sym2 = Symbol("data");

         container.set(sym1, { host: "localhost" });
         container.set(sym2, 999);
         await container.boot();

         expect(container.get(sym1)).toEqual({ host: "localhost" });
         expect(container.get(sym2)).toBe(999);
      });

      test("objects and arrays", async () => {
         container.set("config", { port: 3000 });
         container.set("list", [1, 2, 3]);
         container.set("names", ["Alice", "Bob"]);
         await container.boot();

         expect(container.get("config")).toEqual({ port: 3000 });
         expect(container.get("list")).toEqual([1, 2, 3]);
         expect(container.get("names")).toEqual(["Alice", "Bob"]);
      });

      test("class instances as values", async () => {
         const logger = new Logger();
         logger.log("test");

         const sym2 = Symbol("logger2");

         container.set("myLogger", logger);
         container.set(sym2, new Config());
         await container.boot();

         expect(container.get("myLogger")).toBe(logger);
         expect(container.get(sym2)).toBeInstanceOf(Config);
      });

      test("class instance with only prototype methods (no own properties)", async () => {
         class Strategy {
            encode(values: number[]) { return values.map(v => v * 2); }
            decode(values: number[]) { return values.map(v => v / 2); }
         }

         const strategy = new Strategy();
         expect(Object.keys(strategy)).toEqual([]);

         const sym = Symbol("strategy");
         container.set(sym, strategy);
         await container.boot();

         const resolved = container.get<Strategy>(sym);
         expect(resolved).toBe(strategy);
         expect(typeof resolved.encode).toBe("function");
         expect(resolved.encode([1, 2, 3])).toEqual([2, 4, 6]);
      });

      test("factory functions returning values", async () => {
         container.set("timestamp", () => 12345);
         container.set("obj", () => ({ data: "test" }));

         expect(await container.resolve<number>("timestamp")).toBe(12345);
         expect(await container.resolve<{ data: string }>("obj")).toEqual({ data: "test" });
      });
   });

   describe("Array Registration", () => {
      test("multiple plain classes", async () => {
         container.set([PlainRepo, Logger, Config]);
         await container.boot();

         expect(container.get(PlainRepo)).toBeInstanceOf(PlainRepo);
         expect(container.get(Logger)).toBeInstanceOf(Logger);
         expect(container.get(Config)).toBeInstanceOf(Config);
      });

      test("array with scope parameter", async () => {
         container.set([Logger, Config], Scope.SINGLETON);
         await container.boot();

         const logger1 = container.get(Logger);
         const logger2 = container.get(Logger);
         expect(logger1).toBe(logger2);
      });

      test("decorated classes in array", async () => {
         container.set([Logger, Database, UserRepo]);
         await container.boot();

         expect(container.get(UserRepo).db).toBeInstanceOf(Database);
      });

      test("mixed decorated and plain classes", async () => {
         container.set([PlainRepo, Logger, Config]);
         await container.boot();

         expect(container.get(PlainRepo)).toBeInstanceOf(PlainRepo);
         expect(container.get(Logger)).toBeInstanceOf(Logger);
      });

      test("single class in array", async () => {
         container.set([Logger]);
         await container.boot();

         expect(container.get(Logger)).toBeInstanceOf(Logger);
      });

      test("empty array", async () => {
         container.set([]);
         await container.boot();

         expect(container.has(Container)).toBe(true);
      });
   });

   describe("Edge Cases and Special Scenarios", () => {
      test("factory returning null", async () => {
         container.set("nullable", () => null);
         expect(await container.resolve("nullable")).toBe(null);
      });

      test("factory returning undefined", async () => {
         container.set("undefinable", () => undefined);
         expect(await container.resolve("undefinable")).toBe(undefined);
      });

      test("options with undefined/null values", async () => {
         container.set(Logger, { scope: undefined });
         container.set(Config, { deps: undefined });
         await container.boot();

         expect(container.get(Logger)).toBeInstanceOf(Logger);
         expect(container.get(Config)).toBeInstanceOf(Config);
      });

      test("nested objects", async () => {
         container.set("nested", {
            level1: {
               level2: {
                  value: 123
               }
            }
         });
         await container.boot();

         const nested = container.get("nested") as any;
         expect(nested.level1.level2.value).toBe(123);
      });

      test("anonymous class", async () => {
         const AnonymousClass = class {
            value = "anonymous";
         };

         container.set(AnonymousClass, Scope.SINGLETON);
         await container.boot();

         expect((container.get(AnonymousClass) as any).value).toBe("anonymous");
      });

      test("factory returning different class instance", async () => {
         container.set(PlainRepo, {
            factory: () => {
               const obj = { findAll: () => ["mocked"] };
               return obj as any;
            }
         });

         await container.boot();
         const repo = container.get(PlainRepo);
         expect(repo.findAll()).toEqual(["mocked"]);
      });

      test("scope override on decorated class", async () => {
         container.set(Logger, Scope.TRANSIENT);

         const a = await container.resolve(Logger);
         const b = await container.resolve(Logger);
         expect(a).not.toBe(b);
      });

      test("multiple registrations same token", async () => {
         container.set("value", "first");
         container.set("value", "second");
         await container.boot();

         expect(container.get("value")).toBe("second");
      });

      test("function as factory - returns execution result", async () => {
         const myFunction = () => "executed";
         container.set("fn", myFunction);

         await container.resolve("fn");
         expect(container.get("fn")).toBe("executed");
      });

      test("storing function reference - wrap in object", async () => {
         const myFunction = (x: number) => x * 2;

         container.set("calculator", { multiply: myFunction });
         await container.boot();

         const calc = container.get("calculator") as any;
         expect(calc.multiply(5)).toBe(10);
      });
   });

   describe("Scope Variations with Options", () => {
      test("TRANSIENT with deps", async () => {
         container.set(Logger);
         container.set(PlainService, {
            scope: Scope.TRANSIENT,
            deps: [Logger]
         });

         const a = await container.resolve(PlainService);
         const b = await container.resolve(PlainService);

         expect(a).not.toBe(b);
         expect(a.logger).toBe(b.logger);
      });

      test("REQUEST scope with deps", async () => {
         container.set(Logger);
         container.set(PlainService, {
            scope: Scope.REQUEST,
            deps: [Logger]
         });

         const svc1 = await container.resolve(PlainService, "req-1");
         const svc2 = await container.resolve(PlainService, "req-2");

         expect(svc1).not.toBe(svc2);
         expect(svc1.logger).toBe(svc2.logger);
      });

      test("all scopes with custom factory", async () => {
         let singletonCount = 0;
         let transientCount = 0;
         let requestCount = 0;

         container.set(Logger, {
            scope: Scope.SINGLETON,
            factory: () => { singletonCount++; return new Logger(); }
         });

         container.set(Config, {
            scope: Scope.TRANSIENT,
            factory: () => { transientCount++; return new Config(); }
         });

         container.set(Database, {
            scope: Scope.REQUEST,
            factory: () => { requestCount++; return new Database(); }
         });

         await container.boot();

         container.get(Logger);
         container.get(Logger);
         expect(singletonCount).toBe(1);

         await container.resolve(Config);
         await container.resolve(Config);
         expect(transientCount).toBe(2);

         await container.resolve(Database, "r1");
         await container.resolve(Database, "r1");
         await container.resolve(Database, "r2");
         expect(requestCount).toBe(2);
      });
   });
});

// ============================================
// ALS TESTS (from original - kept intact)
// ============================================

describe("AsyncLocalStorage - Comprehensive Coverage", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   describe("AlsStore - Basic Operations", () => {
      test("set and get single value", () => {
         const store = new AlsStore<{ userId: string }>();

         store.run({ userId: '123' }, () => {
            expect(store.get('userId')).toBe('123');
         });
      });

      test("set and get multiple values", () => {
         const store = new AlsStore<{ userId: string; role: string; tenantId: number }>();

         store.run({ userId: '123', role: 'admin' }, () => {
            expect(store.get('userId')).toBe('123');
            expect(store.get('role')).toBe('admin');
            expect(store.get('tenantId')).toBeUndefined();
         });
      });

      test("set single value inside context", () => {
         const store = new AlsStore<{ userId: string; role: string }>();

         store.run({ userId: '123' }, () => {
            store.set('role', 'admin');
            expect(store.get('role')).toBe('admin');
         });
      });

      test("set bulk values inside context", () => {
         const store = new AlsStore<{ userId: string; role: string; email: string }>();

         store.run({ userId: '123' }, () => {
            store.set({ role: 'admin', email: 'test@example.com' });
            expect(store.get('role')).toBe('admin');
            expect(store.get('email')).toBe('test@example.com');
         });
      });

      test("has returns correct boolean", () => {
         const store = new AlsStore<{ userId: string; role?: string }>();

         store.run({ userId: '123' }, () => {
            expect(store.has('userId')).toBe(true);
            expect(store.has('role')).toBe(false);

            store.set('role', 'admin');
            expect(store.has('role')).toBe(true);
         });
      });

      test("delete removes value", () => {
         const store = new AlsStore<{ userId: string; role: string }>();

         store.run({ userId: '123', role: 'admin' }, () => {
            expect(store.has('role')).toBe(true);
            store.delete('role');
            expect(store.has('role')).toBe(false);
            expect(store.get('role')).toBeUndefined();
         });
      });

      test("all returns all values", () => {
         const store = new AlsStore<{ userId: string; role: string; email: string }>();

         store.run({ userId: '123', role: 'admin' }, () => {
            const all = store.all();
            expect(all).toEqual({ userId: '123', role: 'admin' });
         });
      });

      test("clear removes all values", () => {
         const store = new AlsStore<{ userId: string; role: string }>();

         store.run({ userId: '123', role: 'admin' }, () => {
            store.clear();
            expect(store.get('userId')).toBeUndefined();
            expect(store.get('role')).toBeUndefined();
            expect(store.all()).toEqual({});
         });
      });

      test("isActive returns correct state", () => {
         const store = new AlsStore<{ userId: string }>();

         expect(store.isActive()).toBe(false);

         store.run({ userId: '123' }, () => {
            expect(store.isActive()).toBe(true);
         });

         expect(store.isActive()).toBe(false);
      });
   });

   describe("AlsStore - Error Handling", () => {
      test("set throws outside of run context", () => {
         const store = new AlsStore<{ userId: string }>();

         expect(() => store.set('userId', '123')).toThrow(/No active AsyncLocalStorage context/);
      });

      test("delete throws outside of run context", () => {
         const store = new AlsStore<{ userId: string }>();

         expect(() => store.delete('userId')).toThrow(/No active AsyncLocalStorage context/);
      });

      test("clear throws outside of run context", () => {
         const store = new AlsStore<{ userId: string }>();

         expect(() => store.clear()).toThrow(/No active AsyncLocalStorage context/);
      });

      test("get returns undefined outside context", () => {
         const store = new AlsStore<{ userId: string }>();

         expect(store.get('userId')).toBeUndefined();
      });

      test("has returns false outside context", () => {
         const store = new AlsStore<{ userId: string }>();

         expect(store.has('userId')).toBe(false);
      });

      test("all returns undefined outside context", () => {
         const store = new AlsStore<{ userId: string }>();

         expect(store.all()).toBeUndefined();
      });
   });

   describe("Container - ALS Integration", () => {
      test("run() executes callback in ALS context", () => {
         const result = container.run({ userId: '123', role: 'admin' }, () => {
            expect(container.store.get('userId')).toBe('123');
            return 'success';
         });

         expect(result).toBe('success');
      });

      test("isActive() reflects ALS state", () => {
         expect(container.isActive()).toBe(false);

         container.run({}, () => {
            expect(container.isActive()).toBe(true);
         });

         expect(container.isActive()).toBe(false);
      });

      test("ALS token integration with decorators", async () => {
         const USER_TOKEN = createAlsToken<{ id: number; name: string }>('user');

         @Service()
         class UserService {
            getUser() {
               return container.get(USER_TOKEN);
            }
         }

         container.set(UserService);
         await container.boot();

         const result = await container.run({ user: { id: 1, name: 'John' } }, async () => {
            const service = container.get(UserService);
            return service.getUser();
         });

         expect(result).toEqual({ id: 1, name: 'John' });
      });
   });
});
