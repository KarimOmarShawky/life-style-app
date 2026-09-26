# Authentication flow

## Registration

```mermaid
sequenceDiagram
    participant F as Flutter
    participant V as Zod validation
    participant S as AuthService
    participant H as BcryptPasswordHasher
    participant PG as PostgreSQL

    F->>V: POST /auth/register
    V->>V: normalize email, check password policy,<br/>reject unknown keys
    V->>S: validated input
    S->>H: hash(password)
    H-->>S: bcrypt hash, cost 12
    S->>PG: INSERT user
    Note over PG: unique index decides the race,<br/>not an application pre-check
    PG-->>S: row, or 23505
    S->>PG: INSERT refresh token (SHA-256 digest)
    S-->>F: 201 with user + token pair
```

Uniqueness is left to the database. Checking "does this email exist" first and
inserting afterwards races: two simultaneous signups both pass the check.

## Login

```mermaid
sequenceDiagram
    participant F as Flutter
    participant S as AuthService
    participant PG as PostgreSQL

    F->>S: email + password
    S->>PG: SELECT user by email

    alt no such user
        S->>S: bcrypt against dummy hash<br/>(equalizes timing)
        S-->>F: 401 INVALID_CREDENTIALS
    else locked
        S-->>F: 423 ACCOUNT_LOCKED + Retry-After
    else wrong password
        S->>PG: atomic increment, lock at threshold
        S-->>F: 401 INVALID_CREDENTIALS
    else correct
        S->>PG: clear failure counter
        opt cost factor raised since signup
            S->>PG: re-hash at current cost
        end
        S->>PG: INSERT refresh token
        S-->>F: 200 with user + token pair
    end
```

The unknown-user and wrong-password branches return byte-identical responses.

## Refresh with rotation and reuse detection

```mermaid
sequenceDiagram
    participant F as Flutter
    participant S as AuthService
    participant PG as PostgreSQL

    F->>S: refresh token
    S->>S: verify signature, issuer, audience, expiry
    S->>PG: SELECT token by jti

    alt already revoked
        Note over S,PG: Either the thief or the victim is replaying.<br/>No way to tell which.
        S->>PG: revoke EVERY token in the session
        S-->>F: 401 TOKEN_REUSE_DETECTED
    else live
        S->>PG: BEGIN
        S->>PG: UPDATE ... WHERE revoked_at IS NULL
        Note over PG: rowCount decides the race.<br/>Loser is treated as reuse.
        S->>PG: INSERT successor
        S->>PG: link predecessor -> successor
        S->>PG: COMMIT
        S-->>F: 200 with a new pair
    end
```

## Token lifetimes and why they differ

| Token | Lifetime | Stored? | Revocable |
|---|---|---|---|
| Access | 15 minutes | No | Only via the Redis denylist |
| Refresh | 30 days | SHA-256 digest | Immediately, in PostgreSQL |

The access token is stateless so that verifying it costs no database round trip.
The price is that it cannot be truly revoked, which is exactly why its lifetime
is short. The refresh token is stored so a session can be ended instantly.

## What happens when

| Event | Result |
|---|---|
| Access token expires | `TOKEN_EXPIRED`. Client refreshes and retries |
| Refresh token expires | `TOKEN_EXPIRED`. Client must sign in again |
| Refresh token reused | Entire session family revoked. `TOKEN_REUSE_DETECTED` |
| User logs out | Refresh token revoked, cookie cleared, session added to the denylist |
| Password changed | Every session for that user revoked, including the current one |
| Account disabled | Next refresh fails with `ACCOUNT_DISABLED` |
| 5 failed logins | Account locked 15 minutes; correct password also refused |

## Why a password change ends every session

A password change usually follows a suspected compromise. Leaving existing
sessions alive would leave the attacker signed in. Enforced twice: every refresh
token row is revoked, and any token issued before `password_changed_at` fails its
next refresh.

That timestamp comparison is done in **whole seconds**. A JWT `iat` is defined in
seconds while `password_changed_at` keeps millisecond precision, so comparing raw
values made every token issued at registration look older than the password it
was issued with, and the first refresh always failed. This was a real bug, found
by end-to-end testing and fixed; the sub-second window it leaves is covered by
the explicit row revocation.

## Client guidance for Flutter

- Store both tokens with `flutter_secure_storage`, never `SharedPreferences`.
- On `TOKEN_EXPIRED`, refresh once and retry the original request.
- On any other 401, clear stored tokens and return to sign-in.
- On `TOKEN_REUSE_DETECTED`, clear everything and warn the user that the session
  was ended for security reasons.
- Never retry a refresh automatically more than once. A retry loop against a
  rotated token looks exactly like an attack and will burn the session.
