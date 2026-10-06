import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const STORAGE_KEY = 'owpengram_server_identity';

function setHead() {
  document.head.innerHTML = `
    <link rel="icon" type="image/png" sizes="16x16" href="assets/img/favicon-16x16.png">
    <link rel="icon" type="image/png" sizes="32x32" href="assets/img/favicon-32x32.png">
    <link rel="alternate icon" href="assets/img/favicon.ico" type="image/x-icon">
    <link rel="apple-touch-icon" sizes="180x180" href="assets/img/apple-touch-icon.png">
    <link rel="manifest" href="site.webmanifest">`;
}

async function loadIdentity(stored?: {name: string, description: string, hasIcon: boolean}) {
  vi.resetModules();
  localStorage.clear();
  if(stored) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }

  return import('@lib/owpengram/identity');
}

const icons = () => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="alternate icon"], link[rel="apple-touch-icon"]')];

describe('tab icon', () => {
  beforeEach(setHead);

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('is the server icon when the server has one', async() => {
    const {applyDocumentBranding, getServerIconUrl} = await loadIdentity({name: 'Acme', description: '', hasIcon: true});
    applyDocumentBranding();

    expect(icons()).toHaveLength(4);
    for(const link of icons()) {
      expect(link.href).toBe(getServerIconUrl());
      // describe the bundled PNGs, and would make a browser skip another size/format
      expect(link.hasAttribute('sizes')).toBe(false);
      expect(link.hasAttribute('type')).toBe(false);
    }
    expect(document.head.querySelector('link[rel="manifest"]').getAttribute('href')).toBe('site.webmanifest');
  });

  it('stays the bundled mark when the server has none', async() => {
    const {applyDocumentBranding} = await loadIdentity({name: 'Acme', description: '', hasIcon: false});
    applyDocumentBranding();

    expect(icons().map((link) => link.getAttribute('href'))).toEqual([
      'assets/img/favicon-16x16.png',
      'assets/img/favicon-32x32.png',
      'assets/img/favicon.ico',
      'assets/img/apple-touch-icon.png'
    ]);
    expect(icons()[0].getAttribute('sizes')).toBe('16x16');
  });

  it('follows the server as soon as it is first reached, without waiting for a reload', async() => {
    const {applyDocumentBranding, refreshServerIdentity} = await loadIdentity();
    applyDocumentBranding();
    expect(icons()[0].getAttribute('href')).toBe('assets/img/favicon-16x16.png');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async() => ({name: 'Acme', description: '', has_icon: true})
    }));
    await refreshServerIdentity();

    for(const link of icons()) {
      // getServerIconUrl still reflects the stored identity, which a refresh
      // deliberately leaves alone, so compare with the endpoint instead
      expect(link.href).toMatch(/\/owpengram\/server-icon$/);
      expect(link.hasAttribute('sizes')).toBe(false);
    }
  });

  describe('rounding', () => {
    // jsdom has neither image decoding nor a canvas, so both are stood in for
    function stubCanvas() {
      const calls: string[] = [];
      const context = {
        beginPath: () => calls.push('beginPath'),
        arc: (...args: number[]) => calls.push('arc ' + args.join(',')),
        clip: () => calls.push('clip'),
        drawImage: (_image: unknown, ...args: number[]) => calls.push('draw ' + args.join(','))
      };
      const realCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        if(tag !== 'canvas') {
          return realCreate(tag);
        }
        return {width: 0, height: 0, getContext: () => context, toDataURL: () => 'data:image/png;base64,ROUND'};
      }) as typeof document.createElement);
      return calls;
    }

    function stubImage(outcome: 'load' | 'error') {
      class FakeImage {
        crossOrigin = '';
        onload: () => void;
        onerror: () => void;
        set src(_value: string) {
          queueMicrotask(() => outcome === 'load' ? this.onload() : this.onerror());
        }
      }
      vi.stubGlobal('Image', FakeImage);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('bakes a circular mask into the icon', async() => {
      const calls = stubCanvas();
      stubImage('load');
      const {applyDocumentBranding} = await loadIdentity({name: 'Acme', description: '', hasIcon: true});
      applyDocumentBranding();
      await new Promise((resolve) => setTimeout(resolve));

      // clipped to a circle before the image is drawn into it
      expect(calls).toEqual(['beginPath', 'arc 32,32,32,0,' + Math.PI * 2, 'clip', 'draw 0,0,64,64']);
      for(const link of icons()) {
        expect(link.getAttribute('href')).toBe('data:image/png;base64,ROUND');
      }
    });

    it('keeps the plain server icon when the image cannot be loaded', async() => {
      stubCanvas();
      stubImage('error');
      const {applyDocumentBranding, getServerIconUrl} = await loadIdentity({name: 'Acme', description: '', hasIcon: true});
      applyDocumentBranding();
      await new Promise((resolve) => setTimeout(resolve));

      for(const link of icons()) {
        expect(link.href).toBe(getServerIconUrl());
      }
    });
  });
});
