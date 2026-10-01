/**
 * Diject hot-path micro-benchmarks.
 *
 *   bun bench/container.bench.ts   (or: bun run bench)
 *
 * Mirrors najm's warm-up-then-measure loop style. Each scenario is reported
 * as ops/s + µs/op. These cover the per-request DI slice najm pays on every
 * HTTP request: one run() (ALS enter), a few get() calls, a cleanupReq().
 *
 * Never optimize a site without a before/after number from here.
 */
import "reflect-metadata";
import { Container, Service, Scope, createAlsToken } from "../src";

// ============================================
// HARNESS
// ============================================

const WARMUP = 50_000;
const ITERS = 500_000;

type BenchResult = { name: string; opsPerSec: number; usPerOp: number };
const results: BenchResult[] = [];

function bench(name: string, fn: () => void, iters = ITERS): void {
   // Warm up the JIT.
   for (let i = 0; i < WARMUP; i++) fn();

   const start = Bun.nanoseconds();
   for (let i = 0; i < iters; i++) fn();
   const elapsedNs = Bun.nanoseconds() - start;

   const usPerOp = elapsedNs / iters / 1_000;
   const opsPerSec = 1_000_000_000 / (elapsedNs / iters);
   results.push({ name, opsPerSec, usPerOp });
}

async function benchAsync(name: string, fn: () => Promise<void>, iters = ITERS): Promise<void> {
   for (let i = 0; i < WARMUP; i++) await fn();

   const start = Bun.nanoseconds();
   for (let i = 0; i < iters; i++) await fn();
   const elapsedNs = Bun.nanoseconds() - start;

   const usPerOp = elapsedNs / iters / 1_000;
   const opsPerSec = 1_000_000_000 / (elapsedNs / iters);
   results.push({ name, opsPerSec, usPerOp });
}

function report(): void {
   const nameW = Math.max(...results.map(r => r.name.length), 4);
   const pad = (s: string, w: number) => s.padEnd(w);
   const padL = (s: string, w: number) => s.padStart(w);

   console.log("");
   console.log(`${pad("scenario", nameW)}   ${padL("ops/s", 14)}   ${padL("µs/op", 10)}`);
   console.log(`${"-".repeat(nameW)}   ${"-".repeat(14)}   ${"-".repeat(10)}`);
   for (const r of results) {
      const ops = Math.round(r.opsPerSec).toLocaleString("en-US");
      console.log(`${pad(r.name, nameW)}   ${padL(ops, 14)}   ${padL(r.usPerOp.toFixed(4), 10)}`);
   }
   console.log("");
}

// ============================================
// FIXTURES
// ============================================

@Service()
class SingletonSvc {
   value = 42;
}

@Service(Scope.REQUEST)
class ReqSvc {
   id = Math.random();
}

const LOGGER = Symbol("LOGGER");
const CTX = createAlsToken<{ userId: string }>("context");
const REQID = createAlsToken<string>("requestId");

const noop = () => {};

async function main(): Promise<void> {
   const c = Container.create();
   c.set(SingletonSvc);
   c.set(ReqSvc, Scope.REQUEST);
   c.alias(LOGGER, SingletonSvc);
   await c.boot([SingletonSvc]);

   // 1. Per-request ALS enter.
   bench("run({requestId,context}, noop)", () => {
      c.run({ requestId: "r1", context: { userId: "u1" } }, noop);
   });

   // 2. get(alsToken) — hit and miss, both inside an active store.
   c.run({ requestId: "r1", context: { userId: "u1" } }, () => {
      bench("get(alsToken) hit", () => {
         c.get(CTX);
      });
      bench("get(alsToken) miss", () => {
         c.get(REQID); // key 'requestId' present as string, brand read differs
      });
   });

   // Pure miss: no active store at all.
   bench("get(alsToken) no-store", () => {
      c.get(CTX);
   });

   // 3. get(ClassToken) for a booted singleton.
   bench("get(SingletonSvc)", () => {
      c.get(SingletonSvc);
   });

   // 4. get(aliasToken) — one hop. Guards the D3 fast path.
   bench("get(aliasToken) 1-hop", () => {
      c.get(LOGGER);
   });

   // 5a. Full najm-shaped cycle WITHOUT a request-scoped instance.
   await benchAsync("cycle: run→get×3→cleanup (no req-scope)", async () => {
      await c.run({ requestId: "r1", context: { userId: "u1" } }, async () => {
         c.get(SingletonSvc);
         c.get(LOGGER);
         c.get(CTX);
         await c.cleanupReq();
      });
   }, 200_000);

   // 5b. Full cycle WITH a request-scoped instance created.
   let n = 0;
   await benchAsync("cycle: run→resolve(req)+get×3→cleanup (req-scope)", async () => {
      const rid = "r" + (n++);
      await c.run({ requestId: rid, context: { userId: "u1" } }, async () => {
         await c.resolve(ReqSvc, rid);
         c.get(SingletonSvc);
         c.get(LOGGER);
         c.get(CTX);
         await c.cleanupReq(rid);
      });
   }, 200_000);

   // 6. Plain builds: the per-instance creation cost request/transient
   //    providers pay (async layers, metadata reads, lifecycle checks).
   @Service(Scope.TRANSIENT)
   class Bare { }
   @Service(Scope.TRANSIENT)
   class WithDeps { constructor(public a: SingletonSvc, public b: SingletonSvc) { } }
   c.set(Bare);
   c.set(WithDeps);
   await benchAsync("resolve(transient) 0 deps", async () => {
      await c.resolve(Bare);
   }, 200_000);
   await benchAsync("resolve(transient) 2 singleton deps", async () => {
      await c.resolve(WithDeps);
   }, 200_000);

   // 7. Transient build under a global injector that queries injections per
   //    build (najm's TransactionService shape), 200 non-matching registrations.
   const ic = Container.create();
   @Service(Scope.TRANSIENT)
   class TransientSvc { }
   ic.set(TransientSvc);
   for (let i = 0; i < 200; i++) {
      ic.setInjection({ type: "transaction", target: class Other { }, methodName: "m" + i });
   }
   ic.use({
      name: "Transaction",
      global: true,
      inject: (_instance: any, ctor: any) => { ic.getInjectionsFor("transaction", ctor); },
   });
   await benchAsync("resolve(transient) + global injector, 200 injections", async () => {
      await ic.resolve(TransientSvc);
   }, 50_000);

   report();
}

main();
