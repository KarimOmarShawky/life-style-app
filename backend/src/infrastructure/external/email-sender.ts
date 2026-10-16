/** SMTP delivery acknowledges only an accepted recipient; secrets stay in memory. */
import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '../../config/env.js';

export interface EmailSender {
  sendPasswordResetEmail(to: string, code: string): Promise<void>;
  sendReminderEmail(to: string, subject: string, body: string): Promise<void>;
}

export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(transport?: Transporter) {
    const env = getEnv();
    this.from = env.EMAIL_FROM;
    this.transport =
      transport ??
      nodemailer.createTransport({
        host: env.EMAIL_HOST,
        port: env.EMAIL_PORT,
        secure: env.EMAIL_PORT === 465,
        requireTLS: env.NODE_ENV === 'production',
        auth: env.EMAIL_USER ? { user: env.EMAIL_USER, pass: env.EMAIL_PASSWORD } : undefined,
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        logger: false,
        debug: false
      });
  }

  public async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    await this.sendRaw(
      to,
      'Your LifeStyle App Password Reset Code',
      `Your 6-digit password reset code is: ${code}\n\nThis code is valid for 15 minutes.\nIf you did not request this reset, please ignore this email.`
    );
  }

  public async sendReminderEmail(to: string, subject: string, body: string): Promise<void> {
    await this.sendRaw(to, subject, body);
  }

  private async sendRaw(to: string, subject: string, text: string): Promise<void> {
    try {
      const result = await this.transport.sendMail({ from: this.from, to, subject, text });
      if (!result.accepted?.length || result.rejected?.length) throw new Error('Rejected');
    } catch {
      // Provider exceptions can contain SMTP commands/addresses. Never propagate them.
      throw new Error('EMAIL_DELIVERY_FAILED');
    }
  }
}
