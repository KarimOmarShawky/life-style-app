# Security Architecture & Native Mobile Threat Model

> **Specification Reference:** Section 16.0 & 16.1

## 1. Native Mobile Threat Model (Not a Browser Application)

The LifeStyle App security architecture is purpose-built for a native Flutter client operating on iOS and Android:

```text
[Flutter Client on iOS / Android]
       │
       │ Bearer Token in Authorization Header (Stored in Keychain/Keystore)
       │ No Cookies, No CSRF tokens, No Ambient Credentials
       ▼
[TLS Termination / Load Balancer]
       ▼
[LifeStyle Express 5 API]
       ├── Strict JSON Content-Type Enforcement
       ├── Helmet Hardened Headers (CSP: default-src 'none')
       ├── Zod Schema Validation (.strict() on all inputs)
       ├── Ownership Authorization (Composite Foreign Keys)
       └── Central Error Masker (No SQL or stack leakage)
```

### Core Security Invariants

1. **Untrusted Client:** The mobile app is untrusted code running on user hardware. The server validates every rule, calculation, and relationship. No `isAdmin` or privilege flags from the client are ever honored.
2. **No Browser Attack Surface:** The server sets zero cookies. CSRF, cross-site scripting via ambient credentials, and browser storage attacks are eliminated by architectural design (ADR-003, D-05).
3. **Zero IDOR by Design:** The API returns `404 NOT_FOUND` when attempting to access a resource that does not belong to the authenticated caller (ADR-038). A user can never confirm whether an unowned UUID exists.
4. **Relational Backstop:** Composite foreign keys `(id, user_id)` ensure that even if application logic were defective, PostgreSQL physically rejects cross-user associations.
