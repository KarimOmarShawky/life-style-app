# Feature architecture

Every feature is a vertical slice. Adding one means adding a folder, not editing
seven shared ones. `auth`, `projects`, `tasks`, `notes`, `habits`, `goals` and
`money` all follow the same shape, so the next feature is a matter of copying the
pattern rather than inventing one.

## The files in a feature

```
src/features/<feature>/
├── <name>.types.ts       domain record, response shape, input shapes
├── <name>.validation.ts  Zod schemas for body, query and params
├── <name>.repository.ts  SQL. Ownership lives in the WHERE clause
├── <name>.service.ts     business rules, cross-entity checks, cache invalidation
├── <name>.mapper.ts      record to response. The only place fields are published
├── <name>.controller.ts  read request, call service, send response
└── <name>.routes.ts      middleware chain and paths
```

Two types per entity, never one. `TaskRecord` mirrors the database row and is
internal. `TaskResponse` is what a client sees. Keeping them separate is why
adding a column cannot silently publish it.

## The rules that make a feature secure by construction

**Ownership belongs in the query.** Every repository method that touches
user-owned data carries `user_id = $n`. A mismatched identifier returns no row
rather than someone else's row. A middleware check can be forgotten when a
method is added six months later; a WHERE clause cannot.

The same rule holds where the query language is not SQL. `notes` is a MongoDB
slice, and `userId` is in every `find`, `findOneAndUpdate` and `deleteOne`
filter. Because a filter is a data structure rather than a string, the builder
that assembles it is exported and unit-tested directly, so the owner condition
is asserted rather than assumed.

**Missing and forbidden look identical.** A resource that belongs to another user
returns the same 404 as one that never existed, with the same code and message.
Anything else lets an attacker enumerate valid identifiers.

**References are authorized too.** Filing a task under a project runs one query
that checks existence and ownership together. It is not enough to authorize the
resource being addressed.

**Derived fields are never accepted from a client.** `completedAt` follows from
`status`, and `isOverdue` is computed at serialization. Both are refused in the
request body, so a client cannot write an inconsistent pair.

**Unknown keys are rejected, not stripped.** Schemas are `.strict()`. A request
carrying `role` or `userId` gets a 422 rather than a quiet success, which turns
an attempted escalation into a visible, logged event.

## When a feature spans both databases

`notes` is the only slice whose records live in MongoDB while its references
point at PostgreSQL rows. It carries one extra file for that:

```
└── note.references.ts   the PostgreSQL side of the boundary
```

Its job is everything a foreign key would have done and cannot: validating a
reference before a write, resolving references in bulk on a read, and finding the
ones that no longer resolve. The rule that keeps this honest is that no feature
imports another feature's repository. `notes` re-implements the two ownership
lookups it needs rather than reaching into `tasks`, because a change to a task
query should never silently alter what a note is allowed to link to.

## When one slice holds more than one entity

`money` holds three: expenses, subscriptions and budgets. They are three
collections to a client and one folder here, because a budget is defined entirely
in terms of expenses — its spending is a sum over them, matched on month, category
and currency. Splitting them apart would mean the budget slice writing queries
against the `expenses` table across a boundary this document says features do not
cross. They share a bounded context, so they share a folder.

The file roles do not change; the entity name moves to the front of the ones that
are per-entity:

```
src/features/money/
├── money.types.ts            all three records and responses
├── money.validation.ts       all schemas, and the money primitives they share
├── money.mapper.ts           all three mappers
├── money.dates.ts            calendar arithmetic used across the slice
├── expense.repository.ts     one repository per table
├── subscription.repository.ts
├── budget.repository.ts
├── expense.service.ts        one service per entity
├── subscription.service.ts
├── budget.service.ts
├── money.controller.ts       three controllers
└── money.routes.ts           three router factories
```

The rule that decides this: **share a folder when one entity cannot be queried
without the other's table.** Notes and tasks fail that test — a note merely points
at a task — so notes carries `note.references.ts` and re-implements the two
lookups it needs instead. Budgets and expenses pass it.

`schedule` holds two for the same reason. A reminder may point at an event, and
the query that decides whether a reminder is still deliverable has to read the
`events` table, so the two live together:

```
src/features/schedule/
├── schedule.types.ts        both records and responses
├── schedule.validation.ts   both sets of schemas
├── schedule.mapper.ts       both mappers
├── schedule.entities.ts     the polymorphic table map, and the SQL it builds
├── schedule.references.ts   the ownership check that uses it
├── event.repository.ts      one repository per table
├── reminder.repository.ts
├── event.service.ts         one service per entity
├── reminder.service.ts
├── schedule.controller.ts   two controllers
└── schedule.routes.ts       two router factories
```

`schedule.entities.ts` is split from `schedule.references.ts` on a different
axis: the first builds SQL and imports nothing, the second runs queries and
imports the pool. The split exists so the generated SQL — the only place in the
application where a table name is written into a query string rather than bound —
can be asserted on in the unit tier, with no database and no network. What it
asserts is that every branch of the lookup is scoped to the owner, which is a
property a normal integration test cannot distinguish from an id that simply
does not match.

## The one slice that owns no table

`dashboard` reads eight tables and writes none. That is what a home summary is,
and there is no arrangement of vertical slices in which it does not read widely.
It is the deliberate exception (DD-028), and three rules keep it from becoming a
hole in the architecture:

1. **It is read-only.** No write path here can get out of step with the feature
   that owns the table, because there is no write path.
2. **It imports no repository.** It writes its own queries, so a change to how
   tasks are listed cannot silently change what the home screen counts.
3. **It does not restate a rule that already exists elsewhere.** Which period a
   habit is in, and which expenses a budget measures, are imported as SQL
   fragments from `habit.period` and `budget.match`.

Rule 3 is the one worth stating a test for. The question to ask before
duplicating anything across a slice boundary is: *could two copies of this
disagree while both look correct?* An ownership lookup — `WHERE id = $1 AND
user_id = $2` — cannot, which is why `note.references` duplicates two of them and
that is still right. A habit period rule can: for a weekly habit "done" means
anywhere this week, and a second copy that checked today would be wrong six days
in seven without ever failing. Extract those; duplicate the rest.

```
src/features/dashboard/
├── dashboard.types.ts       the response, and why this slice is the exception
├── dashboard.window.ts      the UTC bounds, pure and unit-tested
├── dashboard.repository.ts  one statement, one CTE per section
├── dashboard.mapper.ts      row to nested response
├── dashboard.service.ts
├── dashboard.controller.ts
└── dashboard.routes.ts
```

## Where each kind of logic goes

| Question | Answer |
|---|---|
| Is this input well-formed? | Validation schema, in middleware |
| Does the caller own this? | Repository WHERE clause |
| Does this reference point somewhere valid? | Service, before the write |
| What happens when two requests race? | A database constraint, not an if statement |
| What does the client see? | Mapper |
| Which HTTP status? | AppError, via its named constructors |
| How is a number added up? | In SQL, if it is money (DD-021) |
| Does a derived value get stored? | No: derive it on read (DD-022, DD-023, DD-025) |
| What validates a reference whose table varies per row? | The service, from one table map (DD-026) |
| Can two copies of this rule disagree while both look right? | Then extract it; otherwise duplicate it (DD-028) |

## Adding a feature

1. Write the migration. Encode the business rules as constraints, not only as
   application checks.
2. Write types, splitting the internal record from the response.
3. Write the validation schemas. Use `.strict()`.
4. Write the repository. Every query filters on `user_id`.
5. Write the service. Put cross-entity checks and cache invalidation here.
6. Write the mapper, listing every published field explicitly.
7. Write a thin controller and a router with `authenticate` applied once at the
   top, so a route added later cannot be public by omission.
8. Register it in `container.ts` and mount it in `app.ts`.
9. Write integration tests for behaviour and security tests for the object-
   reference attacks.
10. Update the OpenAPI document and the decision log.

Steps 9 and 10 are part of the feature, not follow-up work.
