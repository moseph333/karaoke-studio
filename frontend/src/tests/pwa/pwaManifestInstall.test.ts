/**
 * The web app manifest and head tags that make the studio installable as a phone app: a
 * stable id, separate "any" and full-bleed "maskable" icons of the stated sizes,
 * screenshots for Android's install sheet, the share target, and the iOS/Android meta tags.
 */

import { describe, it, expect } from 'vitest';
import { readFrontendFile, readIndexHtml, resolveFrontendFile } from '../helpers/bootScriptUtils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');

interface ManifestImage {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
  form_factor?: string;
}

const manifest = JSON.parse(readFrontendFile('public/manifest.json'));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(src: string): [number, number] {
  const bytes: Uint8Array = fs.readFileSync(resolveFrontendFile(`public${src}`));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(12)).toBe(0x49484452); // "IHDR"
  return [view.getUint32(16), view.getUint32(20)];
}

/** PNG colour type: 6 = RGBA, 2 = RGB. */
function pngColourType(src: string): number {
  const bytes: Uint8Array = fs.readFileSync(resolveFrontendFile(`public${src}`));
  return bytes[25];
}

describe('PWA manifest for installing the app', () => {
  it('has a stable id, language and standalone display', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.lang).toBe('en');
    expect(manifest.display).toBe('standalone');
  });

  it('lists separate any and maskable icons, never the combined "any maskable"', () => {
    const icons: ManifestImage[] = manifest.icons;
    expect(icons.every((icon) => icon.purpose === 'any' || icon.purpose === 'maskable')).toBe(true);
    for (const purpose of ['any', 'maskable']) {
      const sizes = icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes);
      expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    }
  });

  it('ships every icon and screenshot at the size it states', () => {
    const images: ManifestImage[] = [...manifest.icons, ...manifest.screenshots];
    for (const image of images) {
      const [w, h] = image.sizes.split('x').map(Number);
      expect(pngSize(image.src), image.src).toEqual([w, h]);
    }
  });

  it('gives the "any" icons transparent corners and the maskable ones a full-bleed background', () => {
    for (const icon of manifest.icons as ManifestImage[]) {
      expect(pngColourType(icon.src), icon.src).toBe(icon.purpose === 'any' ? 6 : 2);
    }
    // iOS masks the touch icon itself: corners baked into it would show as a dark rim
    expect(pngColourType('/apple-touch-icon.png')).toBe(2);
    expect(pngSize('/apple-touch-icon.png')).toEqual([180, 180]);
  });

  it('offers a narrow and a wide screenshot for the rich install sheet', () => {
    const factors = (manifest.screenshots as ManifestImage[]).map((s) => s.form_factor);
    expect(factors.sort()).toEqual(['narrow', 'wide']);
  });

  it('receives shares as GET parameters on the start page', () => {
    expect(manifest.share_target).toEqual({
      action: '/',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    });
  });
});

describe('index.html install tags', () => {
  const html = readIndexHtml();

  it.each([
    ['mobile-web-app-capable', 'yes'],
    ['apple-mobile-web-app-capable', 'yes'],
    ['apple-mobile-web-app-title', 'Karaoke'],
    ['application-name', 'Karaoke Studio'],
  ])('has <meta name="%s" content="%s">', (name, content) => {
    expect(html).toContain(`<meta name="${name}" content="${content}" />`);
  });
});

describe('offline page', () => {
  const offline = readFrontendFile('public/offline.html');

  it('is self-contained: no scripts or styles from the app build or other hosts', () => {
    expect(offline).not.toMatch(/src="\/assets\//);
    expect(offline).not.toMatch(/https?:\/\//);
  });

  it('offers a retry with a 44 px target', () => {
    expect(offline).toContain('location.reload()');
    expect(offline).toMatch(/min-height:\s*44px/);
  });
});
