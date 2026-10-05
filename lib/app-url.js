/**
 * Public app origin for auth redirects (invite links, login URLs).
 * Prefer APP_URL so we never fall back to Supabase's localhost Site URL.
 */
export function appOrigin(req) {
  const fromEnv = (process.env.APP_URL || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  if (process.env.VERCEL_ENV === 'production') {
    return 'https://measured-stock.vercel.app';
  }

  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (host && !/localhost|127\.0\.0\.1/i.test(String(host))) {
    return `${proto}://${host}`;
  }

  // Preview deployments
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '')}`;
  }

  return 'https://measured-stock.vercel.app';
}

export function appLoginUrl(req) {
  return `${appOrigin(req)}/login`;
}

export function appOnboardUrl(req) {
  return `${appOrigin(req)}/onboard`;
}
