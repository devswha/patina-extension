import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.PATINA_CORE_ROOT) throw new Error('Set PATINA_CORE_ROOT and build before testing.');
const root = resolve(process.env.PATINA_CORE_ROOT);
const { scoreText } = await import(pathToFileURL(resolve(root, 'scripts/prose-score.mjs')));
const context = vm.createContext({});
vm.runInContext(readFileSync('artifacts/score-test.js', 'utf8'), context);
const api = context.PatinaScore;

test('bundled public lexicons preserve the canonical hot ratio across EN/KO fixtures', () => {
  let count = 0;
  for (const language of ['en', 'ko']) for (const kind of ['ai', 'natural']) {
    const directory = resolve(root, 'tests/fixtures/suspect-zones', language, kind);
    for (const name of readdirSync(directory).filter((name) => name.endsWith('.md'))) {
      const text = readFileSync(resolve(directory, name), 'utf8').replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim();
      const result = api.scoreLocal(text, { language, threshold: 30 });
      const canonical = scoreText(text, { lang: language, repoRoot: root });
      assert.equal(result.score, canonical.score, name); assert.equal(result.hotCount, canonical.hotCount, name); count++;
    }
  }
  assert.ok(count >= 20);
});

test('settings, unsupported languages and long inputs cannot expose a model/network path', () => {
  assert.equal(api.settingsFrom({ language: 'remote', threshold: '30', text: 'private' }).language, 'auto');
  assert.deepEqual(Object.keys(api.settingsFrom({ text: 'private' })).sort(), ['language', 'threshold']);
  assert.equal(api.scoreLocal('日本語で書かれた文章をここに入力しています。', { language: 'auto' }).available, false);
  assert.equal(api.scoreLocal('x'.repeat(50001)).available, false);
  assert.equal(context.fetch, undefined); assert.equal(context.process, undefined);
  assert.equal(api.scoreLocal('I fixed the typo.', { language: 'en' }).available, true);
  const mixed = '```\n한국어 예시가 코드 블록 안에 여러 번 들어 있습니다. 한국어 예시 문장입니다.\n```\n\nI fixed the typo. Thanks.';
  const node = scoreText(mixed, { lang: 'auto', repoRoot: root });
  const browser = api.scoreLocal(mixed, { language: 'auto' });
  assert.equal(browser.language, node.lang); assert.equal(browser.score, node.score);
});

test('inflected Korean words preserve the core lexicon language semantics', () => {
  const text = '차별화를 위한 활성화를 검토해요.';
  const result = api.scoreLocal(text, { language: 'ko' });
  const canonical = scoreText(text, { lang: 'ko', repoRoot: root });
  assert.equal(canonical.score, 100);
  assert.equal(result.score, canonical.score);
});

test('production manifest only declares Gmail content scripts and settings storage', () => {
  const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://mail.google.com/*']);
  assert.equal(manifest.background, undefined); assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.ok(!manifest.content_security_policy.extension_pages.includes('unsafe-eval'));
});
