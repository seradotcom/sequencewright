# Sequencewright status

Sequencewright is a public **development alpha**, not a finished consumer release. This file separates working application behavior from planned Semwright integrations so that a visible control or source module is never mistaken for verified native capability.

## Implemented application surface

- Local-first browser studio on loopback with a scene canvas, frame-based sequence timeline, storyboard, brief/narrative workspaces, contextual inspector, keyboard playback, dark/light themes and responsive layouts.
- Application-owned SQLite state with opaque generation/revision identities, compare-and-swap writes, exact request recovery, immutable revision history, branches, explicit three-way merge decisions, locks, anchored review comments and scoped proposals.
- Project archives, Film JSON projection and SRT/WebVTT export.
- Local binary media ingestion up to 16 MiB per asset. The binary path is session/CSRF protected, computes the digest server-side, commits media and revision metadata in one SQLite transaction, and does not enlarge the Native SDK JSON frame.
- Actual Semwright Native SDK application driver and TypeScript bridge against pinned Semwright `4d291de26724810017ce7b6d185326514cb79fa6` / `0.9.0-dev.1`.
- Real shared-state Host acceptance: edits made through the canonical Driver Host are visible in the UI and UI edits are visible through the isolated driver.
- Explicit operator production tooling for Motion Canvas native render, canonical native verification and MLT FFV1 mezzanine encoding.
- An explicit audio delivery profile: one attached whole-sequence **48 kHz stereo uncompressed PCM WAV** can be duration-checked against the project timebase and digest-bound into `driver.mlt-video.av.mux`. The returned H.264/AAC MP4 and the WAV decoded back from that exact master are hashed and checked against the canonical receipts.
- Deterministic source-only packaging is implemented by `scripts/package.py`; the dedicated Source package workflow verifies the archive and per-file manifest before uploading it as a CI artifact.

## Important production boundaries

The interactive Deliver workspace does **not** launch native production yet. Native rendering is an explicit owner/operator CLI against an already provisioned Semwright Broker/Driver Host. The application HTTP service does not become a renderer, scheduler, Broker or policy authority.

The verified audio profile is intentionally narrow. It does not yet provide recording, transcript-to-waveform alignment, trim handles on audio, independent voice/music/SFX buses, ducking, fades, loudness normalization, multitrack mixing or arbitrary source conversion. MP3/video imports remain reference media until a specific native route admits them.

The Motion Canvas visual route rejects placed image/video media instead of silently omitting it. It currently renders application-authored text and geometric composition, then hands the immutable native frame manifest to the canonical MLT driver.

## Not yet claimed

- Canonical Graph admission.
- Independent Effect Conformance reports for Sequencewright authoring operations.
- Blender contribution round-trip.
- Manim Community contribution round-trip.
- Voice recording, word/phoneme alignment or approved transcript synchronization.
- Full multi-track audio editing, loudness metering/normalization and mix automation.
- Provider-backed AI generation or automatic agent execution from the UI.
- Multi-user/remote collaboration, Platform workers or cloud subscriptions.
- Signed desktop installers, automatic native runtime installation, Windows/macOS Host certification.
- Interactive production controls that can safely start/cancel/recover native jobs from the editor.
- Commercial release readiness.

## Evidence policy

A green workflow proves only its exact Git commit and the scope exercised by that workflow. Older PASS results are historical evidence, not a pass for newer code. Current exact-SHA checkpoints and run identifiers are recorded in [VERIFY.md](VERIFY.md).

No source file, user project or database should be deleted as a recovery mechanism. Generated CI runners are disposable; the local application preserves revisions and uses new output/evidence directories rather than overwriting existing artifacts.
