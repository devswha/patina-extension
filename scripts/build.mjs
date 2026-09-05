import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

if (!process.env.PATINA_CORE_ROOT) throw new Error('Set PATINA_CORE_ROOT to the reviewed Patina core checkout.');
const core = resolve(process.env.PATINA_CORE_ROOT);
const pkg = JSON.parse(readFileSync(resolve(core, 'package.json'), 'utf8'));
if (pkg.name !== 'patina-cli') throw new Error('Expected the Patina CLI source package');
const { parseLexiconBody } = await import(pathToFileURL(resolve(core, 'src/features/lexicon-core.js')));
mkdirSync('dist', { recursive: true });
rmSync('dist/score-test.js', { force: true });
mkdirSync('artifacts', { recursive: true });
const lexicons = {};
for (const language of ['en', 'ko']) {
  const source = readFileSync(resolve(core, `lexicon/ai-${language}.md`), 'utf8');
  lexicons[language] = { lang: language, ...parseLexiconBody(source.replace(/^---[\s\S]*?---\s*/, '')) };
  writeFileSync(`dist/lexicon-${language}.json`, JSON.stringify(lexicons[language]));
}
const plugins = [{ name: 'patina-local-inputs', setup(builder) {
  builder.onResolve({ filter: /^patina-core$/ }, () => ({ path: resolve(core, 'src/prose-core.js') }));
  builder.onResolve({ filter: /^patina-lexicons$/ }, () => ({ path: 'lexicons', namespace: 'patina' }));
  builder.onLoad({ filter: /.*/, namespace: 'patina' }, () => ({ contents: `export default ${JSON.stringify(lexicons)};`, loader: 'js' }));
} }];
const content = await build({ entryPoints: ['src/content.js'], outfile: 'dist/content.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome110', metafile: true, plugins });
await build({ entryPoints: ['src/popup.js'], outfile: 'dist/popup.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome110' });
await build({ entryPoints: ['src/local-score.js'], outfile: 'artifacts/score-test.js', bundle: true, format: 'iife', globalName: 'PatinaScore', platform: 'browser', target: 'chrome110', plugins });
for (const file of ['popup.html', 'popup.css', 'content.css']) copyFileSync(`src/${file}`, `dist/${file}`);
copyFileSync('manifest.json', 'dist/manifest.json'); copyFileSync(resolve(core, 'LICENSE'), 'dist/PATINA-LICENSE');
const hashes = Object.fromEntries(Object.keys(content.metafile.inputs).filter((path) => !path.startsWith('patina:')).map((path) => {
  const absolute = resolve(path), withinCore = relative(core, absolute);
  return [withinCore.startsWith('..') ? `extension/${path}` : `core/${withinCore}`, createHash('sha256').update(readFileSync(absolute)).digest('hex')];
}));
for (const language of ['en', 'ko']) hashes[`core/lexicon/ai-${language}.md`] = createHash('sha256').update(readFileSync(resolve(core, `lexicon/ai-${language}.md`))).digest('hex');
const commit = execFileSync('git', ['-C', core, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
hashes['extension/scripts/build.mjs'] = createHash('sha256').update(readFileSync('scripts/build.mjs')).digest('hex');
const runtimeFiles = ['content.js', 'popup.js', 'popup.html', 'popup.css', 'content.css', 'manifest.json', 'PATINA-LICENSE', 'lexicon-en.json', 'lexicon-ko.json'];
const runtimeHashes = Object.fromEntries(runtimeFiles.map((file) => [file, createHash('sha256').update(readFileSync(`dist/${file}`)).digest('hex')]));
writeFileSync('dist/build-info.json', JSON.stringify({ coreVersion: pkg.version, coreCommit: commit, inputHashes: hashes, runtimeHashes, lexiconsBundled: ['en', 'ko'] }, null, 2));
console.log(JSON.stringify({ coreVersion: pkg.version, coreCommit: commit, files: Object.keys(hashes).length }));
