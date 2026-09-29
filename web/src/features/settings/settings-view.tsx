'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  KeyRound,
  LogOut,
  ShieldCheck,
  Trash2,
  UserRound
} from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { settingsApi, settingsAuthApi } from './api';
import { changePasswordFormDefaults, changePasswordFormSchema, profileFormSchema } from './schemas';
import type { ProfileFormValues } from './schemas';
import { useAuth } from '@/lib/auth/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { ApiError } from '@/lib/api/errors';
import type { UpdateProfileBody } from '@/types/api';

function listTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      return intl.supportedValuesOf('timeZone');
    } catch {
      /* fall through */
    }
  }
  return [Intl.DateTimeFormat().resolvedOptions().timeZone];
}

const WEEKDAY_LABELS: Record<string, string> = {
  '1': '1 — Monday',
  '2': '2 — Tuesday',
  '3': '3 — Wednesday',
  '4': '4 — Thursday',
  '5': '5 — Friday',
  '6': '6 — Saturday',
  '7': '7 — Sunday'
};

export function SettingsView() {
  const { user, session, refreshUser, signOutAllDevices } = useAuth();
  const { toast } = useToast();
  const timeZones = useMemo(() => listTimeZones(), []);

  const [profile, setProfile] = useState<ProfileFormValues>({
    displayName: '',
    timezone: 'UTC',
    locale: 'en',
    weekStart: '1',
    defaultCurrency: 'USD'
  });
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const [pw, setPw] = useState(changePasswordFormDefaults);
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  const [exportBusy, setExportBusy] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setProfile({
      displayName: user.displayName,
      timezone: user.timezone,
      locale: user.locale,
      weekStart: String(user.weekStart),
      defaultCurrency: user.defaultCurrency
    });
  }, [user]);

  const isPendingDeletion = user?.status === 'pending_deletion';

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileError(null);
    const parsed = profileFormSchema.safeParse(profile);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!errors[key]) errors[key] = issue.message;
      }
      setProfileErrors(errors);
      return;
    }
    setProfileErrors({});
    setProfileBusy(true);
    try {
      const body: UpdateProfileBody = {
        displayName: parsed.data.displayName,
        timezone: parsed.data.timezone,
        locale: parsed.data.locale,
        weekStart: Number.parseInt(parsed.data.weekStart, 10),
        defaultCurrency: parsed.data.defaultCurrency
      };
      await settingsApi.updateProfile(body, session);
      await refreshUser();
      toast({ title: 'Profile updated', variant: 'success' });
    } catch (error) {
      setProfileError(
        error instanceof ApiError ? error.userMessage : 'Could not save your profile.'
      );
    } finally {
      setProfileBusy(false);
    }
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPwError(null);
    setPwDone(false);
    const parsed = changePasswordFormSchema.safeParse(pw);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!errors[key]) errors[key] = issue.message;
      }
      setPwErrors(errors);
      return;
    }
    setPwErrors({});
    setPwBusy(true);
    try {
      await settingsAuthApi.changePassword({
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword
      });
      setPw(changePasswordFormDefaults);
      setPwDone(true);
      toast({ title: 'Password changed', variant: 'success' });
    } catch (error) {
      setPwError(error instanceof ApiError ? error.userMessage : 'Could not change your password.');
    } finally {
      setPwBusy(false);
    }
  };

  const handleExport = async () => {
    setExportBusy(true);
    try {
      const data = await settingsApi.exportData(session);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `life-style-export-${data.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({
        title: 'Export ready',
        description:
          'Note: the backend export covers profile, sessions, categories, and push devices — not tasks or money data.',
        variant: 'success'
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    } finally {
      setExportBusy(false);
    }
  };

  const handleScheduleDeletion = async () => {
    try {
      const result = await settingsApi.scheduleDeletion(session);
      setScheduledFor(result.deletionScheduledFor ?? null);
      await refreshUser();
      toast({
        title: 'Account scheduled for deletion',
        description: 'Cancel it any time before the date to keep your account.',
        variant: 'warning'
      });
    } catch (error) {
      toast({
        title: 'Could not schedule deletion',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleCancelDeletion = async () => {
    try {
      await settingsApi.cancelDeletion(session);
      setScheduledFor(null);
      await refreshUser();
      toast({ title: 'Deletion cancelled — your account is active again', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not cancel deletion',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Profile, security, and account lifecycle. Tokens live in memory only — this browser will require a sign-in after every reload."
      />

      {isPendingDeletion ? (
        <div className="mb-6">
          <Alert variant="warning" title="This account is scheduled for deletion">
            <div className="mt-1 space-y-2">
              <p>
                Until you cancel, only profile viewing, export, sign-out, and deletion cancellation
                are available — every other API call is rejected by the backend.
              </p>
              {scheduledFor ? (
                <p className="text-sm">Scheduled for: {scheduledFor}</p>
              ) : (
                <p className="text-sm">
                  The scheduled date is not re-readable after a page reload (no status endpoint).
                </p>
              )}
              <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
                Cancel deletion
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      {/* ---------------------------------- Profile --------------------------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="size-4" aria-hidden="true" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void handleProfileSave(event)} className="space-y-4">
            {profileError ? <Alert variant="error">{profileError}</Alert> : null}
            <div className="space-y-1.5">
              <Label htmlFor="set-name">Display name</Label>
              <Input
                id="set-name"
                value={profile.displayName}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, displayName: event.target.value }))
                }
                maxLength={100}
                required
              />
              {profileErrors.displayName ? (
                <p className="text-xs text-danger">{profileErrors.displayName}</p>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="set-timezone">Timezone</Label>
                <Select
                  id="set-timezone"
                  value={profile.timezone}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, timezone: event.target.value }))
                  }
                >
                  {!timeZones.includes(profile.timezone) ? (
                    <option value={profile.timezone}>{profile.timezone}</option>
                  ) : null}
                  {timeZones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-subtle-foreground">
                  Absolute timestamps are rendered in this zone.
                </p>
                {profileErrors.timezone ? (
                  <p className="text-xs text-danger">{profileErrors.timezone}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-locale">Locale</Label>
                <Input
                  id="set-locale"
                  value={profile.locale}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, locale: event.target.value }))
                  }
                  maxLength={16}
                  placeholder="en"
                />
                {profileErrors.locale ? (
                  <p className="text-xs text-danger">{profileErrors.locale}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-weekstart">Week starts on</Label>
                <Select
                  id="set-weekstart"
                  value={profile.weekStart}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, weekStart: event.target.value }))
                  }
                >
                  {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                {profileErrors.weekStart ? (
                  <p className="text-xs text-danger">{profileErrors.weekStart}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-currency">Default currency</Label>
                <Input
                  id="set-currency"
                  value={profile.defaultCurrency}
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      defaultCurrency: event.target.value.toUpperCase()
                    }))
                  }
                  maxLength={3}
                  required
                />
                {profileErrors.defaultCurrency ? (
                  <p className="text-xs text-danger">{profileErrors.defaultCurrency}</p>
                ) : null}
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={profileBusy} disabled={isPendingDeletion}>
                Save profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* --------------------------------- Security --------------------------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={(event) => void handleChangePassword(event)} className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="size-4" aria-hidden="true" />
              Change password
            </h3>
            {pwError ? <Alert variant="error">{pwError}</Alert> : null}
            {pwDone ? (
              <Alert variant="success" title="Password updated">
                Use the new password the next time you sign in.
              </Alert>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pw-current">Current password</Label>
                <Input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={pw.currentPassword}
                  onChange={(event) =>
                    setPw((current) => ({ ...current, currentPassword: event.target.value }))
                  }
                  required
                />
                {pwErrors.currentPassword ? (
                  <p className="text-xs text-danger">{pwErrors.currentPassword}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-new">New password</Label>
                <Input
                  id="pw-new"
                  type="password"
                  autoComplete="new-password"
                  value={pw.newPassword}
                  onChange={(event) =>
                    setPw((current) => ({ ...current, newPassword: event.target.value }))
                  }
                  required
                />
                <p className="text-xs text-subtle-foreground">
                  At least 10 characters, max 72 bytes; common passwords are rejected.
                </p>
                {pwErrors.newPassword ? (
                  <p className="text-xs text-danger">{pwErrors.newPassword}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-confirm">Confirm new password</Label>
                <Input
                  id="pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={pw.confirmNewPassword}
                  onChange={(event) =>
                    setPw((current) => ({ ...current, confirmNewPassword: event.target.value }))
                  }
                  required
                />
                {pwErrors.confirmNewPassword ? (
                  <p className="text-xs text-danger">{pwErrors.confirmNewPassword}</p>
                ) : null}
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={pwBusy} disabled={isPendingDeletion}>
                Change password
              </Button>
            </div>
          </form>

          <Separator />

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Sessions</h3>
            <p className="text-sm text-muted-foreground">
              Sign out of every device, including this one. The backend revokes all sessions in one
              transaction.
            </p>
            <Button variant="outline" size="sm" onClick={() => setLogoutAllOpen(true)}>
              <LogOut className="size-4" aria-hidden="true" />
              Sign out of all devices
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------- Account --------------------------------- */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="size-4" aria-hidden="true" />
            Your data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Export what the backend provides as JSON: profile, sessions, categories, and push
            devices. (Tasks, projects, money, notes, habits, goals, and events are not included by
            the server’s export endpoint.)
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExport()}
            loading={exportBusy}
          >
            <Download className="size-4" aria-hidden="true" />
            Export my data
          </Button>
        </CardContent>
      </Card>

      {/* --------------------------------- Danger zone ------------------------------- */}
      <Card className="border-danger/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-danger">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isPendingDeletion ? (
            <>
              <p className="text-sm text-muted-foreground">
                Your account is scheduled for deletion
                {scheduledFor ? ` for ${scheduledFor}` : ''}. After the grace period the backend
                removes the account permanently and cannot be undone.
              </p>
              <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
                Cancel scheduled deletion
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Scheduling deletion immediately restricts your account: only export, cancellation,
                and sign-out keep working until the account is permanently removed after the grace
                period (14 days — the OpenAPI document’s “30 days” is wrong).
              </p>
              <Button variant="danger" size="sm" onClick={() => setScheduleOpen(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                Schedule account deletion
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={logoutAllOpen}
        onClose={() => setLogoutAllOpen(false)}
        onConfirm={() => void signOutAllDevices()}
        title="Sign out of all devices?"
        description="Every session — including this browser — will be revoked and you will return to the sign-in page."
        confirmLabel="Sign out everywhere"
        danger
      />

      <ConfirmDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onConfirm={handleScheduleDeletion}
        title="Schedule account deletion?"
        description={
          <div className="space-y-2 text-sm">
            <p>
              Your account will be marked <code>pending_deletion</code> right away. Until you
              cancel, almost every API call is rejected (the backend blocks all non-exempt
              endpoints).
            </p>
            <p>After the 14-day grace period, deletion is permanent and cannot be undone.</p>
            <p>You can cancel any time from this page.</p>
          </div>
        }
        confirmLabel="Schedule deletion"
        danger
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={handleCancelDeletion}
        title="Cancel scheduled deletion?"
        description="Your account returns to normal immediately and all features become available again."
        confirmLabel="Keep my account"
      />
    </div>
  );
}
