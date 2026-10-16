# Finding traceability matrix

Primary source: Independent Post-Remediation Review, 2026-10-13, sections 4-5.
The earlier audit was not supplied. B-01-B-33, R-01-R-23 and preserved P0-01
are 57 source records, NOT 57 independent defects. Shared group keys reconcile
37 administrative overlap groups; these are not asserted to be 37 independent bugs.

Remediation dispositions are not verification outcomes: fixed_verified means targeted
executed evidence only; code_unverified means relevant runtime proof is absent;
partial means residual scope; open means no completed correction; unclear means
mapping/policy is unproven. Verification outcomes use only PASS, FAIL, BLOCKED,
NOT RUN and NOT APPLICABLE, with scope in checks.json. No production certification.

| ID | Source severity | Description | Current code | Group | Disposition |
|---|---|---|---|---|---|
| P0-01 | Critical (P0) | Unauthenticated health/migrate DDL and stack disclosure | already fixed | P0-01 | fixed_verified |
| B-01 | High (P1) | Mobile tokens in plaintext preferences and default backup scope | confirmed | B-01 | partial |
| B-02 | High (P1) | Gemini API key compiled into release app | already fixed | B-02 | code_unverified |
| B-03 | High (P1) | SMS capture conflicts with original D-09 exclusion | already fixed | B-03 | code_unverified |
| B-04 | High (P1) | AI features conflict with D-07 exclusion | already fixed | B-04 | partial |
| B-05 | High (P1) | Arabic default/RTL/extra locales conflict with English-only policy | already fixed | B-05 | code_unverified |
| B-06 | High (P1) | Dashboard and Daily Plan missing/incomplete | confirmed | B-06 | code_unverified |
| B-07 | High (P1) | Account erasure and retention purges do not execute completely | confirmed | B-07 | partial |
| B-08 | High (P1) | Recurring tasks stop after first seven days | already fixed | B-08 | code_unverified |
| B-09 | High (P1) | Boot DDL/schema drift/runtime superuser allowed | confirmed | B-09 | partial |
| B-10 | Medium (P2) | Non-atomic reset attempt counter | already fixed | B-10 | fixed_verified |
| B-11 | Medium (P2) | Worker is a stub / BullMQ absent | already fixed | B-11 | partial |
| B-12 | Medium (P2) | Reminders event-only / no dispatch or push | confirmed | B-12 | partial |
| B-13 | Medium (P2) | Plain SMTP transport silently swallows failures | confirmed | B-13 | code_unverified |
| B-14 | Medium (P2) | Success-envelope documentation contradicts raw DTOs | confirmed | B-14 | code_unverified |
| B-15 | Medium (P2) | Forbidden-dependency guard misses Flutter manifest | targeted guard and policy corrected | B-15 | fixed_verified |
| B-16 | Medium (P2) | Coverage gaps | confirmed | B-16 | partial |
| B-17 | Medium (P2) | Destructive tests target development DB and Redis | confirmed | B-17 | fixed_verified |
| B-18 | Medium (P2) | Export/deletion lack reauthentication | partially remediated | B-18 | partial |
| B-19 | Medium (P2) | Timer sessions without task versus documented requirement | confirmed | B-09 | code_unverified |
| B-20 | Medium (P2) | Documentation overstates/nonexistent controls and features | confirmed | B-20 | partial |
| B-21 | Medium (P2) | Search coverage incomplete | confirmed | B-21 | partial |
| B-22 | Low (P3) | Auxiliary listeners not closed on shutdown | already fixed | B-22 | code_unverified |
| B-23 | Low (P3) | Demo HTML embedded in app.ts | already fixed | B-23 | code_unverified |
| B-24 | Low (P3) | Unsafe casts and services accessing DB | confirmed | B-24 | partial |
| B-25 | Low (P3) | Rate-limit values differ from specification | unclear | B-25 | unclear |
| B-26 | Low (P3) | Weak password denylist / unvalidated timezone/currency | confirmed | B-26 | partial |
| B-27 | Low (P3) | Forgot/reset password timing differential | confirmed | B-27 | partial |
| B-28 | Low (P3) | Configured refresh/session TTLs ignored | confirmed | B-28 | fixed_verified |
| B-29 | Low (P3) | Non-strict schemas / extra transaction fields | confirmed | B-29 | partial |
| B-30 | Low (P3) | Debug signing fallback / no obfuscation / lock-screen display | confirmed | B-30 | partial |
| B-31 | Low (P3) | CI scanning and DB timeout gaps | partial implementation; actual current-source scan PASS; historical detector FAIL with reviewed local-default provenance; actual hosted CI separately C39; image scanning NOT RUN | B-31 | partial |
| B-32 | Low (P3) | Repository hygiene | partial cleanup | B-32 | partial |
| B-33 | Low (P3) | Client budget monetary arithmetic uses double | targeted pure-money runtime verified in actual hosted Flutter suite; physical UI not certified | B-33 | fixed_verified |
| R-01 | High | Mobile Daily Plan requests unregistered dashboard root | confirmed | B-06 | fixed_verified |
| R-02 | Medium | Reusable plaintext reset code in BullMQ payload | confirmed | B-13 | fixed_verified |
| R-03 | Medium | SMTP failures resolve, defeating retries | confirmed | B-13 | code_unverified |
| R-04 | Medium | Push sender stub while mobile requests push | confirmed | B-12 | partial |
| R-05 | Medium | Applied migration edited; existing installs miss DELETE grant | confirmed | B-07 | code_unverified |
| R-06 | Medium | Processing reminders never recovered after crash | confirmed | B-12 | code_unverified |
| R-07 | Medium | Floating point and fixed two-decimal dashboard/day money | confirmed | B-06 | code_unverified |
| R-08 | Medium | Ingest credential/SMS queues plaintext and backed up | confirmed | B-01 | partial |
| R-09 | Medium | Reset delivery requires live worker consumer | confirmed | B-13 | fixed_verified |
| R-10 | Medium | Fresh containers lack schema-creation deployment step | confirmed | B-09 | code_unverified |
| R-11 | Low | Duplicate account purge; production copy untested | confirmed | B-07 | code_unverified |
| R-12 | Low | Soft-delete purge catches all errors silently | confirmed | B-07 | fixed_verified |
| R-13 | Low | Day endpoint accepts impossible dates | confirmed | R-13 | fixed_verified |
| R-14 | Low | Search LIKE metacharacters treated as patterns; note body unindexed | confirmed | B-21 | partial |
| R-15 | Low | Worker errors unobservable and failed reset jobs discarded | confirmed | B-11 | code_unverified |
| R-16 | Low | Reminder attempt counter incremented twice | confirmed | B-12 | fixed_verified |
| R-17 | Low | Timer job closes at now, overstating tracked time | confirmed | R-17 | code_unverified |
| R-18 | Low | Table-only schema test misses nullable-task drift | confirmed | B-09 | partial |
| R-19 | Low | Unclosed API queue connection; NODE_ENV selection | confirmed | B-11 | partial |
| R-20 | Low | Reminder routes authenticate/rate-limit twice; cross-feature repositories | confirmed | B-12 | partial |
| R-21 | Informational | AI sends name/counts/typed text to third party | confirmed | R-21 | code_unverified |
| R-22 | Informational | Voice missing from ADR-044; dead Gemini transcription | unclear | B-04 | unclear |
| R-23 | Informational | Offline dependency/build observations | confirmed | R-23 | partial |
