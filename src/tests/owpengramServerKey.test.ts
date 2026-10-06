import {afterEach, describe, expect, it, vi} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {parseRsaPublicKeyPem} from '@lib/owpengram/serverKey';

/** Fresh modules, so @config/owpengram is evaluated under the given build flag. */
async function loadServerKey(embedded: boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_OWPENGRAM_EMBEDDED', embedded ? 'true' : '');
  return import('@lib/owpengram/serverKey');
}

/** What the server serves: PKCS#1, the `openssl rsa -RSAPublicKey_out` form. */
function serverPem(bits: number) {
  const {publicKey} = generateKeyPairSync('rsa', {modulusLength: bits, publicExponent: 0x10001});
  const pem = publicKey.export({type: 'pkcs1', format: 'pem'}) as string;
  const jwk = publicKey.export({format: 'jwk'});
  return {pem, modulus: Buffer.from(jwk.n, 'base64url').toString('hex')};
}

describe('parseRsaPublicKeyPem', () => {
  it('reads the modulus and exponent the server key carries', () => {
    for(const bits of [1024, 2048, 3072]) {
      const {pem, modulus} = serverPem(bits);
      expect(parseRsaPublicKeyPem(pem)).toEqual({modulus, exponent: '010001'});
    }
  });

  it('drops the leading zero DER adds when the top bit is set, and only that', () => {
    const {pem, modulus} = serverPem(2048);
    const parsed = parseRsaPublicKeyPem(pem);
    expect(parsed.modulus).toHaveLength(512);
    expect(parsed.modulus.startsWith('00')).toBe(false);
    expect(parsed.modulus).toBe(modulus);
  });

  it('accepts the PEM however it is wrapped', () => {
    const {pem, modulus} = serverPem(2048);
    const oneLine = pem.replace(/\n/g, '');
    const crlf = pem.replace(/\n/g, '\r\n');
    expect(parseRsaPublicKeyPem(oneLine).modulus).toBe(modulus);
    expect(parseRsaPublicKeyPem(crlf).modulus).toBe(modulus);
  });

  it('refuses anything that is not a PKCS#1 key', () => {
    const {publicKey} = generateKeyPairSync('rsa', {modulusLength: 1024});
    const spki = publicKey.export({type: 'spki', format: 'pem'}) as string;

    expect(() => parseRsaPublicKeyPem('')).toThrow();
    expect(() => parseRsaPublicKeyPem('not a key')).toThrow();
    expect(() => parseRsaPublicKeyPem(spki)).toThrow(/PKCS#1/);

    const {pem} = serverPem(1024);
    const body = pem.replace(/-----[A-Z ]+-----|\s/g, '');
    const cut = `-----BEGIN RSA PUBLIC KEY-----\n${body.slice(0, 40)}\n-----END RSA PUBLIC KEY-----`;
    expect(() => parseRsaPublicKeyPem(cut)).toThrow();
  });
});

describe('fetchServerRsaKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('asks the server that served the page and never caches the answer', async() => {
    const {pem, modulus} = serverPem(2048);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async() => ({dc_id: 2, rsa_public_key_pem: pem})
    });
    vi.stubGlobal('fetch', fetchMock);

    const {fetchServerRsaKey} = await loadServerKey(true);
    expect(await fetchServerRsaKey()).toEqual({modulus, exponent: '010001'});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${location.protocol}//${location.host}/owpengram/server-info`);
    expect(init).toEqual({cache: 'no-store'});
  });

  it('fails loudly when the server has no key to give', async() => {
    const {fetchServerRsaKey} = await loadServerKey(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: false, status: 503}));
    await expect(fetchServerRsaKey()).rejects.toThrow(/503/);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async() => ({dc_id: 2})}));
    await expect(fetchServerRsaKey()).rejects.toThrow(/no rsa_public_key_pem/);
  });
});

describe('embedded build address', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is whoever served the page', async() => {
    vi.resetModules();
    vi.stubEnv('VITE_OWPENGRAM_EMBEDDED', 'true');
    vi.stubEnv('VITE_OWPENGRAM_SERVER', 'somewhere.else:1');
    const config = await import('@config/owpengram');
    expect(config.OWPENGRAM_SERVER).toBe(location.host);
  });

  it('is the configured server otherwise', async() => {
    vi.resetModules();
    vi.stubEnv('VITE_OWPENGRAM_EMBEDDED', '');
    vi.stubEnv('VITE_OWPENGRAM_SERVER', 'somewhere.else:1');
    const config = await import('@config/owpengram');
    expect(config.OWPENGRAM_SERVER).toBe('somewhere.else:1');
  });
});
