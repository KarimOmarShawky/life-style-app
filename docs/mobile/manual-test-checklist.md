# Manual test checklist (Android)

Branch: `arena/ff1ca5da-life-style-app`. This checklist covers the features added in this branch: Goals and milestones, Calendar (events, agenda, reminders, conflicts), Projects, Recurring tasks, Focus session sync, Wallet SMS auto-capture (including with the app closed), and the AI language fix.

Use the IDs (for example `G-3`, `SMS-2`) when you report a result.

---

## 1. Get a build

### Backend migrations (required for this build)

This build needs two database migrations on the backend it talks to:

- `1727300003000_ingest_tokens` (table for the background SMS token)
- `1727300004000_timer_sessions_optional_task` (focus sessions without a task)

When the database already exists, the backend does not apply migrations by itself. Apply them with `npm run migrate:up` in `backend/` (see `docs/database/migrations.md`). If the database was created by the schema bootstrap and has no migration history, run `docs/database/upgrades/2026-10-ingest-tokens-and-optional-timer-task.sql` instead, as the migration role. Use one of the two, not both. Until they are applied, the background SMS token and focus sessions without a task return errors.

### Option A: APK from CI (no AI, production API)

The CI artifact `lifestyle-app-release-apk` is built from the branch head. Download it from the **Actions** run of the branch's latest "CI Pipeline" run.

- The APK has **no `GEMINI_API_KEY`**, so AI and voice transcription are disabled.
- It points at the **production** API (`https://life-style-app-production.up.railway.app/api/v1`). Anything you create is saved there.
- The signed release APK (`lifestyle-android-signed-release`) is signed with the configured release key and verified against the expected release certificate — not a debug key. (The CI also publishes a separate debug validation APK, `lifestyle-android-debug-validation-NOT-RELEASE`, which is not a release build.)

Install it:

```bash
adb install -r app-release.apk
```

If `adb install` reports a signature mismatch, uninstall the old build first: `adb uninstall com.lifestyle.app`.

### Option B: local build with AI enabled

Create a **new** Gemini key first. The key in older commits was exposed, so it must be rotated.

Release builds never embed `GEMINI_API_KEY` (B-02): `app_config.dart` returns an
empty key in `kReleaseMode`. AI features require a **debug** build:

```bash
cd mobile-app/mobile
flutter build apk --debug \
  --dart-define=API_BASE_URL=https://life-style-app-production.up.railway.app/api/v1 \
  --dart-define=GEMINI_API_KEY=<new key>
```

On Windows, set the API base in the same terminal and run the builder at the repo
root (the builder requires `API_BASE_URL` and passes `GEMINI_API_KEY` as empty):

```bat
set API_BASE_URL=https://life-style-app-production.up.railway.app/api/v1
build_apk.bat
```

The builder prints `AI features: enabled` or `AI features: disabled`. In a debug
build the key is compiled in, so do not share that APK publicly. Release builds
always report AI features disabled.

### Option C: test against a local backend (debug build only)

Release builds reject non-HTTPS API URLs. For a local backend, use a debug build:

```bash
# from the repo root; for the first run, follow docs/deployment/docker.md (env and migrations)
docker compose up -d
cd mobile-app/mobile
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 --dart-define=GEMINI_API_KEY=<new key>
```

`10.0.2.2` is the Android emulator's alias for the host machine.

### Quick check that the production API has the new endpoints

Run this from your machine (it does not need the app):

```bash
curl -i https://life-style-app-production.up.railway.app/api/v1/events/agenda
curl -i -X POST https://life-style-app-production.up.railway.app/api/v1/ingest/token
```

- For the first command, `401` means the route exists and needs a login. `404` means production is running an older backend, and the calendar screens will not work until it is deployed.
- For the second command, `401` means the ingest route is deployed. `404` means it is not.

---

## 2. Feature tests

Log in with a test account. Mark each item pass or fail.

### Goals and milestones (More → Goals)

- [ ] **G-1** Create a milestone goal with a title and a start and target date. It appears in the list.
- [ ] **G-2** Open the goal, add two milestones, then tick one. The progress percentage updates. Untick it and the progress goes back.
- [ ] **G-3** Create a numeric goal with target `50` and unit `km`. Enter a target of `0` and the form blocks it.
- [ ] **G-4** On the numeric goal, update the current value to `12.5`. The percentage updates.
- [ ] **G-5** Change the status from the goal page (active → paused → achieved). It saves after you go back and reopen the goal.
- [ ] **G-6** Edit the title, description, and dates. Clear the description. The change saves.
- [ ] **G-7** Set the target date before the start date. The form shows a date-order error and does not save.
- [ ] **G-8** Delete a milestone and then the goal. Both disappear after confirmation.

### Projects (More → Projects)

- [ ] **P-1** Create a project with a name, a status, a colour, a due date, and a linked goal. It appears in the list.
- [ ] **P-2** Edit it: change the status and colour, clear the due date and the goal. The changes save.
- [ ] **P-3** Delete it after confirmation. It disappears.

### Recurring tasks (More → Recurring tasks)

- [ ] **R-1** Create a weekly task with two weekdays, a due time, a reminder offset, and an estimate. It appears in the list.
- [ ] **R-2** Create a daily task with an end date. Create a monthly task. Both save.
- [ ] **R-3** Check that the tasks generated from R-1 appear in the Tasks tab for the next days. **Known limit:** generation covers 7 days from creation (see section 3).
- [ ] **R-4** Pause a task from the list and then resume it. The status changes each time.
- [ ] **R-5** Edit a task and delete it.

### Calendar (More → Calendar)

- [ ] **C-1** The agenda shows the selected day. Move to the previous and next day with the arrows, and pick a date with the date picker.
- [ ] **C-2** Create a timed event with a location and a start and end time. It appears on the agenda for that day.
- [ ] **C-3** Create an all-day event. It appears on the agenda without a time.
- [ ] **C-4** Create a timed event that overlaps C-2. A conflict dialog lists C-2. Cancel and nothing is saved. Confirm and it is saved. All-day events skip the conflict check.
- [ ] **C-5** Edit an event's title and time. The agenda shows the new values.
- [ ] **C-6** Create an event with a reminder offset, then add a reminder from the event screen and remove one. The reminders list updates.
- [ ] **C-7** Delete an event. It disappears from the agenda, and none of its reminders notify afterwards.
- [ ] **C-8** Reminder notification. Create a timed event that starts about 12 minutes from now, with the reminder set to "10 min before". Save it, then lock the phone. About 2 minutes later a notification shows the event title and "Starts at HH:mm" (or the Arabic text). The app does not need to be open.
- [ ] **C-9** Removing a reminder cancels its notification. On an event that starts later today, add an "At start" reminder and check that it notifies at the start time.
- [ ] **C-10** Change the start time of an event that has a reminder. The notification moves with it. The old time does not notify.
- [ ] **C-11** Restart the phone after creating a reminder for a time that is still ahead. The notification still appears. **Do not use Force stop** for this test: Android cancels scheduled alarms of a force-stopped app.

### Focus timer and session sync (Tasks tab → timer icon; More → Focus history)

- [ ] **F-1** Start a focus session on a task. Stop it after about a minute. The session appears in More → Focus history with the duration.
- [ ] **F-2** Start a focus session with no task selected. No hint appears. Stop it after about a minute. The session appears in More → Focus history with the name "Focus session" and the duration.
- [ ] **F-3** Start a focus session, close the app with force-stop, reopen it, and start a new session on a task. The old session is stopped automatically and the new one starts.
- [ ] **F-4** Start a break and stop it. A break is **not** saved to the server (see section 3), so it does not appear in Focus history.

### Wallet SMS auto-capture (Money tab)

Setup:

1. Open the Money tab and turn on **Wallet SMS auto-capture** (`smsSyncTitle`). Grant the SMS permission when asked.
2. Keep the app logged in for one minute after turning it on. The phone then gets a background token for SMS capture. Nothing else needs to be done.

Send test messages from the emulator. Run these from your computer:

```bash
adb devices
adb -s emulator-5554 emu sms send 01000000000 "تم تحويل مبلغ 250 جنيه من حسابك عبر انستاباي. الرصيد 3000 جنيه"
adb -s emulator-5554 emu sms send NBE "Debited 500.00 EGP for Carrefour. Available balance 1,234.56 EGP"
adb -s emulator-5554 emu sms send CIB "تم استلام 1,200.00 جنيه في حسابك بتاريخ 08/10/2026"
adb -s emulator-5554 emu sms send NBE "Your OTP is 123456 for transaction of 500 EGP"
```

Watch the parser log while you test:

```bash
adb logcat -s SmsTransactionReceiver
```

- [ ] **SMS-1** After the InstaPay message, a notification appears ("New Transaction Detected" or its Arabic version). Money shows an **expense of 250.00 EGP**. The balance (3000) is not used as the amount.
- [ ] **SMS-2** After the NBE message, Money shows an **expense of 500.00 EGP**. The available balance (1,234.56) is not used as the amount.
- [ ] **SMS-3** After the CIB message, Money shows an **income of 1,200.00 EGP**.
- [ ] **SMS-4** The OTP message creates **no** transaction.
- [ ] **SMS-5** Close the app by swiping it away from recents (Back or Home, then swipe). **Do not use Force stop**: after a force stop, Android does not deliver SMS to the app until it is opened again. Lock the phone and send SMS-1 again. The notification and the expense of 250.00 EGP appear **without opening the app**. Then open the app and check that there is one transaction only, not two.
- [ ] **SMS-6** Turn the switch off, send a message, and check that nothing is created.
- [ ] **SMS-7** Turn the switch on again, close the app as in SMS-5, and send SMS-1. The transaction is created.
- [ ] **SMS-8** Log out. Send SMS-1 while logged out. Nothing is created yet. Log in as the same user. The message is sent and appears once.

On a physical phone, `adb emu` does not work. Send the messages from a second phone.

### SMS fallback and review flow (Money tab)

These cover likely transactions the **local parser cannot recognize**. The phone
queues a sanitized candidate and the backend fallback (Gemini behind the API)
analyzes it; the raw SMS never leaves the phone. **Note:** the mobile app has no
dedicated transaction-history screen (the backend exposes
`GET /money/transactions`) — check saved results in the budgets overview or the
exported report, and check pending ones in the "Needs review" card.

Notifications from the receiver never contain the SMS body. By default they
also hide the amount and merchant (lock-screen and shade alike); the opt-in
switch is covered by SMS-F-10.

Setup: SMS auto-capture is on, and the backend it talks to has
`SMS_FALLBACK_GEMINI_KEY` set (ask whoever runs the backend; the key is never in
the APK). Without the key the backend answers `503 SMS_FALLBACK_UNAVAILABLE`,
which is **not** the same as "not a transaction": the candidate is retried with
backoff, kept for seven days, and Money shows a *Wallet SMS analysis paused* card.
See SMS-F-8.

```bash
adb -s emulator-5554 emu sms send BANKX "Transfer of 475.5 EGP to merchant CITY TAXI completed today"
adb -s emulator-5554 emu sms send BANKX "Money movement: EGP 320.00 to UNKNOWN SHOP ref omitted"
```

- [ ] **SMS-F-1** After the first message (unknown sender, unusual amount
  format), a "New Transaction Detected" notification appears **only if** the
  fallback is confident; otherwise a "Transaction needs review" notification
  appears, or nothing (fallback disabled). In every case the amount shows as
  **475.50 EGP** and never a reference or balance.
- [ ] **SMS-F-2** When the review notification appears, open Money: the
  **Needs review** card lists the item. Tap it: the sheet shows the expense/
  income toggle (**direction selection**), an editable **amount** field, and
  the sanitized message (placeholders like `[REF]`/`[PHONE]`, no raw digits of
  references or phones).
- [ ] **SMS-F-3** Change the amount and switch the direction, then **Confirm &
  save**. The card clears. The transaction appears in the budget totals.
- [ ] **SMS-F-4** Send a second candidate and **Discard** it. The card clears
  and nothing is saved.
- [ ] **SMS-F-5** Send the same SMS-1 message twice. Exactly one transaction
  exists (the candidate id is the Idempotency-Key on every path).
- [ ] **SMS-F-6** Turn on airplane mode, send a candidate SMS, wait for the
  failed delivery to queue, then turn the network back on and open the app.
  The candidate is retried and becomes either a saved transaction or a review
  item (offline queue retry).
- [ ] **SMS-F-7** Send `"Your OTP is 772211 for transaction of 500 EGP"` from a
  bank-looking sender. No candidate, no review item, no transaction. The log
  (`adb logcat -s SmsTransactionReceiver`) shows no message body.
- [ ] **SMS-F-8** Point the app at a backend **without**
  `SMS_FALLBACK_GEMINI_KEY` and send `Money movement: EGP 320.00 to UNKNOWN
  SHOP ref omitted` from an unknown sender. Nothing is saved and no review item
  appears, but the message is **not** discarded: Money shows the *Wallet SMS
  analysis paused* card, and the log shows retry attempts instead of a delete.
  Restore the key, reopen the app, and the queued candidate is analyzed and
  becomes a saved transaction or a review item.
- [ ] **SMS-F-9** With the phone **locked**, send a candidate message. The
  lock-screen notification says only that there is an item to review
  ("LifeStyle — You have an item to review") and never shows the amount,
  the merchant or the message. Unlock and check the same notification in the
  shade: no message text, and the amount/merchant appear only after SMS-F-10.
- [ ] **SMS-F-10** In Money, with capture on, turn on **Show amount and merchant
  in notifications** (`smsNotificationDetailsTitle`). Send a candidate again:
  the unlocked notification now includes direction, amount and currency, while
  the lock-screen version stays redacted. Turn it back off and confirm the next
  notification is generic again.
- [ ] **SMS-F-11** Capture a candidate, then simulate a status the app does not
  know (point the app at a stub backend that answers `200` with
  `{"status":"partially_recognized"}`). The candidate is **retried**, not
  deleted: `adb logcat -s SmsTransactionReceiver` shows a retry, and Money shows
  the *Wallet messages kept for review* card (`smsQuarantineTitle`) once the
  attempt budget is spent. Nothing is lost and no transaction is invented.
- [ ] **SMS-F-12** After SMS-F-11, clear the shared preferences entry that holds
  the candidate key (or wait for the 7-day retention window). The card clears by
  itself once the quarantine queue is empty; the entry never reappears as a
  review item.

### AI assistant (AI tab). Needs Option B or C

- [ ] **A-1** Set the app language to English (Profile → language; open Profile with the person icon in the Tasks tab). Ask the assistant a plain question in Arabic, for example `إزاي أنظم وقتي الأسبوع ده؟`. The reply is in **Arabic**.
- [ ] **A-2** With the app still in English, ask a question in English. The reply is in English.
- [ ] **A-3** Open the AI tab in a build without `GEMINI_API_KEY` (Option A). The reply asks you to configure the Gemini API key. This is expected for Option A.

### Habits (regression)

- [ ] **H-1** Mark a habit done for today. It stays done after you reopen the app.

### Feature guide Phase 1 (2026-11-10). Needs a phone

Strings for these screens exist in all six languages. Run the list once in English and once in Arabic.

- [ ] **P1-1** Sign up with a new account. Onboarding opens. Pick a focus area: three starter tasks are added for today without typing. Tick one and the celebration screen appears. Note the time from the first screen to the celebration (target: under 60 seconds).
- [ ] **P1-2** No permission prompt appears at app launch. The reminder question comes only after the first win, and "Not now" continues into the app.
- [ ] **P1-3** On a second new account, Skip on the first screen opens the app at once and creates no tasks. In airplane mode, choosing an area shows a friendly error and Skip still works.
- [ ] **P1-4** Create a task with a reminder in two minutes and lock the phone. The lock screen shows a generic title, not the task title. Repeat with a calendar event reminder.
- [ ] **P1-5** With AI help off (the default), Smart Quick Add creates `Call mom tomorrow at 5pm` right away with the phone's own parser and shows no consent dialog. Note whether the date and time were recognised. Turning AI help on in Profile shows the consent dialog.
- [ ] **P1-6** Profile → usage statistics: turn it off, restart the app, and confirm it is still off. Then request the JSON data export: it lists no product events.
- [ ] **P1-7** Add the home-screen widget. It shows today's task count and up to three next tasks (your Top 3 first), level and XP, in the app language. Switch the app to Arabic: the widget follows within a few seconds and its text aligns right.
- [ ] **P1-8** Tap the widget body (opens Focus) and its Daily Plan line (opens Daily Plan), once with the app in the background and once after force-stopping it. After signing out, the same taps lead to sign-in.
- [ ] **P1-9** Without opening the app, move the device date to tomorrow (or wait past midnight). The widget shows the refresh hint, not yesterday's tasks.
- [ ] **P1-10** A new habit shows "Start today". A habit whose streak ended shows "Fresh start today" and its best streak. In airplane mode, the check button shows a friendly message and nothing crashes.
- [ ] **P1-11** With TalkBack on, the habit check button is announced as "Mark done for today", and the onboarding cards and both Profile switches read their titles.
- [ ] **P1-12** Set the largest system font size. Onboarding, the habit list and Profile show no clipped or overlapping text, and the Arabic layout runs right to left.

### Quick regression

- [ ] **X-1** Log out and log in.
- [ ] **X-2** Create and complete a task.
- [ ] **X-3** Add a manual money transaction.

---

## 3. Known gaps (expected behaviour today)

These are not bugs in the test. Report them only if they behave differently from this list.

1. **Calendar reminders notify from the phone that saved them.** The server stores each reminder but does not send it. The notification is scheduled on the phone when you save the event or its reminders. A reminder created on another phone does not notify this one.
2. **Recurring tasks are generated for 7 days from creation.** Nothing extends them later until the worker is implemented.
3. **Breaks are not saved to the server.** Focus periods are saved, with or without a task.
4. **SMS messages that arrive while the phone has no network wait on the phone.** They are sent when the app opens or when the next SMS arrives. Background capture stops when you log out or turn the switch off.
5. **Queued SMS entries are not tied to an account.** If you log out while entries are still waiting, the next account that logs in on that phone receives them.
6. **Voice transcription has the same 15-minute token limit.** It is not fixed.
7. **Other languages show English text for the new screens.** Only English and Arabic have translations for the new strings.
8. **The Gemini key is in previously built APKs and in git history.** It must be rotated. The SMS fallback key is a *different* key and lives only in backend configuration (`SMS_FALLBACK_GEMINI_KEY`); it is never compiled into the APK.
9. **The mobile app has no dedicated transaction-history screen.** The backend exposes `GET /money/transactions`, but the app shows auto-saved SMS transactions in budget totals and the exported report; fallback results wait in the "Needs review" card until confirmed.

---

## 4. What to send back

For each failure, send:

- the test ID (for example `C-4`) and the steps you took;
- a screenshot or screen recording;
- for SMS failures, the output of `adb logcat -s SmsTransactionReceiver`;
- for API failures, the response code shown or the `curl -i` result.
