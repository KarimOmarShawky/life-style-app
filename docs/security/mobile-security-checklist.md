# Native Mobile Security Checklist (P11)

## Token and session handling

- [x] Access JWT and opaque refresh token are stored together using `flutter_secure_storage` (platform secure storage), not app preferences.
- [x] The application attaches tokens only as a Bearer authorization header; it does not use browser cookies.
- [x] The refresh endpoint is called only for an explicit `TOKEN_EXPIRED` response.
- [x] Concurrent expired requests share one refresh operation; late responses use the already-rotated access token.
- [x] A refresh response is persisted as one value. An uncertain rotation clears the local pair rather than replaying a potentially rotated token.
- [x] Each original request is retried at most once after refresh.
- [x] Logout attempts server-side revocation and clears local credentials even if the request fails.
- [x] Reset-password success clears any local session.

## API, transport, and navigation

- [x] Production builds require an HTTPS API base URL; API host configuration is injected at build time.
- [x] HTTP redirects are disabled so bearer credentials are not forwarded to another origin; requests have a bounded 30-second timeout.
- [x] User-visible errors use the API's safe message and request ID is not treated as a credential.
- [x] No passwords, access tokens, refresh tokens, OTPs, or request bodies are logged.
- [x] AI assistant egress is opt-in per conversation: the consent dialog states that typed text, conversation history, display name and task/habit counts are sent to Google Gemini using the user's own API key, that financial records are not included automatically, and warns against typing secrets (R-21).
- [x] Deep links route through a fixed destination allowlist. Query and fragment values are not propagated to screens.
- [x] The API server remains responsible for authentication, authorization, ownership, validation, and rate limits.
- [x] No local business database, background synchronization, or browser runtime was introduced.

## Release checks still required

- [ ] Build and test signed iOS and Android artifacts on supported platform runners.
- [ ] Verify Keychain/Android secure-storage behavior on physical devices and OS upgrade/restore paths.
- [ ] Complete platform-specific deep-link registration and verify unknown schemes/paths cannot navigate outside the allowlist on device.
- [ ] Run dependency vulnerability review against the resolved Flutter dependency lockfile.
- [ ] Complete an end-to-end release test against staging over TLS.

This checklist records implementation and outstanding validation separately; it is not a claim that mobile production certification has been completed.
