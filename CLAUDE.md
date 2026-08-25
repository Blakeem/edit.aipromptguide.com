### AI Prompt Guide Editor

A SvelteKit text editor for writing AI prompts, deployed at `edit.aipromptguide.com`. Clicking a word shows its definitions, pronunciations, synonyms, and relations in a side panel.

### Layout

- `src/routes/+page.svelte` — the single page, holding the tab bar, editor, and collapsible word panel
- `src/lib/stores.ts` — tabs, theme, panel state, and selection, persisted to localStorage
- `src/lib/word-lookup.ts` — the only caller of `/api/word`, race guarded by a module-scope request id
- `src/lib/components/` — TabBar, TextEditor, WordDetails, ThemeToggle, AutoSaveStatus
- `src/lib/server/wordnet.ts` — every SQL statement plus word-form resolution
- `src/routes/api/word/+server.ts` — thin wrapper over `lookupWord`
- `scripts/fetch-wordnet-db.mjs` — database fetcher, plain Node with no dependencies

### Word data

The prebuilt Open English WordNet 2026 SQLite database (github.com/x-englishwordnet/sqlite).

- `pnpm db:fetch` installs it to `data/wordnet.sqlite`, gitignored, 150 MB. `DATABASE_URL` in `.env` points at it.
- There is NO local import pipeline. To upgrade editions, change `SOURCE_URL` in `scripts/fetch-wordnet-db.mjs`.
- `wordnet.ts` opens one readonly better-sqlite3 connection lazily on the first lookup, so a missing database surfaces in the API route's 500 `details` instead of crashing at import.
- Schema gotchas: `senses` has no pos column, so join `synsets`. `sensenum` is per-lexfile and non-unique per (word, pos), so order with the tagcount tiebreaker. `domains.domain` is the short label ('animal') and `domainname` the long one ('noun.animal').

### Checks

`pnpm test` runs vitest over `src/**/*.test.ts`. Tests that read the database self-skip when it is absent, and `wordnet.test.ts` imports the module dynamically to keep that skip clean.

`pnpm lint` runs Prettier then ESLint. Both must stay green.

- `no-useless-assignment` is off in `eslint.config.js`. It fires on variables declared at function start with a default, which is this project's convention, and on Svelte reactive statements whose assignment is read on the next run.
- Three inline suppressions exist, each with its reason above it. Two are in `TextEditor.svelte` for `svelte/infinite-reactive-loop`, which cannot see the `lastPlacedTabId` guard. One is in `WordDetails.svelte` for `svelte/prefer-svelte-reactivity` over a local `Set` inside a pure function.

### Known debt

`selectedWordData.data` in `stores.ts` is typed `any`. It carries three runtime shapes, a WordNet hit, a miss, or a fetch failure, and `WordDetails.svelte` narrows them across `{#if}` blocks in its template. Typing it as a union requires moving that narrowing into the component script first.

The components are written in Svelte 4 idiom (`$:` statements, `<slot />`) running on Svelte 5. Converting to runes is a separate pass.

### Packaging

pnpm 11 gates native build scripts behind the `allowBuilds` map in `pnpm-workspace.yaml`. Do not remove it, or better-sqlite3 loses its binding.

`svelte.config.js` must use `@sveltejs/adapter-node`. `adapter-auto` produces no `build/index.js` for a plain Node host.

### Deploying

Never transfer `node_modules`. Two independent reasons, either of which alone yields a 500.

1. `better-sqlite3/build/Release/better_sqlite3.node` is a per-platform native addon. It has to be built on the machine that runs it.
2. pnpm's `node_modules` is symlink based and does not survive copying. Both WinSCP and `scp -r` dereference symlinks, and better-sqlite3's `bindings` dependency exists only inside `.pnpm/`, so the copy fails with `Cannot find module 'bindings'`. This breaks Linux to Linux copies too.

The same holds for `.svelte-kit/` and `build/`, which are regenerated on the server, and for `data/wordnet.sqlite`, which is fetched there.

`pnpm deploy:pack` runs `git archive` over HEAD into `deploy.tar.gz`, so it carries exactly the tracked files. Untracked paths cannot leak in, and `.gitattributes` forces LF inside the archive. Install, test, and build on the server.

### Local-only paths

`docs/`, `.serena/`, `.claude/settings.local.json`, and `*.local.md` are gitignored. `docs/` holds a vendored SvelteKit, Svelte 5, and Vite doc set for offline reference. `DEPLOYMENT.local.md` holds the host-specific deploy runbook, which stays out of the public repo.
