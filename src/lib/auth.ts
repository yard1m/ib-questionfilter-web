/**
 * Supabase Auth signs users in by email. The site asks for a username instead and maps it to an
 * account email on a reserved domain (RFC 2606 `.invalid`), so no mail is ever sent. A full email
 * address is accepted as well, for accounts created with a real address.
 */
export class LoginInputError extends Error {}

const USERNAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function loginEmail(identifier: string, usernameDomain: string): string {
  const value = identifier.trim().toLowerCase();
  if (!value) throw new LoginInputError('Enter your username.');
  if (value.includes('@')) {
    if (!EMAIL.test(value)) throw new LoginInputError('That does not look like a valid email address.');
    return value;
  }
  if (!USERNAME.test(value)) {
    throw new LoginInputError('Usernames use letters, digits, dots, hyphens or underscores.');
  }
  return `${value}@${usernameDomain}`;
}

/** Maps Supabase Auth failures to messages that do not reveal whether an account exists. */
export function signInErrorMessage(error: { message?: string; status?: number; code?: string } | null): string {
  if (!error) return '';
  if (error.status === 429 || /rate limit/i.test(error.message ?? '')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (error.status === 0 || /fetch|network/i.test(error.message ?? '')) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return 'Incorrect username or password.';
}
