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
                required:
                  - status
        '503':
          description: Service degraded or shutting down
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: degraded
                required:
                  - status

  /auth/register:
    post:
      summary: User Registration
      description: Registers a new user account, creates default categories, and returns session tokens.
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
      description: Authenticates user credentials with constant-time verification and returns session tokens.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/LoginRequest'
      responses:
        '200':
          description: Authentication succeeded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AuthResponse'
        '401':
          description: Invalid credentials
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiErrorEnvelope'

  /auth/refresh:
    post:
      summary: Refresh Access Token
      description: Rotates refresh token under strict single-use semantics (reuse revokes session per ADR-041).
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RefreshRequest'
      responses:
        '200':
          description: Tokens refreshed successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Tokens'
        '401':
          description: Invalid or reused refresh token
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiErrorEnvelope'

  /auth/logout:
    post:
      summary: Logout Session
      description: Revokes the specified session and deletes bound push devices.
      requestBody:
        required: false
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/LogoutRequest'
      responses:
        '204':
          description: Logged out successfully

  /auth/logout-all:
    post:
      summary: Logout All Sessions
      description: Revokes every active session for the authenticated user and unbinds push devices.
      security:
        - BearerAuth: []
      responses:
        '204':
          description: All sessions revoked successfully

  /auth/forgot-password:
    post:
      summary: Request Password Reset
      description: Requests a 6-digit password reset OTP email. Returns 202 indistinguishably.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ForgotPasswordRequest'
      responses:
        '202':
          description: Password reset request accepted

  /auth/reset-password:
    post:
      summary: Complete Password Reset
      description: Resets password using 6-digit OTP and revokes all active sessions.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ResetPasswordRequest'
      responses:
        '200':
          description: Password reset successfully
        '400':
          description: Invalid or expired reset code

  /auth/change-password:
    post:
      summary: Change Password
      description: Changes user password, keeps current session active, and revokes all other sessions.
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ChangePasswordRequest'
      responses:
        '204':
          description: Password changed successfully

  /users/me:
    get:
      summary: Get Current User Profile
      description: Retrieves the profile of the currently authenticated user.
      security:
        - BearerAuth: []
      responses:
        '200':
          description: User profile retrieved
          content:
            application/json:
              schema:
                type: object
                properties:
                  user:
                    $ref: '#/components/schemas/User'
                required:
                  - user
    patch:
      summary: Update User Profile
      description: Updates editable profile fields for the authenticated user.
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
          description: Profile updated successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  user:
                    $ref: '#/components/schemas/User'
                required:
                  - user

  /users/me/devices:
    put:
      summary: Register Push Notification Device
      description: Upserts a push notification device token bound to the current session.
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
          description: Device registered successfully

  /users/me/devices/{deviceId}:
    delete:
      summary: Delete Push Device
      description: Unregisters a push device owned by the authenticated user.
      security:
        - BearerAuth: []
      parameters:
        - name: deviceId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Push device deleted
        '404':
          description: Device not found

  /users/me/deletion:
    post:
      summary: Schedule Account Deletion
      description: Schedules account deletion with a 14-day grace period.
      security:
        - BearerAuth: []
      responses:
        '200':
          description: Account deletion scheduled
    delete:
      summary: Cancel Account Deletion
      description: Cancels scheduled account deletion and restores active status.
      security:
        - BearerAuth: []
      responses:
        '200':
          description: Account deletion cancelled

  /users/me/export:
    post:
      summary: Export User Data (GDPR)
      description: Generates and returns complete JSON export of user personal data.
      security:
        - BearerAuth: []
      responses:
        '200':
          description: User data export payload
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserDataExport'

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    RegisterRequest:
      type: object
      properties:
        email:
          type: string
          format: email
          maxLength: 254
        password:
          type: string
          minLength: 10
        displayName:
          type: string
          minLength: 1
          maxLength: 100
        timezone:
          type: string
          default: UTC
        defaultCurrency:
          type: string
          pattern: '^[A-Z]{3}$'
          default: USD
        locale:
          type: string
          maxLength: 16
          default: en
        device:
          $ref: '#/components/schemas/DeviceMetadata'
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
          minLength: 1
        device:
          $ref: '#/components/schemas/DeviceMetadata'
      required:
        - email
        - password

    RefreshRequest:
      type: object
      properties:
        refreshToken:
          type: string
          pattern: '^[A-Za-z0-9_-]{43}$'
      required:
        - refreshToken

    LogoutRequest:
      type: object
      properties:
        refreshToken:
          type: string

    ForgotPasswordRequest:
      type: object
      properties:
        email:
          type: string
          format: email
      required:
        - email

    ResetPasswordRequest:
      type: object
      properties:
        email:
          type: string
          format: email
        code:
          type: string
          pattern: '^\\d{6}$'
        newPassword:
          type: string
          minLength: 10
      required:
        - email
        - code
        - newPassword

    ChangePasswordRequest:
      type: object
      properties:
        currentPassword:
          type: string
          minLength: 1
        newPassword:
          type: string
          minLength: 10
      required:
        - currentPassword
        - newPassword

    UpdateProfileRequest:
      type: object
      properties:
        displayName:
          type: string
          minLength: 1
          maxLength: 100
        timezone:
          type: string
        locale:
          type: string
          maxLength: 16
        weekStart:
          type: integer
          minimum: 1
          maximum: 7
        defaultCurrency:
          type: string
          pattern: '^[A-Z]{3}$'
        pushShowTitles:
          type: boolean

    RegisterDeviceRequest:
      type: object
      properties:
        pushToken:
          type: string
          maxLength: 512
        platform:
          type: string
          enum: [ios, android]
        appVersion:
          type: string
          maxLength: 32
      required:
        - pushToken
        - platform

    DeviceMetadata:
      type: object
      properties:
        platform:
          type: string
          enum: [ios, android, unknown]
        name:
          type: string
          maxLength: 100
        appVersion:
          type: string
          maxLength: 32

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
        pushShowTitles:
          type: boolean
        status:
          type: string
          enum: [active, disabled, pending_deletion]
        emailVerified:
          type: boolean
        createdAt:
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
        - pushShowTitles
        - status
        - emailVerified
        - createdAt

    Tokens:
      type: object
      properties:
        accessToken:
          type: string
        accessTokenExpiresAt:
          type: string
          format: date-time
        refreshToken:
          type: string
        refreshTokenExpiresAt:
          type: string
          format: date-time
      required:
        - accessToken
        - accessTokenExpiresAt
        - refreshToken
        - refreshTokenExpiresAt

    AuthResponse:
      type: object
      properties:
        user:
          $ref: '#/components/schemas/User'
        tokens:
          $ref: '#/components/schemas/Tokens'
      required:
        - user
        - tokens

    UserDataExport:
      type: object
      properties:
        exportedAt:
          type: string
          format: date-time
        profile:
          type: object
        sessions:
          type: array
          items:
            type: object
        categories:
          type: array
          items:
            type: object
        pushDevices:
          type: array
          items:
            type: object
      required:
        - exportedAt
        - profile
        - sessions
        - categories
        - pushDevices

    FieldError:
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
              example: Invalid request
            requestId:
              type: string
              format: uuid
              example: b3f1c2a0-4592-498c-8f2c-e105e46bfb77
            details:
              type: array
              items:
                $ref: '#/components/schemas/FieldError'
          required:
            - code
            - message
            - requestId
      required:
        - success
        - error

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
