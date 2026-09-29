import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/providers/toast-provider';
import { TasksView } from '@/features/tasks/tasks-view';
import { envelopeError, taskListFixture, tokenPairFixture, userFixture } from '../fixtures/dto';

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
  if (path.includes('/api/v1/tasks')) {
    if (path.includes('cursor=')) {
      return ok({ data: [], meta: { limit: 25, hasMore: false, nextCursor: null } });
    }
    return ok(taskListFixture);
  }
  if (path.includes('/api/v1/projects')) {
    return ok({ data: [], meta: { limit: 25, hasMore: false, nextCursor: null } });
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
        <TasksView />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('TasksView integration (DTO fixtures)', () => {
  it('renders tasks from the verified {data, meta} list shape', async () => {
    renderView();
    expect(await screen.findByText('Write quarterly report')).toBeInTheDocument();
    expect(screen.getByText('Book dentist')).toBeInTheDocument();
    // Pagination offered because meta.hasMore is true.
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('sends the cursor when paging forward', async () => {
    renderView();
    await screen.findByText('Write quarterly report');
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => {
      const paged = fetchMock.mock.calls.find(([url]) => String(url).includes('cursor=cursor-abc'));
      expect(paged).toBeTruthy();
    });
  });

  it('toggles done with optimistic-concurrency version via PATCH', async () => {
    renderView();
    await screen.findByText('Write quarterly report');

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return ok({ task: taskListFixture.data[0] });
      return routeFetch(String(url));
    });

    await userEvent.click(
      screen.getByRole('checkbox', { name: /mark “write quarterly report” as done/i })
    );

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
      );
      expect(patch).toBeTruthy();
      const [url, init] = patch as [string, RequestInit];
      expect(url).toContain('/api/v1/tasks/22222222-2222-4222-8222-222222222222');
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${tokenPairFixture.accessToken}`);
      expect(JSON.parse(String(init.body)).version).toBe(3);
      expect(JSON.parse(String(init.body)).status).toBe('done');
    });
  });

  it('deletes only after explicit confirmation', async () => {
    renderView();
    await screen.findByText('Write quarterly report');

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return routeFetch(String(url));
    });

    await userEvent.click(screen.getByRole('button', { name: /delete “write quarterly report”/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/delete this task/i)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
      )
    ).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
      );
      expect(del).toBeTruthy();
      expect(String(del![0])).toContain('/api/v1/tasks/22222222-2222-4222-8222-222222222222');
    });
  });

  it('shows a safe error state when the backend rejects the list', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/v1/tasks')) {
        return new Response(envelopeError('INTERNAL_ERROR', 'MongoCursorNotFound: gone'), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return routeFetch(String(url));
    });
    renderView();
    const alerts = await screen.findAllByRole('alert');
    const text = alerts.map((node) => node.textContent ?? '').join(' ');
    expect(text).toMatch(/Unable to reach the server|try again/i);
    expect(text).not.toContain('MongoCursorNotFound');
  });
});
