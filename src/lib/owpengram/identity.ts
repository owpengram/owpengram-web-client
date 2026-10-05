import {OWPENGRAM_SECURE, OWPENGRAM_SERVER} from '@config/owpengram';

/**
 * What the server says it is called, and whether it has an icon. Read from the
 * server's own `GET /owpengram/server-info` (the same endpoint the desktop and
 * Android clients use), so an operator renaming the server in the admin panel
 * changes what every client shows without a rebuild.
 *
 * Only cosmetic fields are ever taken from that endpoint. It is plain HTTP, so
 * trusting anything more -- the RSA key it also carries, above all -- would let
 * whoever can tamper with it redirect the handshake; a wrong name is merely
 * wrong. The key stays pinned at build time (see @config/owpengram).
 */
export type ServerIdentity = {
  name: string,
  description: string,
  hasIcon: boolean
};

export const DEFAULT_PRODUCT_NAME = 'OwpenGram';

const STORAGE_KEY = 'owpengram_server_identity';
const MAX_NAME_LENGTH = 64; // the server rejects longer names too

const SERVER_URL = `${OWPENGRAM_SECURE ? 'https' : 'http'}://${OWPENGRAM_SERVER}`;
const SERVER_INFO_URL = SERVER_URL + '/owpengram/server-info';
const SERVER_ICON_URL = SERVER_URL + '/owpengram/server-icon';

let identity: ServerIdentity;

function readStoredIdentity(): ServerIdentity | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(typeof(parsed?.name) === 'string' && typeof(parsed.description) === 'string') {
      return {name: parsed.name, description: parsed.description, hasIcon: !!parsed.hasIcon};
    }
  } catch{}
}

export function getServerIdentity(): ServerIdentity | undefined {
  return identity ??= readStoredIdentity();
}

/**
 * The name to show wherever the product is named. Falls back to the default
 * until the server has been reached once, and whenever an operator has not set
 * a name of their own (the endpoint then answers an empty one).
 */
export function getProductName() {
  return getServerIdentity()?.name || DEFAULT_PRODUCT_NAME;
}

/**
 * Names the tab and the installed app after the server. Reads only what is
 * already stored, so it is safe to run before anything has rendered.
 */
export function applyDocumentBranding() {
  const title = `${getProductName()} Web`;
  document.title = title;
  for(const name of ['application-name', 'apple-mobile-web-app-title', 'mobile-web-app-title']) {
    document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.setAttribute('content', title);
  }
}

/** The server's icon, or undefined when it has none and the bundled mark applies. */
export function getServerIconUrl() {
  return getServerIdentity()?.hasIcon ? SERVER_ICON_URL : undefined;
}

/**
 * Fetches the identity and stores it for the next load. Never throws: offline,
 * an older server without the endpoint, or a malformed answer all leave the
 * previously stored identity (or the defaults) in place.
 *
 * What was fetched is not applied to the current page: strings already rendered
 * keep the name they were built with, and the next load picks the new one up
 * synchronously from storage -- the same way the language pack behaves.
 */
export async function refreshServerIdentity() {
  try {
    const response = await fetch(SERVER_INFO_URL, {cache: 'no-store'});
    if(!response.ok) {
      return;
    }

    const body = await response.json();
    const name = typeof(body.name) === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '';
    const description = typeof(body.description) === 'string' ? body.description.trim() : '';
    const next: ServerIdentity = {name, description, hasIcon: !!body.has_icon};

    const previous = getServerIdentity();
    if(previous && previous.name === next.name && previous.description === next.description && previous.hasIcon === next.hasIcon) {
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch{}
}
