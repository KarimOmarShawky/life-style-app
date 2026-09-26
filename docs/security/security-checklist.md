# Security checklist

Current state. Tick means implemented **and** covered by a test.

## Authentication and session
- [x] bcrypt hashing, configurable cost, verified at 12
- [x] Password policy: 12 characters minimum, 72 bytes maximum, mixed case and digit
- [x] Plaintext never stored, logged, or returned
- [x] Database constraint rejecting anything shorter than a bcrypt hash
- [x] Separate access and refresh secrets, enforced at startup
- [x] Short access lifetime, long refresh lifetime
- [x] Refresh rotation
- [x] Reuse detection revoking the session family
- [x] Refresh tokens stored only as SHA-256 digests
- [x] Logout revokes immediately
- [x] Password change revokes every session
- [x] Algorithm pinned to HS256
- [x] Issuer and audience verified
- [x] Claim shape verified after signature
- [ ] Password reset (not built; must be enumeration-silent)
- [ ] Multi-factor authentication (not planned for MVP)

## Authorization
- [x] Ownership enforced inside repository queries
- [x] 404 rather than 403 for another user's resource
- [x] Role check middleware with audit on denial
- [x] Resource-level IDOR covered on tasks, projects, timer sessions, expenses, subscriptions, budgets, events and reminders
- [x] Ownership enforced in MongoDB filters as well as SQL WHERE clauses
- [x] Nested routes verify the parent as well as the child resource
- [x] Writes through INSERT ... SELECT carry the owner filter in the same statement
- [x] Reconciliation is per-user and cannot touch another user's notes
- [x] Cross-entity references validated for ownership, with a constant message
- [x] List filters cannot widen access beyond the owner predicate
- [x] A foreign write attempt leaves the victim's row unchanged
- [x] References matched by value rather than by id are scoped to the owner in the join
- [x] A cursor issued to one user returns none of their rows when replayed by another
- [x] A duplicate-resource conflict is per user, so it cannot reveal another user's data
- [x] A polymorphic reference validates its type and its id in one owner-scoped query
- [x] Every branch of the polymorphic title lookup is owner-scoped, asserted on the generated SQL
- [x] A cascading delete cannot run before the ownership check that authorizes it
- [x] State-changing action routes carry the owner filter, including the idempotent ones
- [x] Cross-feature aggregate reads are owner-scoped in every branch, asserted on totals rather than ids
- [x] No value from one account appears anywhere in another account's summary response
- [ ] Admin endpoints (middleware exists, no route uses it yet)

## Input handling
- [x] Zod validation on body, query and params before business logic
- [x] Unknown keys rejected on auth endpoints
- [x] Email normalized once, at validation
- [x] Body size capped at 100 kb
- [x] Malformed JSON returns a clean error
- [x] Page size capped at 100; an absurd limit is rejected
- [x] Opaque cursors validated before use, and carry no ownership data
- [x] Server-derived fields (completedAt, streaks, progress, ownership) refused from clients
- [x] Habit log dates bounded by the server clock, never by a client-supplied value
- [x] Monetary amounts bounded to the column's precision and scale before the write
- [x] Report date ranges bounded, so an aggregate cannot be asked for a decade
- [x] Renewal windows bounded rather than silently clamped
- [x] ObjectId shape validated before reaching the driver
- [x] Note tags normalized and capped after deduplication
- [ ] File upload validation (no upload endpoint yet)

## Injection
- [x] All SQL parameterized
- [x] No dynamic SQL identifiers anywhere
- [x] Mongoose schemas strict, `strictQuery` on
- [x] Operator injection rejected by type validation
- [x] LIKE wildcards escaped in search, so `%` matches literally
- [x] Dynamic filter clauses are fixed literals; only values are parameterized
- [x] Regex metacharacters escaped in note search, so `.*` matches literally
- [x] No client value ever becomes a MongoDB query key
- [x] ReDoS prevented by escaping rather than by a timeout
- [x] Money amounts reach SQL as parameters, never as query text, and are pattern-checked first

## Transport and headers
- [x] Helmet configured and justified per directive
- [x] Explicit CORS origin list, production startup check
- [x] HSTS in production only
- [x] `x-powered-by` removed
- [x] TLS enforced to the database (`sslmode=verify-full`)

## Rate limiting and abuse
- [x] General API limit
- [x] Stricter authentication limit keyed on IP and email
- [x] Redis-backed when available, required in production
- [x] Account lockout after repeated failures
- [x] Retry-After on both throttling and lockout

## Errors and logging
- [x] Single AppError type with a stable code catalogue
- [x] One global error handler
- [x] Internal metadata never serialized to a client
- [x] Stack traces suppressed in production
- [x] Unrecognized errors fail closed as a generic 500
- [x] Log redaction by field name at every nesting level
- [x] Connection strings masked before logging
- [x] Correlation id on every request and log line
- [x] Inbound correlation ids validated before echo

## Data protection
- [x] Money as exact NUMERIC, never floating point
- [x] Reminders for deleted items are never delivered
- [x] Audit trail for security-relevant events
- [x] Audit collection append-only, updates blocked at the model
- [x] Two-year retention via a TTL index
- [x] All timestamps stored in UTC
- [x] Cache keys scoped by user id
- [x] Secrets never committed; `.env` gitignored, `.env.example` provided
- [x] Startup fails fast on missing or placeholder configuration
- [ ] Encryption at rest for sensitive fields beyond passwords
- [ ] Documented backup and restore drill

## Availability
- [x] MongoDB being unreachable degrades notes only, not the whole API
- [x] Degraded endpoints answer 503, not 500, and do not name the failing service
- [x] Authentication is checked before unavailability is reported
- [ ] Degradation verified against a MongoDB that fails mid-request, not only one that is absent

## Dependencies
- [x] `npm audit` clean at zero vulnerabilities
- [x] Lockfile committed
- [x] bcrypt upgraded to 6.x, removing a critical transitive advisory
- [x] Automated dependency scanning in CI: `npm audit --audit-level=high` on
      every push, in the "Dependency and secret scanning" job
- [x] Committed secrets scanned on every push: gitleaks over the full history,
      plus an explicit check that no `.env` file is tracked
