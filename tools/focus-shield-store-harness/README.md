# Focus Shield persistence-failure harness

Runs the real session store and decision engine on the JVM with deliberately minimal Android stubs. Supply a Kotlin compiler and Java 17 via `KOTLINC` and `JAVA` if they are not on PATH, then run `tools/focus-shield-store-harness/run.sh` from any directory.

The fake preferences model Android's in-memory edit even when `commit()` returns false. The cases check failed start (including failed rollback), failed bypass without incrementing its count, and failed stop cancellation. These stubs do not establish actual Android SharedPreferences, AlarmManager, notification, process-crash, accessibility or physical-device behavior. They are a supplement to Android/Flutter and device tests, not a replacement.

`run-service.sh` compiles the real Accessibility service and session store against stubs and checks that destroying the connected service ends the stored active session. Android may kill a process without calling `onDestroy`; service lifecycle, permission changes and reconnection still require Android/device validation.
