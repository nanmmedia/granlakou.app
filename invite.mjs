const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
const rolesAllowed = ['business_admin', 'order_staff', 'driver'];
async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw Error(error.message || 'Staff access could not be saved.');
  return data;
}
export async function inviteStaff(req, { caller, admin, mailer }) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { error: 'Sign in required.' });
  try {
    const client = caller(authorization);
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) return reply(401, { error: 'Sign in again.' });
    const access = await rpc(client, 'gldd_get_my_access');
    if (access?.is_super_admin !== true) return reply(403, { error: 'Super Admin access required.' });
    const body = await req.json();
    if (body.action === 'resend') {
      const business = String(body.business || '');
      const team = await rpc(client, 'gldd_staff_directory', { business });
      const member = team.find(m => m.user_id === body.userId);
      if (!member || !member.active || member.user_id === userData.user.id)
        return reply(400, { error: 'Choose an active staff account. Restore revoked access first.' });
      const result = member.email_confirmed
        ? await mailer.auth.signInWithOtp({ email: member.email, options: { shouldCreateUser: false } })
        : await admin.auth.admin.inviteUserByEmail(member.email, { redirectTo: 'https://granlakou.app/confirmed.html' });
      return reply(200, { emailSent: !result.error,
        message: result.error ? 'Email was not sent. Please wait and try again.' : member.email_confirmed
          ? 'A fresh sign-in code has been requested.' : 'A fresh confirmation invitation has been requested.' });
    }
    if (body.action && body.action !== 'invite') return reply(400, { error: 'Unknown action.' });
    const email = String(body.email || '').trim().toLowerCase();
    const firstName = String(body.firstName || '').trim();
    const business = String(body.business || '');
    const roles = body.roles;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        !firstName || firstName.length > 100 || !/^[0-9a-f-]{36}$/i.test(business) ||
        !Array.isArray(roles) || !roles.length || roles.some(r => !rolesAllowed.includes(r))) {
      return reply(400, { error: 'Enter a first name, valid email, business and role.' });
    }
    // Check existing membership BEFORE creating an account or sending mail.
    const team = await rpc(client, 'gldd_staff_directory', { business });
    const existing = team.find(m => m.email?.toLowerCase() === email);
    if (existing) return reply(409, { error: 'This person already has a staff record. Use Manage access instead.' });
    let id = await rpc(client, 'gldd_find_invitee', { staff_email: email });
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email, email_confirm: false, user_metadata: { first_name: firstName },
      });
      if (error) {
        // A simultaneous invitation may already have created the account.
        id = await rpc(client, 'gldd_find_invitee', { staff_email: email });
        if (!id) return reply(400, { error: 'Could not create this sign-in account. Check the email and try again.' });
      } else id = data.user.id;
    }
    await rpc(client, 'gldd_add_invited_member', {
      business, staff_email: email, first_name: firstName, member_roles: [...new Set(roles)],
    });
    // Access is saved first. Failed delivery does not falsely report a sent email.
    // Staff can always request a fresh code on the existing sign-in screen.
    const account = await admin.auth.admin.getUserById(id);
    if (account.error || !account.data?.user) throw Error('Access saved, but the sign-in account could not be checked.');
    const confirmed = !!account.data.user.email_confirmed_at;
    const { error: emailError } = confirmed
      ? await mailer.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
      : await admin.auth.admin.inviteUserByEmail(email, { redirectTo: 'https://granlakou.app/confirmed.html' });
    return reply(200, { saved: true, emailSent: !emailError, firstName, email,
      message: emailError ? 'Access saved, but the email was not sent. Use Resend invitation in Staff access.' : confirmed ? 'Access saved and sign-in code requested.' : 'Access saved and confirmation invitation requested.' });
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : 'Invitation could not be completed.' });
  }
}

