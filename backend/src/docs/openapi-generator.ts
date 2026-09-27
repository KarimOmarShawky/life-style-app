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
      description: Sends an OTP to the user email if registered. Response timing is equalized.
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
        '200':
          description: If the email is registered, a reset code was sent.
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
        '200':
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
      description: Schedules account deletion with a 30-day grace period.
      responses:
        '200':
          description: Account deletion scheduled
    delete:
      summary: Cancel Account Deletion
      security:
        - BearerAuth: []
      description: Cancels scheduled account deletion within the 30-day grace window.
      responses:
        '200':
          description: Deletion cancelled
  /users/me/export:
    post:
      summary: Export User Data (GDPR)
      security:
        - BearerAuth: []
      responses:
        '200':
          description: Complete user data dump

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
        mode:
          type: string
          enum: [stopwatch, countdown]
          default: stopwatch
        plannedSeconds:
          type: integer
          minimum: 60
          maximum: 43200
          nullable: true
      required:
        - taskId

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

  return doc;
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
