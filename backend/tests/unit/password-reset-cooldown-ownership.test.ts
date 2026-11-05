import { describe, expect, it, vi } from 'vitest';
import { PasswordResetProcessor } from '../../src/features/auth/password-reset.processor.js';

function fixture() {
  const otp = {
    checkCooldown: vi.fn(async () => true),
    acquireCooldown: vi.fn(async () => 'owner-a'),
    releaseCooldown: vi.fn(async () => true),
    generateAndStoreCode: vi.fn(async (_userId: string, _owner?: string) => '123456'),
    verifyAndConsumeCode: vi.fn(async () => false)
  };
  const sender = {
    sendPasswordResetEmail: vi.fn(async () => {}),
    sendReminderEmail: vi.fn(async () => {})
  };
  const audit = { log: vi.fn(async () => {}) };
  const repo = {
    findUserByEmail: vi.fn(async () => ({
      id: 'user-1',
      email: 'user@example.com',
      status: 'active'
    }))
  };
  return { otp, sender, audit, processor: new PasswordResetProcessor(repo, otp, sender, audit) };
}

describe('pre-delivery reset cooldown ownership', () => {
  it('releases its own cooldown after issuance fails before SMTP starts', async () => {
    const f = fixture();
    const failure = new Error('redis failed');
    f.otp.generateAndStoreCode.mockRejectedValueOnce(failure);
    await expect(
      f.processor.process('user@example.com', { recordId: 'record', attempt: 1 })
    ).rejects.toBe(failure);
    expect(f.otp.acquireCooldown).toHaveBeenCalledWith('user-1');
    expect(f.otp.generateAndStoreCode).toHaveBeenCalledWith('user-1', 'owner-a');
    expect(f.otp.releaseCooldown).toHaveBeenCalledWith('user-1', 'owner-a');
    expect(f.sender.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('does not release the cooldown after an ambiguous SMTP failure', async () => {
    const f = fixture();
    f.sender.sendPasswordResetEmail.mockRejectedValueOnce(new Error('provider error'));
    await expect(
      f.processor.process('user@example.com', { recordId: 'record', attempt: 1 })
    ).rejects.toThrow('PASSWORD_RESET_DELIVERY_FAILED');
    expect(f.otp.generateAndStoreCode).toHaveBeenCalledWith('user-1', 'owner-a');
    expect(f.otp.releaseCooldown).not.toHaveBeenCalled();
  });

  it('preserves the original issuance failure if cooldown cleanup also fails', async () => {
    const f = fixture();
    const failure = new Error('issuance failed');
    f.otp.generateAndStoreCode.mockRejectedValueOnce(failure);
    f.otp.releaseCooldown.mockRejectedValueOnce(new Error('private provider details'));
    await expect(
      f.processor.process('user@example.com', { recordId: 'record', attempt: 1 })
    ).rejects.toBe(failure);
    expect(f.otp.releaseCooldown).toHaveBeenCalledWith('user-1', 'owner-a');
    expect(f.sender.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
