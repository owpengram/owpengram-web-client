import type rootScope from '@lib/rootScope';

/**
 * Whether the person chose to log in with a phone number after being warned
 * that the server signs people in by email. Kept for the rest of this login,
 * so the sign-in card does not bounce them back to the email form when they
 * come back to it (from the code card, say). Not stored: a new visit starts
 * from the phone form again.
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
 * hide it. Undefined when the
 * server could not be asked.
 */
export async function fetchLoginAppConfig(managers: typeof rootScope.managers): Promise<MTAppConfig | undefined> {
  try {
    const answer = await managers.apiManager.invokeApi('help.getAppConfig', {hash: 0});
    if(answer._ !== 'help.appConfig') return;

    const appConfig = answer.config as any as MTAppConfig;
    return appConfig;
  } catch{}
}
