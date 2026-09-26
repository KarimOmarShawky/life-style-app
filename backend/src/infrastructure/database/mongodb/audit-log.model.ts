/**
 * Audit log document (spec section 69).
 *
 * WHY THIS ONE LIVES IN MONGODB
 *
 * Audit entries are append-only, never updated, never joined, and their
 * `metadata` differs per event type: a login records an IP and a user agent, a
 * role change records the old and new roles, a token revocation records a
 * reason. Relationally that is either a sparse table of every column any event
 * might need, or a JSONB blob. It is also the highest-volume write in the system
 * and the one least tolerant of slowing down the request that produces it.
 *
 * WHAT IS NOT RECORDED
 *
 * Never a password, token, secret, OTP, or cookie. `metadata` is a redaction
 * container in the logger config, but this collection is written directly, so
 * callers must pass only what is listed in AuditMetadata. Treat a new field as a
 * privacy decision, not a convenience.
 */
import mongoose, { Schema, model, type Document, type Model } from 'mongoose';

export const AuditAction = {
  USER_REGISTERED: 'user.registered',
  LOGIN_SUCCEEDED: 'auth.login.succeeded',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESHED: 'auth.token.refreshed',
  TOKEN_REUSE_DETECTED: 'auth.token.reuse_detected',
  SESSION_REVOKED: 'auth.session.revoked',
  PASSWORD_CHANGED: 'user.password.changed',
  ACCOUNT_LOCKED: 'user.account.locked',
  ACCOUNT_DISABLED: 'user.account.disabled',
  ROLE_CHANGED: 'user.role.changed',
  AUTHORIZATION_DENIED: 'authz.denied',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export type AuditOutcome = 'success' | 'failure';

export interface AuditLogDocument extends Document {
  action: AuditActionValue;
  outcome: AuditOutcome;
  /** The acting user, when known. Absent for a failed login on an unknown email. */
  actorId: string | null;
  /** What was acted upon, e.g. a session id or another user's id. */
  targetId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    action: {
      type: String,
      required: true,
      enum: Object.values(AuditAction),
      index: true,
    },
    outcome: { type: String, required: true, enum: ['success', 'failure'] },
    actorId: { type: String, default: null, index: true },
    targetId: { type: String, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 500 },
    requestId: { type: String, default: null, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    // Only createdAt: an audit record is never updated, so an updatedAt field
    // would imply a capability that must not exist.
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
    versionKey: false,
    collection: 'audit_logs',
  },
);

// The two investigative questions: "what happened to this account" and "what
// happened during this request".
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

// Retention (spec section 69). Entries expire automatically after two years,
// which enforces data minimization without a cron job to forget to run.
const TWO_YEARS_SECONDS = 60 * 60 * 24 * 365 * 2;
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: TWO_YEARS_SECONDS });

/**
 * Blocks updates at the model level, so append-only is enforced by the code path
 * and not merely by convention. Deletion by the TTL index still works, because
 * that is performed by the server rather than through these hooks.
 */
function rejectMutation(this: unknown, next: (error?: Error) => void): void {
  next(new Error('audit_logs is append-only: entries cannot be modified'));
}

auditLogSchema.pre('updateOne', rejectMutation);
auditLogSchema.pre('updateMany', rejectMutation);
auditLogSchema.pre('findOneAndUpdate', rejectMutation);
auditLogSchema.pre('deleteOne', rejectMutation);
auditLogSchema.pre('deleteMany', rejectMutation);

/**
 * Registered once per process.
 *
 * `mongoose.model()` throws OverwriteModelError if the same name is registered
 * twice, which happens whenever this module is imported into a fresh module
 * registry inside a running process: a test runner loading several files, or a
 * dev server hot-reloading. Reusing an already-compiled model is the documented
 * way to make the module import-safe.
 */
export const AuditLogModel: Model<AuditLogDocument> =
  (mongoose.models['AuditLog'] as Model<AuditLogDocument> | undefined) ??
  model<AuditLogDocument>('AuditLog', auditLogSchema);
