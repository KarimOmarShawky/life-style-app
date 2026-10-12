/**
 * src/jobs/email-queue.ts
 *
 * Implements Section 11: asynchronous email dispatch through the background
 * worker. `QueuedEmailSender` keeps the `EmailSender` contract used by
 * auth.service, so the password-reset flow is unchanged: the code is generated
 * and stored synchronously, and only the delivery moves onto the queue. Job
 * payloads are deleted from Redis as soon as they are processed
 * (`removeOnComplete/RemoveOnFail: true`).
 */

import { Queue } from 'bullmq';
import type { EmailSender } from '../infrastructure/external/email-sender.js';
import { logger } from '../core/logger/logger.js';

export interface PasswordResetEmailJob {
  to: string;
  code: string;
}

export interface EmailJobQueue {
  enqueuePasswordReset(payload: PasswordResetEmailJob): Promise<void>;
}

export const EMAIL_QUEUE_NAME = 'email';

/** BullMQ-backed email queue. */
export class BullEmailQueue implements EmailJobQueue {
  constructor(private readonly queue: Queue<PasswordResetEmailJob>) {}

  public static create(connection: unknown): BullEmailQueue {
    const queue = new Queue<PasswordResetEmailJob>(EMAIL_QUEUE_NAME, {
      connection: connection as never,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true
      }
    });
    return new BullEmailQueue(queue);
  }

  public async enqueuePasswordReset(payload: PasswordResetEmailJob): Promise<void> {
    await this.queue.add('password-reset', payload);
  }

  public async close(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * Wraps a real `EmailSender` and defers delivery to the queue. If the queue is
 * unreachable the email is sent synchronously so users are never left without a
 * reset code.
 */
export class QueuedEmailSender implements EmailSender {
  constructor(
    private readonly queue: EmailJobQueue,
    private readonly fallback: EmailSender
  ) {}

  public async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    try {
      await this.queue.enqueuePasswordReset({ to, code });
    } catch (err) {
      logger.warn('Email queue unavailable; sending password reset email synchronously', {
        err: String(err)
      });
      await this.fallback.sendPasswordResetEmail(to, code);
    }
  }

  public async sendReminderEmail(to: string, subject: string, body: string): Promise<void> {
    // Reminder emails are dispatched by the worker with the direct sender; the
    // API process only falls back to synchronous delivery here.
    await this.fallback.sendReminderEmail(to, subject, body);
  }
}
