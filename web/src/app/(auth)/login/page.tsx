import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/forms';
import { AUTH_ROUTES } from '@/lib/config/routes';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Suspense>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 id="login-title" className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground">Sign in to your LifeStyle workspace.</p>
        </div>
        <LoginForm />
        <div className="flex items-center justify-between text-sm">
          <Link
            href={AUTH_ROUTES.forgotPassword}
            className="font-medium text-primary hover:underline"
          >
            Forgot password?
          </Link>
          <Link href={AUTH_ROUTES.register} className="font-medium text-primary hover:underline">
            Create account
          </Link>
        </div>
      </div>
    </Suspense>
  );
}
