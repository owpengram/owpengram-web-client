import {OWPENGRAM_SERVER_URL} from '@config/owpengram';
import bytesToHex from '@helpers/bytes/bytesToHex';

/** The modulus/exponent pair the MTProto handshake encrypts to, as hex. */
export type ServerRsaKey = {
  modulus: string,
  exponent: string
};

type DerReader = {der: Uint8Array, pos: number};

function readByte(reader: DerReader) {
  if(reader.pos >= reader.der.length) {
    throw new Error('RSA key is truncated');
  }

  return reader.der[reader.pos++];
}

/** DER definite length: one byte below 128, otherwise 0x80 | byte count, then the count bytes. */
function readLength(reader: DerReader) {
  const first = readByte(reader);
  if(first < 0x80) {
    return first;
  }

  const count = first & 0x7f;
  if(count < 1 || count > 3) {
    throw new Error('RSA key has an unsupported length');
  }

  let length = 0;
  for(let i = 0; i < count; ++i) {
    length = length * 256 + readByte(reader);
  }

  return length;
}

function readTag(reader: DerReader, tag: number) {
  if(readByte(reader) !== tag) {
    throw new Error('RSA key is not a PKCS#1 RSAPublicKey');
  }

  return readLength(reader);
}

function readInteger(reader: DerReader) {
  const length = readTag(reader, 0x02);
  if(!length || reader.pos + length > reader.der.length) {
    throw new Error('RSA key is truncated');
  }

  const bytes = reader.der.subarray(reader.pos, reader.pos + length);
  reader.pos += length;

  // A positive integer whose top bit is set gets a leading zero byte in DER
  let start = 0;
  while(start < bytes.length - 1 && bytes[start] === 0) {
    ++start;
  }

  return bytes.subarray(start);
}

/**
 * Reads the `RSA PUBLIC KEY` PEM block the server serves (PKCS#1, what
 * `openssl rsa -RSAPublicKey_out` prints): `SEQUENCE { INTEGER n, INTEGER e }`.
 * WebCrypto cannot import that form, and a few bytes of DER are not worth a
 * dependency.
 */
export function parseRsaPublicKeyPem(pem: string): ServerRsaKey {
  const body = pem.replace(/-----(BEGIN|END) RSA PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  if(!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) {
    throw new Error('RSA key is not a PKCS#1 PEM block');
  }

  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; ++i) {
    der[i] = binary.charCodeAt(i);
  }

  const reader: DerReader = {der, pos: 0};
  readTag(reader, 0x30);
  const modulus = readInteger(reader);
  const exponent = readInteger(reader);

  return {
    modulus: bytesToHex(modulus).toLowerCase(),
    exponent: bytesToHex(exponent).toLowerCase()
  };
}

/**
 * The key of the server that served this page, read when the client starts.
 * Only the embedded build calls this; see @config/owpengram for why trusting
 * the key from there is no weaker than trusting the page itself.
 *
 * `no-store`: a regenerated server key must be picked up by the very next load,
 * not after a cache entry runs out.
 */
export async function fetchServerRsaKey(): Promise<ServerRsaKey> {
  const url = OWPENGRAM_SERVER_URL + '/owpengram/server-info';
  const response = await fetch(url, {cache: 'no-store'});
  if(!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }

  const pem = (await response.json()).rsa_public_key_pem;
  if(typeof(pem) !== 'string') {
    throw new Error(`${url} returned no rsa_public_key_pem`);
  }

  return parseRsaPublicKeyPem(pem);
}
