import "reflect-metadata";
import { describe, test, expect, beforeEach } from "bun:test";
import { Container, Scope, Service } from "../src";

// ============================================
// TEST FIXTURES
// ============================================

// Basic services
@Service()
class Logger {
   logs: string[] = [];
   log(msg: string) { this.logs.push(msg); }
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

// ============================================
// ERROR HANDLING & EDGE CASES
// ============================================

describe("Error Handling", () => {
   let container: Container;

   beforeEach(() => {
      container = new Container();
   });

   describe("Circular Dependencies", () => {
      test("detects direct circular dependency", async () => {
         container.set(CircularA, {
            scope: Scope.SINGLETON,
            factory: async () => {
               const b = await container.resolve(CircularB);
               return new CircularA(b);
            }
         });

         container.set(CircularB, {
            scope: Scope.SINGLETON,
            factory: async () => {
               const a = await container.resolve(CircularA);
               return new CircularB(a);
            }
         });

         await expect(container.boot()).rejects.toThrow(/circular/i);
      });

      test("error includes dependency chain", async () => {
         container.set(CircularA, {
            scope: Scope.SINGLETON,
            factory: async () => {
               const b = await container.resolve(CircularB);
               return new CircularA(b);
            }
         });

         container.set(CircularB, {
            scope: Scope.SINGLETON,
            factory: async () => {
               const a = await container.resolve(CircularA);
               return new CircularB(a);
            }
         });

         try {
            await container.boot();
            throw new Error("Should have thrown");
         } catch (e: any) {
            expect(e.message).toMatch(/CircularA|CircularB/);
         }
      });
   });

   describe("Missing Dependencies", () => {
      test("throws for unregistered token", () => {
         expect(() => container.get("missing")).toThrow(/not registered/i);
      });

      test("throws for unregistered class", async () => {
         await container.boot();
         expect(() => container.get(Logger)).toThrow(/not registered/i);
      });
   });

   describe("State Errors", () => {
      test("throws when getting unbooted singleton", () => {
         container.set(Logger);
         expect(() => container.get(Logger)).toThrow(/not initialized/i);
      });

      test("throws for request-scoped without requestId", async () => {
         container.set(RequestContext, Scope.REQUEST);
         await container.resolve(RequestContext, "req-1");

         expect(() => container.get(RequestContext)).toThrow(/requestId/i);
      });
   });
});