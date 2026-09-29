import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '@/providers/app-providers';
import '@/styles/globals.css';

/**
 * Render on every request: the CSP is nonce-based, and a nonce can only be
 * injected into <script> tags when the HTML is produced per-request. Statically
 * prerendered HTML would ship without nonces and `strict-dynamic` would block
 * all scripts.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: {
    default: 'LifeStyle',
    template: '%s · LifeStyle'
  },
  description: 'LifeStyle — personal life operating system (web client).',
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#315C4C'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
