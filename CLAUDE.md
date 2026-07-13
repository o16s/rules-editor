# rules-editor — repo guide

Framework-free editor for octaview Edge Hub `rules.xml`, plus the
parse/serialize/validate core. Vanilla TypeScript, **zero runtime dependencies**,
self-injecting scoped styles. Consumed by the octaview website and edge-hub.

## Layout
- `src/` — source of truth.
  - `gui.ts` — the `initRulesEditor` component **and** the re-exports of the core
    (this is the public surface).
  - `model.ts` — types + constants. `serialize.ts` — model → xml.
    `parse.ts` — xml → model + `validate`.
  - `index.ts` — barrel (`export * from './gui.js'`), the package entry.
  - `*.test.ts` — vitest specs (jsdom).
- `dist/` — built ESM + `.d.ts`, **committed** so git-tag installs need no build.

## Workflow
- After editing `src/`, run `npm run build` and **commit the updated `dist/`**.
- `npm test` (vitest + jsdom) · `npm run typecheck`.
- Keep the API in `gui.ts`; `index.ts` just re-exports it. One import for
  consumers: `initRulesEditor`, `parse`, `serialize`, `validate`, model types.

## Conventions
- **No runtime dependencies** — keep it that way.
- `parse()` uses the browser `DOMParser` global (tests run under jsdom); it is
  not usable in bare Node.
- Styles inject once as `#octaview-rules-editor-styles`, scoped under `.re-root`,
  themeable via host CSS custom properties (`--accent`, `--ink`, `--font-body`, …)
  with fallbacks. Class names are `re-*`.
- The `rules.xml` schema must stay in sync with the octaview docs:
  https://octaview.ai/en/docs/edge-hub/rules

## Release
1. Bump `version` in `package.json`.
2. `npm run build` (updates `dist/`).
3. Commit, `git tag -a vX.Y.Z -m vX.Y.Z`, `git push --follow-tags`.
4. Consumers install the release tarball (CI-safe, HTTPS, no SSH):
   `npm install "https://github.com/o16s/rules-editor/archive/refs/tags/vX.Y.Z.tar.gz"`
   (The `github:o16s/rules-editor#vX.Y.Z` shorthand also works, but resolves to
   git+ssh and fails in CI without an SSH key.)
