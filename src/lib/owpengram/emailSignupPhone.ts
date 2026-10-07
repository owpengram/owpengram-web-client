/**
 * Email as an account identity, for a server with `TELESRV_EMAIL_SIGNUP_ENABLE`.
 *
 * Such a server has no SMS to send, so a login is started with an email address
 * instead of a phone number. The address travels as a synthetic "phone number":
 * `888` followed by the address, where letters and digits stay as they are and
 * the few punctuation marks an address may hold become a two-character escape
 * (`q` and a digit). That lets the ordinary `auth.sendCode` / `auth.signIn` /
 * `auth.signUp` calls carry it unchanged -- no new TL constructors.
 *
 * Must stay byte-for-byte identical to the server's `domain.EncodeEmailPhone`
 * and to the Android (`EmailSignupPhone`) and desktop encoders: the server
 * decodes what this produces, and finds an existing account by the decoded
 * address. A change on one side alone silently orphans every account.
 */

export const EMAIL_PHONE_PREFIX = '888';

/** The width of the server's `users.phone` column. */
export const MAX_EMAIL_PHONE_LENGTH = 200;

const ESCAPE = 'q';

const ENCODE: {[char: string]: string} = {
  '@': '0',
  '.': '1',
  '-': '2',
  '_': '3',
  '+': '4',
  [ESCAPE]: '5'
};

const DECODE: {[digit: string]: string} = {};
for(const char in ENCODE) {
  DECODE[ENCODE[char]] = char;
}

/** The same address always encodes to the same number, however it was typed. */
export function normalizeEmail(email: string) {
  return (email || '').trim().toLowerCase();
}

/**
 * The synthetic number for an email address, or undefined when there is none: an
 * address needs an `@`, may only hold `a-z 0-9 @ . - _ +`, and has to fit the
 * server's phone column once encoded.
 */
export function encodeEmailPhone(email: string): string | undefined {
  const normalized = normalizeEmail(email);
  if(!normalized || !normalized.includes('@')) {
    return;
  }

  let body = '';
  for(const char of normalized) {
    if((char >= 'a' && char <= 'z' && char !== ESCAPE) || (char >= '0' && char <= '9')) {
      body += char;
      continue;
    }

    const digit = ENCODE[char];
    if(digit === undefined) {
      return;
    }

    body += ESCAPE + digit;
  }

  const phone = EMAIL_PHONE_PREFIX + body;
  if(phone.length > MAX_EMAIL_PHONE_LENGTH) {
    return;
  }

  return phone;
}

/** The address a synthetic number stands for, or undefined if it is not one. */
export function decodeEmailPhone(phone: string): string | undefined {
  const lower = (phone || '').trim().toLowerCase();
  if(!lower.startsWith(EMAIL_PHONE_PREFIX) || lower.length === EMAIL_PHONE_PREFIX.length) {
    return;
  }

  const body = lower.slice(EMAIL_PHONE_PREFIX.length);
  let email = '';
  for(let i = 0; i < body.length; ++i) {
    const char = body[i];
    if(char !== ESCAPE) {
      email += char;
      continue;
    }

    const decoded = DECODE[body[++i]];
    if(decoded === undefined) {
      return;
    }

    email += decoded;
  }

  if(!email.includes('@')) {
    return;
  }

  return email;
}

/**
 * Whether a number is one `encodeEmailPhone` made. Every encoded value holds a
 * letter (the `q` of the `@` escape) and a real phone number never does, so even
 * a real number that happens to start with 888 is not mistaken for one.
 */
export function isEmailSignupPhone(phone: string) {
  const lower = (phone || '').trim().toLowerCase();
  return lower.startsWith(EMAIL_PHONE_PREFIX) && /[a-z]/.test(lower);
}

/**
 * What to show for a number the login is for: the address when it stands for
 * one, the number as it is otherwise. The synthetic form is wire format only and
 * means nothing to a person.
 */
export function getPhoneForDisplay(phone: string) {
  return (isEmailSignupPhone(phone) && decodeEmailPhone(phone)) || phone;
}
