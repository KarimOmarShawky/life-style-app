'use client';

/**
 * Auth forms (sign-in, registration, password recovery) — react-hook-form +
 * Zod, accessible field wiring, safe error feedback.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useForm,
  FormProvider,
  type FieldValues,
  type Path,
  type UseFormSetError
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, MailCheck } from 'lucide-react';
import { authApi } from './api';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type ForgotPasswordFormValues,
  type LoginFormValues,
  type RegisterFormValues,
  type ResetPasswordFormValues
} from './schemas';
import { useAuth } from '@/lib/auth/auth-provider';
import { ApiError, fieldErrorsOf } from '@/lib/api/errors';
import { safeInternalPath, AUTH_ROUTES } from '@/lib/config/routes';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';

function useSubmitHandler() {
  const [formError, setFormError] = useState<string | null>(null);
  return { formError, setFormError };
}

function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>
): void {
  const fields = fieldErrorsOf(error);
  for (const [name, message] of Object.entries(fields)) {
    setError(name as Path<T>, { type: 'server', message });
  }
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.userMessage : 'Something went wrong. Please try again.';
}

/* ---------------------------------- Login --------------------------------- */

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useAuth();
  const { formError, setFormError } = useSubmitHandler();
  const [busy, setBusy] = useState(false);

  const methods = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' }
  });

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    setBusy(true);
    try {
      const result = await authApi.login({ email: values.email, password: values.password });
      signIn(result.tokens, result.user);
      const next = safeInternalPath(searchParams.get('next')) ?? '/';
      router.replace(next);
      router.refresh();
    } catch (error) {
      applyFieldErrors(error, methods.setError);
      setFormError(messageOf(error));
    } finally {
      setBusy(false);
    }
  });

  return (
    <FormProvider {...methods}>
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-labelledby="login-title">
        {formError ? (
          <Alert variant="error" title="Sign-in failed">
            {formError}
          </Alert>
        ) : null}
        <FormField<LoginFormValues> name="email" label="Email" required>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          )}
        </FormField>
        <FormField<LoginFormValues> name="password" label="Password" required>
          {(props) => <Input {...props} type="password" autoComplete="current-password" required />}
        </FormField>
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>
    </FormProvider>
  );
}

/* -------------------------------- Register -------------------------------- */

export function RegisterForm() {
  const router = useRouter();
  const { signIn } = useAuth();
  const { formError, setFormError } = useSubmitHandler();
  const [busy, setBusy] = useState(false);

  const methods = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' }
  });

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    setBusy(true);
    try {
      const result = await authApi.register({
        email: values.email,
        password: values.password,
        displayName: values.displayName,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      });
      signIn(result.tokens, result.user);
      router.replace('/');
      router.refresh();
    } catch (error) {
      applyFieldErrors(error, methods.setError);
      setFormError(messageOf(error));
    } finally {
      setBusy(false);
    }
  });

  return (
    <FormProvider {...methods}>
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-labelledby="register-title">
        {formError ? (
          <Alert variant="error" title="Registration failed">
            {formError}
          </Alert>
        ) : null}
        <FormField<RegisterFormValues> name="displayName" label="Display name" required>
          {(props) => <Input {...props} autoComplete="name" maxLength={100} required />}
        </FormField>
        <FormField<RegisterFormValues> name="email" label="Email" required>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          )}
        </FormField>
        <FormField<RegisterFormValues>
          name="password"
          label="Password"
          required
          hint="At least 10 characters, up to 72 bytes."
        >
          {(props) => <Input {...props} type="password" autoComplete="new-password" required />}
        </FormField>
        <FormField<RegisterFormValues> name="confirmPassword" label="Confirm password" required>
          {(props) => <Input {...props} type="password" autoComplete="new-password" required />}
        </FormField>
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </FormProvider>
  );
}

/* ----------------------------- Forgot password ---------------------------- */

export function ForgotPasswordForm() {
  const { formError, setFormError } = useSubmitHandler();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const methods = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' }
  });

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    setBusy(true);
    try {
      await authApi.forgotPassword({ email: values.email });
      setSent(true);
    } catch (error) {
      applyFieldErrors(error, methods.setError);
      setFormError(messageOf(error));
    } finally {
      setBusy(false);
    }
  });

  if (sent) {
    return (
      <div className="space-y-4">
        <Alert variant="success" title="Check your email">
          <span className="flex items-center gap-2">
            <MailCheck className="size-4" aria-hidden="true" />
            If an account exists for that address, a 6-digit reset code is on its way. Codes expire
            quickly — check your spam folder if you don’t see it.
          </span>
        </Alert>
        <div className="flex items-center justify-between">
          <Link
            href={AUTH_ROUTES.resetPassword}
            className="text-sm font-medium text-primary hover:underline"
          >
            I have a code →
          </Link>
          <Button variant="outline" size="sm" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError ? (
          <Alert variant="error" title="Request failed">
            {formError}
          </Alert>
        ) : null}
        <FormField<ForgotPasswordFormValues> name="email" label="Email" required>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          )}
        </FormField>
        <Button type="submit" className="w-full" loading={busy}>
          Send reset code
        </Button>
      </form>
    </FormProvider>
  );
}

/* ----------------------------- Reset password ----------------------------- */

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { formError, setFormError } = useSubmitHandler();
  const [busy, setBusy] = useState(false);

  const methods = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      email: searchParams.get('email') ?? '',
      code: '',
      newPassword: '',
      confirmPassword: ''
    }
  });

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    setBusy(true);
    try {
      await authApi.resetPassword({
        email: values.email,
        code: values.code,
        newPassword: values.newPassword
      });
      router.replace(AUTH_ROUTES.login);
    } catch (error) {
      applyFieldErrors(error, methods.setError);
      setFormError(messageOf(error));
    } finally {
      setBusy(false);
    }
  });

  return (
    <FormProvider {...methods}>
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-labelledby="reset-title">
        {formError ? (
          <Alert variant="error" title="Reset failed">
            {formError}
          </Alert>
        ) : null}
        <FormField<ResetPasswordFormValues> name="email" label="Email" required>
          {(props) => <Input {...props} type="email" autoComplete="email" required />}
        </FormField>
        <FormField<ResetPasswordFormValues>
          name="code"
          label="6-digit code"
          required
          hint="Sent to your email by the password-reset request."
        >
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              required
            />
          )}
        </FormField>
        <FormField<ResetPasswordFormValues>
          name="newPassword"
          label="New password"
          required
          hint="At least 10 characters, up to 72 bytes."
        >
          {(props) => <Input {...props} type="password" autoComplete="new-password" required />}
        </FormField>
        <FormField<ResetPasswordFormValues>
          name="confirmPassword"
          label="Confirm new password"
          required
        >
          {(props) => <Input {...props} type="password" autoComplete="new-password" required />}
        </FormField>
        <Button type="submit" className="w-full" loading={busy}>
          Reset password
        </Button>
      </form>
    </FormProvider>
  );
}
