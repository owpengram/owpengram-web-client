import {describe, expect, it} from 'vitest';
import {
  decodeEmailPhone,
  encodeEmailPhone,
  getPhoneForDisplay,
  isEmailSignupPhone,
  MAX_EMAIL_PHONE_LENGTH,
  normalizeEmail
} from '@lib/owpengram/emailSignupPhone';

// Produced by the server's domain.EncodeEmailPhone (internal/domain/emailphone_test.go).
// The server decodes what this client sends, so these have to match byte for byte.
const SERVER_VECTORS: [string, string][] = [
  ['onysd@owpengram.local', '888onysdq0owpengramq1local'],
  ['a@b.co', '888aq0bq1co'],
  ['User.Name+Tag@Example.COM', '888userq1nameq4tagq0exampleq1com'],
  [
    'very.long.email.address.for.testing.purposes@some-long-domain-name.example.com',
    '888veryq1longq1emailq1addressq1forq1testingq1purposesq0someq2longq2domainq2nameq1exampleq1com'
  ]
];

describe('encodeEmailPhone', () => {
  it('matches what the server encodes', () => {
    for(const [email, phone] of SERVER_VECTORS) {
      expect(encodeEmailPhone(email)).toBe(phone);
    }
  });

  it('gives one number to an address however it was typed', () => {
    expect(encodeEmailPhone('  User@Example.com ')).toBe(encodeEmailPhone('user@example.com'));
    expect(normalizeEmail('  User@Example.com ')).toBe('user@example.com');
  });

  it('escapes a literal q, which would otherwise read as an escape', () => {
    expect(encodeEmailPhone('q@q.com')).toBe('888q5q0q5q1com');
    expect(decodeEmailPhone('888q5q0q5q1com')).toBe('q@q.com');
  });

  it('refuses what cannot be an address, or cannot be carried', () => {
    for(const email of ['', '   ', 'not-an-email', 'ünï@example.com', 'a b@example.com', 'a@exämple.com', 'a/b@example.com']) {
      expect(encodeEmailPhone(email)).toBeUndefined();
    }

    const tooLong = 'a'.repeat(MAX_EMAIL_PHONE_LENGTH) + '@example.com';
    expect(encodeEmailPhone(tooLong)).toBeUndefined();
  });

  it('keeps an address that fits the column exactly', () => {
    // 3 for the prefix, 2 for the @ escape, 4 for ".com"'s dot escape and letters: fill the rest
    const local = 'a'.repeat(MAX_EMAIL_PHONE_LENGTH - 3 - 2 - 1 - 2 - 3);
    const phone = encodeEmailPhone(local + '@b.com');
    expect(phone).toBeDefined();
    expect(phone).toHaveLength(MAX_EMAIL_PHONE_LENGTH - 0);
    expect(encodeEmailPhone(local + 'a@b.com')).toBeUndefined();
  });
});

describe('decodeEmailPhone', () => {
  it('reverses the encoding', () => {
    for(const [email, phone] of SERVER_VECTORS) {
      expect(decodeEmailPhone(phone)).toBe(normalizeEmail(email));
    }
  });

  it('refuses numbers that are not an encoded address', () => {
    // like the server's decoder, only the escape is checked: anything else passes through
    for(const phone of ['', '15550001234', '888', '88799999', '888abc', '888q', '888q9x']) {
      expect(decodeEmailPhone(phone)).toBeUndefined();
    }
  });
});

describe('isEmailSignupPhone', () => {
  it('tells an encoded address from a real number, even one starting with 888', () => {
    expect(isEmailSignupPhone('888aq0bq1co')).toBe(true);
    expect(isEmailSignupPhone('  888AQ0BQ1CO ')).toBe(true);
    expect(isEmailSignupPhone('88812345678')).toBe(false);
    expect(isEmailSignupPhone('+15550001234')).toBe(false);
    expect(isEmailSignupPhone('')).toBe(false);
  });
});

describe('getPhoneForDisplay', () => {
  it('shows the address for an encoded number and the number otherwise', () => {
    expect(getPhoneForDisplay('888onysdq0owpengramq1local')).toBe('onysd@owpengram.local');
    expect(getPhoneForDisplay('+373 79 049 448')).toBe('+373 79 049 448');
    expect(getPhoneForDisplay('88812345678')).toBe('88812345678');
    // letters but not an address: shown as received rather than blanked
    expect(getPhoneForDisplay('888q9')).toBe('888q9');
  });
});
