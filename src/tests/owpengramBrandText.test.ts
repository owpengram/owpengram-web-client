import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const STORAGE_KEY = 'owpengram_server_identity';

async function loadBrandText(storedName?: string) {
  vi.resetModules();
  localStorage.clear();
  if(storedName !== undefined) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({name: storedName, description: '', hasIcon: false}));
  }

  return (await import('@lib/owpengram/brandText')).default;
}

describe('brandText', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('replaces the official name with the default product name', async() => {
    const brandText = await loadBrandText();
    expect(brandText('Welcome to Telegram')).toBe('Welcome to OwpenGram');
    expect(brandText('telegram TELEGRAM Telegram')).toBe('OwpenGram OwpenGram OwpenGram');
  });

  it('uses the name the server reported', async() => {
    const brandText = await loadBrandText('Acme Chat');
    expect(brandText('You have %s on Telegram')).toBe('You have %s on Acme Chat');
  });

  it('falls back to the default when the server has no name of its own', async() => {
    const brandText = await loadBrandText('');
    expect(brandText('Telegram Web')).toBe('OwpenGram Web');
  });

  it('rewrites the brand in other scripts the way the server does', async() => {
    const brandText = await loadBrandText();
    expect(brandText('Телеграм Premium')).toBe('OwpenGram Premium');
    expect(brandText('Телеграмом')).toBe('OwpenGram');
  });

  it('leaves links to Telegram hosts untouched instead of breaking them', async() => {
    const brandText = await loadBrandText();
    expect(brandText('Use [Android](https://telegram.org/android) now')).toBe('Use [Android](https://telegram.org/android) now');
    expect(brandText('Telegram on https://t.me/foo and telegram.org')).toBe('OwpenGram on https://t.me/foo and telegram.org');
  });

  it('keeps placeholders and runtime identifiers as they are', async() => {
    const brandText = await loadBrandText();
    expect(brandText('%1$s joined Telegram {0}')).toBe('%1$s joined OwpenGram {0}');
    expect(brandText('telegram.webk_theme')).toBe('telegram.webk_theme');
  });

  it('passes empty values through', async() => {
    const brandText = await loadBrandText();
    expect(brandText('')).toBe('');
    expect(brandText(undefined)).toBe(undefined);
  });
});

describe('brandLangPackString', () => {
  it('brands plain and pluralized strings, and leaves deleted ones alone', async() => {
    vi.resetModules();
    localStorage.clear();
    const {brandLangPackString} = await import('@lib/owpengram/brandText');

    expect(brandLangPackString({_: 'langPackString', key: 'a', value: 'Telegram'})).toEqual({_: 'langPackString', key: 'a', value: 'OwpenGram'});
    expect(brandLangPackString({
      _: 'langPackStringPluralized',
      key: 'b',
      one_value: '%d Telegram user',
      other_value: '%d Telegram users'
    } as any)).toMatchObject({one_value: '%d OwpenGram user', other_value: '%d OwpenGram users'});

    const deleted = {_: 'langPackStringDeleted', key: 'c'} as any;
    expect(brandLangPackString(deleted)).toBe(deleted);
  });
});
