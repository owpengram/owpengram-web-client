/**
 * Everything that points this client at a self-hosted owpengram-server
 * instead of Telegram's own infrastructure. Imported by the two places that
 * would otherwise each carry their own copy of it: dcConfigurator (where to
 * connect) and rsaKeysManager (whose key the handshake is encrypted to).
 *
 * Set by scripts/owpengram-web.ps1, which writes .env.local -- the file Vite
 * reads after .env and git ignores, so pointing a checkout at a different
 * server never shows up as a local modification.
 */

/**
 * The one address of the whole backend.
 *
 * owpengram-server serves MTProto over TCP and MTProto-over-WebSocket
 * (`/apiws*`) on a single host:port, so unlike Telegram there is no per-DC
 * address to derive -- DC ids 1..5 all resolve here, which is what the
 * desktop and Android forks do too (and why the server ships with
 * TELESRV_STRICT_DC_CHECK off).
 */
export const OWPENGRAM_SERVER = import.meta.env.VITE_OWPENGRAM_SERVER || '127.0.0.1:2398';

/**
 * Follows the page's own protocol rather than being configurable: a browser
 * refuses mixed content, so an https-served client can only ever reach a
 * server that terminates TLS itself or sits behind a reverse proxy, and an
 * http-served one can only reach a plaintext port.
 */
export const OWPENGRAM_SECURE = location.protocol === 'https:';

/**
 * The server's RSA public key, as the modulus/exponent pair rsaKeysManager
 * derives a fingerprint from.
 *
 * Baked in at build time on purpose. The server does expose its own key at
 * `GET /owpengram/server-info`, but that endpoint is plain HTTP, so trusting
 * it at runtime would let anything able to MITM it substitute a key and read
 * the handshake -- the same reason the server's identity refresh deliberately
 * applies only name/description/icon from there and never the key.
 *
 * Re-derive after regenerating the server's key (data/server_rsa.pem):
 *   curl -s http://<server>/owpengram/server-info
 *   # then, from the rsa_public_key_pem field:
 *   node -e "const c=require('crypto');console.log(Buffer.from(c.createPublicKey(process.argv[1]).export({format:'jwk'}).n,'base64url').toString('hex'))" "<pem>"
 */
export const OWPENGRAM_RSA_MODULUS = import.meta.env.VITE_OWPENGRAM_RSA_MODULUS ||
  'a5f43a4ae41e10051ddc3bb3f459da66b9873fc3dc42e64076fd70012d4084a26ee0c1fe2797743fec5d22ab260669651ccb56096f8327d05e4f56d43afc6e409c25c8a28e0140eb7aec2d3ddf5dd06f4698d3844d642e6515128752889200f14625e49c185e0e7a791e037e1ab3983cef326054d3a0d592370acc4ea6deeb85099e45fbbc4a1cf1b8bd2cbea8dc3722033358c90a8178b77d7aca91b1cff7af11a35581b5c6f2d2e201845fb44ad708fe676553503e7fb4b1c2b57e7b73a5d7eac5dcae9633a31d92ce4da7b92572ba1394c09d765d63d8c504cd0f331bcb04cc8f60827529f2864f03cde84c529ab97b11e86ac300ecd7e184a2123ef05f61';

export const OWPENGRAM_RSA_EXPONENT = '010001';

/**
 * Where the version line in the menu leads, the same repository the desktop
 * and Android clients open from their settings.
 */
export const OWPENGRAM_REPO_URL = 'https://github.com/owpengram/owpengram-server';
