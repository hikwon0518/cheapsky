// NEVER import from 'use client' components or app/api routes exposed to anon.
// service_role key leakage is the top security risk of this project.
// `server-only` marker enforces at Next.js 15 build-time that this module
// is not bundled into the client. (ADR-003 RLS anon read only)
import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let anonClient: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;

/**
 * Returns the Supabase client bound to the anon (public) key.
 * Reads only — writes are blocked at the RLS layer.
 *
 * Memoized at module level so repeated calls within a single
 * Node/Edge runtime return the same instance.
 */
export function getAnonClient(): SupabaseClient {
  if (anonClient) return anonClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is required for getAnonClient',
    );
  }
  if (!anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY is required for getAnonClient',
    );
  }

  anonClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return anonClient;
}

/**
 * Returns the Supabase client bound to the service_role key (write-enabled).
 * MUST NOT be exposed to anon / client bundles. Use only in:
 *   - batch scripts (scripts/*.ts)
 *   - Server Components or route handlers that are explicitly auth-gated.
 */
export function getServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is required for getServiceClient',
    );
  }
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for getServiceClient',
    );
  }

  serviceClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return serviceClient;
}

/**
 * Test helper — resets the module-level client cache so tests can swap env.
 * Do not call from production code paths.
 */
export function __resetClientsForTest(): void {
  anonClient = null;
  serviceClient = null;
}
