# Sequencewright

An application-owned audiovisual authoring studio in the Semwright family. Build a sequence, edit its composition and timing, compare an alternative, and preserve the decision as an immutable revision.

**Development alpha under active implementation, not a finished production release.** SQLite transaction authority is recovered and under test; UI, driver and native compiler integration are still being completed. Native rendering, canonical Graph/Effects and full production acceptance must be verified independently; browser previews are explicitly design approximations. An empty or unconnected renderer is never shown as a successful export.

## Run the editor

Install Node **24.21.0** (the pinned native TypeScript profile), then run:

```sh
npm start
```

Open `http://127.0.0.1:4318`. No npm installation is necessary to run the editor: it has no third-party runtime dependencies beyond the vendored official Semwright binding. The first run creates three original editable studies and a local SQLite database under `.data`. Use `SEQUENCEWRIGHT_DATA` to choose a different **application-owned** data directory. Do not expose this local-authoring server to a network or reverse proxy.

`npm test` runs bounded application tests. Heavy browser, Rust and native integration work belongs in the repository's GitHub Actions workflows, not on a storage-constrained workstation. Install pinned development tools with `npm ci --ignore-scripts` only when needed.

## The workspace

The studio includes a narrative brief, scene board, selectable SVG design canvas, numeric object inspector, frame-based timeline, typed keyframes, captions, structured manual proposals, A/B previews, exact-revision branches and conflict-aware merges, anchored comments, immutable history, small asset imports with provenance, and editable project/Film/subtitle exports. Dark/light themes, keyboard playback, a command palette and collapsible responsive panels share one interface.

A proposal does not alter the current composition until accepted. Edits and agent calls use the same application-owned CAS transaction; a stale base cannot silently overwrite the current revision. Exact request keys are durable, and historical retries return historical receipts without replaying effects.

## Semwright is a real dependency

The TypeScript binding is copied unchanged from the canonical source and transpiled for the dependency-free local runtime. The Rust adapter depends directly on `semwright-native-sdk` with the `process-bridge` feature. The compiler calls `semwright_motion_authoring::realize` on canonical `Film` values; Sequencewright does not replace the domain compiler, solver, Broker, Host, Policy, Graph or Effects authority.

Pinned upstream revision: `4d291de26724810017ce7b6d185326514cb79fa6`.

```sh
npm ci --ignore-scripts
npm run build:native
export SEQUENCEWRIGHT_NATIVE_BUNDLE_SHA256="$(cat dist/bundle.sha256)"
cargo build --manifest-path native/Cargo.toml --bins
node scripts/fixtures.mjs
native/target/debug/sequencewright-compile < dist/fixtures/product.film.json
```

Build native tools in CI unless your workstation has an appropriate storage budget. A driver binary alone does not establish a running Semwright Host or renderer. See `docs/NATIVE_SDK.md` and `docs/STATUS.md` for the exact supported boundary.

## Data and trust

No telemetry, cloud uploads, AI API keys, subscriptions, shell/source execution fields or automatic publishing. The initial studies are original synthetic material, not supplied customer footage or a generated voiceover. History is append-only; archiving objects does not delete their evidence. SQLite is the application's source of truth; browser storage holds only UI preferences.

Keep copies of your data before using an alpha. Large-media streaming and native production are not yet part of the editor's verified acceptance scope. The app reports these limitations in-context.

## License

Sequencewright is **AGPL-3.0-only**. Official vendored Semwright binding code retains its MIT OR Apache-2.0 licenses. Impeccable is installed at project scope and retains its own upstream terms. No upstream license is replaced by the application's license. See `THIRD_PARTY_NOTICES.md`.
