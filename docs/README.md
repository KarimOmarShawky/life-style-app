# Documentation

## Start here

| Document | Read it for |
|---|---|
| [Architecture overview](architecture/overview.md) | How the layers fit together and what a request does |
| [Design decisions](architecture/design-decisions.md) | Why the stack, the database split and the token design are what they are |
| [Database architecture](database/database-overview.md) | Which data lives where, and the cross-database boundary |
| [Schema reference](database/schema.md) | Tables, constraints and index rationale |
| [Security overview](security/security-overview.md) | Threat by threat: attack, protection, implementation, test |
| [Authentication flow](security/authentication.md) | Registration, login, refresh, rotation, reuse detection |
| [Security checklist](security/security-checklist.md) | What is done, what is not |
| [Error contract](api/errors.md) | Every error code and what a client should do |
| [Feature guide](architecture/feature-architecture.md) | The vertical-slice pattern every feature follows |
| [OpenAPI specification](api/openapi.yaml) | Endpoint reference. Served at `/docs` in development |
| [Development setup](development/setup.md) | Getting it running |
| [Deploying to Railway](deployment/railway.md) | Variables, migrations on deploy, health checks, rollback |
| [Troubleshooting](troubleshooting/common-problems.md) | Symptoms that have actually occurred, and what each one means |

## Conventions

- Documentation describes what exists. Planned work is marked as not implemented
  rather than written in the present tense.
- Every architectural decision belongs in the decision log with its alternatives
  and trade-offs, not only its conclusion.
- Security claims name the test that backs them.
- When an implementation changes, the documentation changes in the same commit.
