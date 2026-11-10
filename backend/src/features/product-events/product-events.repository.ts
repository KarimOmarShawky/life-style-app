/**
 * src/features/product-events/product-events.repository.ts
 */

import type { ProductEventRecord } from './product-events.types.js';

export interface ProductEventsRepository {
  /**
   * Inserts one event unless the account opted out, is not active, already
   * has this event for that local day, or the schema is not applied yet.
   * Returns true only when a row was written.
   */
  record(event: ProductEventRecord): Promise<boolean>;
  /** Retention: hard-deletes events recorded before `cutoff`. */
  purgeOlderThan(cutoff: Date): Promise<number>;
}
