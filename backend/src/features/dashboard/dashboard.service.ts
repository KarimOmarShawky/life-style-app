/**
 * Home summary assembly.
 *
 * Thin on purpose: the whole of the interesting work is the one statement in the
 * repository, and everything this adds is the window it runs over.
 *
 * NOT CACHED, deliberately (DD-027). The key and a five-minute TTL were sketched
 * in the cache module before any of this existed, and the invalidation hooks are
 * the reason it is not used: a cached summary has to be dropped by every write
 * path in eleven services, and the first one that forgets shows the user a home
 * screen that disagrees with the screen they just came from. That is the same
 * failure mode a stored budget counter has, rejected for the same reason in
 * DD-023. One indexed statement against a hosted database is not the thing worth
 * risking it for.
 */
import { createLogger } from '@/core/logger';

import * as repository from './dashboard.repository';
import { dashboardWindow } from './dashboard.window';
import { toDashboardResponse } from './dashboard.mapper';
import type { DashboardResponse } from './dashboard.types';

const log = createLogger('dashboard.service');

export class DashboardService {
  public async summary(userId: string, now: Date = new Date()): Promise<DashboardResponse> {
    const window = dashboardWindow(now);
    const row = await repository.loadDashboard(userId, window);

    log.debug({ userId, day: window.day }, 'Dashboard assembled');

    return toDashboardResponse(window.day, row);
  }
}
