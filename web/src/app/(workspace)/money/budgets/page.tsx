import type { Metadata } from 'next';
import { BudgetsView } from '@/features/money/budgets-view';

export const metadata: Metadata = { title: 'Budgets' };

export default function BudgetsPage() {
  return <BudgetsView />;
}
