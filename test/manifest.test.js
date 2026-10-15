// @ts-check
import { describe, it, expect } from 'vitest';
import fx from '../manifest.json';
import ch from '../manifest.chrome.json';
import pkg from '../package.json';

const REPO = 'https://github.com/ArthurMalucelli/whattasks';

describe('manifests e package.json', () => {
  it('as três versões batem (o release confere a tag contra elas)', () => {
    expect(fx.version).toBe(pkg.version);
    expect(ch.version).toBe(pkg.version);
    expect(fx.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('Firefox: id gecko fixo e update_url apontando pro updates.json da última release', () => {
    const gecko = fx.browser_specific_settings.gecko;
    expect(gecko.id).toBe('wa-tasks@arthurmalucelli');
    expect(gecko.update_url).toBe(`${REPO}/releases/latest/download/updates.json`);
  });

  it('Chrome: sem update_url (só a Web Store atualiza) e sem chaves gecko', () => {
    expect('update_url' in ch).toBe(false);
    expect('browser_specific_settings' in ch).toBe(false);
  });

  it('homepage_url dos dois manifests é o repositório', () => {
    expect(fx.homepage_url).toBe(REPO);
    expect(ch.homepage_url).toBe(REPO);
  });
});
