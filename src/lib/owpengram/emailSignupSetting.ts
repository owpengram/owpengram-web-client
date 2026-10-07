import type rootScope from '@lib/rootScope';

/**
 * Whether the server signs people in by email (`email_signup_enabled`, from
 * TELESRV_EMAIL_SIGNUP_ENABLE), as the login cards need it.
 *
 * The last answer is remembered so a card can show the right method at once,
 * before the server has been heard from. Per origin -- per server, for the
 * build the server serves; a dev build pointed elsewhere is corrected by the
 * answer that follows.
 */

const STORAGE_KEY = 'owpengram_email_signup';

export function readStoredEmailSignup() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch{
    return false;
  }
}

function storeEmailSignup(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch{}
}

/**
 * Whether the person chose to log in with a phone number after being warned
 * that the server signs people in by email. Kept for the rest of this login,
 * so the sign-in card does not bounce them back to the email form when they
 * come back to it (from the code card, say). Not stored: a new visit starts
 * from email again.
 */
let phoneFallbackChosen = false;

export function isPhoneFallbackChosen() {
  return phoneFallbackChosen;
}

export function setPhoneFallbackChosen(chosen: boolean) {
  phoneFallbackChosen = chosen;
}

/**
 * The server's app config, asked for in full rather than through the client's
 * cached copy, so a config cached before the server changed this setting cannot
 * hide it. Remembers the email sign-up setting it carries. Undefined when the
 * server could not be asked.
 */
export async function fetchLoginAppConfig(managers: typeof rootScope.managers): Promise<MTAppConfig | undefined> {
  try {
    const answer = await managers.apiManager.invokeApi('help.getAppConfig', {hash: 0});
    if(answer._ !== 'help.appConfig') return;

    const appConfig = answer.config as any as MTAppConfig;
    storeEmailSignup(!!appConfig.email_signup_enabled);
    return appConfig;
  } catch{}
}
