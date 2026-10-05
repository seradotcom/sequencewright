# Sequencewright verification record

Verification is SHA-bound. A workflow or local command is not carried forward to a different executable source revision unless explicitly described as historical context.

## Semwright dependency

The currently pinned Semwright source is:

```text
4d291de26724810017ce7b6d185326514cb79fa6
Semwright 0.9.0-dev.1
```

On 2026-10-05 the project re-fetched `origin/main` from `seradotcom/semwright`; it still resolved to that exact revision. Sequencewright's `SOURCE_LOCK.json`, Rust dependencies and vendored TypeScript Native SDK source all refer to that revision.

## Historical green checkpoint before binary media/audio delivery

Sequencewright commit `fedf856` completed the four then-existing CI lanes successfully:

| Workflow | Run | Scope |
| --- | ---: | --- |
| Studio behavior and visual evidence | 37283475554 | Unit/application checks, real browser cases and visual evidence. |
| Native SDK and canonical compiler | 37283475651 | Native driver/compiler build and canonical Film realization. |
| Real UI and Native SDK Host | 37283475613 | Canonical daemon/CLI/Driver Host shared-state integration and recovery. |
| Native production pixels | 37283475417 | Three native Motion Canvas sequences and digest-bound MLT FFV1 mezzanines. |

Those runs remain historical evidence only.

## Detected bridge-budget regression

Commit `e3c48300f82410c961cc0a844c55adcf799fd15f` introduced the local binary media endpoint and the first verified WAV → MLT AV-mux path.

Before push, the changed source passed `npm run check`, Python syntax validation and **65 application tests with 0 failures**. CI nevertheless caught an integration boundary missed by those light tests: adding the local upload transaction directly to `src/store.mjs` expanded the Native SDK JavaScript process bundle to **50,774 bytes**, exceeding the existing **49,152-byte (48 KiB)** bridge contract.

| Workflow | Run | Result on `e3c4830` |
| --- | ---: | --- |
| Studio behavior and visual evidence | 37331486081 | SUCCESS |
| Native SDK and canonical compiler | 37331486112 | FAILURE — native bridge bundle budget |
| Real UI and Native SDK Host | 37331486394 | FAILURE — same bridge budget |
| Native production pixels | 37331486132 | FAILURE — same bridge budget before production |

The fix did **not** raise the Native SDK limit. Binary media ingestion was moved to `src/local-assets.mjs`, which is imported only by the loopback editor service and is intentionally outside the native process bridge. The canonical app store remains small enough for the tested SDK profile.

## Current fully green media/audio checkpoint

Commit `f3f37b2f12209d8e2df58686f5217fff01037e78` is the first checkpoint with binary local media ingestion and the verified final AV delivery route green together.

Local bounded checks on the exact source:

```text
npm run check
npm run build:native
npm test
python3 -m py_compile tests/host/render_e2e.py scripts/provision-native.py scripts/package.py
```

The Native bridge bundle is back below the contract ceiling at approximately **47.6 KiB**. Application tests report **65 passed, 0 failed**.

Exact-SHA remote evidence:

| Workflow | Run | Result |
| --- | ---: | --- |
| Studio behavior and visual evidence | 37332348667 | SUCCESS |
| Native SDK and canonical compiler | 37332348906 | SUCCESS |
| Real UI and Native SDK Host | 37332348592 | SUCCESS |
| Native production pixels | 37332348628 | SUCCESS |

The production lane uses three actual Sequencewright project fixtures. The product fixture generates a deterministic synthetic 48 kHz stereo PCM WAV on the disposable runner, imports it through the loopback binary endpoint, confirms that the canonical Native SDK driver observes the resulting application revision, renders Motion Canvas through Semwright, encodes the digest-bound FFV1 mezzanine through `driver.mlt-video.frames.encode`, and calls `driver.mlt-video.av.mux`. The final H.264/AAC MP4 and the WAV decoded back from that same master are checked against canonical returned byte counts and SHA-256 digests. Lesson and brand fixtures keep exercising the visual-only route. The synthetic CI audio is a verification fixture and is not distributed as product media.

## What these checks do not establish

A successful production lane does not by itself establish canonical Graph admission, independent Effect Conformance, human creative approval, transcript synchronization, multi-track mixing, Blender/Manim support, signed installers or commercial release readiness. These remain explicit limitations in [STATUS.md](STATUS.md).
