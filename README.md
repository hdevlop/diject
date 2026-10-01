# diject

Lightweight TypeScript dependency injection container with decorators, scopes, metadata queries, and AsyncLocalStorage support.

## Features

- Decorator-based DI: `@Service`, `@Repository`, `@Controller`, `@Inject`, `@Value`, `@DI`, `createInject`
- Multiple scopes: `SINGLETON`, `REQUEST`, `TRANSIENT`
- Constructor and property injection
- String/symbol/class token support
- Lifecycle hooks: `onInit`, `onDestroy`, `onBootComplete`
- Metadata system with querying and phased boot
- AsyncLocalStorage integration (`AlsStore`, `AlsToken`, `createAlsToken`, `lazyValue`)

## Installation

```bash
npm install diject reflect-metadata
```

`reflect-metadata` is a peer dependency and must be installed by the consumer.
Node.js 18 or newer is required.

## TypeScript setup

Enable decorator metadata in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Import `reflect-metadata` once at app startup (before using decorated classes):

```ts
import "reflect-metadata";
```

## Quick start

```ts
import "reflect-metadata";
import { Container, Service, Inject } from "diject";

@Service()
class Logger {
  log(msg: string) {
    console.log(msg);
  }
}

@Service()
class UserService {
  @Inject()
  logger!: Logger;

  run() {
    this.logger.log("UserService ready");
  }
}

const container = new Container();
container.set([Logger, UserService]);

await container.boot();
container.get(UserService).run();
```

## Core concepts

### Register providers

```ts
container.set(MyService); // class
container.set([A, B, C]); // batch
container.set("API_URL", "https://api.example.com"); // named token
container.set(Symbol.for("config"), { debug: true }); // symbol token

container.set(MyRepo, {
  deps: [Database],
  factory: (db) => new MyRepo(db)
});
```

When `deps` is provided, resolved dependencies are passed to `factory` as
positional arguments. Without `deps`, a class-token factory receives the
optional request ID for backward compatibility.

Only a plain object literal is read as options. Any other object, such as a
class instance, is registered as the value itself:

```ts
container.set(Config, new Config()); // registered as-is, even if Config has `metadata` or `factory` members
```

A function registered under a string or symbol token is a factory: call
`resolve(token)` once, then `get(token)` returns its result.

### Constructor injection examples

`diject` supports constructor injection in 3 common styles.

```ts
import "reflect-metadata";
import { Container, Service, Inject } from "diject";

// 1) Type-based constructor injection (most common)
@Service()
class Logger {
  log(msg: string) {
    console.log(msg);
  }
}

@Service()
class UserRepo {}

@Service()
class UserService {
  constructor(
    public repo: UserRepo,
    public logger: Logger
  ) {}
}

// 2) Token-based constructor injection with @Inject(token)
@Service()
class ApiClient {
  constructor(@Inject("API_URL") public baseUrl: string) {}
}

// 3) Plain class (no decorator) using explicit deps
class PlainHandler {
  constructor(public logger: Logger) {}
}

const container = new Container();
container.set("API_URL", "https://api.example.com");
container.set([Logger, UserRepo, UserService, ApiClient]);
container.set(PlainHandler, { deps: [Logger] });

await container.boot();

const userService = container.get(UserService);
const client = container.get(ApiClient);
const plain = container.get(PlainHandler);

userService.logger.log(client.baseUrl);
plain.logger.log("plain class resolved");
```

### Full example (constructor-based)

```ts
import "reflect-metadata";
import {
  Container,
  Service,
  Repository,
  Controller,
  Inject,
  Scope
} from "diject";

const API_URL = "API_URL";

@Service()
class Logger {
  log(msg: string) {
    console.log(`[LOG] ${msg}`);
  }
}

@Service()
class Database {
  connected = false;

  async onInit() {
    this.connected = true;
    console.log("Database connected");
  }

  async onDestroy() {
    this.connected = false;
    console.log("Database disconnected");
  }

  query(sql: string) {
    return { sql, rows: [{ id: 1, name: "Alice" }] };
  }
}

@Repository()
class UserRepository {
  constructor(
    public db: Database,
    public logger: Logger
  ) {}

  findAll() {
    this.logger.log("Loading users from database");
    return this.db.query("SELECT * FROM users");
  }
}

@Service({ scope: Scope.REQUEST })
class RequestContext {
  createdAt = Date.now();

  constructor(public logger: Logger) {
    this.logger.log(`RequestContext created at ${this.createdAt}`);
  }

  async onDestroy() {
    this.logger.log(`RequestContext destroyed at ${this.createdAt}`);
  }
}

@Service()
class UserService {
  constructor(
    public repo: UserRepository,
    public logger: Logger,
    @Inject(API_URL) public apiUrl: string
  ) {}

  async listUsers(container: Container, requestId: string) {
    const ctx = await container.resolve(RequestContext, requestId);
    this.logger.log(`GET ${this.apiUrl}/users (request: ${requestId})`);
    return {
      requestStartedAt: ctx.createdAt,
      data: this.repo.findAll()
    };
  }
}

@Controller("/users")
class UserController {
  constructor(
    public service: UserService,
    public logger: Logger
  ) {}

  async index(container: Container, requestId: string) {
    this.logger.log(`Handling /users for ${requestId}`);
    return this.service.listUsers(container, requestId);
  }
}

class UserReportJob {
  constructor(
    public service: UserService,
    public logger: Logger
  ) {}

  async run(container: Container) {
    const result = await this.service.listUsers(container, "job-run");
    this.logger.log(`Report rows: ${result.data.rows.length}`);
    return result;
  }
}

async function main() {
  const container = new Container();

  // Named token
  container.set(API_URL, "https://api.example.com");

  // Decorated providers
  container.set([
    Logger,
    Database,
    UserRepository,
    RequestContext,
    UserService,
    UserController
  ]);

  // Plain class with explicit constructor deps
  container.set(UserReportJob, {
    deps: [UserService, Logger]
  });

  // Initialize singletons
  await container.boot();

  // Simulate HTTP requests
  const controller = container.get(UserController);

  const r1 = await controller.index(container, "req-1");
  const r2 = await controller.index(container, "req-2");

  console.log(r1.data.sql);
  console.log(r2.data.sql);

  // Run plain class workflow
  const job = container.get(UserReportJob);
  await job.run(container);

  // Cleanup request-scoped instances
  await container.cleanupReq("req-1");
  await container.cleanupReq("req-2");
  await container.cleanupReq("job-run");

  // Cleanup singletons and call onDestroy hooks
  await container.clear();
}

main().catch(console.error);
```

Expected output (example):

```text
Database connected
[LOG] Handling /users for req-1
[LOG] RequestContext created at 1700000000000
[LOG] GET https://api.example.com/users (request: req-1)
[LOG] Loading users from database
[LOG] Handling /users for req-2
[LOG] RequestContext created at 1700000001234
[LOG] GET https://api.example.com/users (request: req-2)
[LOG] Loading users from database
SELECT * FROM users
SELECT * FROM users
[LOG] RequestContext created at 1700000002234
[LOG] GET https://api.example.com/users (request: job-run)
[LOG] Loading users from database
[LOG] Report rows: 1
[LOG] RequestContext destroyed at 1700000000000
[LOG] RequestContext destroyed at 1700000001234
[LOG] RequestContext destroyed at 1700000002234
Database disconnected
```

### Boot and resolve

- `boot()` initializes singleton providers
- `get()` is synchronous and works for:
  - initialized singletons
  - named/symbol/raw values
  - request scope only when a `requestId` is provided and instance already exists
- `resolve()` is async and should be used for request/transient providers and async factories

```ts
await container.boot();

const app = container.get(AppService);
const transient = await container.resolve(TransientService);
const reqSvc = await container.resolve(RequestScopedService, "req-1");
```

## Scopes

```ts
import { Scope, Service } from "diject";

@Service({ scope: Scope.SINGLETON })
class SingletonSvc {}

@Service({ scope: Scope.TRANSIENT })
class TransientSvc {}

@Service({ scope: Scope.REQUEST })
class RequestSvc {}
```

- `SINGLETON`: one instance per container
- `TRANSIENT`: new instance per `resolve()`
- `REQUEST`: one instance per request id

Resolving a request-scoped provider without an explicit request ID or an active
ALS `requestId` throws instead of creating an untracked instance.

Request cleanup:

```ts
await container.cleanupReq("req-1");
```

`cleanupReq()` is a cheap no-op when the request never created a
request-scoped instance. If you want to skip the call entirely on a hot path,
gate it with the sync `hasRequestScope()` check (the request id is read from
the active ALS store when omitted):

```ts
if (container.hasRequestScope()) {
  await container.cleanupReq();
}
```

## Decorators

```ts
import { Controller, Repository, Service, Inject, Value, DI, Meta, createInject } from "diject";

@Service({ metadata: { layer: "domain" } })
class AuthService {}

@Repository({ database: "main", metadata: { entity: "User" } })
class UserRepo {}

@Controller({ path: "/users", metadata: { version: "v1" } })
class UserController {
  @Inject()
  repo!: UserRepo;

  @Value("API_KEY")
  apiKey?: string; // optional by default

  @DI()
  container!: any;
}

@Meta({ critical: true })
@Service()
class CriticalService {}
```

### Creating reusable inject decorators with `createInject()`

`createInject()` creates a reusable property decorator bound to a specific token. Useful when injecting the same dependency multiple times.

```ts
import "reflect-metadata";
import { Container, Service, createInject } from "diject";

@Service()
class Logger {
  log(msg: string) {
    console.log(msg);
  }
}

// Create a reusable decorator for Logger
const InjectLogger = createInject(Logger);

@Service()
class UserService {
  @InjectLogger() logger!: Logger;

  run() {
    this.logger.log("UserService running");
  }
}

@Service()
class OrderService {
  @InjectLogger() logger!: Logger;
  @InjectLogger({ optional: true }) debugLogger?: Logger;

  process() {
    this.logger.log("OrderService processing");
    this.debugLogger?.log("Debug: processing started");
  }
}

const container = new Container();
container.set([Logger, UserService, OrderService]);
await container.boot();

container.get(UserService).run();
container.get(OrderService).process();
```

You can also use tokens (strings, symbols, or injection tokens):

```ts
const API_KEY = Symbol.for("API_KEY");
const InjectApiKey = createInject(API_KEY);

@Service()
class ApiClient {
  @InjectApiKey({ optional: true }) apiKey?: string;
}
```

### Using `@Meta()` decorator

`@Meta()` lets you attach searchable metadata directly on classes. It is stackable and merged into container metadata.

```ts
import "reflect-metadata";
import { Container, Service, Meta } from "diject";

@Meta({ layer: "core", priority: 100 })
@Service()
class ConfigService {}

@Meta({ layer: "domain" })
@Meta({ tags: ["critical", "billing"] })
@Service()
class BillingService {}

const container = new Container();
container.set([ConfigService, BillingService]);
await container.boot();

// Read metadata
const layer = container.getMeta(BillingService, "layer");
const allMeta = container.getMeta(BillingService);

// Query by metadata
const domainServices = container.find({ layer: "domain" });
const criticalServices = container.filterBy((meta) =>
  Array.isArray(meta.tags) && meta.tags.includes("critical")
);

console.log(layer); // domain
console.log(allMeta.tags); // ["critical", "billing"]
console.log(domainServices.includes(BillingService)); // true
console.log(criticalServices.includes(BillingService)); // true
```

## Metadata queries and phased boot

```ts
container.set(UserRepo, { metadata: { layer: "data", priority: 5 } });
container.set(AuthService, { metadata: { layer: "domain", priority: 10 } });

const domainTokens = container.find({ layer: "domain" });
const highPriority = container.find({ priority: (p: number) => p >= 10 });

await container.bootBy({ layer: "domain" });
await container.bootPhased("layer", ["core", "domain", "app"]);
await container.bootOrdered("priority", "desc");
```

Other metadata APIs:

- `setMeta(token, key, value)` / `setMeta(token, metadata)`
- `getMeta(token, key?)`
- `hasMeta(token, key)`
- `deleteMeta(token, key)`
- `clearMeta(token)`
- `findByKey(key)`, `groupBy(key)`, `getValues(key)`, `filterBy(predicate)`
- `bulkSetMeta(tokens, metadata)`

## AsyncLocalStorage integration

```ts
import { Container, createAlsToken } from "diject";

const container = new Container();
const USER_TOKEN = createAlsToken<{ id: number; name: string }>("user");

await container.run({ user: { id: 1, name: "John" } }, async () => {
  const user = container.get(USER_TOKEN);
  console.log(user?.name); // John
});
```

### Full example (ALS context + services)

```ts
import "reflect-metadata";
import { Container, Service, DI, createAlsToken } from "diject";

const REQUEST_ID = createAlsToken<string>("requestId");
const CURRENT_USER = createAlsToken<{ id: number; name: string }>("user");

@Service()
class AuditService {
  @DI()
  private container!: Container;

  log(action: string) {
    const reqId = this.container.get(REQUEST_ID) ?? "no-request";
    const user = this.container.get(CURRENT_USER);
    const who = user ? `${user.name}#${user.id}` : "guest";

    console.log(`[${reqId}] ${who} -> ${action}`);
  }
}

@Service()
class UserService {
  constructor(public audit: AuditService) {}

  async listUsers() {
    this.audit.log("list users");
    return [{ id: 1, name: "Alice" }];
  }
}

async function main() {
  const container = new Container();
  container.set([AuditService, UserService]);
  await container.boot();

  const users = container.get(UserService);

  // No ALS context yet
  await users.listUsers();

  // Request A context
  await container.run(
    {
      requestId: "req-A",
      user: { id: 10, name: "Adam" }
    },
    async () => {
      await users.listUsers();

      // Nested context inherits parent, then overrides user
      await container.run(
        { user: { id: 11, name: "Bob" } },
        async () => {
          await users.listUsers();
        }
      );

      // Back to parent context (Adam)
      await users.listUsers();
    }
  );
}

main().catch(console.error);
```

Expected output:

```text
[no-request] guest -> list users
[req-A] Adam#10 -> list users
[req-A] Bob#11 -> list users
[req-A] Adam#10 -> list users
```

You can also access the raw store through `container.store` (`AlsStore`).

### Lazy store values

Stashing an expensive value in the request store makes every request pay to
build it, even the ones that never read it. Wrap it with `lazyValue()` and the
factory runs on the first `get()` of that key, then the result is memoized in
the store:

```ts
import { Container, createAlsToken, lazyValue } from "diject";

const SESSION = createAlsToken<Session>("session");
const container = new Container();

await container.run(
  {
    requestId: "req-A",
    session: lazyValue(() => loadSession(req)) // not built yet
  },
  async () => {
    // loadSession() runs here, on first read, then is cached for the request
    const session = container.get(SESSION);
    container.get(SESSION); // same instance, no second call
  }
);
```

- The factory must be **sync** — `get()` stays synchronous.
- `all()` unwraps and memoizes any pending lazy values (it realizes them), so a
  full store dump always returns concrete values. Every other access goes
  through `get()`, which unwraps the single key you read.

## Lifecycle hooks

```ts
@Service()
class Database {
  async onInit() {
    // connect
  }

  async onDestroy() {
    // disconnect
  }

  async onBootComplete() {
    // called after boot cycle completes
  }
}
```

Cleanup APIs:

- `delete(token)`
- `bulkRemove([TokenA, TokenB])`
- `clear()`

## Global convenience API

`diject` exports a global singleton container and helper functions:

```ts
import { set, get, resolve, boot, has, reset } from "diject";

set("key", "value");
await boot();
const value = get("key");
```

For test isolation, prefer `new Container()` or call `await reset()` on the global instance.

Decorators such as `@Service()` register their class in the global container
once, when the class is defined. They do not run again, so a fresh container
(from `new Container()` or `reset()`) starts without those classes: register
them explicitly with `container.set([...])`.

## API reference (quick)

### Container

| Method | Purpose |
| --- | --- |
| `set(token, valueOrOptions)` | Register class/value/token provider |
| `get(token, requestId?)` | Sync access to initialized/available instance |
| `resolve(token, requestId?)` | Async resolve for any provider type |
| `boot(services?)` | Initialize singleton services |
| `bootBy(query)` | Boot singletons matching metadata query |
| `bootPhased(key, phases)` | Boot by ordered metadata phases |
| `bootOrdered(key, order?)` | Boot by sorted metadata value |
| `cleanupReq(requestId?)` | Destroy one request scope cache (no-op if none) |
| `hasRequestScope(requestId?)` | Sync check for request-scoped state (id from ALS store if omitted) |
| `delete(token)` | Remove one registration + cleanup |
| `clear()` | Destroy and remove all providers |
| `find(query)` | Find tokens by metadata |
| `run(data, fn)` | Run function with ALS context |

### Decorators

| Decorator | Purpose |
| --- | --- |
| `@Service(options?)` | Register class as service |
| `@Repository(options?)` | Register class as repository |
| `@Controller(options?)` | Register class as controller |
| `@Inject(token?)` | Inject constructor param or property |
| `@Value(token)` | Optional value injection by token |
| `@DI()` | Inject current container instance |
| `@Store()` | Inject `AlsStore` instance |
| `@Meta(metadata)` | Attach mergeable metadata |
| `createInject(token)` | Create reusable property decorator for a token |

## Suggested package.json metadata

```json
{
  "description": "Lightweight TypeScript DI container with decorators, scopes, metadata queries, and AsyncLocalStorage support.",
  "keywords": [
    "di",
    "dependency-injection",
    "ioc",
    "typescript",
    "decorators",
    "container",
    "metadata",
    "async-local-storage",
    "als"
  ]
}
```

## License

MIT
