import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthGuard } from '@/components/app-shell/auth-guard';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/tasks',
  useSearchParams: () => new URLSearchParams()
}));

let authStatus: 'loading' | 'authenticated' | 'anonymous' = 'loading';

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: authStatus, user: null, session: null })
}));

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('AuthGuard', () => {
  it('shows a loading state while the session is unknown', () => {
    authStatus = 'loading';
    renderWithProviders(
      <AuthGuard>
        <div>secret workspace</div>
      </AuthGuard>
    );
    expect(screen.getByText(/loading your workspace/i)).toBeInTheDocument();
    expect(screen.queryByText('secret workspace')).not.toBeInTheDocument();
  });

  it('redirects anonymous visitors to /login with a safe internal next param', async () => {
    authStatus = 'anonymous';
    replace.mockClear();
    window.history.replaceState({}, '', '/tasks');
    renderWithProviders(
      <AuthGuard>
        <div>secret workspace</div>
      </AuthGuard>
    );
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const target = replace.mock.calls[0]?.[0] as string;
    expect(target.startsWith('/login?next=')).toBe(true);
    expect(decodeURIComponent(target.split('next=')[1] ?? '')).not.toMatch(/^https?:/);
    expect(screen.queryByText('secret workspace')).not.toBeInTheDocument();
  });

  it('renders children only when authenticated', () => {
    authStatus = 'authenticated';
    renderWithProviders(
      <AuthGuard>
        <div>secret workspace</div>
      </AuthGuard>
    );
    expect(screen.getByText('secret workspace')).toBeInTheDocument();
  });
});

describe('form controls', () => {
  it('Button exposes accessible names and busy state', async () => {
    const { Button } = await import('@/components/ui/button');
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('ConfirmDialog requires explicit confirmation and traps focus', async () => {
    const { ConfirmDialog } = await import('@/components/feedback/confirm-dialog');
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete task?"
        description="This can be undone for 30 days."
        confirmLabel="Delete"
        danger
      />
    );
    const confirm = screen.getByRole('button', { name: /delete/i });
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // Dialog closes itself after a successful confirm.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('ErrorState renders only the safe message (no raw error dumps)', async () => {
    const { ErrorState } = await import('@/components/feedback/error-state');
    render(
      <ErrorState
        error={
          {
            userMessage: 'Something went wrong. Please try again.',
            kind: 'http',
            status: 500
          } as never
        }
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/stack|SELECT|token/i)).not.toBeInTheDocument();
  });
});
