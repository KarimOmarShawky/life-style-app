'use client';

import { useEffect, useState } from 'react';
import { FolderKanban, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@/components/data-display/page-header';
import { ProjectStatusBadge } from '@/components/data-display/status-badges';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FormField } from '@/components/forms/form-field';
import { Alert } from '@/components/ui/alert';
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useRestoreProject,
  useUpdateProject
} from './hooks';
import {
  projectFormDefaults,
  projectFormSchema,
  toProjectBody,
  type ProjectFormValues
} from './schemas';
import { useToast } from '@/providers/toast-provider';
import { formatDateOnly } from '@/lib/date/format';
import { ApiError, fieldErrorsOf } from '@/lib/api/errors';
import type { Project } from '@/types/api';

export function ProjectsView() {
  const projects = useProjects({ limit: 100 });
  const { toast } = useToast();
  const deleteProject = useDeleteProject();
  const restoreProject = useRestoreProject();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [cascade, setCascade] = useState(false);
  const [lastDeleted, setLastDeleted] = useState<Project | null>(null);

  const rows = projects.data?.data ?? [];

  const handleDelete = async () => {
    if (!deleting) return;
    const project = deleting;
    try {
      await deleteProject.mutateAsync({ id: project.id, cascade });
      setLastDeleted(project);
      toast({
        title: 'Project deleted',
        description: cascade ? 'Its tasks were deleted too.' : undefined,
        variant: 'success'
      });
    } catch (error) {
      toast({
        title: 'Could not delete project',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    } finally {
      setCascade(false);
    }
  };

  const handleUndo = async () => {
    if (!lastDeleted) return;
    try {
      await restoreProject.mutateAsync(lastDeleted.id);
      setLastDeleted(null);
      toast({ title: 'Project restored', variant: 'success' });
    } catch (error) {
      toast({
        title: 'Could not restore project',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    }
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Group tasks around outcomes and watch them close out."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New project
          </Button>
        }
      />

      {lastDeleted ? (
        <div className="mb-4">
          <Alert variant="info" title={`“${lastDeleted.name}” was deleted`}>
            <div className="mt-1 flex items-center gap-3">
              <span>Restore it within 30 days if you change your mind.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                loading={restoreProject.isPending}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Undo
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      <AsyncContent
        isLoading={projects.isLoading}
        isError={projects.isError}
        error={projects.error}
        isEmpty={rows.length === 0}
        onRetry={() => void projects.refetch()}
        emptyTitle="No projects yet"
        emptyDescription="Create a project to group related tasks."
        emptyIcon={<FolderKanban className="size-8" />}
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New project
          </Button>
        }
        skeletonRows={4}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((project) => (
            <Card key={project.id}>
              <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="truncate">
                    <span
                      className="mr-2 inline-block size-2.5 rounded-full align-middle"
                      style={{ backgroundColor: project.color ?? 'var(--primary)' }}
                      aria-hidden="true"
                    />
                    {project.name}
                  </CardTitle>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <ProjectStatusBadge status={project.status} />
                    {project.dueDate ? (
                      <span className="text-xs text-muted-foreground">
                        Due {formatDateOnly(project.dueDate)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit project “${project.name}”`}
                    onClick={() => {
                      setEditing(project);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete project “${project.name}”`}
                    onClick={() => setDeleting(project)}
                  >
                    <Trash2 className="size-4 text-danger" aria-hidden="true" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {project.description ? (
                  <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                    {project.description}
                  </p>
                ) : null}
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Badge variant="info">{project.taskCounts.open} open</Badge>
                    <Badge variant="success">{project.taskCounts.done} done</Badge>
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </AsyncContent>

      <ProjectFormDialog
        open={dialogOpen}
        project={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this project?"
        description={
          cascade
            ? `“${deleting?.name ?? ''}” and its tasks will be soft-deleted (restorable for 30 days).`
            : `“${deleting?.name ?? ''}” will be soft-deleted. Its tasks are detached and kept.`
        }
        confirmLabel="Delete"
        danger
      >
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--danger)]"
            checked={cascade}
            onChange={(event) => setCascade(event.target.checked)}
          />
          Also delete the project’s open tasks
        </label>
      </ConfirmDialog>
    </div>
  );
}

function ProjectFormDialog({
  open,
  onClose,
  project
}: {
  open: boolean;
  onClose: () => void;
  project: Project | null;
}) {
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);

  const methods = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: projectFormDefaults
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    methods.reset(
      project
        ? {
            name: project.name,
            description: project.description ?? '',
            status: project.status,
            color: project.color ?? '',
            goalId: project.goalId ?? '',
            dueDate: project.dueDate ?? ''
          }
        : projectFormDefaults
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (project) {
        await updateProject.mutateAsync({
          id: project.id,
          body: { ...toProjectBody(values), version: project.version }
        });
        toast({ title: 'Project updated', variant: 'success' });
      } else {
        await createProject.mutateAsync(toProjectBody(values));
        toast({ title: 'Project created', variant: 'success' });
      }
      onClose();
    } catch (error) {
      for (const [name, message] of Object.entries(fieldErrorsOf(error))) {
        methods.setError(name as keyof ProjectFormValues, { message });
      }
      setFormError(error instanceof ApiError ? error.userMessage : 'Could not save the project.');
    }
  });

  const busy = createProject.isPending || updateProject.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : 'New project'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={busy}>
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <FormField<ProjectFormValues> name="name" label="Name" required>
            {(props) => <Input {...props} maxLength={120} autoFocus required />}
          </FormField>
          <FormField<ProjectFormValues> name="description" label="Description">
            {(props) => <Textarea {...props} rows={3} maxLength={5000} />}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<ProjectFormValues> name="status" label="Status" required>
              {(props) => (
                <Select {...props} value={methods.watch('status')}>
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </Select>
              )}
            </FormField>
            <FormField<ProjectFormValues> name="color" label="Color (hex)">
              {(props) => <Input {...props} placeholder="#315C4C" maxLength={7} />}
            </FormField>
          </div>
          <FormField<ProjectFormValues> name="dueDate" label="Due date">
            {(props) => <Input {...props} type="date" />}
          </FormField>
        </form>
      </FormProvider>
    </Dialog>
  );
}
