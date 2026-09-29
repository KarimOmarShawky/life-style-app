import type { Metadata } from 'next';
import { CategoriesView } from '@/features/money/categories-view';

export const metadata: Metadata = { title: 'Categories' };

export default function CategoriesPage() {
  return <CategoriesView />;
}
