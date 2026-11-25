import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type UserRole =
  | 'OWNER_SUPER_ADMIN'
  | 'ADMIN'
  | 'PRODUCTION_SUPERVISOR'
  | 'ACCOUNTANT'
  | 'SALESMAN';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  mustResetPassword: boolean;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function createSession(db: DatabaseSync, userId: string): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(token, userId, expires.toISOString(), now.toISOString());
  return { token, expiresAt: expires.toISOString() };
}

export function authenticateToken(db: DatabaseSync, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.is_active, u.must_reset_password, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as
    | {
        id: string;
        username: string;
        full_name: string;
        email: string;
        role: UserRole;
        is_active: number;
        must_reset_password: number;
        expires_at: string;
      }
    | undefined;

  if (!row) return null;
  if (!row.is_active) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    isActive: Boolean(row.is_active),
    mustResetPassword: Boolean(row.must_reset_password),
  };
}

export function requireAuth(user: AuthUser | null): AuthUser {
  if (!user) {
    throw new HttpError(401, 'Authentication required. Please sign in.');
  }
  return user;
}

export function requireRole(user: AuthUser | null, allowed: UserRole[]): AuthUser {
  const authed = requireAuth(user);
  if (!allowed.includes(authed.role)) {
    throw new HttpError(
      403,
      `Access denied for role ${authed.role}. Required role: ${allowed.join(' or ')}.`
    );
  }
  return authed;
}

