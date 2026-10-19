import { z } from 'zod';

export const RoleSchema = z.enum(['ROOT', 'ADMIN', 'OPERATOR', 'READ_ONLY']);

// Auth Schemas
export const SetupRequestSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'Username must be alphanumeric or contain -/_'),
  password: z.string().min(8).max(128),
  setupToken: z.string().optional(),
});

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().optional(), // Can also come from httpOnly cookie
});

export const CreateUserRequestSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(128),
  role: RoleSchema.default('OPERATOR'),
});

export const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(64),
  role: RoleSchema.default('OPERATOR'),
  expiresInDays: z.number().int().positive().optional(),
});

// Route & Service Schemas
export const CreateRouteRequestSchema = z.object({
  serviceId: z.string().optional(),
  subdomain: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/, 'Subdomain must be lowercase alphanumeric or hyphens'),
  targetPort: z.number().int().min(1).max(65535),
  targetHost: z.string().default('127.0.0.1'),
  tlsEnabled: z.boolean().default(true),
  customDomain: z.string().optional(),
  description: z.string().optional(),
});

export const TableBrowserQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  orderBy: z.string().optional(),
  orderDir: z.enum(['asc', 'desc']).default('asc'),
});
