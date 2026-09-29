import type { Metadata } from 'next';
import { SubscriptionsView } from '@/features/money/subscriptions-view';

export const metadata: Metadata = { title: 'Subscriptions' };

export default function SubscriptionsPage() {
  return <SubscriptionsView />;
}
