import type { Metadata } from 'next';
import { RecurringTasksView } from '@/features/recurring-tasks/recurring-view';

export const metadata: Metadata = { title: 'Recurring tasks' };

export default function RecurringTasksPage() {
  return <RecurringTasksView />;
}
