/**
 * src/features/notes/notes.validation.ts
 *
 * Implements Section 14.10, Section 6.6 & AC-NOTE-01: Notes & Note Links Zod Validation Schemas.
 */

import { z } from 'zod';

export const createNoteLinkSchema = z
  .object({
    entityType: z.enum(['task', 'project', 'goal', 'habit', 'event']).optional(),
    entityId: z.string().uuid('Invalid entityId format').optional(),
    taskId: z.string().uuid('Invalid taskId format').nullable().optional(),
    projectId: z.string().uuid('Invalid projectId format').nullable().optional(),
    goalId: z.string().uuid('Invalid goalId format').nullable().optional(),
    habitId: z.string().uuid('Invalid habitId format').nullable().optional(),
    eventId: z.string().uuid('Invalid eventId format').nullable().optional()
  })
  .refine(
    (data) => {
      if (data.entityType && data.entityId) {
        return true;
      }
      const nonNullCount = [
        data.taskId,
        data.projectId,
        data.goalId,
        data.habitId,
        data.eventId
      ].filter((val) => typeof val === 'string' && val.length > 0).length;
      return nonNullCount === 1;
    },
    {
      message:
        'Either (entityType, entityId) or exactly one of (taskId, projectId, goalId, habitId, eventId) must be provided'
    }
  )
  .transform((data) => {
    if (data.entityType && data.entityId) {
      return {
        taskId: data.entityType === 'task' ? data.entityId : null,
        projectId: data.entityType === 'project' ? data.entityId : null,
        goalId: data.entityType === 'goal' ? data.entityId : null,
        habitId: data.entityType === 'habit' ? data.entityId : null,
        eventId: data.entityType === 'event' ? data.entityId : null
      };
    }
    return {
      taskId: data.taskId ?? null,
      projectId: data.projectId ?? null,
      goalId: data.goalId ?? null,
      habitId: data.habitId ?? null,
      eventId: data.eventId ?? null
    };
  });

export const createNoteSchema = z
  .object({
    title: z.string().trim().max(200, 'Title cannot exceed 200 characters').nullable().optional(),
    body: z.string().max(100000, 'Body cannot exceed 100,000 characters').optional().default(''),
    tags: z
      .array(
        z.string().trim().min(1, 'Tag cannot be empty').max(40, 'Tag cannot exceed 40 characters')
      )
      .max(20, 'Maximum 20 tags allowed')
      .optional()
      .default([])
      .transform((tags) => {
        if (!tags) return [];
        const normalized = tags.map((t) => t.toLowerCase().trim()).filter((t) => t.length > 0);
        return Array.from(new Set(normalized));
      }),
    isPinned: z.boolean().optional().default(false),
    links: z.array(createNoteLinkSchema).max(20, 'Maximum 20 links allowed').optional()
  })
  .refine(
    (data) => {
      const hasTitle = typeof data.title === 'string' && data.title.trim().length > 0;
      const hasBody = typeof data.body === 'string' && data.body.trim().length > 0;
      return hasTitle || hasBody;
    },
    {
      message: 'Either title or non-empty body must be provided',
      path: ['body']
    }
  );

export const updateNoteSchema = z.object({
  title: z.string().trim().max(200, 'Title cannot exceed 200 characters').nullable().optional(),
  body: z.string().max(100000, 'Body cannot exceed 100,000 characters').optional(),
  tags: z
    .array(
      z.string().trim().min(1, 'Tag cannot be empty').max(40, 'Tag cannot exceed 40 characters')
    )
    .max(20, 'Maximum 20 tags allowed')
    .optional()
    .transform((tags) => {
      if (!tags) return undefined;
      const normalized = tags.map((t) => t.toLowerCase().trim()).filter((t) => t.length > 0);
      return Array.from(new Set(normalized));
    }),
  isPinned: z.boolean().optional(),
  links: z.array(createNoteLinkSchema).max(20, 'Maximum 20 links allowed').optional(),
  version: z.number().int().positive().optional()
});

export const listNotesQuerySchema = z
  .object({
    q: z.string().trim().optional(),
    tag: z.string().trim().toLowerCase().optional(),
    isPinned: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    pinned: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    linkedEntityType: z.enum(['task', 'project', 'goal', 'habit', 'event']).optional(),
    linkedEntityId: z.string().uuid('Invalid linkedEntityId format').optional(),
    taskId: z.string().uuid('Invalid taskId format').optional(),
    projectId: z.string().uuid('Invalid projectId format').optional(),
    goalId: z.string().uuid('Invalid goalId format').optional(),
    habitId: z.string().uuid('Invalid habitId format').optional(),
    eventId: z.string().uuid('Invalid eventId format').optional(),
    includeDeleted: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional()
  })
  .transform((data) => {
    const isPinned = data.isPinned !== undefined ? data.isPinned : data.pinned;
    let taskId = data.taskId;
    let projectId = data.projectId;
    let goalId = data.goalId;
    let habitId = data.habitId;
    let eventId = data.eventId;

    if (data.linkedEntityType && data.linkedEntityId) {
      if (data.linkedEntityType === 'task') taskId = data.linkedEntityId;
      if (data.linkedEntityType === 'project') projectId = data.linkedEntityId;
      if (data.linkedEntityType === 'goal') goalId = data.linkedEntityId;
      if (data.linkedEntityType === 'habit') habitId = data.linkedEntityId;
      if (data.linkedEntityType === 'event') eventId = data.linkedEntityId;
    }

    return {
      q: data.q,
      tag: data.tag,
      isPinned,
      taskId,
      projectId,
      goalId,
      habitId,
      eventId,
      includeDeleted: data.includeDeleted
    };
  });

export const noteIdParamSchema = z.object({
  id: z.string().uuid('Invalid note ID format')
});

export const noteLinkIdParamSchema = z.object({
  id: z.string().uuid('Invalid note ID format'),
  linkId: z.string().uuid('Invalid link ID format')
});
