import { z } from 'zod';

export type Role = 'ROOT' | 'ADMIN' | 'OPERATOR' | 'READ_ONLY';

export const ROLE_HIERARCHY: Record<Role, number> = {
  READ_ONLY: 1,
  OPERATOR: 2,
  ADMIN: 3,
  ROOT: 4,
};

export function hasRequiredRole(userRole: Role, minRole?: Role): boolean {
  if (!minRole) return true;
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 0);
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RouteDefinition<TReq = any, TRes = any> {
  method: HttpMethod;
  path: string; // Must start with /api/v1/
  auth: 'public' | 'user';
  minRole?: Role;
  audit?: boolean;
  summary: string;
  requestSchema?: z.ZodType<TReq>;
  responseSchema?: z.ZodType<TRes>;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: Role;
  apiKeyId?: string;
}
