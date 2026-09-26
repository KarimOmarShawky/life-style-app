/**
 * MongoDB connection (spec section 7).
 *
 * MongoDB holds the two parts of this model that are genuinely document-shaped:
 * notes and the audit log. See docs/database/database-overview.md for the full
 * reasoning and for what was deliberately NOT moved here.
 *
 * Optional in development for the same reason as Redis, required in production.
 * When it is absent, note and audit endpoints return 503 rather than crashing
 * the process, so the rest of the API stays usable.
 */
import mongoose from 'mongoose';

import { config } from '@/config';
import { createLogger, maskConnectionString } from '@/core/logger';

const log = createLogger('mongodb');

let connected = false;

export function isMongoConnected(): boolean {
  // readyState 1 is "connected". Checking the driver rather than our own flag
  // means a connection lost after startup reports accurately.
  return connected && mongoose.connection.readyState === 1;
}

export async function connectMongo(): Promise<void> {
  if (!config.MONGODB_URI) {
    log.warn('MONGODB_URI not set: notes and the audit log are unavailable in this process');
    return;
  }

  // Reject anything not in a schema. Without this, a document written through a
  // path the schema does not declare is silently persisted, which is how an
  // injected field ends up stored (spec section 15).
  mongoose.set('strictQuery', true);

  mongoose.connection.on('error', (error: Error) => {
    log.error({ err: error }, 'MongoDB connection error');
  });

  mongoose.connection.on('disconnected', () => {
    connected = false;
    log.warn('MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    connected = true;
    log.info('MongoDB reconnected');
  });

  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: config.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
      // Writes are acknowledged by a majority before returning. The default is
      // weaker; for an audit trail that must survive a primary failover,
      // majority is the correct durability setting.
      writeConcern: { w: 'majority' },
      autoIndex: config.NODE_ENV !== 'production',
    });

    connected = true;
    log.info({ uri: maskConnectionString(config.MONGODB_URI) }, 'MongoDB connected');
  } catch (error) {
    connected = false;
    log.error({ err: error }, 'MongoDB unavailable at startup; continuing in degraded mode');
  }
}

export async function pingMongo(): Promise<boolean> {
  if (!isMongoConnected()) {
    return false;
  }
  try {
    await mongoose.connection.db?.admin().ping();
    return true;
  } catch {
    return false;
  }
}

export async function closeMongo(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    return;
  }
  await mongoose.connection.close(false);
  connected = false;
  log.info('MongoDB connection closed');
}

export { mongoose };
