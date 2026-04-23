import { useCallback } from 'react';
import { useAuth } from '@/contexts/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Returns an `authFetch` function that injects `Authorization: Bearer <token>`
 * on every request and calls `logout()` automatically on a 401 response.
 *
 * Works with or without an active session — omits the header when unauthenticated.
 */
export function useAuthFetch() {
  const { token, logout } = useAuth();

  const authFetch = useCallback(
    async (path: string, options: RequestInit = {}): Promise<Response> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

      if (res.status === 401) {
        logout();
      }

      return res;
    },
    [token, logout],
  );

  return { authFetch };
}