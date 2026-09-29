import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '@/features/auth/forms';
import { envelopeError, tokenPairFixture, userFixture } from '../fixtures/dto';

const replace = vi.fn();
const refresh = vi.fn();
const signIn = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh, prefetch: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(window.location.search)
}));

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ signIn, signOut: vi.fn(), status: 'anonymous', user: null, session: null })
}));

let fetchMock: ReturnType<typeof vi.fn>;
let search = '';

beforeEach(() => {
  replace.mockClear();
  refresh.mockClear();
  signIn.mockClear();
  search = '?next=/tasks';
  window.history.replaceState({}, '', `/login${search}`);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function renderLogin() {
  return render(<LoginForm />);
}

describe('LoginForm integration', () => {
  it('validates client-side before touching the network', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findAllByText(/required|invalid/i)).not.toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts credentials to the relative /api/v1 endpoint and redirects to the internal next path', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: userFixture, tokens: tokenPairFixture }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'demo@example.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'northwind2026');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(url).not.toMatch(/^https?:/);
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('demo@example.test');
    // No access token exists yet — nothing to leak.
    expect(String(init.body)).not.toContain(tokenPairFixture.accessToken);
    // Redirect target is the internal path from ?next=
    expect(replace).toHaveBeenCalledWith('/tasks');
  });

  it('never redirects to an external ?next= target', async () => {
    window.history.replaceState({}, '', '/login?next=https%3A%2F%2Fevil.example');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: userFixture, tokens: tokenPairFixture }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'demo@example.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'northwind2026');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalledWith('https://evil.example');
    expect(replace.mock.calls[0]?.[0]).toBe('/'); // unsafe next falls back to home
  });

  it('shows a safe message on invalid credentials', async () => {
    fetchMock.mockResolvedValue(
      new Response(envelopeError('INVALID_CREDENTIALS', 'password hash mismatch at line 91'), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'demo@example.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrongpassword1');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain('Incorrect email or password');
    expect(alert).not.toContain('password hash');
    expect(alert).not.toContain('line 91');
    expect(signIn).not.toHaveBeenCalled();
  });
});
