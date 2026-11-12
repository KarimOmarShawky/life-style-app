import '../infrastructure-safety.js';
/**
 * tests/integration/ai-assistant-flow.test.ts
 *
 * Hybrid AI slice AI-2b on PostgreSQL: the assistant turn reads context only
 * after the durable consent, only for the signed-in user, and never notes or
 * task descriptions. The AI provider is a fake that records what it would
 * have sent; nothing leaves the test.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';
import { getUserTodayDate } from '../../src/core/time/date-utils.js';
import { AiService } from '../../src/features/ai/ai.service.js';
import type { GeminiClient, GeminiGenerateInput } from '../../src/features/ai/gemini-client.js';
import { GeminiAiProvider } from '../../src/features/ai/providers/gemini.adapter.js';

const PASSWORD = 'ValidUserPassword123!';

describe('AI assistant turn with server-side context (AI-2b) on PostgreSQL', () => {
  const sent: GeminiGenerateInput[] = [];
  const client: GeminiClient = {
    generateText: vi.fn(async (input: GeminiGenerateInput) => {
      sent.push(input);
      return 'OK';
    }),
    streamText: vi.fn(async function* () {
      yield 'OK';
    })
  };
  const app = createApp({ aiService: new AiService(new GeminiAiProvider(client), true) });
  const pool = getPgPool();
  const redis = getRedisClient();

  beforeEach(async () => {
    sent.length = 0;
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    const container = getContainer();
    if ('clear' in container.rateLimiter && typeof container.rateLimiter.clear === 'function') {
      container.rateLimiter.clear();
    }
  });

  async function register(email: string): Promise<string> {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: PASSWORD,
      displayName: 'Assistant User',
      timezone: 'Africa/Cairo',
      defaultCurrency: 'USD'
    });
    expect(res.status).toBe(201);
    return (res.body.data as { tokens: { accessToken: string } }).tokens.accessToken;
  }

  async function seed(token: string, prefix: string): Promise<void> {
    const today = getUserTodayDate('Africa/Cairo', new Date());
    const auth = { Authorization: `Bearer ${token}` };
    const task = await request(app)
      .post('/api/v1/tasks')
      .set(auth)
      .send({ title: `${prefix} task`, description: `${prefix} PRIVATE-DESC`, dueDate: today });
    expect(task.status).toBe(201);
    const goal = await request(app)
      .post('/api/v1/goals')
      .set(auth)
      .send({ title: `${prefix} goal`, progressType: 'milestones' });
    expect(goal.status).toBe(201);
    const event = await request(app)
      .post('/api/v1/events')
      .set(auth)
      .send({
        title: `${prefix} event`,
        location: `${prefix} PRIVATE-LOCATION`,
        startAt: `${today}T08:00:00.000Z`,
        endAt: `${today}T09:00:00.000Z`,
        allDay: false,
        timezone: 'UTC'
      });
    expect(event.status).toBe(201);
    const note = await request(app)
      .post('/api/v1/notes')
      .set(auth)
      .send({ title: `${prefix} note`, body: `${prefix} PRIVATE-NOTE` });
    expect(note.status).toBe(201);
  }

  const turn = (token: string, body: object) =>
    request(app)
      .post('/api/v1/ai/assistant/turn')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const consent = (token: string, version: number | null) =>
    request(app)
      .patch('/api/v1/ai/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ egressConsentVersion: version });

  const allScopes = ['today', 'tasks', 'habits', 'goals', 'calendar'];
  const contextOf = (input: GeminiGenerateInput): string =>
    input.contents[input.contents.length - 1]!.parts[0]!.text;

  it('denies context until the account consents, then sends only that account’s data', async () => {
    const tokenA = await register('assistant-a@example.com');
    const tokenB = await register('assistant-b@example.com');
    await seed(tokenA, 'Alpha');
    await seed(tokenB, 'Bravo');

    const denied = await turn(tokenA, { message: 'Plan my day', contextScopes: allScopes });
    expect(denied.status).toBe(200);
    expect(denied.body.data).toEqual({ type: 'unsupported_or_denied', reason: 'consent_required' });
    expect(sent).toHaveLength(0);

    expect((await consent(tokenA, 1)).status).toBe(200);
    const answered = await turn(tokenA, { message: 'Plan my day', contextScopes: allScopes });
    expect(answered.status).toBe(200);
    expect(answered.body.data).toEqual({ type: 'answer', text: 'OK', language: null });
    expect(sent).toHaveLength(1);
    const contextA = contextOf(sent[0]!);
    expect(contextA).toContain('Alpha task');
    expect(contextA).toContain('Alpha goal');
    expect(contextA).toContain('Alpha event');
    expect(contextA).not.toContain('Bravo');
    expect(contextA).not.toContain('PRIVATE-DESC');
    expect(contextA).not.toContain('PRIVATE-LOCATION');
    expect(contextA).not.toContain('Alpha note');
    expect(contextA).not.toContain('PRIVATE-NOTE');
    expect(sent[0]!.systemInstruction).not.toContain('Alpha');

    // B has not consented: A's consent does not open B's data.
    const deniedB = await turn(tokenB, { message: 'Plan my day', contextScopes: ['tasks'] });
    expect(deniedB.body.data.reason).toBe('consent_required');
    expect(sent).toHaveLength(1);

    expect((await consent(tokenB, 1)).status).toBe(200);
    await turn(tokenB, { message: 'Plan my day', contextScopes: ['tasks'] });
    expect(sent).toHaveLength(2);
    const contextB = contextOf(sent[1]!);
    expect(contextB).toContain('Bravo task');
    expect(contextB).not.toContain('Alpha');
    expect(contextB).not.toContain('Bravo goal');
  });

  it('stops sending context as soon as the consent is withdrawn', async () => {
    const token = await register('assistant-withdraw@example.com');
    await seed(token, 'Charlie');
    expect((await consent(token, 1)).status).toBe(200);
    expect((await turn(token, { message: 'Hi', contextScopes: ['tasks'] })).body.data.type).toBe(
      'answer'
    );
    expect((await consent(token, null)).status).toBe(200);
    const after = await turn(token, { message: 'Hi', contextScopes: ['tasks'] });
    expect(after.body.data).toEqual({ type: 'unsupported_or_denied', reason: 'consent_required' });
    // A turn without context still works without consent.
    const plain = await turn(token, { message: 'Hi' });
    expect(plain.body.data.type).toBe('answer');
    expect(contextOf(sent[sent.length - 1]!)).toBe('Hi');
  });
});
