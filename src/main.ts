import { Container, InjectionDefinition } from "./container";

class UserService {}
class ProductService {}

const container = new Container();

console.log("=== Injection Test ===\n");

// Set injections
container.setInjection({
  type: "middleware",
  target: UserService,
  methodName: "authenticate",
  order: 1,
  name: "auth",
  handler: () => console.log("Auth")
});

container.setInjection({
  type: "middleware",
  target: UserService,
  methodName: "authenticate",
  order: 2,
  name: "log",
  handler: () => console.log("Log")
});

container.setInjection({
  type: "middleware",
  target: ProductService, 
  methodName: "list",
  order: 1,
  name: "cache",
  handler: () => console.log("Cache")
});

// Test 1: Get all
const all = container.getInjections<InjectionDefinition>("middleware"); 
console.log("All middlewares:", all.length);
all.forEach(m => console.log(`  - ${m.name}`));

// Test 2: Get for UserService  
console.log("\nUserService middlewares:"); 
const userMw = container.getInjectionsFor<InjectionDefinition>("middleware", UserService);
console.log("Count:", userMw.length);
userMw.forEach(m => console.log(`  - ${m.name}`));

// Test 3: Get for specific method
console.log("\nUserService.authenticate:");
const authMw = container.getInjectionsFor<InjectionDefinition>("middleware", UserService, "authenticate");
console.log("Count:", authMw.length);
authMw.forEach(m => console.log(`  - ${m.name} (order: ${m.order})`));

console.log("\n✓ Done");
