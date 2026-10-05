# Native integration and owner provisioning

## Boundary

The local Node service owns `sequencewright.db`. The browser uses its loopback HTTP interface. The Rust driver uses the canonical Semwright Native SDK's `Application`, `NativeDriver`, `NodeBridge`, `OperationContract` and Host tool boundary to reach that same application database. It does not scrape the browser or reconstruct application state from screenshots.

Source dependencies are pinned to Semwright `4d291de26724810017ce7b6d185326514cb79fa6`, version `0.9.0-dev.1`. The external Rust application is built against public crates, not a local checkout path or copied Core implementation.

| Component | Responsibility |
| --- | --- |
| `src/store.mjs` | Application transactions, source versions, persistent request outcomes, branches, source assets and revision history. |
| `src/native-entry.mjs` | Official TypeScript bridge entrypoint and trusted application context. |
| `native/src/main.rs` | Actual SDK driver registration, observation, recovery and pinned Host-mediated Node process boundary. |
| Semwright Broker / Driver Host | Policy, session/native references, driver provenance, tool grants and process isolation. |
| `native/src/compile.rs` | Canonical `Film` validation and `semwright_motion_authoring::realize`; not pixels, audio or an alternative solver. |

There are 37 application contracts in `contracts/native-operations.json`: 27 mutations and 10 reads. The SDK supplies the native observation/recovery interface separately. Mutation contracts declare application transactions, durable request keys and atomic revision comparison. Historical request recovery explicitly does not grant present authority or permission to replay an effect.

## Build artifacts, not workstation builds

Use the `Native SDK and canonical compiler` workflow artifact from an exact source SHA. Its relevant files are:

```text
dist/sequencewright.cjs
dist/binding.json
native/target/debug/sequencewright-driver
native/target/debug/sequencewright-compile
native/Cargo.lock
verification/native/
```

The driver contains the SHA-256 of its matching JavaScript bundle. A driver from one run must not be paired with a different bundle. The SDK process-bridge profile permits at most 48 KiB for that bundle; the build fails instead of silently expanding that boundary. The artifact is a development build, not a signed consumer installer.

The verified application runtime is Node 24.21.x. The Motion Canvas runtime uses its own distinct Node 22.22.0 profile; that is not permission to substitute runtimes in the application bridge.

## Provision an application driver explicitly

First start and stop the local editor normally so that `.data/sequencewright.db` exists. Select an artifact root and the Node runtime explicitly. Then run:

```sh
python3 scripts/provision-native.py \
  --driver "$ARTIFACT/native/target/debug/sequencewright-driver" \
  --bundle "$ARTIFACT/dist/sequencewright.cjs" \
  --node "$(command -v node)" \
  --data "$PWD/.data" \
  --output "$PWD/.native-owner/profile-1"
```

`--output` must be new. The script checks the source files, the bridge size and ownership of the existing application data directory. It copies the explicitly selected driver, runtime and bundle into that private profile, computes their digests and creates `driver.json`, `owner.toml` and `provisioning.json`.

It does not replace existing owner configuration, delete application data, start services, install runtimes globally, alter kernel sandbox policy or register a renderer. The host must already have a compatible, owner-provisioned Semwright installation. Review the generated configuration before launching a separate daemon with it; do not overwrite a shared Semwright service configuration used by another application.

The resulting native observation command is:

```sh
semwright --socket "$SOCKET" --session-file "$OWNER_SESSION" --json \
  execute driver.sequencewright.observe \
  --args-json '{"resource":"demo-product@main","scope":"document","limit":1}'
```

Use its actual returned native reference, source version and the SDK's exact request-digest helper for later mutations. Do not synthesize a reference from a project path. The executable example in `tests/host/native_e2e.py` exercises that complete path with a real daemon and sandbox helper.

## Native rendering operator tooling

`scripts/native-render.mjs` is separate, explicit operator tooling for an already provisioned Motion Canvas workspace. It is not an HTTP rendering endpoint or a background worker installed by the editor. It requires an owner-created connection file, a matching canonical CLI executable digest and a renderer workspace already registered in the same canonical Broker.

The connection schema is `sequencewright/connection/1`, with absolute `executable`, `socket`, `session` and `outputRoot` paths, `executableSha256`, a single allowed application `resource`, and an optional `maxFrames` budget (at most 18,000). The file and its selected paths must be owner-controlled. Keep connection files out of Git.

```sh
node scripts/native-render.mjs \
  --connection /absolute/private/production.json \
  --data "$PWD/.data" \
  --resource 'demo-product@main' \
  --output /absolute/new/evidence-directory \
  --typography motion-pinned
```

The typography choice is explicit because the current browser/Film design font profile differs from the Motion Canvas backend's supported pinned profile. This output profile uses Instrument Sans Variable and IBM Plex Mono, records that choice and requires creative review. It does not silently edit the source project or package font binaries.

The client calls canonical composition inspect/plan/apply, render start/status/result and native composition verify commands. It does not generate arbitrary user JavaScript, run a private renderer, synthesize a PASS report, or create a second scheduler. The output directory is new; receipts, a native frame manifest and selected PNG samples are retained there. The full native frame sequence remains in the owner-configured renderer output root.

After native verification, the immutable Motion Canvas frame manifest is passed by path **and expected SHA-256** to `driver.mlt-video.frames.encode`. The MLT provider re-reads and hashes every PNG, then creates a lossless FFV1/Matroska mezzanine. Sequencewright checks the returned dimensions, timebase, frame count, stream profile, on-disk byte count and digest.

For an audio delivery, add one explicit attached asset:

```sh
node scripts/native-render.mjs \
  --connection /absolute/private/production.json \
  --data "$PWD/.data" \
  --resource 'demo-product@main' \
  --output /absolute/new/evidence-directory \
  --typography motion-pinned \
  --audio-asset asset-voice-master
```

This production profile is intentionally strict: the project may contain exactly one media asset, it must be an uncompressed PCM WAV at 48 kHz stereo, no scene object may place that asset visually, and its exact sample-frame duration must equal the complete sequence duration at the project rational timebase. The application verifies the RIFF chunks and source digest before staging the bytes under a digest-derived name in the owner-selected production root. The MLT `media` grant must expose that same production root read-only, while the MLT `output` grant exposes it writable; both are explicit owner policy, not hidden cross-driver filesystem access.

The final `driver.mlt-video.av.mux` call is bound to both the visual-mezzanine digest and audio digest. Semwright MLT emits the H.264/AAC MP4, probes the encoded streams and decodes the final master audio back to WAV. Sequencewright then checks both returned artifacts against their canonical size/digest receipts. The source application revision is re-read after production and reported CURRENT or STALE; rendering never silently rebases or rewrites the project.

Projects containing image/video placement or more complex audio remain rejected by this profile rather than being silently flattened. `tests/host/render_e2e.py` is the three-project renderer acceptance lane; its status must be read for the exact source SHA. The product fixture adds deterministic synthetic CI audio only to verify this AV path; lesson and brand continue exercising visual-only production. `src/production.mjs` is the bounded canonical connection used by this operator script and is intentionally not imported by the editor HTTP service.

## Platform and evidence limits

Linux Host integration is verified by the dedicated CI lane. Windows/macOS native Host support, signed packaging, automatic runtime installation, Platform credentials, remote workers and native rendering controls in the interactive editor are not certified by that lane.

Native renderer measurements are not automatically canonical Graph admission, independent Effect Conformance, final encoded-media validation or human creative approval. Each remains separately reported rather than inferred from a successful process or compiler exit.
