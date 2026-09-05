# Patina Local Writing Signals

A Manifest V3 extension that displays a local hot-paragraph percentage beside
Gmail compose bodies. English and Korean lexicons and the shared Patina analyzer
are bundled at build time. Scoring makes no provider or network requests.

The popup scores a selection and offers an explicit CLI handoff. It does not
embed a model or rewrite a draft automatically. Only language and threshold
settings are saved; draft text is never put in extension storage. Inputs above
50,000 characters require a shorter selection.

The score matches Patina's canonical prose hot ratio (`scripts/prose-score.mjs`),
using the same public lexicon and options. The current CLI `--score` path also
uses an LLM and is a different metric. Short samples are marked; markup evidence
is shown separately. These are editing signals, not authorship probabilities.

## Build and install

Use Node.js 22 or newer and a reviewed Patina checkout containing
`src/prose-core.js` and `src/features/analyzer.js`:

```sh
git clone https://github.com/devswha/patina ../patina-core
git -C ../patina-core checkout 8a66e31901266c5ad5f3de509f7fbc771829edf7
npm ci --prefix ../patina-core
npm ci
PATINA_CORE_ROOT=../patina-core npm run build
PATINA_CORE_ROOT=../patina-core npm test
```

Open `chrome://extensions`, enable Developer mode, and load the generated `dist`
directory as an unpacked extension. Reload Gmail, open a compose body, then use
the badge or extension popup. No Patina CLI is needed for scoring. The optional
handoff requires an installed CLI and its separately configured backend.

`dist/build-info.json` records the core commit and hashes of bundled code and
lexicon inputs. The build adds no local/private model files or credentials.

## Verification status

Unit tests compare the bundled score with Node across the public EN/KO corpus.
`scripts/browser-smoke.py` uses Playwright and an empty Chrome for Testing profile
with intercepted fixture data. It exercises actual extension loading, draft
badges, typing, popup selection/handoff, editor lifecycle, no form submission,
settings-only storage and no scoring HTTP requests. No production Gmail account
is contacted by this test. Live signed-in Gmail verification remains pending.

```sh
PATINA_TEST_BROWSER=/path/to/chrome-for-testing xvfb-run -a python scripts/browser-smoke.py
```

The current MVP covers Gmail only; Notion and LinkedIn are future work. The source
and bundled Patina code are MIT licensed. There is no Web Store publication yet.
