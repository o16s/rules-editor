# rules-editor: repo guide

Framework-free editor for octaview Edge Hub `rules.xml`, plus the
parse/serialize/validate core and the formula language. Vanilla TypeScript,
**zero runtime dependencies**, self-injecting scoped styles. Consumed by the
octaview website and edge-hub.

## Layout
- `src/`: source of truth.
  - `gui.ts`: the `initRulesEditor` component **and** the re-exports of the core
    (this is the public surface). It owns the options and handle types, the
    shared state, validation marking and the render cycle, and wires the parts.
  - `gui/`: the parts of the editor, each a factory that takes its
    dependencies: `rail.ts` (the rule list), `sheets.ts` (Variables, When and
    Then for the selected rule), `cells.ts` (text and formula cells with commit
    semantics), `bar.ts` (cell selection and the formula bar of the phone
    layout), `menu.ts` (the autocomplete menu), `xml-panel.ts` (view, copy,
    download, import), `styles.ts` (the scoped stylesheet), `state.ts` (the
    shared state object and small types), `dom.ts` (element builder, icons,
    choice controls), `labels.ts` (options and help text), `then-rows.ts` (the
    Then sheet's row model and preview), `example.ts` (the default file),
    `simulator.ts` (the Simulator page of design 14a: signals per tag, the
    condition › variable › tag timeline, the log).
  - `simulate.ts`: the simulator core: signal generators, and `simulate()`,
    which builds one request for the engine and words the log from what the
    engine answers. It evaluates no formula of its own.
  - `engine.ts`: loads `dist/rules-engine.wasm`, the gateway's Go engine
    compiled for the browser, and calls it (`loadEngine`, `runEngine`,
    `engineAssets`). One implementation of the language, not two (ADR-024).
  - `model.ts`: types and constants. `formula.ts`: the formula language,
    tokenizer, parser, printer, static checks, function registry.
    `serialize.ts`: model → xml. `parse.ts`: xml → model plus `validate`.
  - `index.ts`: barrel (`export * from './gui.js'`), the package entry.
  - `*.test.ts`: vitest specs (jsdom).
- `dist/`: built ESM and `.d.ts`, **committed** so git-tag installs need no build.
- `stories/` and `.storybook/`: Storybook (dev only, never shipped: outside
  `tsconfig` `rootDir`, so it cannot leak into `dist/`). Stories import
  `../src/*.ts` directly, so a save in `src/` hot-reloads without a build.

## Workflow
- After editing `src/`, run `npm run build` and **commit the updated `dist/`**.
- After editing `rules-engine/`, run `npm run build:engine` and **commit the
  updated `dist/rules-engine.wasm`**. It needs a Go toolchain; a consumer of
  the package does not, because the file is committed.
- `npm test` (vitest + jsdom) · `npm run typecheck`.
- `npm run storybook`: dev server on `0.0.0.0:6100`, for working on the
  component (widths, themes, error states). `npm run build-storybook` for a
  static bundle in `storybook-static/` (gitignored).
- Keep the API in `gui.ts` (`gui/` is internal). `index.ts` only re-exports it,
  so a consumer has one import: `initRulesEditor`, `parse`, `serialize`,
  `validate`, the formula functions, the model types.

## Conventions
- **No runtime dependencies**. Keep it that way.
- `parse()` uses the browser `DOMParser` global (tests run under jsdom); it is
  not usable in bare Node.
- Styles inject once as `#octaview-rules-editor-styles`, scoped under `.re-root`,
  themeable via host CSS custom properties (`--accent`, `--ink`, `--font-body`, …)
  with fallbacks. Class names are `re-*`.
- **Words on screen.** One word per meaning, in the operator's language, not
  the file's. What a rule raises is an **incident**, never an "alarm". A
  message says "the cooldown is not a time", not "not a Go duration", and
  names no XML element the sheets do not show. A cell drops the `Rule "x":`
  prefix, so a message must read as a sentence without it.
- The condition form the editor writes is `<cond expr="…"/>`. The 0.2 form
  `<cond tag op value/>` and nested `<and>`/`<or>` groups are read-only input:
  `parse()` turns them into formula rows, and `serialize()` never writes them.
- A new formula function is one entry in `schema/formula-functions.json`, with
  its help text and a small example, plus the Go implementation in
  `rules-engine/formula/`. Both suites read the registry, so the editor and the
  gateway describe a function the same way. The gateway must implement it
  before the editor offers it.
- `schema/rules.xsd` and `src/xsd.test.ts` must stay in lockstep with
  `parse()`/`validate()`: every new rule gets a fixture in `VALID`, `INVALID`,
  `APP_LEVEL`, or `XSD_STRICTER`.
- The `rules.xml` schema must stay in sync with the octaview docs:
  https://octaview.ai/en/docs/edge-hub/rules

## Release
1. Bump `version` in `package.json` and `xs:schema version` in
   `schema/rules.xsd`. They must match: `src/xsd.test.ts` checks it.
2. `npm run build`, and `npm run build:engine` if `rules-engine/` changed.
3. Commit, `git tag -a vX.Y.Z -m vX.Y.Z`, `git push --follow-tags`. Tag
   `rules-engine/vX.Y.Z` with the same version, so one commit carries one
   version of the language.
4. Consumers install the release tarball (CI-safe, HTTPS, no SSH):
   `npm install "https://github.com/o16s/rules-editor/archive/refs/tags/vX.Y.Z.tar.gz"`
   (The `github:o16s/rules-editor#vX.Y.Z` shorthand also works, but resolves to
   git+ssh and fails in CI without an SSH key.)
