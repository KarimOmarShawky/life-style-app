# Digital Detox — implementation gate and safety contract (2026-10-15)

## Discovered architecture / capability gate (before enforcement implementation)
Flutter + Riverpod. Android is the only native target checked in: no ios directory,
FamilyControls entitlement, ManagedSettings integration, or DeviceActivity extension.
Existing Focus Shield uses a user-enabled Android AccessibilityService to redirect
selected foreground app windows to HOME. It is not device-owner package suspension.
No new accessibility service, device administrator, or usage tracking is introduced.

| Actual configuration | Full-device request | Selected-app request |
|---|---|---|
| Android consumer app | **Partial**: explicitly labelled Strict Focus alternative, redirects visible launchable non-safety apps. Does not lock device. | **Partial**: existing accessibility redirect for selected launchable non-safety apps. Not OS package suspension. |
| iOS (no native target) | **Blocked**: ordinary apps cannot lock the device; no integration. | **Blocked**: would require FamilyControls authorization/distribution entitlement, ManagedSettings and DeviceActivity extensions plus device verification. |
| Other Flutter targets | **Blocked**: native integration absent. | **Blocked**: no fabricated application list. |

All current Android enforced sessions report FOCUS_PARTIAL, never FOCUS_ACTIVE.
A connected service and persisted native owner are checked, but that is NOT proof
that every future launch will be intercepted. Accessibility can be disabled by the
user, OEMs may terminate it, and Android settings, emergency calling, dialers,
keyboards, launcher, permissions UI and LifeStyle remain accessible. Distribution
policy review and physical-device verification are release gates. No new sensitive
permissions are requested automatically. Explain scope before opening Android settings.

## Session design
Explicit transition graph in detox_session.dart; invalid transitions throw.
Defaults 45/15 minutes; focus 1–180 and break 1–60 minutes. Repeat is intentionally
not automatic. At break end complete; Continue explicitly starts a new cycle.
Pause first releases owned restrictions and freezes remaining time. Resume reapplies
before declaring the actual focus status. Stop releases only this owner. Release
failure stays ERROR, not a false unrestricted break/stop.

Secure storage holds a versioned snapshot per authenticated account (no guest
sessions). Timestamps, phase, durations, paused remaining time, selected package IDs,
restriction result and last transition persist. No usage or notification content.
An app-lifetime Riverpod controller serializes operations; the UI ticker is not the
source of time. Startup, resume, and delayed ticks reconcile against native state.
Native expiry releases without Flutter. There is no automatic background restart
of a focus cycle. Native elapsed realtime and boot count invalidate stale restrictions
on reboot or significant clock changes; the safest policy is release, not re-lock.
Break begins at the actual confirmed release, not a fabricated past release time.
Secure-store corruption is reported, and native Detox-owned state is safely released.
Existing Focus Shield sessions are not stopped by Detox's owner-scoped operations.
Signing out already stops native shielding; the Detox snapshot is discarded on logout.

## Verification and remaining requirements
Flutter/Dart/Android SDKs and a physical device are unavailable in this sandbox.
Tests added are NOT RUN until CI/device verification; neither mode is fully delivered
or release-approved. Verify real app selection, permission denial/revocation, HOME
redirects, emergency/essential app safety, expiry with app killed, reboot, time changes,
pause/break/stop release, screen navigation and competing Focus Shield sessions.
For genuine Android OS suspension a separately approved managed-device deployment
would need device-owner provisioning. Do not silently add that privilege here.
For iOS add an actual native target, acquire Apple's distribution entitlement,
implement system FamilyActivityPicker + ManagedSettings + DeviceActivity extensions,
and test release/recovery on devices before reporting support.


## Ingest storage remediation compatibility
The session-bound wallet ingest credential now uses AES-GCM with a non-exportable
Android Keystore key, shared by the receiver and a native method channel. Flutter
receives only a presence flag on reads. Successful encrypted writes remove the legacy
plaintext token; failures do not silently downgrade storage. Other native targets use
FlutterSecureStorage. Backup and device-transfer exclusions cover all app domains.
The financial SMS candidate, review and pending-transaction queues are written to the
same private preferences, but every entry is sealed with the non-exportable Keystore key
(`lifestyle.wallet.queue.v1`, AES-256-GCM) through `WalletQueueCipher` on the native side
and `WalletQueueCodec` in Dart. There is no plaintext fallback: when the platform key
cannot seal an entry, the write is refused and logged instead of storing the payload in
the clear. Entries written by earlier builds remain readable and are re-sealed on their
next write.

Residual risk after this change: entries can still be read by code running as the app on
a rooted or compromised device while the key is usable, and candidates are retained for a
bounded seven days rather than indefinitely. Keystore migration across a device restore is
unverified - no device run has been performed. Describe the queues as encrypted **with
those caveats**, not as protected against a compromised device.
