'use client';

import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/data-display/page-header';
import { AsyncContent } from '@/components/feedback/async-content';
import { ConfirmDialog } from '@/components/feedback/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Table, TBody, THead, TRow, TH, TD } from '@/components/data-display/table';
import { useArchiveCategory, useCategories, useCreateCategory, useUpdateCategory } from './hooks';
import { categoryFormDefaults, categoryFormSchema, type CategoryFormValues } from './schemas';
import { useAuth } from '@/lib/auth/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { ApiError } from '@/lib/api/errors';
import type { Category } from '@/types/api';

export function CategoriesView() {
  const { toast } = useToast();
  const [includeArchived, setIncludeArchived] = useState(false);
  const categories = useCategories(includeArchived);
  const archiveCategory = useArchiveCategory();
  const updateCategory = useUpdateCategory();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [archiving, setArchiving] = useState<Category | null>(null);

  const rows = categories.data?.categories ?? [];
  const expense = rows.filter((row) => row.kind === 'expense');
  const income = rows.filter((row) => row.kind === 'income');

  const handleArchiveToggle = async () => {
    if (!archiving) return;
    try {
      if (archiving.archived) {
        // Un-archive via PATCH with optimistic-concurrency version.
        await updateCategory.mutateAsync({
          id: archiving.id,
          body: { archived: false, version: archiving.version }
        });
        toast({ title: 'Category restored', variant: 'success' });
      } else {
        await archiveCategory.mutateAsync(archiving.id);
        toast({ title: 'Category archived', variant: 'success' });
      }
    } catch (error) {
      toast({
        title: 'Could not update category',
        description: error instanceof ApiError ? error.userMessage : undefined,
        variant: 'error'
      });
    } finally {
      setArchiving(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Organise transactions and budgets by income or expense category."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-pressed={includeArchived}
              onClick={() => setIncludeArchived((value) => !value)}
            >
              <Archive className="size-3.5" aria-hidden="true" />
              {includeArchived ? 'Hiding archived' : 'Show archived'}
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              New category
            </Button>
          </div>
        }
      />

      <AsyncContent
        isLoading={categories.isLoading}
        isError={categories.isError}
        error={categories.error}
        isEmpty={rows.length === 0}
        onRetry={() => void categories.refetch()}
        emptyTitle="No categories yet"
        emptyDescription="Create categories to tag your income and spending."
        emptyIcon={<Tag className="size-8" />}
        emptyAction={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New category
          </Button>
        }
        skeletonRows={4}
      >
        <div className="space-y-8">
          <CategoryGroup
            title="Expense categories"
            rows={expense}
            onEdit={(category) => {
              setEditing(category);
              setEditorOpen(true);
            }}
            onToggleArchive={(category) => setArchiving(category)}
          />
          <CategoryGroup
            title="Income categories"
            rows={income}
            onEdit={(category) => {
              setEditing(category);
              setEditorOpen(true);
            }}
            onToggleArchive={(category) => setArchiving(category)}
          />
        </div>
      </AsyncContent>

      <CategoryDialog
        open={editorOpen}
        category={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        onConfirm={handleArchiveToggle}
        title={archiving?.archived ? 'Restore this category?' : 'Archive this category?'}
        description={
          archiving?.archived
            ? 'The category will reappear in pickers.'
            : 'Archived categories disappear from pickers; existing transactions keep their link.'
        }
        confirmLabel={archiving?.archived ? 'Restore' : 'Archive'}
      />
    </div>
  );
}

function CategoryGroup({
  title,
  rows,
  onEdit,
  onToggleArchive
}: {
  title: string;
  rows: Category[];
  onEdit: (category: Category) => void;
  onToggleArchive: (category: Category) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h2>
      <Table>
        <THead>
          <TRow>
            <TH>Category</TH>
            <TH>Status</TH>
            <TH className="w-24 text-right">Actions</TH>
          </TRow>
        </THead>
        <TBody>
          {rows.map((category) => (
            <TRow key={category.id}>
              <TD>
                <span className="flex items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: category.color ?? 'var(--muted)' }}
                    aria-hidden="true"
                  />
                  {category.icon ? <span aria-hidden="true">{category.icon}</span> : null}
                  <span className="font-medium">{category.name}</span>
                </span>
              </TD>
              <TD>
                {category.archived ? (
                  <Badge variant="neutral">Archived</Badge>
                ) : (
                  <Badge variant="success">Active</Badge>
                )}
              </TD>
              <TD>
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${category.name}`}
                    onClick={() => onEdit(category)}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      category.archived ? `Restore ${category.name}` : `Archive ${category.name}`
                    }
                    onClick={() => onToggleArchive(category)}
                  >
                    {category.archived ? (
                      <ArchiveRestore className="size-4" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-4 text-danger" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </TD>
            </TRow>
          ))}
        </TBody>
      </Table>
    </section>
  );
}

function CategoryDialog({
  open,
  category,
  onClose
}: {
  open: boolean;
  category: Category | null;
  onClose: () => void;
}) {
  const isNew = category === null;
  const { user } = useAuth();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const { toast } = useToast();

  const [values, setValues] = useState<CategoryFormValues>(categoryFormDefaults);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    if (category) {
      setValues({
        kind: category.kind,
        name: category.name,
        color: category.color ?? '',
        icon: category.icon ?? ''
      });
    } else {
      setValues(categoryFormDefaults);
    }
  }, [open, category]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = categoryFormSchema.safeParse(values);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    try {
      if (isNew) {
        await createCategory.mutateAsync({
          kind: parsed.data.kind,
          name: parsed.data.name,
          color: parsed.data.color && parsed.data.color.length > 0 ? parsed.data.color : null,
          icon: parsed.data.icon && parsed.data.icon.length > 0 ? parsed.data.icon : null
        });
        toast({ title: 'Category created', variant: 'success' });
      } else if (category) {
        await updateCategory.mutateAsync({
          id: category.id,
          body: {
            name: parsed.data.name,
            color: parsed.data.color && parsed.data.color.length > 0 ? parsed.data.color : null,
            icon: parsed.data.icon && parsed.data.icon.length > 0 ? parsed.data.icon : null,
            version: category.version
          }
        });
        toast({ title: 'Category updated', variant: 'success' });
      }
      onClose();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.userMessage : 'Could not save the category.');
    }
  };

  const busy = createCategory.isPending || updateCategory.isPending;
  const usedCurrency = user?.defaultCurrency ?? 'USD';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isNew ? 'New category' : 'Edit category'}
      description={
        isNew
          ? `Categories are per-kind. New categories default to ${usedCurrency} usage in filters.`
          : 'The category kind cannot be changed after creation.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button form="category-form" type="submit" loading={busy}>
            {isNew ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={handleSubmit} className="space-y-4">
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div className="space-y-1.5">
          <Label htmlFor="category-kind">Kind</Label>
          <Select
            id="category-kind"
            value={values.kind}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                kind: event.target.value as 'expense' | 'income'
              }))
            }
            disabled={!isNew}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </Select>
          {fieldErrors.kind ? <p className="text-xs text-danger">{fieldErrors.kind}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category-name">Name</Label>
          <Input
            id="category-name"
            value={values.name}
            onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
            maxLength={60}
            required
          />
          {fieldErrors.name ? <p className="text-xs text-danger">{fieldErrors.name}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-color">Color</Label>
            <div className="flex items-center gap-2">
              <input
                id="category-color"
                type="color"
                className="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent"
                value={
                  values.color && /^#[0-9A-Fa-f]{6}$/.test(values.color) ? values.color : '#315C4C'
                }
                onChange={(event) =>
                  setValues((current) => ({ ...current, color: event.target.value }))
                }
                aria-label="Category color"
              />
              <Input
                value={values.color ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, color: event.target.value }))
                }
                placeholder="#315C4C"
                maxLength={7}
                aria-label="Category color hex"
              />
            </div>
            {fieldErrors.color ? <p className="text-xs text-danger">{fieldErrors.color}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-icon">Icon (optional)</Label>
            <Input
              id="category-icon"
              value={values.icon ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, icon: event.target.value }))
              }
              maxLength={40}
              placeholder="e.g. 🛒"
            />
            {fieldErrors.icon ? <p className="text-xs text-danger">{fieldErrors.icon}</p> : null}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
