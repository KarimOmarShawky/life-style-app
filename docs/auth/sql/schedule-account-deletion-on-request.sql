-- Owner-run (Neon SQL editor): schedule the deletion of ONE account after a verified
-- request received outside the app (Google Play account-deletion requirement; see
-- docs/auth/account-deletion-requests.md). Rehearse once on a Neon branch with a test
-- account before the first real request.
--
-- Mirrors UsersRepository.scheduleDeletion with no current session (every session and
-- refresh token is revoked) and writes the same audit event as the app
-- ('user.deletion.requested'), recorded as a system action. The nightly purge erases the
-- account after 14 days; signing in and cancelling in the app stops it, exactly as for a
-- request made in the app. An account that is already scheduled keeps its date.
--
-- Replace the email on the marked line only. The block is one statement: on any error
-- nothing is changed. Never paste the email into the repository or a ticket.
DO $$
DECLARE
  v_email CONSTANT citext := 'person@example.com';  -- << the account's email address
  v_user uuid;
  v_status text;
  v_scheduled timestamptz;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM users WHERE email = v_email;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one account for this email, found %', v_count;
  END IF;

  SELECT id, status, deletion_scheduled_for
    INTO v_user, v_status, v_scheduled
    FROM users
   WHERE email = v_email
     FOR UPDATE;

  IF v_status = 'pending_deletion' AND v_scheduled IS NOT NULL THEN
    RAISE NOTICE 'Already scheduled for % (UTC); date unchanged', v_scheduled;
  ELSE
    v_scheduled := now() + interval '14 days';
    UPDATE users
       SET status = 'pending_deletion', deletion_scheduled_for = v_scheduled, updated_at = now()
     WHERE id = v_user;
  END IF;

  UPDATE ingest_tokens SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;
  DELETE FROM push_devices WHERE user_id = v_user;
  UPDATE reminders
     SET status = 'cancelled', next_attempt_at = NULL, updated_at = now()
   WHERE user_id = v_user AND status IN ('pending', 'processing');
  UPDATE auth_sessions
     SET revoked_at = now(), revoked_reason = 'account_deletion'
   WHERE user_id = v_user AND revoked_at IS NULL;
  UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL;

  INSERT INTO audit_logs (actor_type, actor_user_id, event_type, outcome, metadata)
  VALUES (
    'system', v_user, 'user.deletion.requested', 'success',
    jsonb_build_object(
      'scheduledFor', to_char(v_scheduled AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'channel', 'email_request'
    )
  );

  RAISE NOTICE 'Deletion scheduled for % (UTC)', v_scheduled;
END $$;

-- Verification (read-only; same email):
-- SELECT status, deletion_scheduled_for FROM users WHERE email = 'person@example.com';
--   expected: pending_deletion | about 14 days from now
-- SELECT (SELECT count(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS open_sessions,
--        (SELECT count(*) FROM push_devices p WHERE p.user_id = u.id) AS push_devices,
--        (SELECT count(*) FROM reminders r WHERE r.user_id = u.id AND r.status IN ('pending', 'processing')) AS live_reminders
--   FROM users u WHERE u.email = 'person@example.com';
--   expected: 0 | 0 | 0
