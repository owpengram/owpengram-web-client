import type {LangPackString} from '@layer';
import {getProductName} from '@lib/owpengram/identity';

/**
 * Rewrites the official product name in text the client ships with, the way the
 * server already does for everything it serves: its language packs are run
 * through `branding.UserVisibleText` on the way out, so the strings fetched from
 * the server arrive branded. The local `lang.ts` fallbacks never pass through
 * the server, and this is what brings them into line -- using the same name, so
 * a renamed server reads the same everywhere.
 *
 * The server's brand pattern, kept in step with it on purpose.
 */
const OFFICIAL_BRAND_RE = /telegram|телеграм[\p{L}]*|تيليجرام|تلگرام|텔레그램|טלגרם/giu;

// A dotted or underscored runtime identifier is not copy, and changing it can
// break navigation (the server leaves these alone too)
const TECHNICAL_ID_RE = /^[A-Za-z0-9-]+(?:[._][A-Za-z0-9-]+)+$/;

// Links to Telegram's own hosts, which the server maps onto its public address.
// That address is not known here, so they are left exactly as written rather
// than rewritten into something that would not resolve (`telegram.org` must not
// become `OwpenGram.org`).
const OFFICIAL_LINK = String.raw`https?:\/\/\S+|(?:[a-z0-9-]+\.)*(?:telegram\.(?:org|me|com|dog)|t\.me)\b\S*`;
const OFFICIAL_LINK_SPLIT_RE = new RegExp(`(${OFFICIAL_LINK})`, 'gi');

export default function brandText(value: string) {
  if(!value || TECHNICAL_ID_RE.test(value)) {
    return value;
  }

  const name = getProductName();

  // Splitting on a capturing group keeps the links at the odd indexes
  return value
  .split(OFFICIAL_LINK_SPLIT_RE)
  .map((part, idx) => idx % 2 ? part : part.replace(OFFICIAL_BRAND_RE, name))
  .join('');
}

const PLURAL_FORMS = ['zero_value', 'one_value', 'two_value', 'few_value', 'many_value', 'other_value'] as const;

/** Brands a language pack string in place, whichever shape it has, and returns it. */
export function brandLangPackString(string: LangPackString) {
  if(string._ === 'langPackString') {
    string.value = brandText(string.value);
    return string;
  }

  // A deleted string has no text to rewrite
  if(string._ !== 'langPackStringPluralized') {
    return string;
  }

  for(const form of PLURAL_FORMS) {
    if(string[form]) {
      string[form] = brandText(string[form]);
    }
  }

  return string;
}
