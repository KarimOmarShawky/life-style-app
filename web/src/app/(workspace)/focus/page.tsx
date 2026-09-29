import type { Metadata } from 'next';
import { FocusView } from '@/features/timer-sessions/focus-view';

export const metadata: Metadata = { title: 'Focus' };

export default function FocusPage() {
  return <FocusView />;
}
