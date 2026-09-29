import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/providers/toast-provider';
import { TransactionsView } from '@/features/money/transactions-view';
import {
  categoryFixture,
  tokenPairFixture,
  transactionFixture,
  userFixture
} from '../fixtures/dto';

const session = {
  getAccessToken: () => tokenPairFixture.accessToken,
  getRefreshToken: () => tokenPairFixture.refreshToken,
  setTokens: vi.fn(),
  isAccessTokenExpired: () => false,
  refreshAccessToken: vi.fn(async () => tokenPairFixture.accessToken),
  clear: vi.fn(),
  endSession: vi.fn()
};

vi.mock('@/lib/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'authenticated', user: userFixture, session })
}));

let fetchMock: ReturnType<typeof vi.fn>;

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function routeFetch(url: string): Response {
  const path = String(url);
  if (path.includes('/money/categories')) return ok({ categories: [categoryFixture] });
  if (path.includes('/money/transactions')) {
    return ok({
      transactions: [transactionFixture],
      meta: { limit: 25, hasMore: false, nextCursor: null }
    });
  }
  return ok({});
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => routeFetch(url));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TransactionsView />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('TransactionsView integration', () => {
  it('renders exact decimal amounts from the DTO (no float rounding)', async () => {
    renderView();
    expect(await screen.findByText(/1,234\.56/)).toBeInTheDocument();
    expect(screen.getByText('Weekly groceries')).toBeInTheDocument();
    expect(screen.getAllByText('Groceries').length).toBeGreaterThan(0);
  });

  it('creates a transaction with a UUID Idempotency-Key and string amount', async () => {
    renderView();
    await screen.findByText(/1,234\.56/);

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url).includes('/money/transactions')) {
        return ok({ transaction: { ...transactionFixture, amount: '99.99' } }, 201);
      }
      return routeFetch(String(url));
    });

    await userEvent.click(screen.getByRole('button', { name: /new transaction/i }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(screen.getByLabelText(/^amount/i), '99.99');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          init?.method === 'POST' && String(url).includes('/api/v1/money/transactions')
      );
      expect(post).toBeTruthy();
      const [url, init] = post as [string, RequestInit];
      expect(url).toBe('/api/v1/money/transactions');
      const headers = init.headers as Record<string, string>;
      // Backend requires an Idempotency-Key UUID on this exact route.
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(headers.Authorization).toBe(`Bearer ${tokenPairFixture.accessToken}`);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.amount).toBe('99.99'); // decimal STRING, never a float
      expect(typeof body.amount).toBe('string');
      expect(body.currency).toBe('USD');
      expect(String(body.occurredOn)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    // dialog closes after success
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(dialog).toBeTruthy();
  });

  it('explains version conflicts without overwriting', async () => {
    renderView();
    const first = await screen.findByText(/1,234\.56/);
    expect(first).toBeInTheDocument();

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return ok(
          {
            success: false,
            error: {
              code: 'VERSION_CONFLICT',
              message: 'version mismatch',
              requestId: 'req-vc'
            }
          },
          409
        );
      }
      return routeFetch(String(url));
    });

    await userEvent.click(screen.getByRole('button', { name: /edit transaction/i }));
    await screen.findByRole('dialog');
    const amountInput = screen.getByLabelText(/^amount/i);
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '5');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/someone changed this transaction/i)).toBeInTheDocument();
    // No second PATCH after the conflict (user must reload first).
    const patches = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
    );
    expect(patches).toHaveLength(1);
  });
});
