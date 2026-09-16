# IB Question Filter - web

Authenticated web frontend for the private IB Question Filter question bank. The static frontend is
safe to publish on GitHub Pages; question metadata and PDF objects are fetched only after Supabase
Auth has established an allowlisted session.

## Runtime boundary

The production bundle contains UI code, the PDF renderer, and public Supabase configuration only. It
contains no question catalog, question paper, markscheme, source book, service-role key, or secret
key. The private catalog and PDFs remain in the private Supabase Storage bucket and are not reachable
from the public login page.

`VITE_LOCAL_CORPUS=1` is accepted only by a Vite development server running with
`--mode local-corpus`. The local route is never enabled by a production build.

## Features

- Username/password login and sign-out, with no public sign-up control.
- Chemistry, Physics, and Mathematics AA questions, with HL/SL level filters.
- Examination year, session, level, paper, and topic filters.
- **Only selected topics** subset mode: every topic on a question must be selected.
- **Require every selected topic** mode: a question must carry every selected topic.
- Question-only preview of the selected question slices; there is no whole-paper route.
- Selected-question PDF export and a selected-answer markscheme PDF export.
- Year-aware canonical/shared-question display and responsive desktop/mobile layout.

## Supabase public configuration

The client needs these build-time variables:

| Variable | Required | Meaning |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | The project's `https://<ref>.supabase.co` URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | The publishable browser key, formerly called the anon key. |
| `VITE_CORPUS_PREFIX` | Yes | The opaque Storage prefix produced by the private corpus build. |
| `VITE_CORPUS_BUCKET` | No | Storage bucket name; defaults to `corpus`. |
| `VITE_USERNAME_DOMAIN` | No | Reserved Auth domain used to map a username; defaults to `users.ibquestionbank.invalid`. |

The URL, publishable key, bucket, prefix, and username domain are public configuration values. Never
put a `service_role` JWT, an `sb_secret_` key, a password, or any other secret in a `VITE_*` value.
GitHub Actions should store these values as repository **Variables** with the names above. The
workflow does not set `VITE_LOCAL_CORPUS`.

The username field accepts either the provisioned username or a full email address. Provisioning is
an administrator-side Supabase Auth operation; this frontend does not create users or reveal whether
an account exists.

## Development

```bash
npm ci
npm test
npm run build
npm run verify:bundle
```

For a full local-corpus run, first generate the ignored manifest and objects from the repository root,
then start the development-only route:

```bash
python3 Scripts/build_web_corpus.py --prefix c1-example-prefix --output .web-corpus
cd web
npm run dev:local
```

The local browser check uses the same ignored `.web-corpus/upload-manifest.json`, confirms that all
687 objects are available locally, and exercises preview, both PDF exports, filters, both topic
modes, a rotated markscheme page, and the mobile layout. It also serves `dist/` at the GitHub Pages
base path to verify the unauthenticated login shell:

```bash
npm run check:browser
```

`check:browser` needs a Chromium binary. Set `CHROMIUM_PATH=/path/to/chrome` when Playwright cannot
find one. It never signs in and does not create users.

## Deployment

`.github/workflows/deploy.yml` builds from the `web/` package on pushes to `main`. Before enabling
the workflow, set the required Supabase values above as GitHub Actions repository Variables. The
workflow runs typecheck, unit tests, the production build, and the bundle privacy verifier before
publishing `dist/` with the official GitHub Pages actions.

GitHub Pages is only the static UI host and is not the protection boundary. Supabase Auth, allowlisted
RLS, and the private Storage bucket protect the corpus. The Vite `base` is `/ib-questionfilter-web/`;
update `repoName` in `vite.config.ts` if the Pages repository name changes.

Expected URL: `https://yard1m.github.io/ib-questionfilter-web/`
