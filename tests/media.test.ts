// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { imagesHtml, imagesOf, postImages, safeImageUrl, textWithoutImages } from '../src/media';

describe('imágenes en posts', () => {
  it('detecta URLs https de imagen en el texto, con query string, y las saca del texto visible', () => {
    const c = 'mirá https://img.example/a.JPG?w=1 y https://x.example/b.webp. listo';
    expect(postImages(c).map((i) => i.url)).toEqual(['https://img.example/a.JPG?w=1', 'https://x.example/b.webp']);
    expect(textWithoutImages(c)).toBe('mirá y . listo');
  });
  it('ignora http, javascript:, data: y URLs que no son imágenes', () => {
    expect(postImages('http://a.example/a.png javascript:alert(1)//a.png data:image/png;base64,AAAA https://a.example/page.html')).toEqual([]);
    expect(textWithoutImages('http://a.example/a.png')).toBe('http://a.example/a.png');
    expect(safeImageUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeImageUrl('https://u:p@a.example/a.png')).toBeUndefined();
  });
  it('lee tags imeta (NIP-92) con alt, y solo https', () => {
    const tags = [['imeta', 'url https://cdn.example/f', 'm image/jpeg', 'alt un "gato"', 'dim 10x10'], ['imeta', 'url javascript:alert(1)', 'm image/png'], ['imeta', 'url https://cdn.example/v.mp4', 'm video/mp4']];
    expect(postImages('', tags)).toEqual([{ url: 'https://cdn.example/f', alt: 'un "gato"' }]);
  });
  it('arma el HTML escapado: comillas en la URL o el alt no rompen el atributo; sin handlers inline', () => {
    const html = imagesHtml([{ url: 'https://a.example/x.png?q="><script>alert(1)</script>', alt: '" onerror="alert(1)' }, { url: 'javascript:alert(1)' }], 'm-media');
    const d = document.createElement('div'); d.innerHTML = html;
    const imgs = d.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(d.querySelector('script')).toBeNull();
    expect(imgs[0].getAttributeNames().sort()).toEqual(['alt', 'decoding', 'loading', 'referrerpolicy', 'src']);
    expect(imgs[0].getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(imgs[0].getAttribute('loading')).toBe('lazy');
    expect(imgs[0].getAttribute('src')).toBe(`/api/avatar?img=1&url=${encodeURIComponent('https://a.example/x.png?q=%22%3E%3Cscript%3Ealert(1)%3C/script%3E')}`); // via the proxy: no stand IP leak, bounded size
  });
  it('sin imágenes no agrega nada; une las del post guardadas y las del texto sin repetir', () => {
    expect(imagesHtml([], 'x')).toBe('');
    expect(imagesOf({ content: 'https://a.example/a.png', images: [{ url: 'https://a.example/a.png' }, { url: 'https://b.example/b.gif' }] }).map((i) => i.url)).toEqual(['https://a.example/a.png', 'https://b.example/b.gif']);
    expect(imagesOf({ content: '', images: 'basura' as never })).toEqual([]);
  });
  it('una imagen rota se oculta', async () => {
    const { hideBrokenImages } = await import('../src/media');
    hideBrokenImages(document);
    document.body.innerHTML = imagesHtml([{ url: 'https://a.example/a.png' }], 'm-media');
    const img = document.querySelector('img')!; img.dispatchEvent(new Event('error'));
    expect(img.hidden).toBe(true);
  });
});
