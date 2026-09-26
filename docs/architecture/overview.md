# System architecture

```mermaid
graph TD
    FL["Flutter app<br/>Dart"]
    FL -->|HTTPS| MW

    subgraph API["Node.js + Express + TypeScript"]
        MW["Middleware<br/>request id, helmet, CORS,<br/>body parse, rate limit"]
        MW --> AUTH["authenticate<br/>authorize"]
        AUTH --> CTL[Controllers]
        CTL --> SVC[Services]
        SVC --> REP[Repositories]
        ERR["Global error handler"]
    end

    REP --> PG[(PostgreSQL)]
    REP --> MG[(MongoDB)]
    SVC --> RD[(Redis)]

    MW -.-> ERR
    CTL -.-> ERR
    SVC -.-> ERR
    REP -.-> ERR
```

Every failure path converges on one error handler, which is what makes the
response shape uniform and makes it impossible to leak internals from a forgotten
catch block.

## Layers and what belongs in each

| Layer | Responsibility | Must not |
|---|---|---|
| Route | Wire path to middleware chain and controller | Contain logic |
| Middleware | Cross-cutting concerns: identity, validation, limits | Know about a feature's domain |
| Controller | Read request, call service, send response | Contain business rules or touch a database |
| Service | Business rules, orchestration, transactions | Know about HTTP |
| Repository | Queries and persistence | Contain business rules or perform authorization |

The one deliberate exception: repositories push ownership predicates into their
WHERE clauses. That is authorization leaking downward on purpose, because a
filter the database applies cannot be forgotten at a new call site.

## Request lifecycle

```mermaid
sequenceDiagram
    participant C as Client
    participant M as Middleware
    participant Ct as Controller
    participant S as Service
    participant R as Repository
    participant D as Database
    participant E as Error handler

    C->>M: HTTP request
    M->>M: assign request id, open async context
    M->>M: security headers, CORS, parse body
    M->>M: rate limit
    M->>M: authenticate, set req.user
    M->>M: validate and REPLACE body/query/params
    M->>Ct: clean, typed input
    Ct->>S: call with primitives
    S->>R: query or transaction
    R->>D: parameterized SQL
    D-->>R: rows
    R-->>S: domain record
    S-->>Ct: result
    Ct-->>C: { success: true, data }

    Note over M,E: any throw at any layer
    S--xE: AppError or unknown error
    E->>E: normalize, log, strip internals
    E-->>C: { success: false, error }
```

The correlation id assigned in the first step is carried by async context, so
every log line from every layer of that request shares it without any function
needing a `requestId` parameter.

## Feature layout

```
src/
├── config/          validated environment, single source
├── core/
│   ├── errors/      AppError, code catalogue, normalization
│   ├── logger/      Pino, redaction, async request context
│   ├── middleware/  request id, auth, validate, rate limit, error handler
│   ├── security/    password hasher, token service, HTTP headers
│   ├── utils/       response envelope
│   └── container.ts composition root
├── infrastructure/
│   └── database/
│       ├── postgres/  pool, transactions, migrations
│       ├── mongodb/   connection, models, audit writer
│       └── redis/     client, cache helpers
├── features/
│   ├── auth/        controller, service, repository, routes, validation, types, mapper
│   ├── health/      liveness and readiness
│   └── docs/        Swagger UI
├── app.ts
└── server.ts
```

A feature owns its full vertical slice. There is no global `controllers/` or
`models/` directory, which is what the specification means by feature-based.

## Dependency inversion in practice

```mermaid
graph LR
    AS[AuthService] --> PH["PasswordHasher<br/>interface"]
    AS --> TS["TokenService<br/>interface"]
    PH -.implemented by.-> BC[BcryptPasswordHasher]
    TS -.implemented by.-> JW[JwtTokenService]
    CR[container.ts] -->|binds| BC
    CR -->|binds| JW
```

`AuthService` never imports bcrypt or jsonwebtoken. `container.ts` is the only
file that binds an interface to an implementation, so swapping bcrypt for argon2
is one line there. Tests exploit the same seam to inject fast fakes.
