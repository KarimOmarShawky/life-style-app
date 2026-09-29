import type { Metadata } from 'next';
import { NotesView } from '@/features/notes/notes-view';

export const metadata: Metadata = { title: 'Notes' };

export default function NotesPage() {
  return <NotesView />;
}
