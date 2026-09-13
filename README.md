# IB Question Filter - web

Public web front end for the IB Question Filter. It reproduces the desktop app's
filtering, deduplication and export behaviour.

**This repository is deliberately sanitized.** It contains no IB question papers,
no markschemes, no answer keys, no source books and no export of the private
catalog. The data shipped here is a small synthetic demonstration corpus written
for this repository, clearly labelled in the UI.

## What it does

- Subject selection for Chemistry, Mathematics and Physics.
- Filters for examination year, session, level, paper and paper type.
- Topic filtering, with two mutually exclusive refinements:
  - **Only selected topics** - the subset rule. A question is shown only when
    *all* of its topics fall inside your selection, so a question that also
    tests something you did not pick is hidden.
  - **Must include every selected topic** - keeps only questions carrying all
    selected topics.
- One canonical question per examination year. Where the same question appears
  twice in a year (typically an HL and an SL paper) exactly one row is
  selectable; the other occurrence is shown only as provenance.
- Question viewing with diagrams, tables, formulas and options.
- Selected-question PDF export.
- A newly generated markscheme containing only the answer slices for the
  selected questions. A whole source markscheme is never reproduced.
- Responsive desktop and mobile layouts, with light and dark themes.

## The deduplication rule

The identity boundary is:

```
subject + examination year + verified question content
```

Including the examination year is what keeps identical content in two different
years as **two** canonical questions, one per year, rather than collapsing them
globally. Level, paper and time zone are used only to distinguish genuinely
different content. Questions that merely share a topic, formula, method,
structure or context are not duplicates.

A non-canonical occurrence is never independently selectable and can never be
exported, so a generated PDF cannot contain two canonical rows from the same
shared component.

## Data mode

The app ships with `isDemoData: true`. The private corpus is not published here
and is not reachable from this site. Serving real question content would require
a separately hosted authenticated backend with an explicit allowlist; GitHub
Pages is static hosting and must never be used as the protection boundary.

## Development

```bash
npm ci
npm run dev            # local dev server
npm test               # unit tests
npm run build          # production build
npm run verify:bundle  # fail if anything private reached dist/
npm run check:browser  # headless browser checks against the built site
```

`npm run check:browser` needs a Chromium binary. In a sandbox with a preinstalled
build, point it at the binary:

```bash
CHROMIUM_PATH=/path/to/chrome node scripts/browser-check.mjs
```

## Deployment

`.github/workflows/deploy.yml` builds on every push to `main`, runs the
typecheck, unit tests and bundle verification, then publishes `dist/` with the
official GitHub Pages actions.

The Vite `base` is set to `/ib-questionfilter-web/` to match the repository name,
which is what a GitHub Pages project site requires. **If you rename the
repository, update `repoName` in `vite.config.ts`** or every asset will 404.

Repository settings must have **Settings → Pages → Source** set to
**GitHub Actions**.

Expected URL: `https://yard1m.github.io/ib-questionfilter-web/`
