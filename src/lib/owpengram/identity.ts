import {OWPENGRAM_SERVER_URL} from '@config/owpengram';

/**
 * What the server says it is called, and whether it has an icon. Read from the
 * server's own `GET /owpengram/server-info` (the same endpoint the desktop and
 * Android clients use), so an operator renaming the server in the admin panel
 * changes what every client shows without a rebuild.
 *
 * Only cosmetic fields are ever taken from that endpoint. It is plain HTTP, so
 * trusting anything more -- the RSA key it also carries, above all -- would let
 * whoever can tamper with it redirect the handshake; a wrong name is merely
 * wrong. The key stays pinned at build time (see @config/owpengram), except in
 * the build embedded in the server, which reads it from the server that served
 * the page (see lib/owpengram/serverKey).
 */
export type ServerIdentity = {
  name: string,
  description: string,
  hasIcon: boolean
};

export const DEFAULT_PRODUCT_NAME = 'OwpenGram';

const STORAGE_KEY = 'owpengram_server_identity';
const MAX_NAME_LENGTH = 64; // the server rejects longer names too

const SERVER_INFO_URL = OWPENGRAM_SERVER_URL + '/owpengram/server-info';
const SERVER_ICON_URL = OWPENGRAM_SERVER_URL + '/owpengram/server-icon';

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

  applyDocumentIcon();
}

/**
 * Puts the server's icon in the tab. The bundled mark stays when the server has
 * none. `sizes` and `type` are dropped because they describe the bundled PNGs:
 * the server's icon can be any size and format, and a wrong hint makes the
 * browser skip it.
 *
 * Changes the `href` in place rather than replacing the elements, which is what
 * the unread-badge code (uiNotificationsManager) holds on to and restores.
 */
function applyDocumentIcon(url = getServerIconUrl()) {
  if(!url) {
    return;
  }

  // `alternate icon` too: it is the bundled favicon.ico, and a browser that
  // prefers it keeps showing the bundled mark however the others are changed
  const links = document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="alternate icon"], link[rel="apple-touch-icon"]');
  const setHref = (href: string) => links.forEach((link) => link.href = href);
  for(const link of links) {
    link.removeAttribute('sizes');
    link.removeAttribute('type');
  }

  // The raw image first: it is what stays if the rounded one cannot be made
  setHref(url);
  roundIcon(url).then(setHref, () => {});
}

let iconRequest = 0;

/**
 * The icon with a circular mask baked into its pixels. A browser draws a
 * favicon as it is and ignores CSS, so an icon with square corners (the server
 * serves whatever image the operator uploaded, often a round mark on a white
 * square) would show square in the tab. The admin panel does the same, so the
 * tab matches the round mark used everywhere else.
 *
 * Rejects when the image or a canvas is unavailable. Only the latest request
 * resolves, so a slow image cannot overwrite a newer one.
 */
function roundIcon(url: string, size = 64) {
  const request = ++iconRequest;
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    // The server allows cross-origin reads of its icon, which the canvas needs
    // when the page is served from somewhere else (the dev server)
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      if(!context || request !== iconRequest) {
        reject();
        return;
      }

      context.beginPath();
      context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      context.clip();
      context.drawImage(image, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject();
    image.src = url;
  });
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

    // The one thing applied right away: a tab icon that is wrong until the
    // next load would be the first thing a new visitor sees
    if(next.hasIcon !== !!previous?.hasIcon) {
      applyDocumentIcon(next.hasIcon ? SERVER_ICON_URL : undefined);
    }
  } catch{}
}
