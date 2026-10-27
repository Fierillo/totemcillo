// Admin panel flows: sign-in, saving settings, remote control of the totem, sign-out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, startApp, openApp, adminLogin, settings, session, save, now, five, fiveZaps } from '../browser/harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

test('una clave incorrecta no inicia sesión', async () => {
  const page = await app.browser.newPage();
  await page.goto(`${BASE}/admin`);
  await page.fill('input[type="password"]', 'incorrecta');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.err');
  assert.match(await page.textContent('.err'), /incorrecta/i);
  assert.equal((await session(page)).authed, false);
  await page.close();
});

test('guardar la configuración persiste inicio, proveedor, anuncio, duración y video', async () => {
  const page = await adminLogin(app.browser);
  const start = new Date((now - 86400) * 1000 - 3 * 3600_000).toISOString().slice(0, 16);
  await page.fill('input[name="startLine"]', start);
  await page.fill('input[name="prov-new"]', 'wallet.example');
  await page.click('form.prov-add button[type="submit"]');
  await page.waitForSelector('.prov-item[data-domain="wallet.example"]');
  await page.fill('textarea[name="announcement"]', '¡Sorteo desde e2e!');
  await page.fill('input[name="dur-post"]', '20');
  await page.fill('input[name="videoEveryCycles"]', '3');
  await page.selectOption('select[name="videoMode"]', 'clip');
  await page.fill('input[name="videoClipSeconds"]', '30');
  assert.equal(await save(page), 'Guardado');
  const s = await settings(page);
  assert.deepEqual([s.announcement, s.sceneDurations.post, s.videoEveryCycles, s.videoMode, s.videoClipSeconds], ['¡Sorteo desde e2e!', 20000, 3, 'clip', 30]);
  assert.equal(Date.parse(s.startLine), Date.parse(`${start}:00-03:00`)); // Argentina time
  assert.ok(s.zapProviders.includes('wallet.example'));
  await page.close();
});

test('modo video completo oculta el largo del clip, lo conserva y sigue así al recargar', async () => {
  const page = await adminLogin(app.browser);
  const clip = page.locator('input[name="videoClipSeconds"]');
  await page.selectOption('select[name="videoMode"]', 'clip');
  await page.fill('input[name="videoClipSeconds"]', '30');
  await page.selectOption('select[name="videoMode"]', 'full');
  assert.equal(await clip.isVisible(), false);
  await save(page);
  await page.reload(); await page.waitForSelector('select[name="videoMode"]');
  const s = await settings(page);
  assert.deepEqual([s.videoMode, s.videoClipSeconds], ['full', 30]);
  assert.equal(await clip.isVisible(), false);
  await page.selectOption('select[name="videoMode"]', 'clip');
  await save(page);
  await page.reload(); await page.waitForSelector('select[name="videoMode"]');
  assert.equal(await clip.isVisible(), true);
  await page.close();
});

/** Totem page that polls settings fast, plus the signed-in admin. */
async function totemAndAdmin() {
  const totem = await openApp(app.browser, { config: { publicUrl: 'https://totem.lacrypta.ar/', settingsPollMs: 500 }, data: { posts: five, zaps: fiveZaps } });
  await totem.goto(`${BASE}/`);
  await totem.waitForSelector('#scene[class*="scene-"]');
  return { totem, admin: await adminLogin(app.browser) };
}

test('el anuncio guardado en el admin aparece en el tótem', async () => {
  const { totem, admin } = await totemAndAdmin();
  await admin.fill('textarea[name="announcement"]', '¡Anuncio remoto e2e!');
  await save(admin);
  const sees = (ms) => totem.waitForFunction(() => document.body.innerText.includes('¡Anuncio remoto e2e!'), null, { timeout: ms }).then(() => true, () => false);
  let found = await sees(2500);
  for (let i = 0; i < 4 && !found; i++) { await admin.click('button.cmd-next'); found = await sees(1500); } // step the schedule to Anuncio
  assert.ok(found);
  await totem.close(); await admin.close();
});

test('la flecha remota mueve la agenda y el tótem cambia de escena', async () => {
  const { totem, admin } = await totemAndAdmin();
  const epoch = (await settings(admin)).epoch;
  const before = await totem.evaluate(() => document.getElementById('scene').className);
  await admin.click('button.cmd-next');
  await admin.waitForFunction(async (e) => (await (await fetch('/api/settings')).json()).epoch !== e, epoch, { timeout: 5000 });
  await totem.waitForFunction((b) => document.getElementById('scene').className !== b, before, { timeout: 5000 });
  await totem.close(); await admin.close();
});

test('salir cierra la sesión', async () => {
  const page = await adminLogin(app.browser);
  await page.click('button.logout');
  await page.waitForURL(`${BASE}/`);
  assert.equal((await session(page)).authed, false);
  await page.close();
});
