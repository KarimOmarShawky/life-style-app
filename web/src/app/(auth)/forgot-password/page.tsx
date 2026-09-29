import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ForgotPasswordForm } from '@/features/auth/forms';
import { AUTH_ROUTES } from '@/lib/config/routes';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Forgot your password?
          </h1>
          <p className="text-sm text-muted-foreground">
            We’ll email you a 6-digit code to reset it.
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-sm text-muted-foreground">
          Remembered it?{' '}
          <Link href={AUTH_ROUTES.login} className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </Suspense>
  );
}
