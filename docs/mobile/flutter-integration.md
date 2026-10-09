# Flutter Mobile Integration (P10)

The MVP client is a native Flutter app that talks directly to the REST API. It is not a web client and does not implement offline-first storage or synchronization.

## Included client foundation

- Flutter source package at `mobile/`, using Riverpod for authentication/task state.
- REST transport compatible with the API's raw success DTOs, `{ data, meta }` collection responses, and `{ success: false, error }` errors.
- Registration, login, password-reset request/confirmation, profile display, task listing/creation/completion, and logout.
- Access and opaque refresh tokens stored together in one secure-storage value; no tokens are written to preferences, logs, or navigation state.
- One in-flight refresh operation is shared across concurrent expired-token responses. A request is replayed once only after `TOKEN_EXPIRED`; unrelated `401` errors are not retried. If rotation outcome is uncertain, the stored pair is cleared because replaying an old token would trigger the server's strict reuse detection.
- English localization scaffolding in `mobile/lib/l10n/` and English ARB source catalog. `en` is the only supported locale for the MVP.
- Native route handling accepts only `/tasks` and `/profile` destinations. URI query strings and fragments are discarded.

## Requirements to run

Install the Flutter stable SDK and the platform tooling for the target device. From `mobile/`:

```bash
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze --fatal-infos
flutter test --coverage
```

The repository currently carries Flutter source/package configuration but no resolved `pubspec.lock`; run `flutter pub get` and review/commit the resulting lockfile with the SDK. Generate the platform runner projects with the Flutter SDK before `flutter run` or building/signing iOS/Android binaries. Then, for an Android emulator, run:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

`10.0.2.2` is the Android emulator host alias. For a device, use a reachable development API address. Release builds reject non-HTTPS API URLs.

## Native deep-link registration

The route parser accepts the app URI form `lifestyle://tasks` and `lifestyle://profile`; Flutter receives the platform route and maps it through the allowlist. Add the scheme to the generated platform runner's existing launcher configuration.

Android launcher activity intent-filter entry:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="lifestyle" />
</intent-filter>
```

For iOS, add `lifestyle` to `CFBundleURLTypes` in the generated Runner `Info.plist`. Do not place credentials or tokens in deep-link URIs. The current routing contract intentionally ignores all query and fragment data.

## API prefix and local environment

`API_BASE_URL` must be an absolute URL ending in `/api/v1`, for example:

- Android emulator development: `http://10.0.2.2:3000/api/v1`
- Staging/production: `https://<configured-api-host>/api/v1`

The client sends bearer access tokens in the `Authorization` header. It never uses cookies. The API remains authoritative for validation, ownership, money, date, and concurrency rules.

## Optional AI build define

The AI assistant and native voice transcription use Gemini. They are disabled unless the app is built with the key:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 --dart-define=GEMINI_API_KEY=<key>
```

The key has no source default. `build_apk.bat` at the repo root passes it through only when `GEMINI_API_KEY` is set in the environment (`set GEMINI_API_KEY=<key>` in the same terminal, then run the file). On startup the app mirrors it into the app's private SharedPreferences (`flutter.gemini_api_key`) so native voice code can read it. A build-time define is still compiled into the APK, so anyone who extracts the app can read the key. For production, move the Gemini call behind a backend endpoint that reads the key from server configuration.

## Wallet SMS capture

When the user enables wallet SMS capture on the Money screen and grants `RECEIVE_SMS`, the Android receiver parses bank and wallet messages. Each detected transaction is saved to a local queue first, then sent:

- If an ingest token is stored, the receiver sends the transaction right away with it. This works while the app is closed.
- Without an ingest token, the receiver sends with the stored access token, but only while that token is still valid.
- Otherwise the Flutter app sends queued transactions on start and on resume, through `ApiClient`, which owns token refresh.
- The queue entry id is the `Idempotency-Key`, so a retry cannot create a duplicate.

The ingest token (`POST /api/v1/ingest/token`, stored under `lifestyle.wallet_ingest_token.v1`) is bound to the login session. It can only call `POST /api/v1/ingest/transactions`, and it stops working when the session ends. The app issues it when the switch is turned on and on start, revokes it when the switch is turned off, and clears the local copy on sign-out.

The receiver never refreshes tokens itself. The backend revokes a session when a refresh token is reused.

## Planning modules

The "More" tab opens Calendar (day agenda, event reminders, conflict check before save), Goals (milestones or numeric progress), Projects, Recurring tasks, and Focus history.

Calendar reminders are scheduled as local notifications by `calendar_reminder_notifications.dart`. The event form schedules them when an event or its reminders are saved, deleting an event or reminder cancels its notifications, and the app re-registers the upcoming ones on start. The server stores reminders but does not send them.

The focus timer records each running focus period through `/timer-sessions`, on the selected task or without one. Breaks stay on the device.

New UI strings have English and Arabic catalog entries. The other locales fall back to English until they are translated.
