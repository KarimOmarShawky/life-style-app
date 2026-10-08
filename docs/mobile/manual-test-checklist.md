# Manual test checklist (Android)

Branch: `arena/ff1ca5da-life-style-app`. This checklist covers the features added in this branch: Goals and milestones, Calendar (events, agenda, reminders, conflicts), Projects, Recurring tasks, Focus session sync, Wallet SMS auto-capture, and the AI language fix.

Use the IDs (for example `G-3`, `SMS-2`) when you report a result.

---

## 1. Get a build

### Option A: APK from CI (no AI, production API)

The CI artifact `lifestyle-app-release-apk` is built from the branch head. Download it from the **Actions** run of the branch's latest "CI Pipeline" run.

- The APK has **no `GEMINI_API_KEY`**, so AI and voice transcription are disabled.
- It points at the **production** API (`https://life-style-app-production.up.railway.app/api/v1`). Anything you create is saved there.
- It is signed with the debug key, so it installs for testing but is not a store build.

Install it:

```bash
adb install -r app-release.apk
```

If `adb install` reports a signature mismatch, uninstall the old build first (`adb uninstall <package>`).

### Option B: local build with AI enabled

Create a **new** Gemini key first. The key in older commits was exposed, so it must be rotated.

```bash
cd mobile-app/mobile
flutter build apk --release \
  --dart-define=API_BASE_URL=https://life-style-app-production.up.railway.app/api/v1 \
  --dart-define=GEMINI_API_KEY=<new key>
```

On Windows, set the key in the same terminal and run the builder at the repo root:

```bat
set GEMINI_API_KEY=<new key>
build_apk.bat
```

The builder prints `AI features: enabled` or `AI features: disabled`. The key is compiled into the APK, so do not share that APK publicly.

### Option C: test against a local backend (debug build only)

Release builds reject non-HTTPS API URLs. For a local backend, use a debug build:

```bash
# from the repo root; for the first run, follow docs/deployment/docker.md (env and migrations)
docker compose -f docker/docker-compose.yml up -d
cd mobile-app/mobile
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1 --dart-define=GEMINI_API_KEY=<new key>
```

`10.0.2.2` is the Android emulator's alias for the host machine.

### Quick check that the production API has the new endpoints

Run this from your machine (it does not need the app):

```bash
curl -i https://life-style-app-production.up.railway.app/api/v1/events/agenda
```

- `401` means the route exists and needs a login. Good.
- `404` means production is running an older backend. The calendar screens will not work until it is deployed.

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
- [ ] **C-6** Create an event with a reminder offset, then add a reminder from the event screen and remove one. The reminders list updates. **Note:** reminders are stored on the server but do not send a notification yet (see section 3). Confirm the list updates and do not expect a notification.
- [ ] **C-7** Delete an event. It disappears from the agenda.

### Focus timer and session sync (Tasks tab → timer icon; More → Focus history)

- [ ] **F-1** Start a focus session on a task. Stop it after about a minute. The session appears in More → Focus history with the duration.
- [ ] **F-2** Start a focus session with no task selected. The hint says a task is needed. This session is **not** saved to the server (see section 3).
- [ ] **F-3** Start a focus session, close the app with force-stop, reopen it, and start a new session on a task. The old session is stopped automatically and the new one starts.

### Wallet SMS auto-capture (Money tab)

Setup:

1. Open the Money tab and turn on **Wallet SMS auto-capture** (`smsSyncTitle`). Grant the SMS permission when asked.
2. Keep the app logged in.

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
- [ ] **SMS-5** Close the app normally (Back or Home, then swipe it away from recents). **Do not use Force stop**: after a force stop, Android may not deliver SMS to the app until it is opened again. Send SMS-1 again. Then open the app. The transaction appears either straight away or once the app opens. If the login token has expired, the message waits on the phone until the app opens.
- [ ] **SMS-6** Turn the switch off, send a message, and check that nothing is created.

On a physical phone, `adb emu` does not work. Send the messages from a second phone.

### AI assistant (AI tab). Needs Option B or C

- [ ] **A-1** Set the app language to English (Profile → language; open Profile with the person icon in the Tasks tab). Ask the assistant a plain question in Arabic, for example `إزاي أنظم وقتي الأسبوع ده؟`. The reply is in **Arabic**.
- [ ] **A-2** With the app still in English, ask a question in English. The reply is in English.
- [ ] **A-3** Open the AI tab in a build without `GEMINI_API_KEY` (Option A). The reply asks you to configure the Gemini API key. This is expected for Option A.

### Habits (regression)

- [ ] **H-1** Mark a habit done for today. It stays done after you reopen the app.

### Quick regression

- [ ] **X-1** Log out and log in.
- [ ] **X-2** Create and complete a task.
- [ ] **X-3** Add a manual money transaction.

---

## 3. Known gaps (expected behaviour today)

These are not bugs in the test. Report them only if they behave differently from this list.

1. **Calendar reminders do not notify.** They are saved on the server. The backend worker (`worker.ts`) does not create any queue or processor yet, and the app does not schedule local notifications for calendar reminders. The planned delivery is push through FCM, which needs `FCM_CREDENTIALS`.
2. **Recurring tasks are generated for 7 days from creation.** Nothing extends them later until the worker is implemented.
3. **Focus sessions without a task are not saved to the server.** The API requires `taskId`. Breaks are not saved either.
4. **SMS sync needs a valid login token.** The access token lasts 15 minutes. If it has expired, messages are queued on the phone and sent when the app is opened or resumed. Background sync needs a dedicated ingest token, which is not built.
5. **Voice transcription has the same 15-minute token limit.** It is not fixed.
6. **Other languages show English text for the new screens.** Only English and Arabic have translations for the new strings.
7. **The Gemini key is in previously built APKs and in git history.** It must be rotated.

---

## 4. What to send back

For each failure, send:

- the test ID (for example `C-4`) and the steps you took;
- a screenshot or screen recording;
- for SMS failures, the output of `adb logcat -s SmsTransactionReceiver`;
- for API failures, the response code shown or the `curl -i` result.
