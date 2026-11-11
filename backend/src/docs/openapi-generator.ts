/**
 * src/docs/openapi-generator.ts
 *
 * Implements Section 14.18, Section 16 & ADR-007: OpenAPI Generation.
 * Generates docs/api/openapi.yaml from baseline API contracts and Zod schemas.
 * CI verifies that the committed openapi.yaml matches this generator output.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const openapiFilePath = path.resolve(__dirname, '../../../docs/api/openapi.yaml');

export function generateOpenApiDocument(): string {
  const doc = `openapi: 3.1.0
info:
  title: LifeStyle App API
  version: 1.0.1
  description: Single source of truth API specification for LifeStyle App (Personal Life Operating System).
servers:
  - url: /api/v1
    description: Primary API version 1 prefix
paths:
  /health/live:
    get:
      summary: Process Liveness Probe
      description: Returns 200 if the process event loop is active.
      responses:
        '200':
          description: Process is running
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: ok
                required:
                  - status
  /health/ready:
    get:
      summary: Process Readiness Probe
      description: Checks PostgreSQL and Redis connectivity with 1s timeouts.
      responses:
        '200':
          description: Dependencies are healthy and process can accept traffic
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: ok
                  database:
                    type: string
                    example: connected
                  redis:
                    type: string
                    example: connected
                required:
                  - status
                  - database
                  - redis
        '503':
          description: Service Unavailable - one or more dependencies failed
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiErrorEnvelope'
  /auth/register:
    post:
      summary: User Registration
      description: Creates a new user account, initializes default categories, and issues access & refresh tokens.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RegisterRequest'
      responses:
        '201':
          description: User registered successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuthResponse'
        '400':
          $ref: '#/components/responses/ValidationError'
        '409':
          description: Email already registered
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiErrorEnvelope'
  /auth/login:
    post:
      summary: User Login
      description: Authenticates user with email and password, establishing a new active session.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/LoginRequest'
      responses:
        '200':
          description: Authenticated successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuthResponse'
        '401':
          description: Invalid email or password
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiErrorEnvelope'
        '429':
          description: Too many requests
  /auth/refresh:
    post:
      summary: Refresh Access Token
      description: Uses an opaque refresh token with strict rotation to issue a new token pair.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RefreshTokenRequest'
      responses:
        '200':
          description: Tokens refreshed successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuthResponse'
        '401':
          description: Invalid, expired, or reused refresh token
  /auth/logout:
    post:
      summary: Session Logout
      security:
        - BearerAuth: []
      description: Revokes the current session and refresh token.
      responses:
        '204':
          description: Logged out successfully
  /auth/logout-all:
    post:
      summary: Logout All Sessions
      security:
        - BearerAuth: []
      description: Revokes all active sessions for the authenticated user and unregisters push devices.
      responses:
        '204':
          description: All sessions revoked
  /auth/forgot-password:
    post:
      summary: Request Password Reset OTP
      description: Accepts a bounded volatile background request before account lookup. Does not guarantee email delivery or durability across process termination. Registered, unknown, disabled and cooldown requests share admission; aggregate resource contention is not constant-time.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                email:
                  type: string
                  format: email
              required:
                - email
      responses:
        '202':
          description: Request accepted for best-effort background processing; empty object, no delivery assertion.
        '503':
          description: Global admission capacity exhausted or server draining; no request was accepted.
  /auth/reset-password:
    post:
      summary: Reset Password with OTP
      description: Verifies OTP and resets user password, revoking all existing sessions.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ResetPasswordRequest'
      responses:
        '200':
          description: Password reset successfully
  /auth/change-password:
    post:
      summary: Change Password
      security:
        - BearerAuth: []
      description: Changes password using existing password; revokes all other sessions.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ChangePasswordRequest'
      responses:
        '204':
          description: Password updated successfully
  /users/me:
    get:
      summary: Get Profile
      security:
        - BearerAuth: []
      responses:
        '200':
          description: User profile
          content:
            application/json:
              schema:
                type: object
                properties:
                  user:
                    $ref: '#/components/schemas/User'
    patch:
      summary: Update Profile
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateProfileRequest'
      responses:
        '200':
          description: Updated profile
          content:
            application/json:
              schema:
                type: object
                properties:
                  user:
                    $ref: '#/components/schemas/User'
        '400':
          description: Validation failed (unknown fields are rejected)
        '503':
          description: productEventsEnabled or onboardingCompleted was sent but the server database does not support it yet; nothing was changed
  /users/me/devices:
    put:
      summary: Register Push Device
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RegisterDeviceRequest'
      responses:
        '200':
          description: Device registered
  /users/me/devices/{deviceId}:
    delete:
      summary: Unregister Push Device
      security:
        - BearerAuth: []
      parameters:
        - name: deviceId
          in: path
          required: true
          schema:
            type: string
      responses:
        '204':
          description: Device unregistered
  /users/me/deletion:
    post:
      summary: Schedule Account Deletion
      security:
        - BearerAuth: []
      description: Schedules account deletion with a 14-day grace period.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [currentPassword]
              properties:
                currentPassword: { type: string, minLength: 1, maxLength: 1024, writeOnly: true }
      responses:
        '202':
          description: Account deletion scheduled
        '400':
          description: Missing or invalid current-password proof
        '403':
          description: Current-password verification failed
        '429':
          description: Shared sensitive-action attempt budget exhausted
        '503':
          description: Security rate-limit backend unavailable; action not performed
    delete:
      summary: Cancel Account Deletion
      security:
        - BearerAuth: []
      description: Cancels scheduled account deletion within the 14-day grace window.
      responses:
        '204':
          description: Deletion cancelled
  /users/me/export:
    post:
      summary: Export Account Metadata
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [currentPassword]
              properties:
                currentPassword: { type: string, minLength: 1, maxLength: 1024, writeOnly: true }
      responses:
        '200':
          description: Account profile (including product-event and onboarding settings when supported), sessions, categories, push-device metadata and content-free product events only; not a complete data portability archive. Session and device lists are capped at 1000 rows and product events at 5000; overflow returns 413, never silent truncation
        '400':
          description: Missing or invalid current-password proof
        '403':
          description: Current-password verification failed
        '413':
          description: Metadata list exceeds 1000 rows; use the domain archive endpoint
        '429':
          description: Shared sensitive-action attempt budget exhausted
        '503':
          description: Security rate-limit backend unavailable; action not performed

  /users/me/export/archive:
    post:
      summary: Stream a versioned account domain archive
      description: >-
        Additive NDJSON attachment with a read-only repeatable-read snapshot of 21
        explicitly projected profile/domain/metadata sections, including soft-deleted rows.
        Secrets, audit/infrastructure data and device-only data are excluded in its manifest.
        Decimal numeric values are strings. Clients must verify the final complete record,
        byte count, section counts and SHA-256 over all preceding UTF-8 lines; a partial
        stream is not a successful archive. Maximum 128 MiB, 512 KiB per projected row,
        60 seconds, two concurrent database archive readers per API process and one per user per process.
        No background job or archive retention is created. Existing JSON metadata export
        is unchanged. See docs/api/account-archive.md; Android save integration is authored but Flutter/bridge/provider/device execution remains unverified.
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [currentPassword]
              properties:
                currentPassword: { type: string, minLength: 1, maxLength: 1024, writeOnly: true }
      responses:
        '200':
          description: NDJSON manifest/record lines followed by a verified completion footer; errors after headers terminate the stream without a completion record
          headers:
            Content-Disposition:
              schema: { type: string }
              description: Fixed NDJSON attachment filename
            Cache-Control:
              schema: { type: string, const: no-store }
          content:
            application/x-ndjson:
              schema: { type: string }
        '400':
          description: Missing or invalid strict current-password body
        '401':
          description: Authentication required
        '403':
          description: Account disabled or current-password verification failed
        '404':
          description: Account absent from the export snapshot
        '413':
          description: Export limits exceeded before headers; after headers the stream aborts without a completion footer
        '429':
          description: Shared sensitive-action budget or archive capacity exceeded
        '503':
          description: Security limiter, database or export deadline unavailable before headers; mid-stream failures abort

  # Phase P4: Tasks Endpoints
  /tasks:
    get:
      summary: List Tasks
      security:
        - BearerAuth: []
      description: Retrieves filtered list of active tasks for authenticated user.
      parameters:
        - name: status
          in: query
          schema:
            type: string
          description: Comma-separated list (todo,in_progress,done,cancelled)
        - name: priority
          in: query
          schema:
            type: string
          description: Comma-separated list (none,low,medium,high)
        - name: projectId
          in: query
          schema:
            type: string
          description: UUID or 'none'
        - name: dueFrom
          in: query
          schema:
            type: string
            format: date
        - name: dueTo
          in: query
          schema:
            type: string
            format: date
        - name: plannedDate
          in: query
          schema:
            type: string
            format: date
        - name: overdue
          in: query
          schema:
            type: boolean
          description: Filter tasks where due_date < user_today and status not done/cancelled
        - name: isFocus
          in: query
          schema:
            type: boolean
        - name: completedFrom
          in: query
          description: Inclusive first completion date in the user's timezone
          schema:
            type: string
            format: date
        - name: completedTo
          in: query
          description: Inclusive last completion date in the user's timezone
          schema:
            type: string
            format: date
        - name: sort
          in: query
          schema:
            type: string
            enum: [dueDate, priority, createdAt, updatedAt]
        - name: order
          in: query
          schema:
            type: string
            enum: [asc, desc]
            default: asc
        - name: limit
          in: query
          schema:
            type: integer
            default: 25
        - name: cursor
          in: query
          schema:
            type: string
      responses:
        '200':
          description: Paginated tasks list
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Task'
                  meta:
                    $ref: '#/components/schemas/PageMeta'
        '400':
          $ref: '#/components/responses/ValidationError'
    post:
      summary: Create Task
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateTaskRequest'
      responses:
        '201':
          description: Task created successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  task:
                    $ref: '#/components/schemas/Task'
        '400':
          $ref: '#/components/responses/ValidationError'
  /tasks/{id}:
    get:
      summary: Get Task
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Task details including tracked seconds
          content:
            application/json:
              schema:
                type: object
                properties:
                  task:
                    $ref: '#/components/schemas/Task'
        '404':
          description: Task not found
    patch:
      summary: Update Task
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateTaskRequest'
      responses:
        '200':
          description: Updated task
          content:
            application/json:
              schema:
                type: object
                properties:
                  task:
                    $ref: '#/components/schemas/Task'
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Task not found
        '409':
          description: Concurrent modification conflict
    delete:
      summary: Delete Task
      security:
        - BearerAuth: []
      description: Soft deletes task with 30-day restore window and cancels pending reminders.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Task soft-deleted
        '404':
          description: Task not found
  /tasks/{id}/restore:
    post:
      summary: Restore Deleted Task
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Task restored
          content:
            application/json:
              schema:
                type: object
                properties:
                  task:
                    $ref: '#/components/schemas/Task'
        '404':
          description: Task not found or restore window expired

  # Phase P4: Projects Endpoints
  /projects:
    get:
      summary: List Projects
      security:
        - BearerAuth: []
      parameters:
        - name: status
          in: query
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
            default: 25
        - name: cursor
          in: query
          schema:
            type: string
      responses:
        '200':
          description: Paginated projects list with taskCounts
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Project'
                  meta:
                    $ref: '#/components/schemas/PageMeta'
    post:
      summary: Create Project
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateProjectRequest'
      responses:
        '201':
          description: Project created successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  project:
                    $ref: '#/components/schemas/Project'
        '400':
          $ref: '#/components/responses/ValidationError'
  /projects/{id}:
    get:
      summary: Get Project
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Project detail with taskCounts
          content:
            application/json:
              schema:
                type: object
                properties:
                  project:
                    $ref: '#/components/schemas/Project'
        '404':
          description: Project not found
    patch:
      summary: Update Project
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateProjectRequest'
      responses:
        '200':
          description: Project updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  project:
                    $ref: '#/components/schemas/Project'
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Project not found
        '409':
          description: Concurrent modification conflict
    delete:
      summary: Delete Project
      security:
        - BearerAuth: []
      description: Soft deletes project. Detaches tasks by default; cascade=true soft-deletes tasks too.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: cascade
          in: query
          schema:
            type: boolean
            default: false
      responses:
        '204':
          description: Project deleted
        '404':
          description: Project not found
  /projects/{id}/restore:
    post:
      summary: Restore Deleted Project
      security:
        - BearerAuth: []
      description: Restores project within 30 days. Tasks are not reattached.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Project restored
          content:
            application/json:
              schema:
                type: object
                properties:
                  project:
                    $ref: '#/components/schemas/Project'
        '404':
          description: Project not found or restore window expired

  # Phase P4: Recurring Tasks Endpoints
  /recurring-tasks:
    get:
      summary: List Recurring Tasks
      security:
        - BearerAuth: []
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [active, paused, ended]
        - name: limit
          in: query
          schema:
            type: integer
            default: 25
        - name: cursor
          in: query
          schema:
            type: string
      responses:
        '200':
          description: Paginated recurring tasks list
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/RecurringTask'
                  meta:
                    $ref: '#/components/schemas/PageMeta'
    post:
      summary: Create Recurring Task
      security:
        - BearerAuth: []
      description: Creates template and idempotently generates first 7 days of instances in same transaction.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateRecurringTaskRequest'
      responses:
        '201':
          description: Recurring task template created
          content:
            application/json:
              schema:
                type: object
                properties:
                  recurringTask:
                    $ref: '#/components/schemas/RecurringTask'
        '400':
          $ref: '#/components/responses/ValidationError'
  /recurring-tasks/{id}:
    get:
      summary: Get Recurring Task
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Recurring task template
          content:
            application/json:
              schema:
                type: object
                properties:
                  recurringTask:
                    $ref: '#/components/schemas/RecurringTask'
        '404':
          description: Recurring task not found
    patch:
      summary: Update Recurring Task
      security:
        - BearerAuth: []
      description: Updates template and updates future, non-customized, open instances.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateRecurringTaskRequest'
      responses:
        '200':
          description: Recurring task updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  recurringTask:
                    $ref: '#/components/schemas/RecurringTask'
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Recurring task not found
    delete:
      summary: Delete Recurring Task
      security:
        - BearerAuth: []
      description: Soft deletes recurring template; already generated instances stay.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Recurring task deleted
        '404':
          description: Recurring task not found

  # Phase P4: Timer Sessions Endpoints
  /timer-sessions:
    get:
      summary: List Timer Sessions
      security:
        - BearerAuth: []
      parameters:
        - name: taskId
          in: query
          schema:
            type: string
            format: uuid
        - name: from
          in: query
          schema:
            type: string
            format: date-time
        - name: to
          in: query
          schema:
            type: string
            format: date-time
        - name: limit
          in: query
          schema:
            type: integer
            default: 25
        - name: cursor
          in: query
          schema:
            type: string
      responses:
        '200':
          description: Paginated timer sessions list
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/TimerSession'
                  meta:
                    $ref: '#/components/schemas/PageMeta'
    post:
      summary: Start Timer Session
      security:
        - BearerAuth: []
      description: Starts timer. Rejects if another timer is running (409 TIMER_ALREADY_RUNNING). Rejects client-supplied duration.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateTimerSessionRequest'
      responses:
        '201':
          description: Timer session started
          content:
            application/json:
              schema:
                type: object
                properties:
                  timerSession:
                    $ref: '#/components/schemas/TimerSession'
        '400':
          $ref: '#/components/responses/ValidationError'
        '409':
          description: A timer session is already running
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiErrorEnvelope'
  /timer-sessions/active:
    get:
      summary: Get Active Timer Session
      security:
        - BearerAuth: []
      responses:
        '200':
          description: Currently active running timer or null
          content:
            application/json:
              schema:
                type: object
                properties:
                  timerSession:
                    anyOf:
                      - $ref: '#/components/schemas/TimerSession'
                      - type: 'null'
  /timer-sessions/{id}:
    delete:
      summary: Delete Timer Session
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Timer session deleted
        '404':
          description: Timer session not found
  /timer-sessions/{id}/stop:
    post:
      summary: Stop Timer Session
      security:
        - BearerAuth: []
      description: Stops running timer session and derives duration from timestamps.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Timer session stopped
          content:
            application/json:
              schema:
                type: object
                properties:
                  timerSession:
                    $ref: '#/components/schemas/TimerSession'
        '404':
          description: Timer session not found
        '409':
          description: Timer session not running

  /reminders:
    get:
      summary: List Reminders (Unified)
      security:
        - BearerAuth: []
      description: Returns the user's reminders across task, habit, and subscription parents, newest first.
      parameters:
        - name: entityType
          in: query
          required: false
          schema:
            type: string
            enum: [task, habit, event, subscription]
        - name: status
          in: query
          required: false
          schema:
            type: string
            enum: [pending, processing, sent, failed, cancelled]
        - name: from
          in: query
          required: false
          schema:
            type: string
            format: date-time
        - name: to
          in: query
          required: false
          schema:
            type: string
            format: date-time
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            default: 50
      responses:
        '200':
          description: Reminders list
          content:
            application/json:
              schema:
                type: object
                properties:
                  reminders:
                    type: array
                    items:
                      $ref: '#/components/schemas/UnifiedReminder'
    post:
      summary: Create Reminder (Specification Canonical)
      security:
        - BearerAuth: []
      description: Creates a user-authored reminder for an owned, non-deleted task or event. Exactly one of remindAt or offsetMinutes is required; email is reserved for system reminders in the MVP.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUserReminderRequest'
      responses:
        '201':
          description: Reminder created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UnifiedReminder'
        '400':
          description: Invalid parent, channel, schedule or reminder time
        '409':
          description: Reminder quota exceeded

  /reminders/{id}:
    patch:
      summary: Update Reminder
      security:
        - BearerAuth: []
      description: Updates a pending user-authored reminder. System reminders and non-pending rows return 409 REMINDER_NOT_EDITABLE.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateUserReminderRequest'
      responses:
        '200':
          description: Reminder updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UnifiedReminder'
        '400':
          description: Validation error
        '404':
          description: Reminder not found
        '409':
          description: REMINDER_NOT_EDITABLE
    delete:
      summary: Delete Reminder
      security:
        - BearerAuth: []
      description: Hard-deletes a user-authored reminder. System-generated reminders cannot be deleted.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Reminder deleted
        '404':
          description: Reminder not found
        '409':
          description: REMINDER_NOT_EDITABLE

  /tasks/{id}/reminders:
    get:
      summary: List Task Reminders
      security:
        - BearerAuth: []
      description: Returns all reminders attached to the task.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Reminders list
          content:
            application/json:
              schema:
                type: object
                properties:
                  reminders:
                    type: array
                    items:
                      $ref: '#/components/schemas/UnifiedReminder'
        '404':
          description: Task not found
    post:
      summary: Add Task Reminder
      security:
        - BearerAuth: []
      description: Creates a reminder on the task (FR-REM-01/02). A manual reminder with both remindAt and offsetMinutes is rejected; exactly one must be provided (FR-REM-02).
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUnifiedReminderRequest'
      responses:
        '201':
          description: Reminder created
          content:
            application/json:
              schema:
                type: object
                properties:
                  reminder:
                    $ref: '#/components/schemas/UnifiedReminder'
        '400':
          description: Validation error (e.g. both remindAt and offsetMinutes provided)
        '404':
          description: Task not found
        '409':
          description: Duplicate dedupeKey
  /tasks/{id}/reminders/{reminderId}:
    delete:
      summary: Delete Task Reminder
      security:
        - BearerAuth: []
      description: Permanently deletes the reminder (FR-REM-06). Parent ownership is enforced by composite foreign keys.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: reminderId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Reminder deleted
        '404':
          description: Task or reminder not found

  /habits/{id}/reminders:
    get:
      summary: List Habit Reminders
      security:
        - BearerAuth: []
      description: Returns all reminders attached to the habit.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Reminders list
          content:
            application/json:
              schema:
                type: object
                properties:
                  reminders:
                    type: array
                    items:
                      $ref: '#/components/schemas/UnifiedReminder'
        '404':
          description: Habit not found
    post:
      summary: Add Habit Reminder
      security:
        - BearerAuth: []
      description: Creates a reminder on the habit (FR-REM-01/02).
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUnifiedReminderRequest'
      responses:
        '201':
          description: Reminder created
          content:
            application/json:
              schema:
                type: object
                properties:
                  reminder:
                    $ref: '#/components/schemas/UnifiedReminder'
        '400':
          description: Validation error
        '404':
          description: Habit not found
        '409':
          description: Duplicate dedupeKey
  /habits/{id}/reminders/{reminderId}:
    delete:
      summary: Delete Habit Reminder
      security:
        - BearerAuth: []
      description: Permanently deletes the reminder (FR-REM-06).
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: reminderId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Reminder deleted
        '404':
          description: Habit or reminder not found

  /subscriptions/{id}/reminders:
    get:
      summary: List Subscription Reminders
      security:
        - BearerAuth: []
      description: Returns all reminders attached to the subscription.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Reminders list
          content:
            application/json:
              schema:
                type: object
                properties:
                  reminders:
                    type: array
                    items:
                      $ref: '#/components/schemas/UnifiedReminder'
        '404':
          description: Subscription not found
    post:
      summary: Add Subscription Reminder
      security:
        - BearerAuth: []
      description: Creates a reminder on the subscription (FR-REM-01/02).
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUnifiedReminderRequest'
      responses:
        '201':
          description: Reminder created
          content:
            application/json:
              schema:
                type: object
                properties:
                  reminder:
                    $ref: '#/components/schemas/UnifiedReminder'
        '400':
          description: Validation error
        '404':
          description: Subscription not found
        '409':
          description: Duplicate dedupeKey
  /subscriptions/{id}/reminders/{reminderId}:
    delete:
      summary: Delete Subscription Reminder
      security:
        - BearerAuth: []
      description: Permanently deletes the reminder (FR-REM-06).
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: reminderId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Reminder deleted
        '404':
          description: Subscription or reminder not found

  /day/today:
    get:
      summary: Daily Plan - Today (Specification Path)
      security:
        - BearerAuth: []
      description: Canonical singular specification path for today's plan in the user's timezone.
      responses:
        '200':
          description: Day view
          content:
            application/json:
              schema:
                type: object
                properties:
                  day:
                    $ref: '#/components/schemas/DayView'
  /day/{date}:
    get:
      summary: Daily Plan - Specific Date (Specification Path)
      security:
        - BearerAuth: []
      description: Canonical singular specification path for a given date in the user's timezone.
      parameters:
        - name: date
          in: path
          required: true
          schema:
            type: string
            pattern: '^\\d{4}-\\d{2}-\\d{2}$'
      responses:
        '200':
          description: Day view
          content:
            application/json:
              schema:
                type: object
                properties:
                  day:
                    $ref: '#/components/schemas/DayView'
        '400':
          description: Invalid date

  /dashboard:
    get:
      summary: Dashboard Overview (Specification Path)
      security:
        - BearerAuth: []
      description: Canonical specification path for aggregated dashboard counts.
      responses:
        '200':
          description: Dashboard overview
          content:
            application/json:
              schema:
                type: object
                properties:
                  overview:
                    $ref: '#/components/schemas/DashboardOverview'

  /analytics:
    get:
      summary: Range Analytics (Real Data)
      security:
        - BearerAuth: []
      description: Aggregates the authenticated user's own tasks, habit check-ins, focus timer sessions, goals and active subscriptions for the requested range. Rates that have no denominator are null (unavailable), never fabricated. Habit consistency is only computed for ranges up to 31 days and is null for longer ranges. Series points are daily up to 31 days and 7-day buckets beyond that.
      parameters:
        - name: days
          in: query
          required: false
          schema:
            type: integer
            enum: [7, 30, 90, 365]
            default: 7
      responses:
        '200':
          description: Analytics summary
          content:
            application/json:
              schema:
                type: object
                properties:
                  analytics:
                    $ref: '#/components/schemas/AnalyticsSummary'
        '400':
          description: Unsupported days range
        '401':
          description: Unauthenticated

  /ai/chat:
    post:
      summary: AI Assistant Chat (Server Proxy)
      security:
        - BearerAuth: []
      description: Relays the conversation to Gemini with the central server key; clients never hold a provider key. The system prompt, model and generation parameters are server-owned. Disabled (AI_ENABLED off or no key configured) returns 503 AI_DISABLED before any quota is consumed. Per-user minute and daily quotas apply (429 RATE_LIMITED). Prompts and replies are never logged.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AiChatRequest'
      responses:
        '200':
          description: Model reply
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AiChatResponse'
        '400':
          description: Invalid messages payload
        '401':
          description: Unauthenticated
        '429':
          description: Per-user AI quota exceeded
        '502':
          description: AI provider failure
        '503':
          description: AI disabled or provider busy

  /ai/chat/stream:
    post:
      summary: AI Assistant Chat (Streaming)
      security:
        - BearerAuth: []
      description: Same contract and quotas as /ai/chat, answered as text/event-stream. Each event payload is a JSON object with a text field; the stream ends with a [DONE] payload. Errors before the first byte use the standard error envelope; mid-stream failures end the stream with an error event.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AiChatRequest'
      responses:
        '200':
          description: Server-sent event stream of reply chunks
          content:
            text/event-stream:
              schema:
                type: string
        '400':
          description: Invalid messages payload
        '401':
          description: Unauthenticated
        '429':
          description: Per-user AI quota exceeded
        '503':
          description: AI disabled

  /product-events:
    post:
      summary: Record a Content-Free Product Event
      security:
        - BearerAuth: []
      description: >-
        Records one usage event for the Activation and D1/D7/D30 funnel. The
        body carries only an event name from a closed list, the platform and an
        optional app version: no titles, notes, identifiers, free text or
        client timestamps (unknown fields are rejected). The server stamps the
        time and the user's local calendar day; at most one row is kept per
        user, event and local day. Nothing is recorded when the account opted
        out (PATCH /users/me productEventsEnabled=false), when the server kill
        switch is off or before the schema is applied; the response is still
        202 with recorded=false. Rate limit: 60 requests per 60 seconds per
        user.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RecordProductEventRequest'
      responses:
        '202':
          description: Accepted; recorded is false when nothing was stored
          content:
            application/json:
              schema:
                type: object
                properties:
                  recorded:
                    type: boolean
                required:
                  - recorded
        '400':
          description: Validation failed (unknown event, platform or field)
        '401':
          description: Missing or invalid access token
        '429':
          description: Per-user event rate limit exceeded

  /notification-preferences:
    get:
      summary: Read Notification Settings
      security:
        - BearerAuth: []
      description: >-
        Returns the account's settings for the shared notification policy
        (feature guide G2, ADR-046): master switch, quiet hours, daily limit,
        low-priority summary and whether alarms may ring during quiet hours.
        Accounts that never saved settings get the defaults (everything on, no
        quiet hours, no daily limit). Quiet hours are read in the account time
        zone, returned as timeZone. available is false until the owner-run SQL
        is applied; the defaults are returned then. Rate limit: 30 requests per
        60 seconds per user.
      responses:
        '200':
          description: Current settings
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/NotificationPreferences'
        '401':
          description: Missing or invalid access token
        '429':
          description: Per-user rate limit exceeded
    put:
      summary: Replace Notification Settings
      security:
        - BearerAuth: []
      description: >-
        Replaces all settings at once. Unknown fields are rejected. Quiet hours
        use 24-hour HH:MM local times, may cross midnight and need different
        start and end times; null turns them off. dailyLimit is 1-50
        non-critical notifications per local day, or null for no limit;
        notifications over the limit are combined into one summary
        notification. Rate limit: 30 requests per 60 seconds per user.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/NotificationPreferencesRequest'
      responses:
        '200':
          description: Saved settings
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/NotificationPreferences'
        '400':
          description: Validation failed
        '401':
          description: Missing or invalid access token
        '429':
          description: Per-user rate limit exceeded
        '503':
          description: NOTIFICATION_PREFERENCES_UNAVAILABLE before the owner-run SQL is applied

  /sessions:
    get:
      summary: List Signed-in Devices
      security:
        - BearerAuth: []
      description: >-
        Active sessions of the authenticated account (feature guide G6,
        ADR-047): not revoked and not past their absolute expiry. The session
        that made the request comes first and has current true; the rest follow
        by last use. Only device metadata is returned: never an IP address, a
        token or a token hash. At most 50 sessions are listed; truncated says
        whether more exist. Rate limit: 30 requests per 60 seconds per user.
      responses:
        '200':
          description: Signed-in devices
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SessionList'
        '401':
          description: Missing or invalid access token
        '429':
          description: Per-user rate limit exceeded

  /sessions/{id}/revoke:
    post:
      summary: Sign Out One Device
      security:
        - BearerAuth: []
      description: >-
        Ends one session of the authenticated account after checking the
        current password: the session is revoked, its refresh tokens stop
        working and the push devices it registered are removed, in one
        transaction. Access tokens of that session are rejected on their next
        request. A session id that is unknown or belongs to another account
        answers 404. Revoking a session that already ended answers 200 again.
        current is true when the caller signed out its own session; the app
        then finishes signing out. Rate limits: 30 requests per 60 seconds per
        user, and the shared re-authentication budget of 5 attempts per 15
        minutes per account (also used by change-password, account deletion
        and export).
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RevokeSessionRequest'
      responses:
        '200':
          description: The session is ended
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RevokeSessionResult'
        '400':
          description: Validation failed
        '401':
          description: Missing or invalid access token
        '403':
          description: REAUTHENTICATION_FAILED (wrong current password)
        '404':
          description: No such session for this account
        '429':
          description: Rate limit or re-authentication budget exceeded

  /search:
    get:
      summary: Global Search
      security:
        - BearerAuth: []
      description: Searches tasks, notes, habits, projects, events, goals, and subscriptions (title/full-text) and merges the results. Retired financial transactions are not searchable.
      parameters:
        - name: q
          in: query
          required: true
          schema:
            type: string
            minLength: 1
            maxLength: 120
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 50
            default: 10
      responses:
        '200':
          description: Search results grouped by entity type
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SearchResults'
        '400':
          description: Missing or invalid q

  /habits:
    get:
      summary: List Habits
      security:
        - BearerAuth: []
      description: Returns all active (and optionally archived) habits ordered by sortOrder.
      parameters:
        - name: includeArchived
          in: query
          required: false
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: Habits list
          content:
            application/json:
              schema:
                type: object
                properties:
                  habits:
                    type: array
                    items:
                      $ref: '#/components/schemas/Habit'
                required:
                  - habits
    post:
      summary: Create Habit
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateHabitRequest'
      responses:
        '201':
          description: Habit created
          content:
            application/json:
              schema:
                type: object
                properties:
                  habit:
                    $ref: '#/components/schemas/Habit'
                required:
                  - habit
        '400':
          $ref: '#/components/responses/ValidationError'

  /habits/progress/today:
    get:
      summary: Today Habits Progress
      security:
        - BearerAuth: []
      description: Returns daily habit completion metrics and individual habit progress items for a given date.
      parameters:
        - name: date
          in: query
          required: false
          schema:
            type: string
            format: date
          description: Calendar date (YYYY-MM-DD) in user timezone. Defaults to today.
      responses:
        '200':
          description: Today progress summary
          content:
            application/json:
              schema:
                type: object
                properties:
                  progress:
                    $ref: '#/components/schemas/TodayProgress'
                required:
                  - progress

  /habits/{id}:
    get:
      summary: Get Habit
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Habit details
          content:
            application/json:
              schema:
                type: object
                properties:
                  habit:
                    $ref: '#/components/schemas/Habit'
                required:
                  - habit
        '404':
          description: Habit not found
    patch:
      summary: Update Habit
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateHabitRequest'
      responses:
        '200':
          description: Habit updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  habit:
                    $ref: '#/components/schemas/Habit'
                required:
                  - habit
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Habit not found
    delete:
      summary: Delete Habit (Soft-Delete)
      security:
        - BearerAuth: []
      description: Soft-deletes a habit. Can be restored within 30 days.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Habit soft-deleted
        '404':
          description: Habit not found

  /habits/{id}/restore:
    post:
      summary: Restore Habit
      security:
        - BearerAuth: []
      description: Restores a soft-deleted habit if within the 30-day restore window.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Habit restored
          content:
            application/json:
              schema:
                type: object
                properties:
                  habit:
                    $ref: '#/components/schemas/Habit'
                required:
                  - habit
        '404':
          description: Habit not found
        '410':
          description: Habit soft-delete restore window has expired

  /habits/{id}/checkins:
    get:
      summary: List Habit Check-ins
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: fromDate
          in: query
          required: false
          schema:
            type: string
            format: date
        - name: toDate
          in: query
          required: false
          schema:
            type: string
            format: date
      responses:
        '200':
          description: Check-in records
          content:
            application/json:
              schema:
                type: object
                properties:
                  checkins:
                    type: array
                    items:
                      $ref: '#/components/schemas/HabitCheckin'
                required:
                  - checkins
        '404':
          description: Habit not found

  /habits/{id}/checkins/{date}:
    put:
      summary: Record or Update Habit Check-in
      security:
        - BearerAuth: []
      description: Records, toggles, or updates a check-in on a specific date. Future dates and unscheduled dates are rejected.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: date
          in: path
          required: true
          schema:
            type: string
            format: date
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PutCheckinRequest'
      responses:
        '200':
          description: Check-in saved and habit streaks updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  checkin:
                    $ref: '#/components/schemas/HabitCheckin'
                  habit:
                    $ref: '#/components/schemas/Habit'
                required:
                  - checkin
                  - habit
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Habit not found
    delete:
      summary: Delete Habit Check-in
      security:
        - BearerAuth: []
      description: Removes a check-in for a given date and recalculates streak values.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: date
          in: path
          required: true
          schema:
            type: string
            format: date
      responses:
        '204':
          description: Check-in deleted
        '404':
          description: Check-in or habit not found

  # Phase P6: Calendar & Events Endpoints
  /events:
    get:
      summary: List Calendar Events
      security:
        - BearerAuth: []
      description: Returns calendar events matching optional date range filters, ordered chronologically by startAt.
      parameters:
        - name: from
          in: query
          required: false
          schema:
            type: string
            format: date-time
        - name: to
          in: query
          required: false
          schema:
            type: string
            format: date-time
        - name: includeDeleted
          in: query
          required: false
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: List of events
          content:
            application/json:
              schema:
                type: object
                properties:
                  events:
                    type: array
                    items:
                      $ref: '#/components/schemas/Event'
                required:
                  - events
    post:
      summary: Create Calendar Event
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateEventRequest'
      responses:
        '201':
          description: Event created
          content:
            application/json:
              schema:
                type: object
                properties:
                  event:
                    $ref: '#/components/schemas/Event'
                required:
                  - event
        '400':
          $ref: '#/components/responses/ValidationError'

  /events/conflicts:
    get:
      summary: Check Event Conflicts
      security:
        - BearerAuth: []
      description: Identifies overlapping calendar events for a proposed time interval.
      parameters:
        - name: startAt
          in: query
          required: true
          schema:
            type: string
            format: date-time
        - name: endAt
          in: query
          required: true
          schema:
            type: string
            format: date-time
        - name: excludeEventId
          in: query
          required: false
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Conflict check results
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConflictResponse'
        '400':
          $ref: '#/components/responses/ValidationError'

  /events/agenda:
    get:
      summary: Daily Agenda View
      security:
        - BearerAuth: []
      description: Returns all calendar events occurring on a specific date in the user timezone.
      parameters:
        - name: date
          in: query
          required: false
          schema:
            type: string
            format: date
          description: Calendar date (YYYY-MM-DD) in user timezone. Defaults to today.
      responses:
        '200':
          description: Daily agenda summary
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AgendaResponse'

  /events/{id}:
    get:
      summary: Get Calendar Event
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Event details
          content:
            application/json:
              schema:
                type: object
                properties:
                  event:
                    $ref: '#/components/schemas/Event'
                required:
                  - event
        '404':
          description: Event not found
    patch:
      summary: Update Calendar Event
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateEventRequest'
      responses:
        '200':
          description: Event updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  event:
                    $ref: '#/components/schemas/Event'
                required:
                  - event
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Event not found
        '409':
          description: Version conflict (optimistic lock mismatch)
    delete:
      summary: Delete Calendar Event (Soft-Delete)
      security:
        - BearerAuth: []
      description: Soft-deletes event and cancels any associated pending reminders.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Event soft-deleted
        '404':
          description: Event not found

  /events/{id}/restore:
    post:
      summary: Restore Calendar Event
      security:
        - BearerAuth: []
      description: Restores a soft-deleted event if within the 30-day restore window.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Event restored
          content:
            application/json:
              schema:
                type: object
                properties:
                  event:
                    $ref: '#/components/schemas/Event'
                required:
                  - event
        '404':
          description: Event not found
        '410':
          description: Event soft-delete restore window has expired

  /events/{id}/reminders:
    get:
      summary: List Event Reminders
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Reminders for event
          content:
            application/json:
              schema:
                type: object
                properties:
                  reminders:
                    type: array
                    items:
                      $ref: '#/components/schemas/Reminder'
                required:
                  - reminders
        '404':
          description: Event not found
    post:
      summary: Add Reminder to Event
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateReminderRequest'
      responses:
        '201':
          description: Reminder created
          content:
            application/json:
              schema:
                type: object
                properties:
                  reminder:
                    $ref: '#/components/schemas/Reminder'
                required:
                  - reminder
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Event not found

  /events/{id}/reminders/{reminderId}:
    delete:
      summary: Delete Event Reminder
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: reminderId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Reminder deleted
        '404':
          description: Reminder or event not found

  # Phase P7: Goals & Milestones Endpoints
  /goals:
    get:
      summary: List Goals
      security:
        - BearerAuth: []
      description: Returns user goals with optional status, progressType, and soft-delete filters.
      parameters:
        - name: status
          in: query
          required: false
          schema:
            $ref: '#/components/schemas/GoalStatus'
        - name: progressType
          in: query
          required: false
          schema:
            $ref: '#/components/schemas/GoalProgressType'
        - name: includeDeleted
          in: query
          required: false
          schema:
            type: boolean
            default: false
      responses:
        '200':
          description: List of goals
          content:
            application/json:
              schema:
                type: object
                properties:
                  goals:
                    type: array
                    items:
                      $ref: '#/components/schemas/Goal'
                required:
                  - goals
    post:
      summary: Create Goal
      security:
        - BearerAuth: []
      description: Creates a new numeric or milestones goal.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateGoalRequest'
      responses:
        '201':
          description: Goal created
          content:
            application/json:
              schema:
                type: object
                properties:
                  goal:
                    $ref: '#/components/schemas/Goal'
                required:
                  - goal
        '400':
          $ref: '#/components/responses/ValidationError'

  /goals/{id}:
    get:
      summary: Get Goal
      security:
        - BearerAuth: []
      description: Returns goal details, including progress percentage and milestones if applicable.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Goal details
          content:
            application/json:
              schema:
                type: object
                properties:
                  goal:
                    $ref: '#/components/schemas/Goal'
                required:
                  - goal
        '404':
          description: Goal not found
    patch:
      summary: Update Goal
      security:
        - BearerAuth: []
      description: Updates goal properties, progress values, or lifecycle status.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateGoalRequest'
      responses:
        '200':
          description: Goal updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  goal:
                    $ref: '#/components/schemas/Goal'
                required:
                  - goal
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Goal not found
        '409':
          description: Version conflict
    delete:
      summary: Delete Goal (Soft-Delete)
      security:
        - BearerAuth: []
      description: Soft-deletes a goal.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Goal soft-deleted
        '404':
          description: Goal not found

  /goals/{id}/restore:
    post:
      summary: Restore Goal
      security:
        - BearerAuth: []
      description: Restores a soft-deleted goal if within 30-day restore window.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Goal restored
          content:
            application/json:
              schema:
                type: object
                properties:
                  goal:
                    $ref: '#/components/schemas/Goal'
                required:
                  - goal
        '404':
          description: Goal not found
        '410':
          description: Goal soft-delete restore window has expired

  /goals/{id}/milestones:
    get:
      summary: List Milestones
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Milestones list
          content:
            application/json:
              schema:
                type: object
                properties:
                  milestones:
                    type: array
                    items:
                      $ref: '#/components/schemas/Milestone'
                required:
                  - milestones
        '404':
          description: Goal not found
    post:
      summary: Create Milestone
      security:
        - BearerAuth: []
      description: Adds a milestone to a milestone-type goal.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateMilestoneRequest'
      responses:
        '201':
          description: Milestone created
          content:
            application/json:
              schema:
                type: object
                properties:
                  milestone:
                    $ref: '#/components/schemas/Milestone'
                required:
                  - milestone
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Goal not found

  /goals/{id}/milestones/{milestoneId}:
    get:
      summary: Get Milestone
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: milestoneId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Milestone details
          content:
            application/json:
              schema:
                type: object
                properties:
                  milestone:
                    $ref: '#/components/schemas/Milestone'
                required:
                  - milestone
        '404':
          description: Milestone or goal not found
    patch:
      summary: Update Milestone
      security:
        - BearerAuth: []
      description: Updates milestone title, dueDate, sortOrder, or completion status.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: milestoneId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateMilestoneRequest'
      responses:
        '200':
          description: Milestone updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  milestone:
                    $ref: '#/components/schemas/Milestone'
                required:
                  - milestone
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Milestone or goal not found
        '409':
          description: Version conflict
    delete:
      summary: Delete Milestone
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: milestoneId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Milestone deleted
        '404':
          description: Milestone or goal not found

  # Phase P8: Notes & Linking Endpoints
  /notes:
    get:
      summary: List Notes
      security:
        - BearerAuth: []
      description: Returns user notes ordered by isPinned DESC, updatedAt DESC. Omits body and includes 200-char excerpt. Supports tag, isPinned, entity-link filters, and full-text search via q.
      parameters:
        - name: q
          in: query
          required: false
          schema:
            type: string
        - name: tag
          in: query
          required: false
          schema:
            type: string
        - name: isPinned
          in: query
          required: false
          schema:
            type: boolean
        - name: taskId
          in: query
          required: false
          schema:
            type: string
            format: uuid
        - name: projectId
          in: query
          required: false
          schema:
            type: string
            format: uuid
        - name: goalId
          in: query
          required: false
          schema:
            type: string
            format: uuid
        - name: habitId
          in: query
          required: false
          schema:
            type: string
            format: uuid
        - name: eventId
          in: query
          required: false
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: List of notes
          content:
            application/json:
              schema:
                type: object
                properties:
                  notes:
                    type: array
                    items:
                      $ref: '#/components/schemas/NoteListItem'
                required:
                  - notes
    post:
      summary: Create Note
      security:
        - BearerAuth: []
      description: Creates a new note with optional title, body, tags (<=20), and links. At least title or body must be present.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateNoteRequest'
      responses:
        '201':
          description: Note created
          content:
            application/json:
              schema:
                type: object
                properties:
                  note:
                    $ref: '#/components/schemas/Note'
                required:
                  - note
        '400':
          $ref: '#/components/responses/ValidationError'
        '409':
          description: Quota exceeded

  /notes/tags:
    get:
      summary: List Note Tags
      security:
        - BearerAuth: []
      description: Returns aggregated tag counts for active notes owned by the caller.
      responses:
        '200':
          description: List of tags with counts
          content:
            application/json:
              schema:
                type: object
                properties:
                  tags:
                    type: array
                    items:
                      $ref: '#/components/schemas/TagCount'
                required:
                  - tags

  /notes/{id}:
    get:
      summary: Get Note
      security:
        - BearerAuth: []
      description: Returns note details, including full body and polymorphic entity links.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Note details
          content:
            application/json:
              schema:
                type: object
                properties:
                  note:
                    $ref: '#/components/schemas/Note'
                required:
                  - note
        '404':
          description: Note not found
    patch:
      summary: Update Note
      security:
        - BearerAuth: []
      description: Updates note title, body, tags, isPinned, or links. Supports optimistic locking via version.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateNoteRequest'
      responses:
        '200':
          description: Note updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  note:
                    $ref: '#/components/schemas/Note'
                required:
                  - note
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Note not found
        '409':
          description: Version conflict
    delete:
      summary: Delete Note
      security:
        - BearerAuth: []
      description: Soft-deletes a note. Retains links for 30-day restoration window.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Note soft-deleted
        '404':
          description: Note not found

  /notes/{id}/restore:
    post:
      summary: Restore Note
      security:
        - BearerAuth: []
      description: Restores a soft-deleted note if within the 30-day window.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Note restored
          content:
            application/json:
              schema:
                type: object
                properties:
                  note:
                    $ref: '#/components/schemas/Note'
                required:
                  - note
        '404':
          description: Note not found
        '409':
          description: Note is not deleted
        '410':
          description: Note soft-delete restore window has expired

  /notes/{id}/links:
    get:
      summary: List Note Links
      security:
        - BearerAuth: []
      description: Lists all polymorphic entity links for the specified note.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: List of note links
          content:
            application/json:
              schema:
                type: object
                properties:
                  links:
                    type: array
                    items:
                      $ref: '#/components/schemas/NoteLink'
                required:
                  - links
        '404':
          description: Note not found
    post:
      summary: Add Note Link
      security:
        - BearerAuth: []
      description: Links note to an owned task, project, goal, habit, or event.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateNoteLinkRequest'
      responses:
        '201':
          description: Note link created
          content:
            application/json:
              schema:
                type: object
                properties:
                  link:
                    $ref: '#/components/schemas/NoteLink'
                required:
                  - link
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Note or target entity not found
        '409':
          description: Entity already linked to this note

  /notes/{id}/links/{linkId}:
    delete:
      summary: Delete Note Link
      security:
        - BearerAuth: []
      description: Removes a polymorphic link from a note.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: linkId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Note link deleted
        '404':
          description: Note or link not found

  # Retained subscriptions
  /money/subscriptions:
    get:
      summary: List Subscriptions
      description: >
        Active subscriptions show the next scheduled renewal projected in the
        account timezone without recording payment or changing stored dates.
        Pages use the stored billing date and ID as stable cursor keys, so the
        displayed projected dates are not guaranteed to be sorted. Concurrent
        edits can still change a list while paging; clients may sort after a
        complete fetch.
      security:
        - BearerAuth: []
      parameters:
        - name: status
          in: query
          required: false
          schema:
            type: string
            enum: [active, paused, cancelled]
        - name: limit
          in: query
          required: false
          schema:
            type: integer
        - name: cursor
          in: query
          required: false
          schema:
            type: string
      responses:
        '200':
          description: List of subscriptions
          content:
            application/json:
              schema:
                type: object
                properties:
                  subscriptions:
                    type: array
                    items:
                      $ref: '#/components/schemas/Subscription'
                  meta:
                    $ref: '#/components/schemas/PageMeta'
                required:
                  - subscriptions
                  - meta
    post:
      summary: Create Subscription
      security:
        - BearerAuth: []
      description: Creates a recurring subscription with drift-free anchor date cycle math.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateSubscriptionRequest'
      responses:
        '201':
          description: Subscription created
          content:
            application/json:
              schema:
                type: object
                properties:
                  subscription:
                    $ref: '#/components/schemas/Subscription'
                required:
                  - subscription
        '400':
          $ref: '#/components/responses/ValidationError'
        '409':
          description: Quota exceeded

  /money/subscriptions/{id}:
    get:
      summary: Get Subscription
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Subscription details
          content:
            application/json:
              schema:
                type: object
                properties:
                  subscription:
                    $ref: '#/components/schemas/Subscription'
                required:
                  - subscription
        '404':
          description: Subscription not found
    patch:
      summary: Update Subscription
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateSubscriptionRequest'
      responses:
        '200':
          description: Subscription updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  subscription:
                    $ref: '#/components/schemas/Subscription'
                required:
                  - subscription
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          description: Subscription not found
        '409':
          description: Version conflict
    delete:
      summary: Delete Subscription
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Subscription deleted
        '404':
          description: Subscription not found

  /ingest/token:
    delete:
      summary: Revoke ingest token
      description: Revokes the ingest token of the caller's current session.
      security:
        - BearerAuth: []
      responses:
        '204':
          description: Ingest token revoked
        '401':
          description: Access token missing, invalid, or expired
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: Bearer JWT Access Token (15-minute lifetime)
  schemas:
    RegisterRequest:
      type: object
      properties:
        email:
          type: string
          format: email
        password:
          type: string
          format: password
          minLength: 8
          maxLength: 128
        displayName:
          type: string
          minLength: 1
          maxLength: 100
        timezone:
          type: string
          default: UTC
          example: Europe/London
        locale:
          type: string
          default: en
        weekStart:
          type: integer
          minimum: 0
          maximum: 6
          default: 1
        defaultCurrency:
          type: string
          minLength: 3
          maxLength: 3
          default: USD
      required:
        - email
        - password
        - displayName

    LoginRequest:
      type: object
      properties:
        email:
          type: string
          format: email
        password:
          type: string
          format: password
        deviceName:
          type: string
        devicePlatform:
          type: string
          enum: [ios, android, unknown]
          default: unknown
        appVersion:
          type: string
      required:
        - email
        - password

    RefreshTokenRequest:
      type: object
      properties:
        refreshToken:
          type: string
      required:
        - refreshToken

    ResetPasswordRequest:
      type: object
      properties:
        email:
          type: string
          format: email
        code:
          type: string
          minLength: 6
          maxLength: 6
        newPassword:
          type: string
          format: password
          minLength: 8
          maxLength: 128
      required:
        - email
        - code
        - newPassword

    ChangePasswordRequest:
      type: object
      properties:
        currentPassword:
          type: string
          format: password
        newPassword:
          type: string
          format: password
          minLength: 8
          maxLength: 128
      required:
        - currentPassword
        - newPassword

    UpdateProfileRequest:
      type: object
      properties:
        displayName:
          type: string
          maxLength: 100
        timezone:
          type: string
        locale:
          type: string
        weekStart:
          type: integer
          minimum: 0
          maximum: 6
        defaultCurrency:
          type: string
          minLength: 3
          maxLength: 3
        pushShowTitles:
          type: boolean
        productEventsEnabled:
          type: boolean
          description: Opt in or out of content-free product events. false also deletes the events already recorded for this account.
        onboardingCompleted:
          type: boolean
          const: true
          description: Marks first-run onboarding as completed or skipped. Idempotent; the first time is kept.
      additionalProperties: false

    RecordProductEventRequest:
      type: object
      additionalProperties: false
      properties:
        event:
          type: string
          enum: [app_opened, onboarding_started, onboarding_completed, onboarding_skipped, task_completed, habit_checked_in]
        platform:
          type: string
          enum: [android, ios, unknown]
        appVersion:
          type: string
          pattern: '^[0-9A-Za-z.+-]{1,32}$'
      required:
        - event
        - platform

    NotificationPreferencesRequest:
      type: object
      additionalProperties: false
      properties:
        notificationsEnabled:
          type: boolean
          description: Master switch; false drops every policy-managed notification, alarms included.
        quietHours:
          type: object
          nullable: true
          additionalProperties: false
          properties:
            start:
              type: string
              pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            end:
              type: string
              pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          required:
            - start
            - end
        dailyLimit:
          type: integer
          nullable: true
          minimum: 1
          maximum: 50
        digestEnabled:
          type: boolean
          description: Low-priority notifications join the day's summary instead of arriving one by one.
        criticalBreaksQuiet:
          type: boolean
          description: Alarms the user chose may ring during quiet hours.
      required:
        - notificationsEnabled
        - quietHours
        - dailyLimit
        - digestEnabled
        - criticalBreaksQuiet

    NotificationPreferences:
      allOf:
        - $ref: '#/components/schemas/NotificationPreferencesRequest'
        - type: object
          properties:
            timeZone:
              type: string
              description: Account time zone (IANA) that quiet hours and days are read in.
            available:
              type: boolean
              description: False until the owner-run SQL is applied.
          required:
            - timeZone
            - available

    SessionList:
      type: object
      properties:
        sessions:
          type: array
          items:
            $ref: '#/components/schemas/Session'
        truncated:
          type: boolean
          description: More than 50 active sessions exist; the oldest are not listed.
      required:
        - sessions
        - truncated

    Session:
      type: object
      description: Device metadata of one active session. No IP address, token or hash.
      properties:
        id:
          type: string
          format: uuid
        devicePlatform:
          type: string
          enum: [ios, android, unknown]
        deviceName:
          type: string
          nullable: true
        appVersion:
          type: string
          nullable: true
        createdAt:
          type: string
          format: date-time
        lastUsedAt:
          type: string
          format: date-time
          description: Last sign-in or token refresh of the session.
        current:
          type: boolean
          description: The session that made this request.
      required:
        - id
        - devicePlatform
        - deviceName
        - appVersion
        - createdAt
        - lastUsedAt
        - current

    RevokeSessionRequest:
      type: object
      additionalProperties: false
      properties:
        currentPassword:
          type: string
          minLength: 1
          maxLength: 1024
      required:
        - currentPassword

    RevokeSessionResult:
      type: object
      properties:
        revoked:
          type: boolean
          enum: [true]
        current:
          type: boolean
          description: The caller signed out its own session.
      required:
        - revoked
        - current

    RegisterDeviceRequest:
      type: object
      properties:
        platform:
          type: string
          enum: [ios, android]
        pushToken:
          type: string
        appVersion:
          type: string
      required:
        - platform
        - pushToken

    User:
      type: object
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        displayName:
          type: string
        timezone:
          type: string
        locale:
          type: string
        weekStart:
          type: integer
        defaultCurrency:
          type: string
        status:
          type: string
          enum: [active, disabled, pending_deletion]
        deletionScheduledFor:
          type: string
          format: date-time
          nullable: true
        pushShowTitles:
          type: boolean
        productEventsEnabled:
          type: boolean
          description: Present only when the server supports product events; absent means unsupported.
        onboardingCompletedAt:
          type: string
          format: date-time
          nullable: true
          description: Present only when the server supports onboarding. null means first-run onboarding has not been completed or skipped.
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
      required:
        - id
        - email
        - displayName
        - timezone
        - locale
        - weekStart
        - defaultCurrency
        - status
        - pushShowTitles
        - createdAt
        - updatedAt

    AuthResponse:
      type: object
      properties:
        user:
          $ref: '#/components/schemas/User'
        tokens:
          type: object
          properties:
            accessToken:
              type: string
            refreshToken:
              type: string
            expiresIn:
              type: integer
              example: 900
          required:
            - accessToken
            - refreshToken
            - expiresIn
      required:
        - user
        - tokens

    # Phase P4 Domain Schemas
    Task:
      type: object
      properties:
        id:
          type: string
          format: uuid
        title:
          type: string
          example: Complete architectural review
        description:
          type: string
          nullable: true
        status:
          type: string
          enum: [todo, in_progress, done, cancelled]
        priority:
          type: string
          enum: [none, low, medium, high]
        dueDate:
          type: string
          format: date
          nullable: true
        dueTime:
          type: string
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'
          nullable: true
        plannedDate:
          type: string
          format: date
          nullable: true
        isFocus:
          type: boolean
        estimateMinutes:
          type: integer
          nullable: true
        projectId:
          type: string
          format: uuid
          nullable: true
        recurringTaskId:
          type: string
          format: uuid
          nullable: true
        occurrenceDate:
          type: string
          format: date
          nullable: true
        completedAt:
          type: string
          format: date-time
          nullable: true
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        version:
          type: integer
        trackedSeconds:
          type: integer
          description: Aggregate time tracked on this task
      required:
        - id
        - title
        - status
        - priority
        - isFocus
        - createdAt
        - updatedAt
        - version

    CreateTaskRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 300
        description:
          type: string
          maxLength: 10000
          nullable: true
        status:
          type: string
          enum: [todo, in_progress, done, cancelled]
          default: todo
        priority:
          type: string
          enum: [none, low, medium, high]
          default: none
        dueDate:
          type: string
          format: date
          nullable: true
        dueTime:
          type: string
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'
          nullable: true
        plannedDate:
          type: string
          format: date
          nullable: true
        isFocus:
          type: boolean
          default: false
        estimateMinutes:
          type: integer
          minimum: 1
          maximum: 1440
          nullable: true
        projectId:
          type: string
          format: uuid
          nullable: true
      required:
        - title

    UpdateTaskRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 300
        description:
          type: string
          maxLength: 10000
          nullable: true
        status:
          type: string
          enum: [todo, in_progress, done, cancelled]
        priority:
          type: string
          enum: [none, low, medium, high]
        dueDate:
          type: string
          format: date
          nullable: true
        dueTime:
          type: string
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'
          nullable: true
        plannedDate:
          type: string
          format: date
          nullable: true
        isFocus:
          type: boolean
        estimateMinutes:
          type: integer
          minimum: 1
          maximum: 1440
          nullable: true
        projectId:
          type: string
          format: uuid
          nullable: true
        version:
          type: integer
          minimum: 1

    Project:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
          example: Mobile App Redesign
        description:
          type: string
          nullable: true
        status:
          type: string
          enum: [active, on_hold, completed, archived]
        color:
          type: string
          pattern: '^#[0-9A-Fa-f]{6}$'
          nullable: true
        goalId:
          type: string
          format: uuid
          nullable: true
        dueDate:
          type: string
          format: date
          nullable: true
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        version:
          type: integer
        taskCounts:
          type: object
          properties:
            open:
              type: integer
            done:
              type: integer
          required:
            - open
            - done
      required:
        - id
        - name
        - status
        - createdAt
        - updatedAt
        - version
        - taskCounts

    CreateProjectRequest:
      type: object
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 120
        description:
          type: string
          maxLength: 5000
          nullable: true
        status:
          type: string
          enum: [active, on_hold, completed, archived]
          default: active
        color:
          type: string
          pattern: '^#[0-9A-Fa-f]{6}$'
          nullable: true
        goalId:
          type: string
          format: uuid
          nullable: true
        dueDate:
          type: string
          format: date
          nullable: true
      required:
        - name

    UpdateProjectRequest:
      type: object
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 120
        description:
          type: string
          maxLength: 5000
          nullable: true
        status:
          type: string
          enum: [active, on_hold, completed, archived]
        color:
          type: string
          pattern: '^#[0-9A-Fa-f]{6}$'
          nullable: true
        goalId:
          type: string
          format: uuid
          nullable: true
        dueDate:
          type: string
          format: date
          nullable: true
        version:
          type: integer
          minimum: 1

    RecurrenceDefinition:
      type: object
      properties:
        id:
          type: string
          format: uuid
        freq:
          type: string
          enum: [daily, weekly, monthly, yearly]
        interval:
          type: integer
          minimum: 1
          default: 1
        byWeekday:
          type: array
          items:
            type: integer
            minimum: 1
            maximum: 7
          nullable: true
        byMonthDay:
          type: integer
          nullable: true
        byMonth:
          type: integer
          minimum: 1
          maximum: 12
          nullable: true
        startDate:
          type: string
          format: date
        endDate:
          type: string
          format: date
          nullable: true
        occurrenceLimit:
          type: integer
          minimum: 1
          nullable: true
      required:
        - freq
        - interval
        - startDate

    RecurringTask:
      type: object
      properties:
        id:
          type: string
          format: uuid
        title:
          type: string
        description:
          type: string
          nullable: true
        projectId:
          type: string
          format: uuid
          nullable: true
        priority:
          type: string
          enum: [none, low, medium, high]
        estimateMinutes:
          type: integer
          nullable: true
        dueTime:
          type: string
          nullable: true
        reminderOffsetMinutes:
          type: integer
          nullable: true
        status:
          type: string
          enum: [active, paused, ended]
        generatedThrough:
          type: string
          format: date
          nullable: true
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        version:
          type: integer
        recurrence:
          $ref: '#/components/schemas/RecurrenceDefinition'
      required:
        - id
        - title
        - priority
        - status
        - createdAt
        - updatedAt
        - version
        - recurrence

    CreateRecurringTaskRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 300
        description:
          type: string
          maxLength: 10000
          nullable: true
        projectId:
          type: string
          format: uuid
          nullable: true
        priority:
          type: string
          enum: [none, low, medium, high]
          default: none
        estimateMinutes:
          type: integer
          minimum: 1
          maximum: 1440
          nullable: true
        dueTime:
          type: string
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'
          nullable: true
        reminderOffsetMinutes:
          type: integer
          minimum: 0
          maximum: 43200
          nullable: true
        status:
          type: string
          enum: [active, paused, ended]
          default: active
        recurrence:
          type: object
          properties:
            freq:
              type: string
              enum: [daily, weekly, monthly, yearly]
            interval:
              type: integer
              minimum: 1
              default: 1
            byWeekday:
              type: array
              items:
                type: integer
                minimum: 1
                maximum: 7
              nullable: true
            byMonthDay:
              type: integer
              nullable: true
            byMonth:
              type: integer
              minimum: 1
              maximum: 12
              nullable: true
            startDate:
              type: string
              format: date
            endDate:
              type: string
              format: date
              nullable: true
            occurrenceLimit:
              type: integer
              minimum: 1
              nullable: true
          required:
            - freq
            - startDate
      required:
        - title
        - recurrence

    UpdateRecurringTaskRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 300
        description:
          type: string
          maxLength: 10000
          nullable: true
        projectId:
          type: string
          format: uuid
          nullable: true
        priority:
          type: string
          enum: [none, low, medium, high]
        estimateMinutes:
          type: integer
          minimum: 1
          maximum: 1440
          nullable: true
        dueTime:
          type: string
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'
          nullable: true
        reminderOffsetMinutes:
          type: integer
          minimum: 0
          maximum: 43200
          nullable: true
        status:
          type: string
          enum: [active, paused, ended]
        recurrence:
          type: object
        version:
          type: integer
          minimum: 1

    TimerSession:
      type: object
      properties:
        id:
          type: string
          format: uuid
        taskId:
          type: string
          format: uuid
          nullable: true
        startedAt:
          type: string
          format: date-time
        endedAt:
          type: string
          format: date-time
          nullable: true
        mode:
          type: string
          enum: [stopwatch, countdown]
        plannedSeconds:
          type: integer
          nullable: true
        durationSeconds:
          type: integer
          description: Elapsed seconds derived from timestamps
        endReason:
          type: string
          enum: [stopped, completed, auto_closed]
          nullable: true
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
      required:
        - id
        - taskId
        - startedAt
        - mode
        - durationSeconds
        - createdAt
        - updatedAt

    CreateTimerSessionRequest:
      type: object
      properties:
        taskId:
          type: string
          format: uuid
          nullable: true
          description: Optional. When set, the task must belong to the user.
        mode:
          type: string
          enum: [stopwatch, countdown]
          default: stopwatch
        plannedSeconds:
          type: integer
          minimum: 60
          maximum: 43200
          nullable: true

    ApiErrorEnvelope:
      type: object
      properties:
        success:
          type: boolean
          example: false
        error:
          type: object
          properties:
            code:
              type: string
              example: VALIDATION_ERROR
            message:
              type: string
              example: Invalid request parameters
            requestId:
              type: string
              format: uuid
            details:
              type: array
              items:
                type: object
                properties:
                  field:
                    type: string
                  code:
                    type: string
                  message:
                    type: string
                required:
                  - field
                  - message
          required:
            - code
            - message
            - requestId
      required:
        - success
        - error

    HabitFrequencyType:
      type: string
      enum:
        - daily
        - weekly
        - monthly
        - days_per_week
        - days_per_month

    HabitRecurrenceRule:
      type: object
      properties:
        frequencyType:
          $ref: '#/components/schemas/HabitFrequencyType'
        interval:
          type: integer
          example: 1
        daysOfWeek:
          type: array
          items:
            type: integer
          example: [1, 2, 3, 4, 5]
        daysOfMonth:
          type: array
          items:
            type: integer
        targetDays:
          type: integer
      required:
        - frequencyType

    HabitCheckinStatus:
      type: string
      enum:
        - done
        - skip
        - fail

    DayView:
      type: object
      description: Daily Plan view composed from read-only feature readers (P1-05).
      properties:
        date:
          type: string
          example: '2026-10-11'
        timezone:
          type: string
          example: UTC
        tasks:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              title: { type: string }
              description: { type: string, nullable: true }
              status: { type: string }
              priority: { type: integer }
              dueDate: { type: string, nullable: true }
              dueTime: { type: string, nullable: true }
              plannedDate: { type: string, nullable: true }
              isFocus: { type: boolean }
              estimateMinutes: { type: integer, nullable: true }
        habits:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              name: { type: string }
              color: { type: string, nullable: true }
              reminderTime: { type: string, nullable: true }
              status: { type: string }
              completedOn: { type: boolean }
              dueOn: { type: boolean }
        events:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              title: { type: string }
              startAt: { type: string, format: date-time }
              endAt: { type: string, format: date-time }
              allDay: { type: boolean }
              location: { type: string, nullable: true }
        subscriptionsDue:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              name: { type: string }
              amountMinor: { type: string, pattern: '^-?[0-9]+$' }
              currencyExponent: { type: integer }
              currency: { type: string }
              billingUnit: { type: string }
              nextBillingDate: { type: string }
        activeTimer:
          type: object
          nullable: true
          properties:
            id: { type: string, format: uuid }
            taskId: { type: string, format: uuid, nullable: true }
            taskTitle: { type: string, nullable: true }
            startedAt: { type: string, format: date-time }
            mode: { type: string }
            plannedSeconds: { type: integer, nullable: true }
      required:
        - date
        - timezone
        - tasks
        - habits
        - events
        - subscriptionsDue
    DashboardOverview:
      type: object
      description: Dashboard aggregates (P1-05).
      properties:
        date: { type: string }
        timezone: { type: string }
        tasks:
          type: object
          properties:
            dueToday: { type: integer }
            doneToday: { type: integer }
            overdue: { type: integer }
        habits:
          type: object
          properties:
            dueToday: { type: integer }
            completedToday: { type: integer }
        eventsToday: { type: integer }
        subscriptionsDueNext7Days:
          type: object
          properties:
            count: { type: integer }
            totalMinorByCurrency:
              type: object
              additionalProperties: { type: string }
        activeSubscriptions: { type: integer }
        activeTimer:
          type: object
          nullable: true
          properties:
            id: { type: string, format: uuid }
            taskId: { type: string, format: uuid, nullable: true }
            startedAt: { type: string, format: date-time }
      required:
        - date
        - timezone
        - tasks
        - habits
        - eventsToday
        - subscriptionsDueNext7Days
        - activeSubscriptions
    AiChatRequest:
      type: object
      description: Conversation turns for the AI proxy. The last turn must be from the user. At most 21 turns, 4000 characters per turn, 24000 characters in total.
      properties:
        messages:
          type: array
          items:
            type: object
            properties:
              role:
                type: string
                enum: [user, model]
              text:
                type: string
            required:
              - role
              - text
        language:
          type: string
          description: Preferred reply language name (letters and spaces only, at most 35 characters)
        mode:
          type: string
          enum: [chat, brief]
          default: chat
          description: Server-owned generation profile; brief is the short daily-briefing profile
      required:
        - messages
    AiChatResponse:
      type: object
      properties:
        reply:
          type: string
      required:
        - reply
    AnalyticsSummary:
      type: object
      description: Range-based real analytics (no demo data). Nullable rates are unavailable, not zero.
      properties:
        rangeDays: { type: integer }
        from: { type: string, format: date }
        to: { type: string, format: date }
        timezone: { type: string }
        tasks:
          type: object
          properties:
            completedInRange: { type: integer }
            createdInRange: { type: integer }
            pendingNow: { type: integer }
            overdueNow: { type: integer }
            completionRatePercent: { type: number, nullable: true }
        habits:
          type: object
          properties:
            activeHabits: { type: integer }
            checkinsDoneInRange: { type: integer }
            consistencyPercent: { type: number, nullable: true }
        focus:
          type: object
          properties:
            sessionsInRange: { type: integer }
            totalMinutes: { type: number }
        goals:
          type: object
          properties:
            active: { type: integer }
            achievedTotal: { type: integer }
            achievedInRange: { type: integer }
            averageNumericProgressPercent: { type: number, nullable: true }
        subscriptions:
          type: object
          properties:
            active: { type: integer }
            dueNext7Days: { type: integer }
        series:
          type: array
          items:
            type: object
            properties:
              date: { type: string, format: date }
              tasksCompleted: { type: integer }
              habitCheckins: { type: integer }
              focusMinutes: { type: number }
      required:
        - rangeDays
        - from
        - to
        - timezone
        - tasks
        - habits
        - focus
        - goals
        - subscriptions
        - series
    SearchResults:
      type: object
      description: Global search results grouped by entity type (P1-05).
      properties:
        query: { type: string }
        tasks:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              title: { type: string }
        notes:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              title: { type: string, nullable: true }
              excerpt: { type: string, nullable: true }
        habits:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              name: { type: string }
        projects:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              name: { type: string }
        events:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              title: { type: string }
        goals:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              title: { type: string }
              status: { type: string }
        subscriptions:
          type: array
          items:
            type: object
            properties:
              id: { type: string, format: uuid }
              name: { type: string }
              status: { type: string }
              nextBillingDate: { type: string, format: date }
      required:
        - query
        - tasks
        - notes
        - habits
        - projects
        - events
        - goals
        - subscriptions
    UnifiedReminder:
      type: object
      description: Unified reminder attached to a task, habit, event, or subscription parent (FR-REM-01..06).
      properties:
        id:
          type: string
          format: uuid
        entityType:
          type: string
          enum: [task, habit, event, subscription]
        entityId:
          type: string
          format: uuid
        source:
          type: string
          enum: [user, system]
        remindAt:
          type: string
          format: date-time
        offsetMinutes:
          type: integer
          nullable: true
        channel:
          type: string
          enum: [push, in_app, email]
        status:
          type: string
          enum: [pending, processing, sent, failed, cancelled]
        nextAttemptAt:
          type: string
          format: date-time
          nullable: true
        attemptCount:
          type: integer
          minimum: 0
        sentAt:
          type: string
          format: date-time
          nullable: true
        failedAt:
          type: string
          format: date-time
          nullable: true
        lastErrorCode:
          type: string
          nullable: true
        dedupeKey:
          type: string
          nullable: true
        createdAt:
          type: string
          format: date-time
      required:
        - id
        - entityType
        - entityId
        - source
        - remindAt
        - channel
        - status
        - createdAt
    CreateUserReminderRequest:
      type: object
      description: Canonical top-level reminder input. User reminders target an owned task or event; exactly one schedule mode is accepted.
      properties:
        entityType:
          type: string
          enum: [task, event]
        entityId:
          type: string
          format: uuid
        remindAt:
          type: string
          format: date-time
        offsetMinutes:
          type: integer
          minimum: 0
          maximum: 43200
          nullable: true
        channel:
          type: string
          enum: [push, in_app]
          default: in_app
      required:
        - entityType
        - entityId
    UpdateUserReminderRequest:
      type: object
      description: Editable fields for a pending user-authored reminder. At least one field is required; remindAt and offsetMinutes are mutually exclusive.
      properties:
        remindAt:
          type: string
          format: date-time
        offsetMinutes:
          type: integer
          minimum: 0
          maximum: 43200
        channel:
          type: string
          enum: [push, in_app]
    CreateUnifiedReminderRequest:
      type: object
      description: Manual reminder input. Exactly one of remindAt or offsetMinutes must be provided (FR-REM-02).
      properties:
        remindAt:
          type: string
          format: date-time
        offsetMinutes:
          type: integer
          nullable: true
        channel:
          type: string
          enum: [push, in_app, email]
          default: in_app
        dedupeKey:
          type: string
          nullable: true
      required:
        - remindAt
    Habit:
      type: object
      properties:
        id:
          type: string
          format: uuid
        userId:
          type: string
          format: uuid
        title:
          type: string
          example: Morning Meditation
        description:
          type: string
          nullable: true
          example: 10 minutes mindful breathing
        color:
          type: string
          example: '#4F46E5'
        icon:
          type: string
          nullable: true
        recurrence:
          $ref: '#/components/schemas/HabitRecurrenceRule'
        targetPerDay:
          type: integer
          example: 1
        unit:
          type: string
          example: times
        timeOfDay:
          type: string
          nullable: true
          enum: [anytime, morning, afternoon, evening]
        reminderTime:
          type: string
          nullable: true
          example: '07:30'
        startDate:
          type: string
          format: date
          example: '2026-01-01'
        endDate:
          type: string
          format: date
          nullable: true
        isArchived:
          type: boolean
          example: false
        sortOrder:
          type: integer
          example: 0
        currentStreak:
          type: integer
          example: 5
        longestStreak:
          type: integer
          example: 14
        totalCompletions:
          type: integer
          example: 42
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        deletedAt:
          type: string
          format: date-time
          nullable: true
      required:
        - id
        - userId
        - title
        - color
        - recurrence
        - targetPerDay
        - unit
        - startDate
        - isArchived
        - sortOrder
        - currentStreak
        - longestStreak
        - totalCompletions
        - createdAt
        - updatedAt

    HabitCheckin:
      type: object
      properties:
        id:
          type: string
          format: uuid
        habitId:
          type: string
          format: uuid
        date:
          type: string
          format: date
          example: '2026-03-30'
        status:
          $ref: '#/components/schemas/HabitCheckinStatus'
        value:
          type: number
          nullable: true
          example: 1
        notes:
          type: string
          nullable: true
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
      required:
        - id
        - habitId
        - date
        - status
        - createdAt
        - updatedAt

    CreateHabitRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 255
          example: Drink Water
        description:
          type: string
          maxLength: 2000
          nullable: true
        color:
          type: string
          pattern: '^#[0-9A-Fa-f]{6}$'
          example: '#3B82F6'
        icon:
          type: string
          maxLength: 100
          nullable: true
        recurrence:
          $ref: '#/components/schemas/HabitRecurrenceRule'
        targetPerDay:
          type: integer
          minimum: 1
          default: 1
        unit:
          type: string
          maxLength: 50
          default: times
        timeOfDay:
          type: string
          enum: [anytime, morning, afternoon, evening]
          nullable: true
        reminderTime:
          type: string
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'
          nullable: true
        startDate:
          type: string
          format: date
        endDate:
          type: string
          format: date
          nullable: true
        sortOrder:
          type: integer
          default: 0
      required:
        - title
        - recurrence
        - startDate

    UpdateHabitRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 255
        description:
          type: string
          maxLength: 2000
          nullable: true
        color:
          type: string
          pattern: '^#[0-9A-Fa-f]{6}$'
        icon:
          type: string
          maxLength: 100
          nullable: true
        recurrence:
          $ref: '#/components/schemas/HabitRecurrenceRule'
        targetPerDay:
          type: integer
          minimum: 1
        unit:
          type: string
          maxLength: 50
        timeOfDay:
          type: string
          enum: [anytime, morning, afternoon, evening]
          nullable: true
        reminderTime:
          type: string
          pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'
          nullable: true
        startDate:
          type: string
          format: date
        endDate:
          type: string
          format: date
          nullable: true
        isArchived:
          type: boolean
        sortOrder:
          type: integer

    PutCheckinRequest:
      type: object
      properties:
        status:
          $ref: '#/components/schemas/HabitCheckinStatus'
        value:
          type: number
          minimum: 0
          nullable: true
        notes:
          type: string
          maxLength: 1000
          nullable: true
      required:
        - status

    TodayHabitProgressItem:
      type: object
      properties:
        habitId:
          type: string
          format: uuid
        title:
          type: string
        status:
          $ref: '#/components/schemas/HabitCheckinStatus'
          nullable: true
        scheduled:
          type: boolean
        targetValue:
          type: integer
        actualValue:
          type: number
        currentStreak:
          type: integer
      required:
        - habitId
        - title
        - status
        - scheduled
        - targetValue
        - actualValue
        - currentStreak

    TodayProgress:
      type: object
      properties:
        date:
          type: string
          format: date
        totalScheduled:
          type: integer
        totalDone:
          type: integer
        totalSkipped:
          type: integer
        totalFailed:
          type: integer
        completionRate:
          type: number
          example: 0.8
        habits:
          type: array
          items:
            $ref: '#/components/schemas/TodayHabitProgressItem'
      required:
        - date
        - totalScheduled
        - totalDone
        - totalSkipped
        - totalFailed
        - completionRate
        - habits

    # Phase P6 Domain Schemas
    Event:
      type: object
      properties:
        id:
          type: string
          format: uuid
        userId:
          type: string
          format: uuid
        title:
          type: string
          example: Product Architecture Review
        description:
          type: string
          nullable: true
          example: Review LifeStyle App architecture
        location:
          type: string
          nullable: true
          example: Meeting Room A
        startAt:
          type: string
          format: date-time
          example: '2026-10-01T10:00:00.000Z'
        endAt:
          type: string
          format: date-time
          example: '2026-10-01T11:00:00.000Z'
        allDay:
          type: boolean
          example: false
        timezone:
          type: string
          example: UTC
        version:
          type: integer
          example: 1
        reminders:
          type: array
          items:
            $ref: '#/components/schemas/Reminder'
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        deletedAt:
          type: string
          format: date-time
          nullable: true
      required:
        - id
        - userId
        - title
        - startAt
        - endAt
        - allDay
        - timezone
        - version
        - createdAt
        - updatedAt

    CreateReminderRequest:
      type: object
      properties:
        channel:
          type: string
          enum: [push, in_app, email]
          default: push
        offsetMinutes:
          type: integer
          minimum: 0
          maximum: 43200
          nullable: true
          example: 15
        remindAt:
          type: string
          format: date-time
          nullable: true
      required:
        - channel

    CreateEventRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 200
          example: Team Sync
        description:
          type: string
          maxLength: 5000
          nullable: true
        location:
          type: string
          maxLength: 300
          nullable: true
        startAt:
          type: string
          format: date-time
          example: '2026-10-01T14:00:00.000Z'
        endAt:
          type: string
          format: date-time
          example: '2026-10-01T15:00:00.000Z'
        allDay:
          type: boolean
          default: false
        timezone:
          type: string
          maxLength: 64
          example: UTC
        reminders:
          type: array
          items:
            $ref: '#/components/schemas/CreateReminderRequest'
      required:
        - title
        - startAt
        - endAt
        - timezone

    UpdateEventRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 200
        description:
          type: string
          maxLength: 5000
          nullable: true
        location:
          type: string
          maxLength: 300
          nullable: true
        startAt:
          type: string
          format: date-time
        endAt:
          type: string
          format: date-time
        allDay:
          type: boolean
        timezone:
          type: string
          maxLength: 64
        version:
          type: integer

    Reminder:
      type: object
      properties:
        id:
          type: string
          format: uuid
        userId:
          type: string
          format: uuid
        eventId:
          type: string
          format: uuid
          nullable: true
        taskId:
          type: string
          format: uuid
          nullable: true
        habitId:
          type: string
          format: uuid
          nullable: true
        subscriptionId:
          type: string
          format: uuid
          nullable: true
        entityType:
          type: string
          example: event
        entityId:
          type: string
          format: uuid
        source:
          type: string
          example: user
        remindAt:
          type: string
          format: date-time
        offsetMinutes:
          type: integer
          nullable: true
        channel:
          type: string
          enum: [push, in_app, email]
        status:
          type: string
          enum: [pending, processing, sent, failed, cancelled]
        nextAttemptAt:
          type: string
          format: date-time
          nullable: true
        attemptCount:
          type: integer
        lastErrorCode:
          type: string
          nullable: true
        lastErrorMessage:
          type: string
          nullable: true
        dedupeKey:
          type: string
          nullable: true
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
      required:
        - id
        - userId
        - entityType
        - entityId
        - source
        - remindAt
        - channel
        - status
        - attemptCount
        - createdAt
        - updatedAt

    ConflictResponse:
      type: object
      properties:
        hasConflict:
          type: boolean
          example: true
        conflicts:
          type: array
          items:
            $ref: '#/components/schemas/Event'
      required:
        - hasConflict
        - conflicts

    AgendaResponse:
      type: object
      properties:
        date:
          type: string
          format: date
          example: '2026-10-01'
        totalEvents:
          type: integer
          example: 3
        events:
          type: array
          items:
            $ref: '#/components/schemas/Event'
      required:
        - date
        - totalEvents
        - events

    # Phase P7 Domain Schemas
    GoalStatus:
      type: string
      enum:
        - active
        - paused
        - achieved
        - abandoned

    GoalProgressType:
      type: string
      enum:
        - milestones
        - numeric

    Milestone:
      type: object
      properties:
        id:
          type: string
          format: uuid
        goalId:
          type: string
          format: uuid
        title:
          type: string
          example: Complete System Architecture
        dueDate:
          type: string
          format: date
          nullable: true
          example: '2026-06-30'
        completed:
          type: boolean
          example: false
        completedAt:
          type: string
          format: date-time
          nullable: true
        sortOrder:
          type: integer
          example: 1
        version:
          type: integer
          example: 1
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
      required:
        - id
        - goalId
        - title
        - completed
        - sortOrder
        - version
        - createdAt
        - updatedAt

    Goal:
      type: object
      properties:
        id:
          type: string
          format: uuid
        userId:
          type: string
          format: uuid
        title:
          type: string
          example: Launch Production Platform
        description:
          type: string
          nullable: true
          example: Complete all MVP development phases
        status:
          $ref: '#/components/schemas/GoalStatus'
        progressType:
          $ref: '#/components/schemas/GoalProgressType'
        targetValue:
          type: string
          nullable: true
          example: '100.0000'
        currentValue:
          type: string
          nullable: true
          example: '25.0000'
        unit:
          type: string
          nullable: true
          example: '%'
        progressPercentage:
          type: number
          example: 25.0
        totalMilestones:
          type: integer
          nullable: true
          example: 4
        completedMilestones:
          type: integer
          nullable: true
          example: 1
        milestones:
          type: array
          items:
            $ref: '#/components/schemas/Milestone'
        startDate:
          type: string
          format: date
          nullable: true
          example: '2026-01-01'
        targetDate:
          type: string
          format: date
          nullable: true
          example: '2026-12-31'
        achievedAt:
          type: string
          format: date-time
          nullable: true
        version:
          type: integer
          example: 1
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        deletedAt:
          type: string
          format: date-time
          nullable: true
      required:
        - id
        - userId
        - title
        - status
        - progressType
        - progressPercentage
        - version
        - createdAt
        - updatedAt

    CreateGoalRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 200
          example: Read 24 Books
        description:
          type: string
          maxLength: 5000
          nullable: true
        progressType:
          $ref: '#/components/schemas/GoalProgressType'
        targetValue:
          type: string
          nullable: true
          example: '24.0000'
        currentValue:
          type: string
          nullable: true
          example: '0.0000'
        unit:
          type: string
          maxLength: 30
          nullable: true
          example: books
        startDate:
          type: string
          format: date
          nullable: true
        targetDate:
          type: string
          format: date
          nullable: true
      required:
        - title
        - progressType

    UpdateGoalRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 200
        description:
          type: string
          maxLength: 5000
          nullable: true
        status:
          $ref: '#/components/schemas/GoalStatus'
        targetValue:
          type: string
          nullable: true
        currentValue:
          type: string
          nullable: true
        unit:
          type: string
          maxLength: 30
          nullable: true
        startDate:
          type: string
          format: date
          nullable: true
        targetDate:
          type: string
          format: date
          nullable: true
        version:
          type: integer

    CreateMilestoneRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 200
          example: Phase 1 Completion
        dueDate:
          type: string
          format: date
          nullable: true
        sortOrder:
          type: integer
          default: 0
      required:
        - title

    UpdateMilestoneRequest:
      type: object
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 200
        dueDate:
          type: string
          format: date
          nullable: true
        completed:
          type: boolean
        sortOrder:
          type: integer
        version:
          type: integer

    Note:
      type: object
      properties:
        id:
          type: string
          format: uuid
        userId:
          type: string
          format: uuid
        title:
          type: string
          nullable: true
          example: Meeting Notes
        body:
          type: string
          example: Project roadmap discussion.
        excerpt:
          type: string
          example: Project roadmap discussion.
        tags:
          type: array
          items:
            type: string
          example: ['work', 'roadmap']
        isPinned:
          type: boolean
          example: false
        links:
          type: array
          items:
            $ref: '#/components/schemas/NoteLink'
        version:
          type: integer
          example: 1
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        deletedAt:
          type: string
          format: date-time
          nullable: true
      required:
        - id
        - userId
        - title
        - body
        - excerpt
        - tags
        - isPinned
        - version
        - createdAt
        - updatedAt
        - deletedAt

    NoteListItem:
      type: object
      properties:
        id:
          type: string
          format: uuid
        userId:
          type: string
          format: uuid
        title:
          type: string
          nullable: true
          example: Meeting Notes
        excerpt:
          type: string
          example: Project roadmap discussion.
        tags:
          type: array
          items:
            type: string
          example: ['work', 'roadmap']
        isPinned:
          type: boolean
          example: false
        version:
          type: integer
          example: 1
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        deletedAt:
          type: string
          format: date-time
          nullable: true
      required:
        - id
        - userId
        - title
        - excerpt
        - tags
        - isPinned
        - version
        - createdAt
        - updatedAt
        - deletedAt

    NoteLink:
      type: object
      properties:
        id:
          type: string
          format: uuid
        noteId:
          type: string
          format: uuid
        entityType:
          type: string
          enum: [task, project, goal, habit, event]
        entityId:
          type: string
          format: uuid
        taskId:
          type: string
          format: uuid
          nullable: true
        projectId:
          type: string
          format: uuid
          nullable: true
        goalId:
          type: string
          format: uuid
          nullable: true
        habitId:
          type: string
          format: uuid
          nullable: true
        eventId:
          type: string
          format: uuid
          nullable: true
        createdAt:
          type: string
          format: date-time
      required:
        - id
        - noteId
        - entityType
        - entityId
        - taskId
        - projectId
        - goalId
        - habitId
        - eventId
        - createdAt

    CreateNoteLinkRequest:
      type: object
      properties:
        entityType:
          type: string
          enum: [task, project, goal, habit, event]
        entityId:
          type: string
          format: uuid
        taskId:
          type: string
          format: uuid
        projectId:
          type: string
          format: uuid
        goalId:
          type: string
          format: uuid
        habitId:
          type: string
          format: uuid
        eventId:
          type: string
          format: uuid

    CreateNoteRequest:
      type: object
      properties:
        title:
          type: string
          maxLength: 200
          nullable: true
        body:
          type: string
          maxLength: 100000
          default: ''
        tags:
          type: array
          items:
            type: string
            maxLength: 40
          maxItems: 20
        isPinned:
          type: boolean
          default: false
        links:
          type: array
          items:
            $ref: '#/components/schemas/CreateNoteLinkRequest'

    UpdateNoteRequest:
      type: object
      properties:
        title:
          type: string
          maxLength: 200
          nullable: true
        body:
          type: string
          maxLength: 100000
        tags:
          type: array
          items:
            type: string
            maxLength: 40
          maxItems: 20
        isPinned:
          type: boolean
        links:
          type: array
          items:
            $ref: '#/components/schemas/CreateNoteLinkRequest'
        version:
          type: integer

    TagCount:
      type: object
      properties:
        tag:
          type: string
          example: work
        count:
          type: integer
          example: 5
      required:
        - tag
        - count

    Subscription:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
          example: Netflix
        amount:
          type: string
          example: '15.99'
        currency:
          type: string
          example: USD
        billingUnit:
          type: string
          enum: [week, month, year]
        billingInterval:
          type: integer
          example: 1
        anchorDate:
          type: string
          format: date
          example: '2026-01-31'
        nextBillingDate:
          type: string
          format: date
          example: '2026-02-28'
        status:
          type: string
          enum: [active, paused, cancelled]
        cancelledOn:
          type: string
          format: date
          nullable: true
        categoryId:
          type: string
          format: uuid
          nullable: true
        reminderDaysBefore:
          type: integer
          nullable: true
        notes:
          type: string
          nullable: true
        monthlyEquivalent:
          type: string
          example: '15.9900'
        daysUntilNextBilling:
          type: integer
          example: 12
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
        version:
          type: integer
      required:
        - id
        - name
        - amount
        - currency
        - billingUnit
        - billingInterval
        - anchorDate
        - nextBillingDate
        - status
        - monthlyEquivalent
        - daysUntilNextBilling
        - createdAt
        - updatedAt
        - version

    CreateSubscriptionRequest:
      type: object
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 120
        amount:
          type: string
        currency:
          type: string
        billingUnit:
          type: string
          enum: [week, month, year]
        billingInterval:
          type: integer
          minimum: 1
          maximum: 12
          default: 1
        anchorDate:
          type: string
          format: date
        nextBillingDate:
          type: string
          format: date
        categoryId:
          type: string
          format: uuid
          nullable: true
        reminderDaysBefore:
          type: integer
          minimum: 0
          maximum: 30
          nullable: true
        notes:
          type: string
          maxLength: 1000
          nullable: true
      required:
        - name
        - amount
        - currency
        - billingUnit
        - anchorDate

    UpdateSubscriptionRequest:
      type: object
      properties:
        name:
          type: string
        amount:
          type: string
        currency:
          type: string
        billingUnit:
          type: string
          enum: [week, month, year]
        billingInterval:
          type: integer
        anchorDate:
          type: string
          format: date
        nextBillingDate:
          type: string
          format: date
        status:
          type: string
          enum: [active, paused, cancelled]
        cancelledOn:
          type: string
          format: date
          nullable: true
        categoryId:
          type: string
          format: uuid
          nullable: true
        reminderDaysBefore:
          type: integer
          nullable: true
        notes:
          type: string
          nullable: true
        version:
          type: integer

    PageMeta:
      type: object
      properties:
        limit:
          type: integer
          example: 25
        hasMore:
          type: boolean
          example: false
        nextCursor:
          type: string
          nullable: true
          example: null
      required:
        - limit
        - hasMore
        - nextCursor

  responses:
    ValidationError:
      description: Request validation failed
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ApiErrorEnvelope'
`;

  const parsed = parse(doc) as {
    paths: Record<
      string,
      Record<
        string,
        {
          responses?: Record<
            string,
            { content?: Record<string, { schema?: Record<string, unknown> }> }
          >;
        }
      >
    >;
  };
  for (const [route, pathItem] of Object.entries(parsed.paths)) {
    if (route.startsWith('/health/') || route.startsWith('/users/me/export')) continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!/^2\d\d$/.test(status) || status === '204') continue;
        response.content ??= {};
        const json =
          response.content['application/json'] ??
          (response.content['application/json'] = { schema: {} });
        const payload = json.schema ?? {};
        const props = payload.properties as Record<string, unknown> | undefined;
        if (props?.success && props.data) continue;
        const listPayload =
          typeof props?.data === 'object' &&
          props.data !== null &&
          (props.data as Record<string, unknown>).type === 'array';
        const hasMeta = listPayload && props?.meta !== undefined;
        json.schema = {
          type: 'object',
          properties: {
            success: { type: 'boolean', const: true },
            data: listPayload ? props.data : payload,
            ...(hasMeta ? { meta: props?.meta } : {})
          },
          required: hasMeta ? ['success', 'data', 'meta'] : ['success', 'data']
        };
      }
    }
  }
  return stringify(parsed);
}

export function writeOpenApiDocument(): void {
  const content = generateOpenApiDocument();
  fs.mkdirSync(path.dirname(openapiFilePath), { recursive: true });
  fs.writeFileSync(openapiFilePath, content, 'utf8');
}

// If executed directly, write the document
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeOpenApiDocument();
  // eslint-disable-next-line no-console
  console.log(`✅ OpenAPI document generated at: ${openapiFilePath}`);
}
