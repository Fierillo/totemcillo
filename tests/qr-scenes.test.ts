// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { ZapStore } from '../src/nostr/store';
import { Announcement } from '../src/announcement';
import { QR_CAPTION } from '../src/scenes/post';

const URL_ = 'https://totem.lacrypta.ar/';
const render = (name: string, ann = new Announcement('Hola a todos')) => {
  const s = buildScenes({ ...defaultConfig, publicUrl: URL_ }, new ZapStore(), ann, 'http://x').find((x) => x.name === name)!;
  const root = document.createElement('div');
  s.render(root, () => {});
  return root;
};

describe('QR de la app también en últimos zaps, tops y anuncio (mismo componente que en posts)', () => {
  for (const name of ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio']) {
    it(`${name}: un único QR con la URL pública y su leyenda`, () => {
      const root = render(name);
      const qrs = root.querySelectorAll('aside.qr-box figure.qr');
      expect(qrs).toHaveLength(1);
      expect(qrs[0].getAttribute('data-uri')).toBe(URL_);
      expect(qrs[0].querySelector('svg')).not.toBeNull();
      expect(qrs[0].querySelector('figcaption')!.textContent).toBe(QR_CAPTION);
    });
  }
  it('últimos zaps sin zaps también lleva QR', () => {
    expect(render('latestZaps').textContent).toContain('Todavía no hay zaps');
    expect(render('latestZaps').querySelectorAll('figure.qr')).toHaveLength(1);
  });
  it('anuncio vacío también lleva QR', () => {
    expect(render('anuncio', new Announcement('')).querySelectorAll('figure.qr')).toHaveLength(1);
  });
  it('el video sigue sin QR (pantalla completa)', () => {
    expect(render('video').querySelector('figure.qr')).toBeNull();
  });
  it('CSS: últimos zaps, tops y anuncio usan columna propia para el QR (sin superponerse al contenido)', () => {
    const css = readFileSync(`${process.cwd()}/src/style.css`, 'utf8');
    expect(css).toMatch(/\.scene-anuncio, \.scene-latestZaps, \.scene-top10Historico, \.scene-top10Ultimas3h\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
    expect(css).toMatch(/\.scene-anuncio > \.qr-box, \.scene-latestZaps > \.qr-box, \.scene-top10Historico > \.qr-box, \.scene-top10Ultimas3h > \.qr-box\s*\{[^}]*grid-column:\s*2/);
  });
});
