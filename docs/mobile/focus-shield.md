# Focus Shield + Productivity Suite

Implemented above PR #5 (`af26305`), on the single session branch, in five phase commits. The PR stays **draft/unmerged until explicit approval**. Exact commit-specific CI evidence is recorded on PR #6, not inferred from an earlier green run.

## Architecture and boundaries

- Existing Riverpod/repository architecture is retained. `TasksController` provides one queued bulk update boundary; the existing online-first backend has no bulk transaction endpoint. Per-task version checks, explicit partial results and version-aware Undo are retained. There is no invented offline sync guarantee.
- Focus Shield is explicitly opt-in and off initially. Native support/permission failures do not prevent ordinary timer XP, task/habit XP, routines, offline coaching or widget display.
- `focus_shield_prefs` owns session activity, expiration, bypasses and the distraction counter. Flutter never increments attempts, and reads the final native count to persist history. A local pending-session journal allows recovery after Flutter restarts; a ledger makes all awards idempotent. Task XP has lifetime identity; habit/ritual XP has local-date identity.
- Accessibility listens only to window-state changes and cannot retrieve window content. Safe packages include both the Kotlin namespace and actual application ID, phone/emergency/system permissions components, dynamically resolved launcher/dialer and all installed IMEs.
- Services remain system-bound but do no capture/blocking work when inactive. Calling `disableSelf()` would revoke accessibility between sessions and make the permission/start flow unusable; activity is instead gated on every event.
- The only new library is pinned **test-only JUnit 4.13.2**. No Flutter or Android runtime dependency was added. The widget is standard Kotlin/RemoteViews, not a plugin.

## Privacy

- Native reply entries use a bounded, synchronized `ConcurrentHashMap` cache (100); the native event FIFO is also bounded to 100. Notification removals evict actions and queued message events. Session end clears both message events and actions. No message/sender/RemoteInput is logged, serialized, persisted or backed up.
- Flutter persists a whitelist of ledger, badge, session and settings fields, never Inbox contents or drafts. A removed notification's sender/body is purged; a non-empty **user-authored draft** remains in memory as a stale fallback until session end.
- Replies are not delivery receipts. `sent` means the notification PendingIntent was accepted; support varies by application. Missing/stale/cancelled/failed reply actions leave the draft intact and offer explicit clipboard copy plus a single-package 60-second pass. An awake foreground recheck enforces the grace boundary even without another window event.
- Weekly coaching has a fresh per-request consent dialog with the exact numeric payload and a default-off optional spending checkbox. `AiService` independently allowlists numeric metric names, uses an empty conversation history, encrypted BYOK and the existing circuit breaker. No key/paused/failed request yields deterministic offline coaching.
- The widget displays only XP/level, a clarity score, task count, **one** priority title and native shield status. It ignores yesterday's task snapshot. Sign-out clears the widget and stops the shield.

## Android lifecycle and safety

- An ongoing, non-foreground-service notification provides **End Shield Now** through a non-exported receiver; the Focus screen has an always-reachable exit even when loading, errors or POST_NOTIFICATIONS denial occur.
- Expiry is checked on every native event and widget read. A native alarm and main-thread deadline schedule cleanup without Flutter. Exact alarms are used when permitted, with an inexact idle-compatible fallback otherwise; Android/OEM process scheduling can delay asynchronous refreshes. No event blocks at or after the stored deadline even if cleanup was delayed.
- Stop, expiry, reboot and manual notification exits refresh widgets natively. Native status is never accepted from Flutter's display payload.
- Package visibility is scoped to launchable/home intents. No QUERY_ALL_PACKAGES was added.

## Automated gates

CI retains the real check names **Backend Quality, Security & API Contract Gate** and **Flutter Static Analysis & Tests**. The latter runs:

1. `dart format --output=none --set-exit-if-changed lib test`
2. `flutter analyze --fatal-infos` (all three strict language flags remain on)
3. `flutter test --coverage`
4. `cd android/app && ../gradlew testDebugUnitTest` (app-scoped, not upstream plugins' own Robolectric suites)
5. **Build Android Release APK**: `flutter build apk --release`

The baseline's existing unformatted Dart files were formatted in phase 1 to make the newly non-mutating format gate meaningful. Formatting failures expose a source-only repair patch through artifacts/API annotations for environments that cannot download SDKs or artifact blobs. Failures remain failures; diagnostic steps do not bypass gates.

Local Flutter/Dart/Java/Android execution is **BLOCKED** in the Arena sandbox (SDKs absent). XML parsing, forbidden-dependency guard and whitespace validation can run locally. Do not interpret static inspection or green build/test jobs as physical-device verification.

## Required device acceptance (not claimed as verified)

- Enable accessibility/listener independently, deny POST_NOTIFICATIONS, and confirm the visible exit always works. Revoke permissions during a session and re-enable them. Exercise battery settings and OEM restrictions.
- Toggle YouTube and every default/custom package; verify installed-app picker visibility on Android 11+. Attempt to block launcher, keyboard, Settings, permission controllers and dialer; they must remain usable.
- Enter a blocked app and verify HOME → Focus, task title, package, remaining time and a single debounced native attempt. Test warm/cold launch/deep links and process recreation.
- Receive real WhatsApp/Instagram/Telegram/Messenger/SMS messages. Verify summary/ongoing/self notifications are ignored. Exercise missing actions, cancelled PendingIntents and a notification removed mid-draft; confirm no draft loss on failure and no content in preferences/logs/backups.
- Copy/open for 60 seconds, remain in the app, then verify blocking returns; verify a second bypass resets only its package/deadline. End from the notification while Flutter is closed. Expire/reboot and confirm native state/widget are Ready, accounting for Android alarm/OEM scheduling limits.
- Add/resize multiple widgets, complete tasks/habits/focus sessions, select Top 3 and sign out. Inspect task count/title, score and ledger-derived level. Let midnight pass without Flutter: old task snapshots must show No data.
- Rollover a mixture of dated, undated and recurring tasks with deselection; simulate offline/409 partial results; Undo and ensure newer edits are not overwritten. Test device local timezone and month/year/DST boundaries.
- Generate coaching repeatedly: each online request must require new consent; spending must be omitted by default. Test no key, denied consent, invalid key, quota/circuit pause and offline fallback. Never send raw notes/titles/messages/packages.
