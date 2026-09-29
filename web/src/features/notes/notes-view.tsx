'use client';

import { useEffect, useState } from 'react';
import { Link2, NotebookPen, Pencil, Pin, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  useAddNoteLink,
  useCreateNote,
  useDeleteNote,
  useNote,
  useNoteLinks,
  useNotes,
  useNoteTags,
  useRemoveNoteLink,
  useRestoreNote,
  useUpdateNote
} from './hooks';
import { useTasks } from '@/features/tasks/hooks';
import { useProjects } from '@/features/projects/hooks';
import { useGoals } from '@/features/goals/hooks';
import { useHabits } from '@/features/habits/hooks';
import { useEvents } from '@/features/events/hooks';
import { useToast } from '@/providers/toast-provider';
import { formatTimestamp } from '@/lib/date/format';
import { ApiError } from '@/lib/api/errors';
import type { Note, NoteListItem } from '@/types/api';

export function NotesView() {
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NoteListItem | null>(null);
  const [lastDeleted, setLastDeleted] = useState<NoteListItem | null>(null);

  // Debounce search input.
  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const notes = useNotes({
    q: query || undefined,
    tag: tagFilter || undefined,
    isPinned: pinnedOnly ? true : undefined
  });
  const tags = useNoteTags();
  const deleteNote = useDeleteNote();
  const restoreNote = useRestoreNote();

  const rows = notes.data?.notes ?? [];

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteNote.mutateAsync(deleting.id);
      setLastDeleted(deleting);
      toast({ title: 'Note deleted', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not delete note',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  const handleUndo = async () => {
    if (!lastDeleted) return;
    try {
      await restoreNote.mutateAsync(lastDeleted.id);
      setLastDeleted(null);
      toast({ title: 'Note restored', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not restore note',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Notes"
        description="Plain-text notes with tags and links to the rest of your workspace."
        actions={
          <Button
            onClick={() => {
              setEditingId(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New note
          </Button>
        }
      />

      {lastDeleted ? (
        <div className="mb-4">
          <Alert variant="info" title="Note deleted">
            <div className="mt-1 flex items-center gap-3">
              <span>Restore it within 30 days.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                loading={restoreNote.isPending}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Undo
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search notes"
            placeholder="Search titles and content…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={pinnedOnly ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={pinnedOnly}
            onClick={() => setPinnedOnly((value) => !value)}
          >
            <Pin className="size-3.5" aria-hidden="true" />
            Pinned
          </Button>
          {tags.data?.tags.map((tag) => (
            <Button
              key={tag.tag}
              size="sm"
              variant={tagFilter === tag.tag ? 'secondary' : 'outline'}
              aria-pressed={tagFilter === tag.tag}
              onClick={() => setTagFilter((current) => (current === tag.tag ? '' : tag.tag))}
            >
              #{tag.tag} <span className="text-subtle-foreground">{tag.count}</span>
            </Button>
          ))}
        </div>
      </div>

      <AsyncContent
        isLoading={notes.isLoading}
        isError={notes.isError}
        error={notes.error}
        isEmpty={rows.length === 0}
        onRetry={() => void notes.refetch()}
        emptyTitle={
          query || tagFilter || pinnedOnly ? 'No notes match your filters' : 'No notes yet'
        }
        emptyDescription="Capture your first thought — plain text, tags, and links to your tasks and goals."
        emptyIcon={<NotebookPen className="size-8" />}
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New note
          </Button>
        }
        skeletonRows={5}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((note) => (
            <Card key={note.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-2 pt-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-1 font-medium text-foreground">
                    {note.isPinned ? (
                      <Pin className="mr-1 inline size-3.5 text-primary" aria-label="Pinned" />
                    ) : null}
                    {note.title ?? 'Untitled'}
                  </h3>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit “${note.title ?? 'Untitled'}”`}
                      onClick={() => {
                        setEditingId(note.id);
                        setEditorOpen(true);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete “${note.title ?? 'Untitled'}”`}
                      onClick={() => setDeleting(note)}
                    >
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <p className="line-clamp-3 flex-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {note.excerpt || '—'}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {note.tags.map((tag) => (
                    <Badge key={tag} variant="primary">
                      #{tag}
                    </Badge>
                  ))}
                  <span className="ml-auto text-xs text-subtle-foreground">
                    {formatTimestamp(note.updatedAt, undefined)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </AsyncContent>

      <NoteEditorDialog
        open={editorOpen}
        noteId={editingId}
        onClose={() => {
          setEditorOpen(false);
          setEditingId(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this note?"
        description="The note will be soft-deleted and can be restored within 30 days."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function NoteEditorDialog({
  open,
  noteId,
  onClose
}: {
  open: boolean;
  noteId: string | null;
  onClose: () => void;
}) {
  const isNew = !noteId;
  const detail = useNote(noteId);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const note: Note | null = isNew ? null : (detail.data?.note ?? null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (isNew) {
      setTitle('');
      setBody('');
      setTagsInput('');
      setIsPinned(false);
    } else if (note) {
      setTitle(note.title ?? '');
      setBody(note.body);
      setTagsInput(note.tags.join(', '));
      setIsPinned(note.isPinned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, noteId, note?.version]);

  const handleSave = async () => {
    setFormError(null);
    const tags = tagsInput
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0)
      .slice(0, 20);
    try {
      if (isNew) {
        await createNote.mutateAsync({ title: title || null, body, tags, isPinned });
        toast({ title: 'Note created', variant: 'success' });
      } else if (note) {
        await updateNote.mutateAsync({
          id: note.id,
          body: { title: title || null, body, tags, isPinned, version: note.version }
        });
        toast({ title: 'Note updated', variant: 'success' });
      }
      onClose();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.userMessage : 'Could not save the note.');
    }
  };

  const busy = createNote.isPending || updateNote.isPending;
  const loading = !isNew && detail.isLoading;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? 'New note' : 'Edit note'}
      description="Notes render as plain text — no HTML or markup is executed."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} loading={busy} disabled={loading}>
            {isNew ? 'Create note' : 'Save changes'}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading note…</p>
      ) : (
        <div className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <div className="space-y-1.5">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="Optional — a body alone is enough"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note-body">Body</Label>
            <Textarea
              id="note-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={10}
              maxLength={100000}
              placeholder="Write in plain text…"
            />
            <p className="text-xs text-muted-foreground">{body.length} / 100,000 characters</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note-tags">Tags</Label>
            <Input
              id="note-tags"
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              placeholder="comma, separated, tags"
            />
            <p className="text-xs text-muted-foreground">Up to 20 tags · lowercase</p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={isPinned}
              onChange={(event) => setIsPinned(event.target.checked)}
            />
            Pin this note to the top
          </label>

          {note ? <NoteLinksSection note={note} /> : null}
        </div>
      )}
    </Dialog>
  );
}

function NoteLinksSection({ note }: { note: Note }) {
  const links = useNoteLinks(note.id);
  const addLink = useAddNoteLink();
  const removeLink = useRemoveNoteLink();
  const { toast } = useToast();
  const [entityType, setEntityType] = useState<'task' | 'project' | 'goal' | 'habit' | 'event'>(
    'task'
  );

  const rows = links.data?.links ?? [];

  return (
    <section className="space-y-2 rounded-lg border border-border p-3" aria-label="Note links">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Link2 className="size-4" aria-hidden="true" />
        Linked items
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No links yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2">
              <Badge variant="neutral">
                {link.entityType}: {link.entityId.slice(0, 8)}…
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove link"
                onClick={() =>
                  void removeLink
                    .mutateAsync({ noteId: note.id, linkId: link.id })
                    .catch((error: unknown) =>
                      toast({
                        title: 'Could not remove link',
                        description: error instanceof ApiError ? error.userMessage : undefined,
                        variant: 'error'
                      })
                    )
                }
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="link-type">Link to</Label>
          <Select
            id="link-type"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value as typeof entityType)}
          >
            <option value="task">Task</option>
            <option value="project">Project</option>
            <option value="goal">Goal</option>
            <option value="habit">Habit</option>
            <option value="event">Event</option>
          </Select>
        </div>
        <EntityPicker
          entityType={entityType}
          onPick={(entityId) =>
            void addLink
              .mutateAsync({ noteId: note.id, entityType, entityId })
              .then(() => toast({ title: 'Linked', variant: 'success' }))
              .catch((error: unknown) =>
                toast({
                  title: 'Could not link',
                  description: error instanceof ApiError ? error.userMessage : undefined,
                  variant: 'error'
                })
              )
          }
          disabled={addLink.isPending}
        />
      </div>
    </section>
  );
}

function EntityPicker({
  entityType,
  onPick,
  disabled
}: {
  entityType: 'task' | 'project' | 'goal' | 'habit' | 'event';
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  // Each branch mounts only its own query (hooks are per-component).
  if (entityType === 'task') {
    return <TaskPicker onPick={onPick} disabled={disabled} />;
  }
  if (entityType === 'project') {
    return <ProjectPicker onPick={onPick} disabled={disabled} />;
  }
  if (entityType === 'goal') {
    return <GoalPicker onPick={onPick} disabled={disabled} />;
  }
  if (entityType === 'habit') {
    return <HabitPicker onPick={onPick} disabled={disabled} />;
  }
  return <EventPicker onPick={onPick} disabled={disabled} />;
}

function PickerSelect({
  label,
  options,
  onPick,
  disabled
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor="entity-pick">{label}</Label>
      <Select
        id="entity-pick"
        defaultValue=""
        disabled={disabled || options.length === 0}
        onChange={(event) => {
          if (event.target.value) onPick(event.target.value);
          event.target.value = '';
        }}
      >
        <option value="">{options.length === 0 ? 'Nothing to link' : 'Choose…'}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function TaskPicker({ onPick, disabled }: { onPick: (id: string) => void; disabled?: boolean }) {
  const tasks = useTasks({ limit: 50, sort: 'updatedAt', order: 'desc' });
  return (
    <PickerSelect
      label="Task"
      options={(tasks.data?.data ?? []).map((task) => ({ id: task.id, label: task.title }))}
      onPick={onPick}
      disabled={disabled}
    />
  );
}

function ProjectPicker({ onPick, disabled }: { onPick: (id: string) => void; disabled?: boolean }) {
  const projects = useProjects({ limit: 50 });
  return (
    <PickerSelect
      label="Project"
      options={(projects.data?.data ?? []).map((project) => ({
        id: project.id,
        label: project.name
      }))}
      onPick={onPick}
      disabled={disabled}
    />
  );
}

function GoalPicker({ onPick, disabled }: { onPick: (id: string) => void; disabled?: boolean }) {
  const goals = useGoals({});
  return (
    <PickerSelect
      label="Goal"
      options={(goals.data?.goals ?? []).map((goal) => ({ id: goal.id, label: goal.title }))}
      onPick={onPick}
      disabled={disabled}
    />
  );
}

function HabitPicker({ onPick, disabled }: { onPick: (id: string) => void; disabled?: boolean }) {
  const habits = useHabits({ limit: 50 });
  return (
    <PickerSelect
      label="Habit"
      options={(habits.data?.data ?? []).map((habit) => ({ id: habit.id, label: habit.name }))}
      onPick={onPick}
      disabled={disabled}
    />
  );
}

function EventPicker({ onPick, disabled }: { onPick: (id: string) => void; disabled?: boolean }) {
  const events = useEvents({});
  return (
    <PickerSelect
      label="Event"
      options={(events.data?.events ?? []).map((event) => ({ id: event.id, label: event.title }))}
      onPick={onPick}
      disabled={disabled}
    />
  );
}
