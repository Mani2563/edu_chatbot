import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const rawUrl = process.env.SUPABASE_URL || '';
// Strict normalization: remove any trailing slashes or /rest/v1
const SUPABASE_URL = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '').trim();
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Validate URL on load
if (SUPABASE_URL && (!SUPABASE_URL.startsWith('http://') && !SUPABASE_URL.startsWith('https://'))) {
  throw new Error(`Invalid SUPABASE_URL: ${SUPABASE_URL}. Must start with http:// or https://`);
}

export function isSupabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_URL.startsWith('http') &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes('your-project')
  );
}

/**
 * Returns public configuration safe to share with the browser
 * Only exposes the project URL and publishable key (ANON KEY)
 */
export function getPublicConfig() {
  return {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY
  };
}

/**
 * Standard anonymous client
 */
export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
}

/**
 * Server-side administrative client (service role key)
 * Reserved strictly for administrative tasks (e.g. initial health checks)
 * Never used for normal student operations to bypass RLS
 */
export function getSupabaseAdmin() {
  if (!isSupabaseConfigured() || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/**
 * User-scoped Supabase client
 * Executes queries and storage operations strictly under the authenticated user's JWT
 * Enforces all database and Storage Row Level Security (RLS) policies
 */
export function getUserSupabaseClient(accessToken) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured on the backend');
  }
  if (!accessToken) {
    throw new Error('Access token is required to create user-scoped Supabase client');
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

/**
 * Derives and strictly validates authenticated user from Authorization Bearer header
 * Uses Supabase Auth to verify JWT authenticity and expiration
 * Rejects invalid, expired, or mock tokens
 */
export async function getUserFromRequest(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) {
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email,
      role: data.user.role,
      user_metadata: data.user.user_metadata || {},
      accessToken: token
    };
  } catch (err) {
    console.error('Error verifying user token:', err.message);
    return null;
  }
}
