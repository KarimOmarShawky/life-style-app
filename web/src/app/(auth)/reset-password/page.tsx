import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/auth/forms';
import { AUTH_ROUTES } from '@/lib/config/routes';

export const metadata: Metadata = { title: 'Reset password' };

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 id="reset-title" className="text-2xl font-semibold tracking-tight text-foreground">
            Reset your password
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your email along with a new password.
          </p>
        </div>
        <ResetPasswordForm />
        <p className="text-sm text-muted-foreground">
          Need a new code?{' '}
          <Link
            href={AUTH_ROUTES.forgotPassword}
            className="font-medium text-primary hover:underline"
          >
            Request another
          </Link>
        </p>
      </div>
    </Suspense>
  );
}
