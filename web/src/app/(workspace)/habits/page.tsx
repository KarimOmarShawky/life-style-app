import type { Metadata } from 'next';
import { HabitsView } from '@/features/habits/habits-view';

export const metadata: Metadata = { title: 'Habits' };

export default function HabitsPage() {
  return <HabitsView />;
}
