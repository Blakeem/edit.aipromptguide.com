# AI Prompt Guide Editor

A text editor for writing and storing AI prompts. Click any word to see its meanings, pronunciation, synonyms, and related words in a side panel.

The editor runs at [edit.aipromptguide.com](https://edit.aipromptguide.com).

## Features

- Documents are kept in the browser with localStorage. There is no account or server storage.
- Tabs hold several documents at once.
- Inflected words resolve to their base form, so clicking "mice" shows "mouse".
- Light and dark themes.

## Requirements

- Node 22.13 or newer
- pnpm 11

## Quick start

```bash
pnpm install
pnpm db:fetch
cp .env.example .env
pnpm dev
```

`pnpm db:fetch` downloads the Open English WordNet database and extracts it to `data/wordnet.sqlite`. The file is 150 MB and is not committed. The script skips the download when that file already exists, so pass `--force` to replace it.

`DATABASE_URL` in `.env` holds the database path.

## Word API

The editor reads word data from one endpoint.

```
GET /api/word?word=fox
```

The response carries the resolved word, its cased spelling, GB and US pronunciations, and its senses. Each sense holds a part of speech, a domain, a definition, examples, usage notes, synonyms, and grouped relations such as hypernyms and antonyms.

A word is resolved by exact match first. Then WordNet's irregular form table is tried. Then suffix rules are tried, so "dogs" finds "dog".

## Commands

| Command         | Purpose                             |
| --------------- | ----------------------------------- |
| `pnpm dev`      | Development server                  |
| `pnpm build`    | Production build                    |
| `pnpm preview`  | Serve the production build          |
| `pnpm check`    | Type diagnostics                    |
| `pnpm test`     | Unit tests                          |
| `pnpm lint`     | Prettier and ESLint                 |
| `pnpm format`   | Rewrite files to the Prettier style |
| `pnpm db:fetch` | Download the WordNet database       |

Tests that read the database skip themselves when it is absent.

## Technology

SvelteKit with adapter-node, and better-sqlite3 for the word database.

## License

The code is MIT licensed. See [LICENSE](LICENSE).

Word data comes from [Open English WordNet](https://github.com/x-englishwordnet/sqlite) 2026, licensed CC BY 4.0. The database is downloaded during setup and is not part of this repository.
