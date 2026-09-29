'use client';

import { useEffect, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/lib/auth/auth-provider';
import { useProjects } from '@/features/projects/hooks';
import { ApiError, fieldErrorsOf } from '@/lib/api/errors';
import { taskFormDefaults, taskFormSchema, toTaskBody, type TaskFormValues } from './schemas';
import { useCreateTask, useUpdateTask } from './hooks';
import type { Task } from '@/types/api';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/forms/form-field';
import { Alert } from '@/components/ui/alert';
import { useToast } from '@/providers/toast-provider';

export interface TaskFormDialogProps {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
}

export function TaskFormDialog({ open, onClose, task }: TaskFormDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const projects = useProjects({ limit: 100 });
  const [formError, setFormError] = useState<string | null>(null);

  const methods = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: taskFormDefaults
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    createTask.reset();
    updateTask.reset();
    methods.reset(
      task
        ? {
            title: task.title,
            description: task.description ?? '',
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate ?? '',
            dueTime: task.dueTime ?? '',
            plannedDate: task.plannedDate ?? '',
            isFocus: task.isFocus,
            estimateMinutes: task.estimateMinutes ? String(task.estimateMinutes) : '',
            projectId: task.projectId ?? ''
          }
        : {
            ...taskFormDefaults,
            plannedDate: user ? undefined : ''
          }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const onSubmit = methods.handleSubmit(async (values) => {
    setFormError(null);
    const body = toTaskBody(values);
    try {
      if (task) {
        await updateTask.mutateAsync({
          id: task.id,
          body: { ...body, version: task.version }
        });
        toast({ title: 'Task updated', variant: 'success' });
      } else {
        await createTask.mutateAsync(body);
        toast({ title: 'Task created', variant: 'success' });
      }
      onClose();
    } catch (error) {
      const fields = fieldErrorsOf(error);
      for (const [name, message] of Object.entries(fields)) {
        methods.setError(name as keyof TaskFormValues, { message });
      }
      setFormError(error instanceof ApiError ? error.userMessage : 'Could not save the task.');
    }
  });

  const busy = createTask.isPending || updateTask.isPending;
  const projectOptions = projects.data?.data ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'New task'}
      description={task ? 'Update this task’s details.' : 'Add a task to your plan.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={busy}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <FormField<TaskFormValues> name="title" label="Title" required>
            {(props) => <Input {...props} maxLength={300} autoFocus required />}
          </FormField>
          <FormField<TaskFormValues> name="description" label="Description">
            {(props) => <Textarea {...props} rows={3} maxLength={10000} />}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField<TaskFormValues> name="status" label="Status" required>
              {(props) => (
                <Select {...props} value={methods.watch('status')}>
                  <option value="todo">To do</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              )}
            </FormField>
            <FormField<TaskFormValues> name="priority" label="Priority" required>
              {(props) => (
                <Select {...props} value={methods.watch('priority')}>
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              )}
            </FormField>
            <FormField<TaskFormValues> name="dueDate" label="Due date">
              {(props) => <Input {...props} type="date" />}
            </FormField>
            <FormField<TaskFormValues> name="dueTime" label="Due time">
              {(props) => <Input {...props} type="time" />}
            </FormField>
            <FormField<TaskFormValues>
              name="plannedDate"
              label="Planned date"
              hint="When you intend to work on it."
            >
              {(props) => <Input {...props} type="date" />}
            </FormField>
            <FormField<TaskFormValues>
              name="estimateMinutes"
              label="Estimate (minutes)"
              hint="1–1440"
            >
              {(props) => <Input {...props} type="number" min={1} max={1440} inputMode="numeric" />}
            </FormField>
          </div>
          <FormField<TaskFormValues> name="projectId" label="Project">
            {(props) => (
              <Select {...props} value={methods.watch('projectId') ?? ''}>
                <option value="">No project</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField<TaskFormValues> name="isFocus" label="Focus">
            {(props) => (
              <Checkbox
                id={props.id}
                aria-describedby={props['aria-describedby']}
                checked={methods.watch('isFocus')}
                onChange={(event) => methods.setValue('isFocus', event.target.checked)}
                label="Mark as a focus task (requires a planned date)"
              />
            )}
          </FormField>
        </form>
      </FormProvider>
    </Dialog>
  );
}
