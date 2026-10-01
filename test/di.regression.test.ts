import { describe, expect, test } from 'bun:test';
import {
   BaseError,
   Container,
   DI_CODES,
   Scope,
   container as globalContainer,
} from '../src';

const errorCode = (error: unknown): string | undefined =>
   error instanceof BaseError ? error.code : undefined;

describe('review regressions', () => {
   test('injections are isolated by constructor identity when class names collide', () => {
      const FirstController = class SharedName {};
      const SecondController = class SharedName {};
      const c = new Container();

      c.setInjection({
         type: 'middleware',
         target: FirstController,
         name: 'first-controller',
         marker: 'first-only',
      });
      c.setInjection({
         type: 'middleware',
         target: SecondController,
         name: 'second-controller',
         marker: 'second-only',
      });

      expect(FirstController.name).toBe(SecondController.name);
      expect(c.getInjectionsFor<any>('middleware', FirstController).map(i => i.marker))
         .toEqual(['first-only']);
      expect(c.getInjectionsFor<any>('middleware', SecondController).map(i => i.marker))
         .toEqual(['second-only']);
      expect(c.resolver.hasInjection('middleware', FirstController)).toBe(true);
      expect(c.resolver.hasInjection('middleware', SecondController)).toBe(true);
   });

   test('method injections with identical class and method names remain isolated', () => {
      const FirstService = class SharedName {};
      const SecondService = class SharedName {};
      const c = new Container();

      c.setInjection({
         type: 'transaction',
         target: FirstService,
         methodName: 'execute',
         marker: 'first-transaction',
      });
      c.setInjection({
         type: 'transaction',
         target: SecondService,
         methodName: 'execute',
         marker: 'second-transaction',
      });

      expect(c.getInjectionsFor<any>('transaction', FirstService, 'execute').map(i => i.marker))
         .toEqual(['first-transaction']);
      expect(c.getInjectionsFor<any>('transaction', SecondService, 'execute').map(i => i.marker))
         .toEqual(['second-transaction']);
      expect(c.resolver.hasInjection('transaction', FirstService, 'execute')).toBe(true);
      expect(c.resolver.hasInjection('transaction', FirstService, 'missing')).toBe(false);
   });

   test('getInjectionsFor matches metadata overrides of target and methodName', () => {
      class Original {}
      class Moved {}
      const c = new Container();

      const token = c.setInjection({
         type: 'transaction',
         target: Original,
         methodName: 'execute',
         marker: 'moved',
      });
      c.setMeta(token, { target: Moved, methodName: 'run' });

      expect(c.getInjectionsFor<any>('transaction', Original, 'execute')).toEqual([]);
      const [injection] = c.getInjectionsFor<any>('transaction', Moved, 'run');
      expect(injection.marker).toBe('moved');
      expect(injection.target).toBe(Moved);
      expect(injection.methodName).toBe('run');
   });

   test('concurrent transient resolutions are independent', async () => {
      class Transient {}
      const c = new Container();
      c.set(Transient, {
         scope: Scope.TRANSIENT,
         factory: async () => {
            await Bun.sleep(10);
            return new Transient();
         },
      });

      const [first, second] = await Promise.all([
         c.resolve(Transient),
         c.resolve(Transient),
      ]);

      expect(first).toBeInstanceOf(Transient);
      expect(second).toBeInstanceOf(Transient);
      expect(first).not.toBe(second);
   });

   test('concurrent request resolutions with different IDs are independent', async () => {
      class RequestValue {}
      const c = new Container();
      c.set(RequestValue, {
         scope: Scope.REQUEST,
         factory: async () => {
            await Bun.sleep(10);
            return new RequestValue();
         },
      });

      const [first, second] = await Promise.all([
         c.resolve(RequestValue, 'request-a'),
         c.resolve(RequestValue, 'request-b'),
      ]);

      expect(first).toBeInstanceOf(RequestValue);
      expect(second).toBeInstanceOf(RequestValue);
      expect(first).not.toBe(second);
   });

   test('a recursive async factory still reports a real cycle', async () => {
      class Recursive {}
      const c = new Container();
      c.set(Recursive, {
         factory: async () => {
            await Bun.sleep(1);
            return c.resolve(Recursive);
         },
      });

      try {
         await c.resolve(Recursive);
         throw new Error('Expected resolution to fail');
      } catch (error) {
         expect(errorCode(error)).toBe(DI_CODES.CIRCULAR_DEPENDENCY);
      }
   });

   test('deps are passed to a custom factory', async () => {
      class Dependency {}
      class Consumer {
         constructor(readonly dependency: Dependency) {}
      }

      const c = new Container();
      c.set(Dependency);
      c.set(Consumer, {
         deps: [Dependency],
         factory: (dependency: Dependency) => new Consumer(dependency),
      });

      const consumer = await c.resolve(Consumer);
      expect(consumer.dependency).toBeInstanceOf(Dependency);
   });

   test('a factory without deps still receives the request ID', async () => {
      class RequestFactory {
         constructor(readonly requestId?: string) {}
      }

      const c = new Container();
      c.set(RequestFactory, {
         scope: Scope.REQUEST,
         factory: (requestId?: string) => new RequestFactory(requestId),
      });

      expect((await c.resolve(RequestFactory, 'request-id')).requestId).toBe('request-id');
   });

   test('failed initialization is not cached and retries cleanly', async () => {
      let initCalls = 0;
      class RetryInit {
         async onInit() {
            initCalls++;
            if (initCalls === 1) throw new Error('first init failed');
         }
      }

      const c = new Container();
      c.set(RetryInit);

      await expect(c.resolve(RetryInit)).rejects.toThrow('first init failed');
      const initialized = await c.resolve(RetryInit);

      expect(initialized).toBeInstanceOf(RetryInit);
      expect(initCalls).toBe(2);
   });

   test('cleanup waits for in-flight request providers and destroys them', async () => {
      let destroyCalls = 0;
      class SlowRequest {
         async onDestroy() { destroyCalls++; }
      }

      const c = new Container();
      c.set(SlowRequest, {
         scope: Scope.REQUEST,
         factory: async () => {
            await Bun.sleep(15);
            return new SlowRequest();
         },
      });

      const pending = c.resolve(SlowRequest, 'cleanup-race');
      await Bun.sleep(1);
      await c.cleanupReq('cleanup-race');
      await pending;

      expect(c.hasRequestScope('cleanup-race')).toBe(false);
      expect(destroyCalls).toBe(1);
      expect(() => c.get(SlowRequest, 'cleanup-race')).toThrow();
   });

   test('cleanup waits for in-flight request providers without onDestroy', async () => {
      class SlowPlain {}

      const c = new Container();
      c.set(SlowPlain, {
         scope: Scope.REQUEST,
         factory: async () => {
            await Bun.sleep(15);
            return new SlowPlain();
         },
      });

      const pending = c.resolve(SlowPlain, 'plain-race');
      await Bun.sleep(1);
      await c.cleanupReq('plain-race');
      await pending;

      // Clearing before the build settled would let it re-create the cache.
      expect(c.hasRequestScope('plain-race')).toBe(false);
   });

   test('cleanup without hooks or in-flight builds frees the request scope', async () => {
      class Plain {}

      const c = new Container();
      c.set(Plain, Scope.REQUEST);

      const first = await c.resolve(Plain, 'sync-clean');
      await c.cleanupReq('sync-clean');

      expect(c.hasRequestScope('sync-clean')).toBe(false);
      expect(await c.resolve(Plain, 'sync-clean')).not.toBe(first);
   });

   test('delete waits for an in-flight singleton and does not resurrect it', async () => {
      let destroyCalls = 0;
      class SlowSingleton {
         async onDestroy() { destroyCalls++; }
      }

      const c = new Container();
      c.set(SlowSingleton, {
         factory: async () => {
            await Bun.sleep(15);
            return new SlowSingleton();
         },
      });

      const pending = c.resolve(SlowSingleton);
      await Bun.sleep(1);
      await c.delete(SlowSingleton);
      await pending;

      expect(c.has(SlowSingleton)).toBe(false);
      expect(destroyCalls).toBe(1);
   });

   test('request scope requires a request ID', async () => {
      class RequestOnly {}
      const c = new Container();
      c.set(RequestOnly, Scope.REQUEST);

      try {
         await c.resolve(RequestOnly);
         throw new Error('Expected resolution to fail');
      } catch (error) {
         expect(errorCode(error)).toBe(DI_CODES.REQUEST_ID_REQUIRED);
      }
   });

   test('a singleton cannot capture a request-scoped dependency', async () => {
      class RequestOnly {}
      class SingletonConsumer {
         constructor(readonly request: RequestOnly) {}
      }

      const c = new Container();
      c.set(RequestOnly, Scope.REQUEST);
      c.set(SingletonConsumer, { deps: [RequestOnly] });

      try {
         await c.resolve(SingletonConsumer, 'request-id');
         throw new Error('Expected resolution to fail');
      } catch (error) {
         expect(errorCode(error)).toBe(DI_CODES.SCOPE_VIOLATION);
      }
   });

   test('re-registration replaces old metadata indexes', async () => {
      class Versioned {}
      const c = new Container();
      c.set(Versioned, { metadata: { version: 1 } });
      c.set(Versioned, { metadata: { version: 2 } });

      expect(c.find({ version: 1 })).not.toContain(Versioned);
      expect(c.find({ version: 2 })).toContain(Versioned);

      await c.delete(Versioned);
      expect(c.find({ version: 1 })).not.toContain(Versioned);
      expect(c.find({ version: 2 })).not.toContain(Versioned);
   });

   test('undefined metadata values are removed from indexes when changed', () => {
      class MaybeTagged {}
      const c = new Container();
      c.set(MaybeTagged, { metadata: { tag: undefined } });
      c.setMeta(MaybeTagged, 'tag', 'present');

      expect(c.find({ tag: undefined })).not.toContain(MaybeTagged);
      expect(c.find({ tag: 'present' })).toContain(MaybeTagged);
   });

   test('named tokens preserve empty, null, and undefined values', () => {
      const c = new Container();
      const empty = {};
      c.set('empty', empty);
      c.set('null', null);
      c.set('undefined', undefined);

      expect(c.get('empty')).toBe(empty);
      expect(c.get('null')).toBeNull();
      expect(c.get('undefined')).toBeUndefined();
      expect(c.has('undefined')).toBe(true);
   });

   test('request caches preserve falsy provider values', async () => {
      let calls = 0;
      class ZeroProvider {}
      const c = new Container();
      c.set(ZeroProvider, {
         scope: Scope.REQUEST,
         factory: () => {
            calls++;
            return 0 as any;
         },
      });

      expect(await c.resolve(ZeroProvider, 'zero')).toBe(0 as any);
      expect(await c.resolve(ZeroProvider, 'zero')).toBe(0 as any);
      expect(c.get(ZeroProvider, 'zero')).toBe(0 as any);
      expect(calls).toBe(1);
   });

   test.serial('reset replaces the global container and clears defaults', async () => {
      const before = Container.getInstance();
      before.setDefaults({ leaked: true });

      const after = await Container.reset();
      class AfterReset {}
      after.set(AfterReset);

      expect(after).not.toBe(before);
      expect(globalContainer).toBe(after);
      expect(after.getMeta(AfterReset, 'leaked')).toBeUndefined();
   });
});
