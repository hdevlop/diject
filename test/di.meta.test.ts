import "reflect-metadata";
import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
   Container,
   Controller,
   getDecoratorMetadata, getDecoratorMetadataValue, hasDecoratorMetadata, Meta, Repository, Scope, Service
} from "../src";

// ============================================
// METADATA SYSTEM TESTS
// ============================================

describe("Metadata System", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   // Test fixtures for metadata tests
   @Service()
   class ConfigService {
      value = "config";
   }

   @Service()
   class LoggerService {
      value = "logger";
   }

   @Service()
   class DatabaseService {
      connected = false;
      async onInit() { this.connected = true; }
   }

   @Service()
   class CacheService {
      value = "cache";
   }

   @Service()
   class UserService2 {
      value = "user";
   }

   @Service()
   class OrderService2 {
      value = "order";
   }

   @Service()
   class PaymentService {
      value = "payment";
   }

   @Service()
   @Controller('/api')
   class ApiController {
      value = "api";
   }

   describe("setMeta and getMeta", () => {
      test("setMeta with key-value pair", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, 'layer', 'core');
         await container.boot();

         expect(container.getMeta(ConfigService, 'layer')).toBe('core');
      });

      test("setMeta with metadata object", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, { layer: 'core', priority: 10 });
         await container.boot();

         expect(container.getMeta(ConfigService, 'layer')).toBe('core');
         expect(container.getMeta(ConfigService, 'priority')).toBe(10);
      });

      test("getMeta returns all metadata when no key specified", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, { layer: 'core', priority: 10, critical: true });
         await container.boot();

         const meta = container.getMeta(ConfigService);
         expect(meta).toEqual({ type: 'service', layer: 'core', priority: 10, critical: true });
      });

      test("getMeta returns undefined for non-existent key", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, { layer: 'core' });
         await container.boot();

         expect(container.getMeta(ConfigService, 'nonexistent')).toBeUndefined();
      });

      test("getMeta returns type metadata for token without custom metadata", async () => {
         container.set(ConfigService);
         await container.boot();
         const meta = container.getMeta(ConfigService);
         expect(meta.type).toBe('service');
      });

      test("setMeta overwrites existing values", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, 'layer', 'core');
         container.setMeta(ConfigService, 'layer', 'domain');
         await container.boot();

         expect(container.getMeta(ConfigService, 'layer')).toBe('domain');
      });

      test("setMeta merges with existing metadata", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, { layer: 'core' });
         container.setMeta(ConfigService, { priority: 10 });
         await container.boot();

         expect(container.getMeta(ConfigService)).toEqual({ type: 'service', layer: 'core', priority: 10 });
      });

      test("setMeta is chainable", async () => {
         container
            .set(ConfigService)
            .setMeta(ConfigService, 'layer', 'core')
            .setMeta(ConfigService, 'priority', 10);
         await container.boot();

         expect(container.getMeta(ConfigService, 'layer')).toBe('core');
         expect(container.getMeta(ConfigService, 'priority')).toBe(10);
      });
   });

   describe("hasMeta and deleteMeta", () => {
      test("hasMeta returns true for existing key", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, 'layer', 'core');
         await container.boot();

         expect(container.hasMeta(ConfigService, 'layer')).toBe(true);
      });

      test("hasMeta returns false for non-existent key", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, 'layer', 'core');
         await container.boot();

         expect(container.hasMeta(ConfigService, 'priority')).toBe(false);
      });

      test("hasMeta returns false for token without explicit metadata", async () => {
         container.set(ConfigService);
         await container.boot();

         expect(container.hasMeta(ConfigService, 'layer')).toBe(false);
      });

      test("deleteMeta removes specific key", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, { layer: 'core', priority: 10 });
         container.deleteMeta(ConfigService, 'priority');
         await container.boot();

         expect(container.hasMeta(ConfigService, 'layer')).toBe(true);
         expect(container.hasMeta(ConfigService, 'priority')).toBe(false);
      });

      test("deleteMeta is chainable", async () => {
         container.set(ConfigService);
         container
            .setMeta(ConfigService, { layer: 'core', priority: 10, critical: true })
            .deleteMeta(ConfigService, 'priority')
            .deleteMeta(ConfigService, 'critical');
         await container.boot();

         expect(container.getMeta(ConfigService)).toEqual({ type: 'service', layer: 'core' });
      });

      test("clearMeta removes all metadata from token", async () => {
         container.set(ConfigService);
         container.setMeta(ConfigService, { layer: 'core', priority: 10 });
         container.clearMeta(ConfigService);
         await container.boot();

         expect(container.getMeta(ConfigService)).toEqual({});
         expect(container.hasMeta(ConfigService, 'layer')).toBe(false);
      });
   });

   describe("Registration with metadata", () => {
      test("set single service with metadata in options", async () => {
         container.set(ConfigService, { metadata: { layer: 'core', priority: 10 } });
         await container.boot();

         expect(container.getMeta(ConfigService, 'layer')).toBe('core');
         expect(container.getMeta(ConfigService, 'priority')).toBe(10);
      });

      test("set service with scope and metadata", async () => {
         container.set(ConfigService, {
            scope: Scope.SINGLETON,
            metadata: { layer: 'core' }
         });
         await container.boot();

         expect(container.getMeta(ConfigService, 'layer')).toBe('core');
         expect(container.get(ConfigService)).toBeInstanceOf(ConfigService);
      });

      test("set array of services with shared metadata", async () => {
         container.set([ConfigService, LoggerService, DatabaseService], {
            metadata: { layer: 'core', priority: 10 }
         });
         await container.boot();

         expect(container.getMeta(ConfigService, 'layer')).toBe('core');
         expect(container.getMeta(LoggerService, 'layer')).toBe('core');
         expect(container.getMeta(DatabaseService, 'layer')).toBe('core');

         expect(container.getMeta(ConfigService, 'priority')).toBe(10);
         expect(container.getMeta(LoggerService, 'priority')).toBe(10);
         expect(container.getMeta(DatabaseService, 'priority')).toBe(10);
      });

      test("set array with scope and metadata", async () => {
         container.set([UserService2, OrderService2], {
            scope: Scope.SINGLETON,
            metadata: { layer: 'domain', critical: true }
         });
         await container.boot();

         expect(container.getMeta(UserService2, 'layer')).toBe('domain');
         expect(container.getMeta(OrderService2, 'layer')).toBe('domain');
         expect(container.getMeta(UserService2, 'critical')).toBe(true);
      });
   });

   describe("find - Query by metadata", () => {
      beforeEach(async () => {
         container.set(ConfigService, { metadata: { layer: 'core', priority: 10 } });
         container.set(LoggerService, { metadata: { layer: 'core', priority: 9 } });
         container.set(DatabaseService, { metadata: { layer: 'core', priority: 8 } });
         container.set(UserService2, { metadata: { layer: 'domain', priority: 5 } });
         container.set(OrderService2, { metadata: { layer: 'domain', priority: 5 } });
         container.set(ApiController, { metadata: { layer: 'app', priority: 1 } });
      });

      test("find with single exact match", () => {
         const tokens = container.find({ layer: 'core' });

         expect(tokens).toHaveLength(3);
         expect(tokens).toContain(ConfigService);
         expect(tokens).toContain(LoggerService);
         expect(tokens).toContain(DatabaseService);
      });

      test("find with multiple exact matches (AND)", () => {
         const tokens = container.find({ layer: 'domain', priority: 5 });

         expect(tokens).toHaveLength(2);
         expect(tokens).toContain(UserService2);
         expect(tokens).toContain(OrderService2);
      });

      test("find with predicate function", () => {
         const tokens = container.find({ priority: (p: number) => p > 7 });

         expect(tokens).toHaveLength(3);
         expect(tokens).toContain(ConfigService);
         expect(tokens).toContain(LoggerService);
         expect(tokens).toContain(DatabaseService);
      });

      test("find with mixed exact match and predicate", () => {
         const tokens = container.find({
            layer: 'core',
            priority: (p: number) => p >= 9
         });

         expect(tokens).toHaveLength(2);
         expect(tokens).toContain(ConfigService);
         expect(tokens).toContain(LoggerService);
      });

      test("find returns empty array when no matches", () => {
         const tokens = container.find({ layer: 'nonexistent' });
         expect(tokens).toHaveLength(0);
      });

      test("find with empty query returns empty array", () => {
         const tokens = container.find({});
         expect(tokens).toHaveLength(0);
      });
   });

   describe("findByKey", () => {
      beforeEach(() => {
         container.set(ConfigService, { metadata: { layer: 'core', priority: 10 } });
         container.set(LoggerService, { metadata: { layer: 'core' } });
         container.set(UserService2, { metadata: { layer: 'domain', critical: true } });
         container.set(OrderService2, { metadata: { priority: 5 } });
      });

      test("findByKey returns tokens with specific key", () => {
         const tokens = container.findByKey('layer');

         expect(tokens).toHaveLength(3);
         expect(tokens).toContain(ConfigService);
         expect(tokens).toContain(LoggerService);
         expect(tokens).toContain(UserService2);
      });

      test("findByKey for priority", () => {
         const tokens = container.findByKey('priority');

         expect(tokens).toHaveLength(2);
         expect(tokens).toContain(ConfigService);
         expect(tokens).toContain(OrderService2);
      });

      test("findByKey returns empty for non-existent key", () => {
         const tokens = container.findByKey('nonexistent');
         expect(tokens).toHaveLength(0);
      });
   });

   describe("groupBy", () => {
      beforeEach(() => {
         container.set(ConfigService, { metadata: { layer: 'core' } });
         container.set(LoggerService, { metadata: { layer: 'core' } });
         container.set(UserService2, { metadata: { layer: 'domain' } });
         container.set(OrderService2, { metadata: { layer: 'domain' } });
         container.set(ApiController, { metadata: { layer: 'app' } });
      });

      test("groupBy groups tokens by key value", () => {
         const groups = container.groupBy('layer');

         expect(groups.size).toBe(3);

         expect(groups.get('core')).toHaveLength(2);
         expect(groups.get('core')).toContain(ConfigService);
         expect(groups.get('core')).toContain(LoggerService);

         expect(groups.get('domain')).toHaveLength(2);
         expect(groups.get('domain')).toContain(UserService2);
         expect(groups.get('domain')).toContain(OrderService2);

         expect(groups.get('app')).toHaveLength(1);
         expect(groups.get('app')).toContain(ApiController);
      });

      test("groupBy returns empty map for non-existent key", () => {
         const groups = container.groupBy('nonexistent');
         expect(groups.size).toBe(0);
      });
   });

   describe("getValues", () => {
      beforeEach(() => {
         container.set(ConfigService, { metadata: { layer: 'core', priority: 10 } });
         container.set(LoggerService, { metadata: { layer: 'core', priority: 9 } });
         container.set(UserService2, { metadata: { layer: 'domain', priority: 5 } });
         container.set(ApiController, { metadata: { layer: 'app', priority: 1 } });
      });

      test("getValues returns unique values for key", () => {
         const layers = container.getValues('layer');

         expect(layers.size).toBe(3);
         expect(layers.has('core')).toBe(true);
         expect(layers.has('domain')).toBe(true);
         expect(layers.has('app')).toBe(true);
      });

      test("getValues returns unique priorities", () => {
         const priorities = container.getValues('priority');

         expect(priorities.size).toBe(4);
         expect(priorities.has(10)).toBe(true);
         expect(priorities.has(9)).toBe(true);
         expect(priorities.has(5)).toBe(true);
         expect(priorities.has(1)).toBe(true);
      });

      test("getValues returns empty set for non-existent key", () => {
         const values = container.getValues('nonexistent');
         expect(values.size).toBe(0);
      });
   });

   describe("filterBy", () => {
      beforeEach(() => {
         container.set(ConfigService, { metadata: { layer: 'core', tags: ['core', 'config'] } });
         container.set(LoggerService, { metadata: { layer: 'core', tags: ['core', 'logging'] } });
         container.set(UserService2, { metadata: { layer: 'domain', tags: ['business'] } });
         container.set(PaymentService, { metadata: { layer: 'domain', tags: ['business', 'critical'] } });
      });

      test("filterBy with simple predicate", () => {
         const tokens = container.filterBy((meta) => meta.layer === 'core');

         expect(tokens).toHaveLength(2);
         expect(tokens).toContain(ConfigService);
         expect(tokens).toContain(LoggerService);
      });

      test("filterBy with array check", () => {
         const tokens = container.filterBy((meta) => meta.tags?.includes('core'));

         expect(tokens).toHaveLength(2);
         expect(tokens).toContain(ConfigService);
         expect(tokens).toContain(LoggerService);
      });

      test("filterBy with complex condition", () => {
         const tokens = container.filterBy((meta) =>
            meta.layer === 'domain' && meta.tags?.includes('critical')
         );

         expect(tokens).toHaveLength(1);
         expect(tokens).toContain(PaymentService);
      });

      test("filterBy receives token as second argument", () => {
         const tokens = container.filterBy((meta, token) =>
            typeof token === 'function' && token.name.includes('Service')
         );

         expect(tokens.length).toBeGreaterThan(0);
         tokens.forEach(token => {
            expect((token as Function).name).toContain('Service');
         });
      });
   });

   describe("bulkSetMeta", () => {
      test("bulkSetMeta sets metadata on multiple tokens", async () => {
         container.set([UserService2, OrderService2, PaymentService]);
         container.bulkSetMeta([UserService2, OrderService2, PaymentService], {
            layer: 'domain',
            critical: true
         });
         await container.boot();

         expect(container.getMeta(UserService2, 'layer')).toBe('domain');
         expect(container.getMeta(OrderService2, 'layer')).toBe('domain');
         expect(container.getMeta(PaymentService, 'layer')).toBe('domain');

         expect(container.getMeta(UserService2, 'critical')).toBe(true);
         expect(container.getMeta(OrderService2, 'critical')).toBe(true);
         expect(container.getMeta(PaymentService, 'critical')).toBe(true);
      });

      test("bulkSetMeta is chainable", async () => {
         container
            .set([UserService2, OrderService2])
            .bulkSetMeta([UserService2, OrderService2], { layer: 'domain' });
         await container.boot();

         expect(container.getMeta(UserService2, 'layer')).toBe('domain');
         expect(container.getMeta(OrderService2, 'layer')).toBe('domain');
      });
   });

   describe("bootBy - Boot by metadata query", () => {
      test("bootBy resolves only matching services", async () => {
         const bootOrder: string[] = [];

         @Service()
         class FrameworkService1 {
            constructor() { bootOrder.push('core1'); }
         }

         @Service()
         class FrameworkService2 {
            constructor() { bootOrder.push('core2'); }
         }

         @Service()
         class DomainService1 {
            constructor() { bootOrder.push('domain1'); }
         }

         container.set(FrameworkService1, { metadata: { layer: 'core' } });
         container.set(FrameworkService2, { metadata: { layer: 'core' } });
         container.set(DomainService1, { metadata: { layer: 'domain' } });

         await container.bootBy({ layer: 'core' });

         expect(bootOrder).toContain('core1');
         expect(bootOrder).toContain('core2');
         expect(bootOrder).not.toContain('domain1');
      });

      test("bootBy with predicate", async () => {
         const bootOrder: string[] = [];

         @Service()
         class HighPriority {
            constructor() { bootOrder.push('high'); }
         }

         @Service()
         class LowPriority {
            constructor() { bootOrder.push('low'); }
         }

         container.set(HighPriority, { metadata: { priority: 10 } });
         container.set(LowPriority, { metadata: { priority: 1 } });

         await container.bootBy({ priority: (p: number) => p > 5 });

         expect(bootOrder).toContain('high');
         expect(bootOrder).not.toContain('low');
      });
   });

   describe("bootPhased - Boot in phases", () => {
      test("bootPhased boots services in specified order", async () => {
         const bootOrder: string[] = [];

         @Service()
         class Framework1 {
            constructor() { bootOrder.push('core1'); }
         }

         @Service()
         class Framework2 {
            constructor() { bootOrder.push('core2'); }
         }

         @Service()
         class Domain1 {
            constructor() { bootOrder.push('domain1'); }
         }

         @Service()
         class App1 {
            constructor() { bootOrder.push('app1'); }
         }

         container.set(App1, { metadata: { layer: 'app' } });
         container.set(Domain1, { metadata: { layer: 'domain' } });
         container.set(Framework1, { metadata: { layer: 'core' } });
         container.set(Framework2, { metadata: { layer: 'core' } });

         await container.bootPhased('layer', ['core', 'domain', 'app']);

         const core1Idx = bootOrder.indexOf('core1');
         const core2Idx = bootOrder.indexOf('core2');
         const domain1Idx = bootOrder.indexOf('domain1');
         const app1Idx = bootOrder.indexOf('app1');

         expect(core1Idx).toBeLessThan(domain1Idx);
         expect(core2Idx).toBeLessThan(domain1Idx);
         expect(domain1Idx).toBeLessThan(app1Idx);
      });

      test("bootPhased skips phases with no matching services", async () => {
         const bootOrder: string[] = [];

         @Service()
         class OnlyService {
            constructor() { bootOrder.push('only'); }
         }

         container.set(OnlyService, { metadata: { layer: 'domain' } });

         await container.bootPhased('layer', ['core', 'domain', 'app']);

         expect(bootOrder).toEqual(['only']);
      });
   });

   describe("bootOrdered - Boot ordered by key", () => {
      test("bootOrdered ascending order", async () => {
         const bootOrder: string[] = [];

         @Service()
         class Priority10 {
            constructor() { bootOrder.push('p10'); }
         }

         @Service()
         class Priority5 {
            constructor() { bootOrder.push('p5'); }
         }

         @Service()
         class Priority1 {
            constructor() { bootOrder.push('p1'); }
         }

         container.set(Priority5, { metadata: { priority: 5 } });
         container.set(Priority10, { metadata: { priority: 10 } });
         container.set(Priority1, { metadata: { priority: 1 } });

         await container.bootOrdered('priority', 'asc');

         expect(bootOrder).toEqual(['p1', 'p5', 'p10']);
      });

      test("bootOrdered descending order", async () => {
         const bootOrder: string[] = [];

         @Service()
         class Priority10Desc {
            constructor() { bootOrder.push('p10'); }
         }

         @Service()
         class Priority5Desc {
            constructor() { bootOrder.push('p5'); }
         }

         @Service()
         class Priority1Desc {
            constructor() { bootOrder.push('p1'); }
         }

         container.set(Priority5Desc, { metadata: { priority: 5 } });
         container.set(Priority10Desc, { metadata: { priority: 10 } });
         container.set(Priority1Desc, { metadata: { priority: 1 } });

         await container.bootOrdered('priority', 'desc');

         expect(bootOrder).toEqual(['p10', 'p5', 'p1']);
      });

      test("bootOrdered defaults to ascending", async () => {
         const bootOrder: string[] = [];

         @Service()
         class PriorityA {
            constructor() { bootOrder.push('pA'); }
         }

         @Service()
         class PriorityB {
            constructor() { bootOrder.push('pB'); }
         }

         container.set(PriorityB, { metadata: { order: 2 } });
         container.set(PriorityA, { metadata: { order: 1 } });

         await container.bootOrdered('order');

         expect(bootOrder).toEqual(['pA', 'pB']);
      });
   });

   describe("Metadata with delete and clear", () => {
      test("delete token cleans up metadata indexes", async () => {
         container.set(ConfigService, { metadata: { layer: 'core' } });
         container.set(LoggerService, { metadata: { layer: 'core' } });
         await container.boot();

         expect(container.find({ layer: 'core' })).toHaveLength(2);

         await container.delete(ConfigService);

         expect(container.find({ layer: 'core' })).toHaveLength(1);
         expect(container.find({ layer: 'core' })).toContain(LoggerService);
      });

      test("clear removes all metadata", async () => {
         container.set(ConfigService, { metadata: { layer: 'core' } });
         container.set(LoggerService, { metadata: { layer: 'core' } });
         await container.boot();

         await container.clear();

         expect(container.find({ layer: 'core' })).toHaveLength(0);
         expect(container.findByKey('layer')).toHaveLength(0);
      });
   });

   describe("Integration - Complete metadata workflow", () => {
      test("layered architecture boot sequence", async () => {
         const events: string[] = [];

         @Service()
         class AppConfig {
            constructor() { events.push('config'); }
         }

         @Service()
         class AppUserService {
            constructor() { events.push('userService'); }
         }

         @Service()
         class AppController {
            constructor() { events.push('controller'); }
         }

         container.set(AppConfig, { metadata: { layer: 'core' } });
         container.set(AppUserService, { metadata: { layer: 'domain' } });
         container.set(AppController, { metadata: { layer: 'app' } });

         await container.bootPhased('layer', ['core', 'domain', 'app']);

         const configIdx = events.indexOf('config');
         const userServiceIdx = events.indexOf('userService');
         const controllerIdx = events.indexOf('controller');

         expect(configIdx).toBeLessThan(userServiceIdx);
         expect(userServiceIdx).toBeLessThan(controllerIdx);
         expect(events).toEqual(['config', 'userService', 'controller']);
      });

      test("feature-based organization with critical services", async () => {
         const bootedCritical: string[] = [];
         const bootedNonCritical: string[] = [];

         @Service()
         class AuthService {
            constructor() { bootedCritical.push('auth'); }
         }

         @Service()
         class TokenService {
            constructor() { bootedCritical.push('token'); }
         }

         @Service()
         class AnalyticsService {
            constructor() { bootedNonCritical.push('analytics'); }
         }

         @Service()
         class NotificationService {
            constructor() { bootedNonCritical.push('notification'); }
         }

         container.set([AuthService, TokenService], {
            metadata: { feature: 'auth', critical: true }
         });

         container.set([AnalyticsService, NotificationService], {
            metadata: { feature: 'support', critical: false }
         });

         await container.bootBy({ critical: true });
         expect(bootedCritical).toHaveLength(2);
         expect(bootedNonCritical).toHaveLength(0);

         await container.bootBy({ critical: false });
         expect(bootedNonCritical).toHaveLength(2);

         const authServices = container.find({ feature: 'auth' });
         expect(authServices).toHaveLength(2);

         const criticalServices = container.filterBy((meta) => meta.critical === true);
         expect(criticalServices).toHaveLength(2);
      });

      test("dynamic metadata updates after registration", async () => {
         container.set(ConfigService);
         container.set(LoggerService);
         await container.boot();

         container.setMeta(ConfigService, { layer: 'core', version: '1.0' });
         container.setMeta(LoggerService, { layer: 'core', version: '1.1' });

         expect(container.find({ layer: 'core' })).toHaveLength(2);

         container.setMeta(ConfigService, 'version', '2.0');
         expect(container.getMeta(ConfigService, 'version')).toBe('2.0');

         const v2Services = container.find({ version: '2.0' });
         expect(v2Services).toHaveLength(1);
         expect(v2Services).toContain(ConfigService);
      });
   });
});


describe("Decorator Metadata", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   describe("@Meta() Decorator - Standalone", () => {
      test("@Meta() adds metadata to class", () => {
         @Service()
         @Meta({ layer: 'domain' })
         class TestService { }

         const meta = getDecoratorMetadata(TestService);
         expect(meta.layer).toBe('domain');
      });

      test("@Meta() is stackable - multiple decorators merge", () => {
         @Service()
         @Meta({ layer: 'domain' })
         @Meta({ priority: 10 })
         @Meta({ tags: ['critical'] })
         class StackedMetaService { }

         const meta = getDecoratorMetadata(StackedMetaService);
         expect(meta.layer).toBe('domain');
         expect(meta.priority).toBe(10);
         expect(meta.tags).toEqual(['critical']);
      });

      test("@Meta() can be used without other decorators", () => {
         @Meta({ custom: 'value' })
         class PlainMetaClass { }

         const meta = getDecoratorMetadata(PlainMetaClass);
         expect(meta.custom).toBe('value');
      });

      test("@Meta() with complex nested objects", () => {
         @Service()
         @Meta({
            config: {
               timeout: 5000,
               retries: 3,
               endpoints: ['a', 'b']
            }
         })
         class ComplexMetaService { }

         const meta = getDecoratorMetadata(ComplexMetaService);
         expect(meta.config).toEqual({
            timeout: 5000,
            retries: 3,
            endpoints: ['a', 'b']
         });
      });
   });

   describe("@Service() with Metadata Options", () => {
      test("@Service() with scope only (backward compatible)", () => {
         @Service(Scope.REQUEST)
         class RequestScopedService { }

         container.set(RequestScopedService);
         const entry = container['registry'].get(RequestScopedService);
         expect(entry.scope).toBe(Scope.REQUEST);
      });

      test("@Service() with no args (backward compatible)", () => {
         @Service()
         class DefaultService { }

         container.set(DefaultService);
         const entry = container['registry'].get(DefaultService);
         expect(entry.scope).toBe(Scope.SINGLETON);
      });

      test("@Service() with options object containing scope", async () => {
         @Service({ scope: Scope.TRANSIENT })
         class TransientService { }

         container.set(TransientService);

         const a = await container.resolve(TransientService);
         const b = await container.resolve(TransientService);
         expect(a).not.toBe(b);
      });

      test("@Service() with options object containing metadata", async () => {
         @Service({ metadata: { layer: 'domain', priority: 5 } })
         class MetadataService { }

         container.set(MetadataService);
         await container.boot();

         expect(container.getMeta(MetadataService, 'layer')).toBe('domain');
         expect(container.getMeta(MetadataService, 'priority')).toBe(5);
      });

      test("@Service() with scope and metadata combined", async () => {
         @Service({ scope: Scope.SINGLETON, metadata: { layer: 'core' } })
         class FullOptionsService { }

         container.set(FullOptionsService);
         await container.boot();

         const entry = container['registry'].get(FullOptionsService);
         expect(entry.scope).toBe(Scope.SINGLETON);
         expect(container.getMeta(FullOptionsService, 'layer')).toBe('core');
      });
   });

   describe("@Service() + @Meta() for Controller-like behavior", () => {

      test("@Controller() + @Meta() with path only", () => {
         @Controller()
         @Meta({ path: '/users' })
         class UsersController { }

         container.set(UsersController);
         expect(container.getMeta(UsersController, 'type')).toBe('controller');
      });

      test("@Controller() + @Meta() with no path", () => {
         @Controller()
         class RootController { }

         container.set(RootController);
         expect(container.getMeta(RootController, 'type')).toBe('controller');
      });

      test("@Service() with metadata containing path", async () => {
         @Controller('/api/products')
         class ProductsController { }

         container.set(ProductsController);
         await container.boot();

         expect(container.getMeta(ProductsController, 'type')).toBe('controller');
      });

      test("@Service() with metadata containing version and public flag", async () => {

         @Controller({ path: '/api', metadata: { version: 'v1', public: true } })
         class ApiV1Controller { }

         container.set(ApiV1Controller);
         await container.boot();

         expect(container.getMeta(ApiV1Controller, 'version')).toBe('v1');
         expect(container.getMeta(ApiV1Controller, 'public')).toBe(true);
      });

      test("@Service() with path and metadata combined", async () => {

         @Controller({ path: '/admin', metadata: { auth: 'required', rateLimit: 100 } })
         class AdminController { }

         container.set(AdminController);
         await container.boot();

         expect(container.getMeta(AdminController, 'type')).toBe('controller');
         expect(container.getMeta(AdminController, 'auth')).toBe('required');
         expect(container.getMeta(AdminController, 'rateLimit')).toBe(100);
      });
   });

   describe("@Service() + @Meta() for Repository-like behavior", () => {
      test("@Service() + @Meta() with database name only", () => {

         @Repository()
         @Meta({ database: 'analytics' })
         class AnalyticsRepo { }

         container.set(AnalyticsRepo);
         expect(container.getMeta(AnalyticsRepo, 'type')).toBe('repository');
      });

      test("@Service() + @Meta() with no database", () => {

         @Repository()
         class DefaultRepo { }

         container.set(DefaultRepo);
         expect(container.getMeta(DefaultRepo, 'type')).toBe('repository');
      });

      test("@Service() with metadata containing database", async () => {
         @Repository({ metadata: { type: 'repository', database: 'reporting' } })
         class ReportingRepo { }

         container.set(ReportingRepo);
         await container.boot();

         expect(container.getMeta(ReportingRepo, 'type')).toBe('repository');
      });

      test("@Service() with metadata containing entity and cached flag", async () => {
         @Repository({ metadata: { type: 'repository', entity: 'User', cached: true } })

         class UserRepoWithMeta { }

         container.set(UserRepoWithMeta);
         await container.boot();

         expect(container.getMeta(UserRepoWithMeta, 'entity')).toBe('User');
         expect(container.getMeta(UserRepoWithMeta, 'cached')).toBe(true);
      });

      test("@Service() with database and metadata combined", async () => {
         @Repository({ metadata: { type: 'repository', database: 'main', entity: 'Order', ttl: 3600 } })
         class OrderRepoWithMeta { }

         container.set(OrderRepoWithMeta);
         await container.boot();

         expect(container.getMeta(OrderRepoWithMeta, 'type')).toBe('repository');
         expect(container.getMeta(OrderRepoWithMeta, 'entity')).toBe('Order');
         expect(container.getMeta(OrderRepoWithMeta, 'ttl')).toBe(3600);
      });
   });

   describe("Combining @Meta() with Decorator Options", () => {
      test("@Service() metadata merges with @Meta()", async () => {
         @Service({ metadata: { layer: 'domain' } })
         @Meta({ priority: 10 })
         @Meta({ tags: ['core'] })
         class CombinedService { }

         container.set(CombinedService);
         await container.boot();

         expect(container.getMeta(CombinedService, 'layer')).toBe('domain');
         expect(container.getMeta(CombinedService, 'priority')).toBe(10);
         expect(container.getMeta(CombinedService, 'tags')).toEqual(['core']);
      });

      test("@Service() with controller metadata merges with @Meta()", async () => {
         @Controller({ metadata: { type: 'controller', path: '/users', version: 'v2' } })
         @Meta({ auth: 'jwt' })
         @Meta({ rateLimit: 50 })
         class CombinedController { }

         container.set(CombinedController);
         await container.boot();

         expect(container.getMeta(CombinedController, 'version')).toBe('v2');
         expect(container.getMeta(CombinedController, 'auth')).toBe('jwt');
         expect(container.getMeta(CombinedController, 'rateLimit')).toBe(50);
      });

      test("Decorator options override @Meta() for same key", async () => {
         @Service({ metadata: { priority: 100 } })
         @Meta({ priority: 10 })  // This should be overridden
         class OverrideService { }

         // Note: The decorator options metadata is stored in META.METADATA
         // and will be merged during registration
         const decoratorMeta = getDecoratorMetadata(OverrideService);
         // @Meta is applied first, then @Service overrides
         expect(decoratorMeta.priority).toBe(100);
      });
   });

   describe("Metadata Merge Priority", () => {
      test("container.set() metadata overrides decorator metadata", async () => {
         @Service({ metadata: { layer: 'domain', priority: 5 } })
         @Meta({ tags: ['user'] })
         class MergeTestService { }

         // Registration with additional metadata
         container.set(MergeTestService, { metadata: { priority: 10, critical: true } });
         await container.boot();

         // Decorator metadata
         expect(container.getMeta(MergeTestService, 'layer')).toBe('domain');
         expect(container.getMeta(MergeTestService, 'tags')).toEqual(['user']);

         // Overridden by container.set()
         expect(container.getMeta(MergeTestService, 'priority')).toBe(10);

         // Added by container.set()
         expect(container.getMeta(MergeTestService, 'critical')).toBe(true);
      });

      test("Complete merge chain: @Meta -> decorator options -> container.set()", async () => {
         @Service({ metadata: { b: 'decorator', c: 'decorator' } })
         @Meta({ a: 'meta', b: 'meta' })
         class FullMergeService { }

         container.set(FullMergeService, { metadata: { c: 'set', d: 'set' } });
         await container.boot();

         // From @Meta (base)
         expect(container.getMeta(FullMergeService, 'a')).toBe('meta');

         // From decorator options (overrides @Meta)
         expect(container.getMeta(FullMergeService, 'b')).toBe('decorator');

         // From container.set() (overrides decorator)
         expect(container.getMeta(FullMergeService, 'c')).toBe('set');

         // From container.set() only
         expect(container.getMeta(FullMergeService, 'd')).toBe('set');
      });
   });

   describe("Decorator Metadata Getters", () => {
      @Service({ metadata: { layer: 'core', priority: 10 } })
      @Meta({ tags: ['core', 'config'] })
      @Meta({ version: '1.0.0' })
      class GetterTestService { }

      test("getDecoratorMetadata() returns all decorator metadata", () => {
         const meta = getDecoratorMetadata(GetterTestService);

         expect(meta.layer).toBe('core');
         expect(meta.priority).toBe(10);
         expect(meta.tags).toEqual(['core', 'config']);
         expect(meta.version).toBe('1.0.0');
      });

      test("getDecoratorMetadata() returns empty object for class without metadata", () => {
         class NoMetaClass { }

         const meta = getDecoratorMetadata(NoMetaClass);
         expect(meta).toEqual({});
      });

      test("hasDecoratorMetadata() returns true for existing key", () => {
         expect(hasDecoratorMetadata(GetterTestService, 'layer')).toBe(true);
         expect(hasDecoratorMetadata(GetterTestService, 'priority')).toBe(true);
         expect(hasDecoratorMetadata(GetterTestService, 'tags')).toBe(true);
      });

      test("hasDecoratorMetadata() returns false for non-existent key", () => {
         expect(hasDecoratorMetadata(GetterTestService, 'nonexistent')).toBe(false);
         expect(hasDecoratorMetadata(GetterTestService, 'missing')).toBe(false);
      });

      test("hasDecoratorMetadata() returns false for class without metadata", () => {
         class NoMetaClass2 { }

         expect(hasDecoratorMetadata(NoMetaClass2, 'anything')).toBe(false);
      });

      test("getDecoratorMetadataValue() returns specific value", () => {
         expect(getDecoratorMetadataValue<string>(GetterTestService, 'layer')).toBe('core');
         expect(getDecoratorMetadataValue<number>(GetterTestService, 'priority')).toBe(10);
         expect(getDecoratorMetadataValue<string[]>(GetterTestService, 'tags')).toEqual(['core', 'config']);
      });

      test("getDecoratorMetadataValue() returns undefined for non-existent key", () => {
         expect(getDecoratorMetadataValue(GetterTestService, 'nonexistent')).toBeUndefined();
      });

      test("getDecoratorMetadataValue() with type parameter", () => {
         const priority = getDecoratorMetadataValue<number>(GetterTestService, 'priority');
         expect(priority).toBe(10);

         const tags = getDecoratorMetadataValue<string[]>(GetterTestService, 'tags');
         expect(tags).toEqual(['core', 'config']);
      });
   });

   describe("Integration - Decorator Metadata with Container Queries", () => {
      test("find() works with decorator-defined metadata", async () => {
         @Service({ metadata: { layer: 'core' } })
         @Meta({ priority: 10 })
         class FrameworkConfig1 { }

         @Service({ metadata: { layer: 'core' } })
         @Meta({ priority: 9 })
         class FrameworkLogger1 { }

         @Service()
         @Meta({ layer: 'domain', priority: 5 })
         class DomainUserService1 { }

         container.set([FrameworkConfig1, FrameworkLogger1, DomainUserService1]);
         await container.boot();

         const coreServices = container.find({ layer: 'core' });
         expect(coreServices).toHaveLength(2);
      });

      test("find() with predicate on decorator metadata", async () => {
         @Service({ metadata: { priority: 10 } })
         class HighPriority1 { }

         @Service({ metadata: { priority: 9 } })
         class HighPriority2 { }

         @Service({ metadata: { priority: 1 } })
         class LowPriority1 { }

         container.set([HighPriority1, HighPriority2, LowPriority1]);
         await container.boot();

         const highPriority = container.find({ priority: (p: number) => p >= 9 });
         expect(highPriority).toHaveLength(2);
      });

      test("groupBy() works with decorator-defined metadata", async () => {
         @Service({ metadata: { layer: 'core' } })
         class F1 { }

         @Service({ metadata: { layer: 'core' } })
         class F2 { }

         @Service()
         @Meta({ layer: 'domain' })
         class D1 { }

         @Service()
         @Meta({ type: 'controller', path: '/', layer: 'app' })
         class A1 { }

         container.set([F1, F2, D1, A1]);
         await container.boot();

         const groups = container.groupBy('layer');

         expect(groups.get('core')).toHaveLength(2);
         expect(groups.get('domain')).toHaveLength(1);
         expect(groups.get('app')).toHaveLength(1);
      });

      test("filterBy() works with combined metadata", async () => {
         @Service()
         @Meta({ critical: true })
         class CriticalSvc { }

         @Service()
         @Meta({ critical: false })
         class NonCriticalSvc { }

         container.set([CriticalSvc, NonCriticalSvc]);
         await container.boot();

         const critical = container.filterBy((meta) => meta.critical === true);
         expect(critical).toHaveLength(1);
      });

      test("getValues() returns decorator-defined values", async () => {
         @Service({ metadata: { layer: 'core' } })
         class LayerF { }

         @Service()
         @Meta({ layer: 'domain' })
         class LayerD { }

         @Service()
         @Meta({ type: 'controller', path: '/', layer: 'app' })
         class LayerA { }

         container.set([LayerF, LayerD, LayerA]);
         await container.boot();

         const layers = container.getValues('layer');

         expect(layers.has('core')).toBe(true);
         expect(layers.has('domain')).toBe(true);
         expect(layers.has('app')).toBe(true);
      });
   });

   describe("Integration - Decorator Metadata with Boot Phases", () => {
      test("bootPhased() works with decorator-defined layers", async () => {
         const bootOrder: string[] = [];

         @Service({ metadata: { layer: 'core' } })
         class BootFramework {
            constructor() { bootOrder.push('core'); }
         }

         @Service()
         @Meta({ layer: 'domain' })
         class BootDomain {
            constructor() { bootOrder.push('domain'); }
         }

         @Service()
         @Meta({ type: 'controller', path: '/', layer: 'app' })
         class BootApp {
            constructor() { bootOrder.push('app'); }
         }

         container.set([BootFramework, BootDomain, BootApp]);
         await container.bootPhased('layer', ['core', 'domain', 'app']);

         expect(bootOrder.indexOf('core')).toBeLessThan(bootOrder.indexOf('domain'));
         expect(bootOrder.indexOf('domain')).toBeLessThan(bootOrder.indexOf('app'));
      });

      test("bootOrdered() works with decorator-defined priority", async () => {
         const bootOrder: string[] = [];

         @Service({ metadata: { priority: 1 } })
         class LowPriorityBoot {
            constructor() { bootOrder.push('low'); }
         }

         @Service()
         @Meta({ priority: 10 })
         class HighPriorityBoot {
            constructor() { bootOrder.push('high'); }
         }

         @Service({ metadata: { priority: 5 } })
         @Meta({ extra: 'data' })
         class MedPriorityBoot {
            constructor() { bootOrder.push('med'); }
         }

         container.set([LowPriorityBoot, HighPriorityBoot, MedPriorityBoot]);
         await container.bootOrdered('priority', 'desc');

         expect(bootOrder).toEqual(['high', 'med', 'low']);
      });

      test("bootBy() works with decorator-defined critical flag", async () => {
         const bootOrder: string[] = [];

         @Service()
         @Meta({ critical: true })
         class CriticalBoot {
            constructor() { bootOrder.push('critical'); }
         }

         @Service()
         @Meta({ critical: false })
         class NonCriticalBoot {
            constructor() { bootOrder.push('non-critical'); }
         }

         container.set([CriticalBoot, NonCriticalBoot]);

         await container.bootBy({ critical: true });
         expect(bootOrder).toEqual(['critical']);

         await container.bootBy({ critical: false });
         expect(bootOrder).toEqual(['critical', 'non-critical']);
      });
   });

   describe("Edge Cases", () => {
      test("Empty metadata object in decorator", async () => {
         @Service({ metadata: {} })
         class EmptyMetaService { }

         container.set(EmptyMetaService);
         await container.boot();

         expect(container.getMeta(EmptyMetaService, 'type')).toBe('service');
      });

      test("Undefined values in metadata", async () => {
         @Service({ metadata: { defined: 'value', undef: undefined } })
         class UndefinedMetaService { }

         container.set(UndefinedMetaService);
         await container.boot();

         expect(container.getMeta(UndefinedMetaService, 'defined')).toBe('value');
      });

      test("Null values in metadata", async () => {
         @Service({ metadata: { nullable: null } })
         class NullMetaService { }

         container.set(NullMetaService);
         await container.boot();

         expect(container.getMeta(NullMetaService, 'nullable')).toBeNull();
      });

      test("Boolean values in metadata", async () => {
         @Service({ metadata: { enabled: true, disabled: false } })
         class BooleanMetaService { }

         container.set(BooleanMetaService);
         await container.boot();

         expect(container.getMeta(BooleanMetaService, 'enabled')).toBe(true);
         expect(container.getMeta(BooleanMetaService, 'disabled')).toBe(false);
      });

      test("Numeric zero in metadata", async () => {
         @Service({ metadata: { count: 0, priority: 0 } })
         class ZeroMetaService { }

         container.set(ZeroMetaService);
         await container.boot();

         expect(container.getMeta(ZeroMetaService, 'count')).toBe(0);
         expect(container.getMeta(ZeroMetaService, 'priority')).toBe(0);
      });

      test("Array metadata values", async () => {
         @Service({ metadata: { roles: ['admin', 'user'], ids: [1, 2, 3] } })
         class ArrayMetaService { }

         container.set(ArrayMetaService);
         await container.boot();

         expect(container.getMeta(ArrayMetaService, 'roles')).toEqual(['admin', 'user']);
         expect(container.getMeta(ArrayMetaService, 'ids')).toEqual([1, 2, 3]);
      });

      test("Multiple classes with same metadata", async () => {
         @Service({ metadata: { layer: 'shared' } })
         class SharedA { }

         @Service({ metadata: { layer: 'shared' } })
         class SharedB { }

         @Service({ metadata: { layer: 'shared' } })
         class SharedC { }

         container.set([SharedA, SharedB, SharedC]);
         await container.boot();

         const sharedServices = container.find({ layer: 'shared' });
         expect(sharedServices).toHaveLength(3);
      });

      test("Inheritance does not affect decorator metadata", () => {
         @Service({ metadata: { parent: true } })
         class ParentService { }

         @Service({ metadata: { child: true } })
         class ChildService extends ParentService { }

         const parentMeta = getDecoratorMetadata(ParentService);
         const childMeta = getDecoratorMetadata(ChildService);

         expect(parentMeta.parent).toBe(true);
         expect(parentMeta.child).toBeUndefined();

         expect(childMeta.child).toBe(true);
         // Note: Reflect metadata doesn't automatically inherit
      });
   });
});
