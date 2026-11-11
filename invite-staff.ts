import { createClient } from 'npm:@supabase/supabase-js@2.102.0';
import { inviteStaff } from './invite.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
// Supplied by the server runtime; never returned to the browser.
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve((req: Request) => inviteStaff(req, {
  caller: (authorization: string) => createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  admin,
  mailer: createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
}));

