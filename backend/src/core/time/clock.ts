/**
 * src/core/time/clock.ts
 *
 * Implements Section 7.1 & ADR-010: Clock abstraction for deterministic time handling.
 * Prevents naive usage of system wall clock and supports precise simulation in test suites.
 */

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  private currentTime: Date;

  constructor(initialTime?: Date) {
    this.currentTime = initialTime ? new Date(initialTime) : new Date('2026-09-24T12:00:00.000Z');
  }

  public now(): Date {
    return new Date(this.currentTime);
  }

  public set(time: Date | string): void {
    this.currentTime = new Date(time);
  }

  public advance(milliseconds: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + milliseconds);
  }

  public advanceMinutes(minutes: number): void {
    this.advance(minutes * 60 * 1000);
  }

  public advanceHours(hours: number): void {
    this.advance(hours * 60 * 60 * 1000);
  }

  public advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60 * 1000);
  }
}
