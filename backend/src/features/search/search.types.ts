/**
 * src/features/search/search.types.ts
 *
 * Implements Section 14 (P1-05): Global Search across the user's data,
 * composed from read-only Reader interfaces.
 */

import type { TaskReaderItem } from '../tasks/tasks.reader.js';
import type { HabitReaderItem } from '../habits/habits.reader.js';
import type { EventReaderItem } from '../calendar/calendar.reader.js';
import type { NoteSearchItem } from '../notes/notes.reader.js';
import type { ProjectSearchItem } from '../projects/projects.reader.js';

export interface SearchResults {
  query: string;
  tasks: TaskReaderItem[];
  notes: NoteSearchItem[];
  habits: HabitReaderItem[];
  projects: ProjectSearchItem[];
  events: EventReaderItem[];
}
