/**
 * Square app settings. Tokens and the app secret never go to the browser.
 */

export function squareConfig() {
  const environment = process.env.SQUARE_ENV === 'production' ? 'production' : 'sandbox';
  return {
    environment,
    appId: (process.env.SQUARE_APP_ID || '').trim(),
    appSecret: (process.env.SQUARE_APP_SECRET || '').trim(),
    tokenKey: (process.env.SQUARE_TOKEN_KEY || '').trim(),
    webhookKey: (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '').trim(),
    webhookUrl: (process.env.SQUARE_WEBHOOK_URL || '').trim(),
    redirectUrl: (process.env.SQUARE_REDIRECT_URL || '').trim(),
    version: (process.env.SQUARE_VERSION || '2026-09-16').trim(),
  };
}

/** @param {Array<'appId'|'appSecret'|'tokenKey'|'webhookKey'>} needs */
export function missingSquareConfig(needs = ['appId', 'appSecret', 'tokenKey']) {
  const cfg = squareConfig();
  return needs.filter((key) => !cfg[key]);
}

/** @param {'sandbox'|'production'} environment */
export function squareApiBase(environment) {
  return environment === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}
