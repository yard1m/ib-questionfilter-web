import { describe, expect, it } from 'vitest';
import { LoginInputError, loginEmail, signInErrorMessage } from './auth';
import { readConfig } from '../config';

describe('loginEmail', () => {
  const domain = 'users.ibquestionbank.invalid';

  it('maps a username to the reserved account domain', () => {
    expect(loginEmail('  Yardim ', domain)).toBe('yardim@users.ibquestionbank.invalid');
    expect(loginEmail('first.last-2', domain)).toBe('first.last-2@users.ibquestionbank.invalid');
  });

  it('accepts a full email address unchanged apart from case', () => {
    expect(loginEmail('Someone@Example.com', domain)).toBe('someone@example.com');
  });

  it('rejects empty or malformed identifiers', () => {
    for (const bad of ['', '   ', 'bad name', '-leading', 'trailing.', 'x@y', 'a/b']) {
      expect(() => loginEmail(bad, domain)).toThrow(LoginInputError);
    }
  });
});

describe('signInErrorMessage', () => {
  it('never says whether the account exists', () => {
    expect(signInErrorMessage({ message: 'Invalid login credentials', status: 400 })).toBe('Incorrect username or password.');
    expect(signInErrorMessage({ message: 'Email not confirmed', status: 400 })).toBe('Incorrect username or password.');
  });

  it('explains rate limits and network failures', () => {
    expect(signInErrorMessage({ message: 'x', status: 429 })).toMatch(/Too many attempts/);
    expect(signInErrorMessage({ message: 'Failed to fetch', status: 0 })).toMatch(/Could not reach/);
  });
});

describe('readConfig', () => {
  const base = {
    VITE_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    VITE_CORPUS_PREFIX: 'c1-0123456789abcdef',
  };

  it('accepts a complete public configuration', () => {
    const result = readConfig(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.bucket).toBe('corpus');
      expect(result.config.localCorpus).toBe(false);
    }
  });

  it('reports missing values', () => {
    const result = readConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_CORPUS_PREFIX']);
  });

  it('refuses secret keys in the browser', () => {
    const secret = readConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' });
    expect(secret.ok).toBe(false);
    const payload = btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '');
    const legacy = readConfig({ ...base, VITE_SUPABASE_PUBLISHABLE_KEY: `x.${payload}.y` });
    expect(legacy.ok).toBe(false);
  });

  it('only allows the local corpus in development builds', () => {
    const production = readConfig({ DEV: false }, true);
    expect(production.ok).toBe(false);
    const development = readConfig({ DEV: true }, true);
    expect(development.ok && development.config.localCorpus).toBe(true);
  });
});
