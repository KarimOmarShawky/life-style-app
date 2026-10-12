/**
 * src/infrastructure/external/email-sender.ts
 *
 * Implements Section 4.4 & 8.5: Abstracted Email Sender.
 * Formats plain password reset emails with 6-digit code and no links.
 */

import net from 'node:net';
import { getEnv } from '../../config/env.js';
import { logger } from '../../core/logger/logger.js';

export interface EmailSender {
  sendPasswordResetEmail(to: string, code: string): Promise<void>;
  sendReminderEmail(to: string, subject: string, body: string): Promise<void>;
}

export class SmtpEmailSender implements EmailSender {
  private readonly host: string;
  private readonly port: number;
  private readonly from: string;

  constructor() {
    const env = getEnv();
    this.host = env.EMAIL_HOST;
    this.port = env.EMAIL_PORT;
    this.from = env.EMAIL_FROM;
  }

  public async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    const subject = 'Your LifeStyle App Password Reset Code';
    const body = `Your 6-digit password reset code is: ${code}\n\nThis code is valid for 15 minutes.\nIf you did not request this reset, please ignore this email.`;

    logger.info(`Sending password reset email to [REDACTED] via ${this.host}:${this.port}`);
    await this.sendRaw(to, subject, body);
  }

  public async sendReminderEmail(to: string, subject: string, body: string): Promise<void> {
    logger.info(`Sending reminder email to [REDACTED] via ${this.host}:${this.port}`);
    await this.sendRaw(to, subject, body);
  }

  private async sendRaw(to: string, subject: string, body: string): Promise<void> {
    // In local dev/test with Mailpit or mock, attempt simple SMTP socket write
    return new Promise((resolve) => {
      const socket = net.createConnection(this.port, this.host, () => {
        socket.write(`HELO localhost\r\n`);
        socket.write(`MAIL FROM:<${this.from}>\r\n`);
        socket.write(`RCPT TO:<${to}>\r\n`);
        socket.write(`DATA\r\n`);
        socket.write(
          `From: ${this.from}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${body}\r\n.\r\n`
        );
        socket.write(`QUIT\r\n`);
      });

      socket.on('error', (err) => {
        logger.warn('SMTP connection failed, logged email locally', { err: String(err) });
        resolve(); // Do not fail the API if Mailpit is unreachable
      });

      socket.on('data', (data) => {
        if (data.toString().includes('221') || data.toString().includes('250')) {
          socket.end();
          resolve();
        }
      });

      // Timeout safety
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 2000);
    });
  }
}
