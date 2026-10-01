import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import {
   AlsStore,
   BaseError,
   Container,
   DI,
   DI_CODES,
   Meta,
   Scope,
   Service,
   Store,
   container as globalContainer,
   lazyValue,
} from '../src';

const errorCode = (error: unknown): string | undefined =>
   error instanceof BaseError ? error.code : undefined;

describe('request store isolation', () => {
   test('store writes made while constructing are visible to the caller', async () => {
      const c = Container.create();
      class Auth {
         constructor() { c.store.set('tag', 'ctor'); }
         async onInit() { c.store.set('userId', 'u1'); }
      }
      c.set(Auth, Scope.REQUEST);

      await c.run({ requestId: 'r1' }, async () => {
         await c.resolve(Auth);
         expect(c.store.get('tag')).toBe('ctor');
         expect(c.store.get('userId')).toBe('u1');
      });
   });

   test('a lazy value first read during construction is evaluated once', async () => {
      const c = Container.create();
      let calls = 0;
      class NeedsSession { session = c.store.get('session'); }
      c.set(NeedsSession, Scope.TRANSIENT);

      await c.run({ requestId: 'r1', session: lazyValue(() => ++calls) }, async () => {
         const instance = await c.resolve(NeedsSession);
         expect(instance.session).toBe(1);
         expect(c.store.get('session')).toBe(1);
         expect(calls).toBe(1);
      });
   });

   test('a lazy value is evaluated once across nested runs', () => {
      const store = new AlsStore<any>();
      let calls = 0;

      store.run({ session: lazyValue(() => ++calls) }, () => {
         store.run({ nested: true }, () => {
            expect(store.get('session')).toBe(1);
         });
         expect(store.get('session')).toBe(1);
         expect(calls).toBe(1);
      });
   });

   test('resolving outside run() does not open a request store', async () => {
      const c = Container.create();
      let active: boolean | undefined;
      class Probe { constructor() { active = c.isActive(); } }
      c.set(Probe);

      await c.resolve(Probe);
      expect(active).toBe(false);
   });
});

describe('resolution context lifetime', () => {
   test('work started in a singleton onInit can later resolve request-scoped providers', async () => {
      const c = Container.create();
      class Req {}
      c.set(Req, Scope.REQUEST);

      let later!: Promise<unknown>;
      class Worker {
         onInit() {
            later = new Promise(resolve => setTimeout(resolve, 0))
               .then(() => c.run({ requestId: 'bg' }, () => c.resolve(Req)));
         }
      }
      c.set(Worker);

      await c.boot();
      expect(await later).toBeInstanceOf(Req);
   });

   test('a transient can resolve itself from work it scheduled', async () => {
      const c = Container.create();
      let created = 0;
      let later!: Promise<unknown>;
      class Job {
         constructor() { created++; }
         onInit() {
            if (created === 1) {
               later = new Promise(resolve => setTimeout(resolve, 0)).then(() => c.resolve(Job));
            }
         }
      }
      c.set(Job, Scope.TRANSIENT);

      await c.resolve(Job);
      expect(await later).toBeInstanceOf(Job);
   });

   test('detached work awaited by a still-building ancestor still reports the cycle', async () => {
      const c = Container.create();
      class B {
         ready = new Promise(resolve => setTimeout(resolve, 0)).then(() => c.resolve(A));
      }
      class A {
         constructor(readonly b: B) {}
         async onInit() { await this.b.ready; }
      }
      c.set(B, Scope.TRANSIENT);
      c.set(A, { deps: [B] });

      const error = await c.resolve(A).catch(e => e);
      expect(errorCode(error)).toBe(DI_CODES.CIRCULAR_DEPENDENCY);
   });
});

describe('provider identification', () => {
   test('a class instance with option-like fields is registered as that instance', async () => {
      const c = Container.create();
      class Plugin { metadata = { name: 'x' }; }
      class Pool { factory() { return 'not-a-pool'; } }
      const plugin = new Plugin();
      const pool = new Pool();
      c.set(Plugin, plugin);
      c.set(Pool, pool);

      expect(c.get(Plugin)).toBe(plugin);
      expect(await c.resolve(Pool)).toBe(pool);
   });

   test('a named value shaped like a provider is returned as-is', async () => {
      const c = Container.create();
      const config = { scope: 'singleton', factory: () => 'conn' };
      c.set('cfg', config);

      expect(c.get('cfg')).toBe(config);
      expect(await c.resolve('cfg')).toBe(config);
   });
});

describe('scope enforcement', () => {
   test('a named factory cannot capture a request-scoped provider', async () => {
      const c = Container.create();
      class Req {}
      c.set(Req, Scope.REQUEST);
      c.set('svc', async () => ({ req: await c.resolve(Req) }));

      const error = await c.run({ requestId: 'r1' }, () => c.resolve('svc')).catch(e => e);
      expect(errorCode(error)).toBe(DI_CODES.SCOPE_VIOLATION);
   });
});

describe('registration races', () => {
   test('re-registering a named factory while it runs keeps the new registration', async () => {
      const c = Container.create();
      let release!: (value: string) => void;
      c.set('db', () => new Promise<string>(resolve => { release = resolve; }));

      const pending = c.resolve('db');
      await Bun.sleep(1);
      const replacement = { v: 'new' };
      c.set('db', replacement);
      release('old');

      expect(await pending).toBe('old');
      expect(c.get('db')).toBe(replacement);
   });

   test('re-registering a singleton while it builds does not inherit the stale instance', async () => {
      const c = Container.create();
      class Svc { constructor(readonly version: number) {} }
      let release!: () => void;
      c.set(Svc, { factory: () => new Promise<Svc>(resolve => { release = () => resolve(new Svc(1)); }) });

      const pending = c.resolve(Svc);
      await Bun.sleep(1);
      c.set(Svc, { factory: () => new Svc(2) });
      release();

      expect((await pending).version).toBe(1);
      expect((await c.resolve(Svc)).version).toBe(2);
   });
});

describe('aliases', () => {
   test('an alias to an unregistered target throws instead of returning undefined', async () => {
      const c = Container.create();
      class Missing {}
      c.alias('IMissing', Missing);

      expect(() => c.get('IMissing')).toThrow('Not registered: "Missing"');
      const error = await c.resolve('IMissing').catch(e => e);
      expect(errorCode(error)).toBe(DI_CODES.NOT_REGISTERED);
   });

   test('an alias whose target was deleted throws', async () => {
      const c = Container.create();
      class Target {}
      c.set(Target).alias('ITarget', Target);
      await c.delete(Target);

      expect(() => c.get('ITarget')).toThrow('Not registered: "Target"');
   });

   test('an alias cycle names the classes without dumping their source', () => {
      const c = Container.create();
      class A { method() { return 'SOURCE'; } }
      class B {}
      c.alias(A, B).alias(B, A);

      expect(() => c.get(A)).toThrow('Circular dependency: A → B → A');
   });
});

describe('cleanup', () => {
   test('clear() keeps the built-in Container and AlsStore tokens', async () => {
      const c = Container.create();
      class UsesContainer {
         @DI() container!: Container;
         @Store() store!: AlsStore;
      }
      await c.clear();
      c.set(UsesContainer);

      const instance = await c.resolve(UsesContainer);
      expect(instance.container).toBe(c);
      expect(instance.store).toBe(c.store);
      expect(c.get(Container)).toBe(c);
   });

   test('clear() destroys an instance reachable from two tokens once', async () => {
      const c = Container.create();
      let destroyed = 0;
      class Db { onDestroy() { destroyed++; } }
      c.set(Db);
      c.set('db', () => c.resolve(Db));

      await c.boot();
      await c.resolve('db');
      await c.clear();
      expect(destroyed).toBe(1);
   });
});

describe('metadata', () => {
   test('$sort orders string values', () => {
      const c = Container.create();
      class X {}
      class Y {}
      class Z {}
      c.set(X, { metadata: { name: 'b' } });
      c.set(Y, { metadata: { name: 'c' } });
      c.set(Z, { metadata: { name: 'a' } });

      expect(c.find({ type: 'service', $sort: { name: 'asc' } })).toEqual([Z, X, Y]);
      expect(c.find({ type: 'service', $sort: { name: 'desc' } })).toEqual([Y, X, Z]);
   });

   test('$sort keeps numeric ordering and treats missing values as 0', () => {
      const c = Container.create();
      class High {}
      class Low {}
      class Unset {}
      c.set(High, { metadata: { order: 10 } });
      c.set(Low, { metadata: { order: 2 } });
      c.set(Unset);

      expect(c.find({ type: 'service', $sort: { order: 'asc' } })).toEqual([Unset, Low, High]);
   });

   test('bootOrdered and getOrdered sort string values', async () => {
      const c = Container.create();
      const booted: string[] = [];
      class Second { constructor() { booted.push('Second'); } }
      class First { constructor() { booted.push('First'); } }
      c.set(Second, { metadata: { name: 'b' } });
      c.set(First, { metadata: { name: 'a' } });

      await c.bootOrdered('name');
      expect(booted).toEqual(['First', 'Second']);

      c.push('items', { n: 'b' }, { n: 'a' });
      expect(c.getOrdered<{ n: string }>('items', 'n').map(item => item.n)).toEqual(['a', 'b']);
   });

   test('lookups ignore inherited object properties', () => {
      const c = Container.create();
      class S {}
      c.set(S);

      expect(c.hasMeta(S, 'toString')).toBe(false);
      expect(c.getMeta(S, 'toString')).toBeUndefined();
   });

   test('metadata never mutates a named value', async () => {
      const c = Container.create();
      const pkg = { name: 'x', metadata: { author: 'me' } };
      c.set('pkg', pkg);
      c.setMeta('pkg', 'layer', 'core');

      expect(pkg.metadata).toEqual({ author: 'me' });
      expect(c.getMeta('pkg')).toEqual({ layer: 'core' });

      await c.delete('pkg');
      expect(pkg.metadata).toEqual({ author: 'me' });
      expect(c.find({ layer: 'core' })).toEqual([]);
   });

   test('metadata on a registered instance does not add properties to it', () => {
      const c = Container.create();
      class Cfg {}
      const cfg = new Cfg();
      c.set(Cfg, cfg);
      c.setMeta(Cfg, 'layer', 'core');

      expect(Object.keys(cfg)).toEqual([]);
      expect(c.find({ layer: 'core' })).toEqual([Cfg]);
   });

   test('injection data keeps its own metadata field untouched', async () => {
      const c = Container.create();
      class Ctrl {}
      const params = [{ type: 'params', propertyKey: 'id' }];
      const token = c.setInjection({ type: 'params', target: Ctrl, methodName: 'show', metadata: params });

      const [injection] = c.getInjectionsFor<any>('params', Ctrl, 'show');
      expect(injection.metadata).toBe(params);
      expect(injection.type).toBe('params');
      expect(injection.order).toBe(999);
      expect(Object.keys(params)).toEqual(['0']);

      await c.delete(token);
      expect(params).toEqual([{ type: 'params', propertyKey: 'id' }]);
   });
});

describe('decorator order', () => {
   test('@Meta written above @Service reaches the global container', () => {
      @Meta({ layer: 'meta-above-service' })
      @Service()
      class Late {}

      expect(globalContainer.find({ layer: 'meta-above-service' })).toEqual([Late]);
      expect(globalContainer.getMeta(Late, 'type')).toBe('service');
   });

   test('@Meta above or below @Service gives the same metadata', () => {
      @Meta({ type: 'job', tier: 1 })
      @Service()
      class Above {}

      @Service()
      @Meta({ type: 'job', tier: 1 })
      class Below {}

      expect(globalContainer.getMeta(Above)).toEqual(globalContainer.getMeta(Below));
   });
});
