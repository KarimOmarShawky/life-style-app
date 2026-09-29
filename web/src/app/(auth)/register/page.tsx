import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { RegisterForm } from '@/features/auth/forms';
import { AUTH_ROUTES } from '@/lib/config/routes';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage() {
  return (
    <Suspense>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 id="register-title" className="text-2xl font-semibold tracking-tight text-foreground">
            Create your account
          </h1>
          <p className="text-sm text-muted-foreground">
            Start planning, focusing, and reviewing your life in one place.
          </p>
        </div>
        <RegisterForm />
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href={AUTH_ROUTES.login} className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </Suspense>
  );
}
