# rules-editor — repo guide

Framework-free editor for octaview Edge Hub `rules.xml`, plus the
parse/serialize/validate core and the formula language. Vanilla TypeScript,
**zero runtime dependencies**, self-injecting scoped styles. Consumed by the
octaview website and edge-hub.

## Layout
- `src/` — source of truth.
  - `gui.ts` — the `initRulesEditor` component **and** the re-exports of the core
    (this is the public surface). It owns the options and handle types, the
    shared state, validation marking and the render cycle, and wires the parts.
  - `gui/` — the parts of the editor, each a factory that takes its
    dependencies: `rail.ts` (the rule list), `sheets.ts` (Variables, When and
    Then for the selected rule), `cells.ts` (text and formula cells with commit
    semantics), `bar.ts` (cell selection and the formula bar of the phone
    layout), `menu.ts` (the autocomplete menu), `xml-panel.ts` (view, copy,
    download, import), `styles.ts` (the scoped stylesheet), `state.ts` (the
    shared state object and small types), `dom.ts` (element builder, icons,
    choice controls), `labels.ts` (options and help text), `then-rows.ts` (the
    Then sheet's row model and preview), `example.ts` (the default file).
  - `model.ts` — types + constants. `formula.ts` — the formula language:
    tokenizer, parser, printer, static checks, function registry.
    `serialize.ts` — model → xml. `parse.ts` — xml → model + `validate`.
  - `index.ts` — barrel (`export * from './gui.js'`), the package entry.
  - `*.test.ts` — vitest specs (jsdom).
- `dist/` — built ESM + `.d.ts`, **committed** so git-tag installs need no build.
- `stories/` + `.storybook/` — Storybook (dev only, never shipped: outside
  `tsconfig` `rootDir`, so it cannot leak into `dist/`). Stories import
  `../src/*.ts` directly, so a save in `src/` hot-reloads without a build.

## Workflow
- After editing `src/`, run `npm run build` and **commit the updated `dist/`**.
- `npm test` (vitest + jsdom) · `npm run typecheck`.
- `npm run storybook` — dev server on `0.0.0.0:6100`, for working on the
  component (widths, themes, error states). `npm run build-storybook` for a
  static bundle in `storybook-static/` (gitignored).
- Keep the API in `gui.ts` (`gui/` is internal); `index.ts` just re-exports it. One import for
  consumers: `initRulesEditor`, `parse`, `serialize`, `validate`, the formula
  functions, model types.

## Conventions
- **No runtime dependencies** — keep it that way.
- `parse()` uses the browser `DOMParser` global (tests run under jsdom); it is
  not usable in bare Node.
- Styles inject once as `#octaview-rules-editor-styles`, scoped under `.re-root`,
  themeable via host CSS custom properties (`--accent`, `--ink`, `--font-body`, …)
  with fallbacks. Class names are `re-*`.
- The condition form the editor writes is `<cond expr="…"/>`. The 0.2 form
  `<cond tag op value/>` and nested `<and>`/`<or>` groups are read-only input:
  `parse()` turns them into formula rows, and `serialize()` never writes them.
- A new formula function is one line in `FUNCTIONS` in `formula.ts`. The
  gateway must implement it before it does anything at runtime.
- `schema/rules.xsd` and `src/xsd.test.ts` must stay in lockstep with
  `parse()`/`validate()`: every new rule gets a fixture in `VALID`, `INVALID`,
  `APP_LEVEL`, or `XSD_STRICTER`.
- The `rules.xml` schema must stay in sync with the octaview docs:
  https://octaview.ai/en/docs/edge-hub/rules

## Release
1. Bump `version` in `package.json` and in `schema/rules.xsd` (`xs:schema version`).
2. `npm run build` (updates `dist/`).
3. Commit, `git tag -a vX.Y.Z -m vX.Y.Z`, `git push --follow-tags`.
4. Consumers install the release tarball (CI-safe, HTTPS, no SSH):
   `npm install "https://github.com/o16s/rules-editor/archive/refs/tags/vX.Y.Z.tar.gz"`
   (The `github:o16s/rules-editor#vX.Y.Z` shorthand also works, but resolves to
   git+ssh and fails in CI without an SSH key.)
