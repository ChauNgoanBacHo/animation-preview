# Architecture Overview

## High-level

This app is a small Electron desktop tool for previewing Spine animation folders.

It is organized into 4 runtime layers:

1. `main process` in `src/main.js`
2. `preload bridge` in `src/preload.js`
3. `renderer app` in `src/renderer.js`
4. `Spine rendering adapter` in `src/spineStage.js`

At runtime, the renderer asks the main process to scan folders and uses a custom protocol to fetch local Spine assets safely.

## Runtime Diagram

```text
Electron Main (src/main.js)
  - window lifecycle
  - filesystem scanning
  - custom protocol: spine-asset://
  - IPC handlers
            ^
            |
Preload Bridge (src/preload.js)
  - exposes window.spinePreview.*
            ^
            |
Renderer App (src/renderer.js)
  - app state
  - UI rendering
  - event delegation
  - playback orchestration
            |
            v
SpineStage (src/spineStage.js)
  - Pixi Application
  - pixi-spine integration
  - fit / zoom / pan
  - animation controls
```

## File Responsibilities

### `src/main.js`

Main process responsibilities:

- Creates the main `BrowserWindow`
- Registers IPC handlers for folder selection and scanning
- Registers IPC handlers for Spine package export
- Recursively scans Spine JSON, atlas, texture, and sound files
- Validates Spine candidates before returning them to the renderer
- Registers the `spine-asset://` custom protocol so renderer-side code can `fetch()` local files

Important functions:

- `createWindow()`
- `scanSpineFolder(sourceDir)`
- `scanSoundFolder(sourceDir)`
- `buildExportAtlas(...)`
- `buildExportJson(...)`
- `saveBatchSpineExportFiles(outputDir, files)`
- `registerIpcHandlers()`
- `installSpineAssetProtocol()`

### `src/preload.js`

Security boundary between Electron and the renderer.

It exposes a very small surface:

- `selectFolder()`
- `scanFolder(folderPath)`
- `selectSoundFolder()`
- `scanSoundFolder(folderPath)`
- `selectExportFolder()`
- `saveBatchSpineExport(payload)`

### `src/renderer.js`

This is the main frontend app and currently the largest module in the repo.

It owns:

- global app state
- preview state
- export state
- DOM rendering via template strings
- event delegation
- preview lifecycle
- playback controls
- animation sequence logic
- sound matching and playback
- theme and background settings

Core areas:

- state definition
- folder scan and sound scan handlers
- export workspace handlers
- Spine preview loading
- ticker-driven playback UI updates
- controls for animation, skin, seek, zoom, sequence, and sound
- fullscreen preview modal

### `src/spineStage.js`

Thin rendering adapter around `pixi.js` + `pixi-spine`.

Responsibilities:

- create the Pixi application
- load Spine data and atlas assets
- fit content into the viewport
- handle zoom and pan
- pause/resume ticker
- control playback and sequences

This is the cleanest reusable rendering abstraction in the app.

## Main Data Flow

### 1. Scan animation folder

1. User selects an animation folder in the renderer
2. Renderer calls `window.spinePreview.scanFolder(path)`
3. Preload forwards the call through IPC
4. Main process runs `scanSpineFolder()`
5. Main returns validated Spine file metadata
6. Renderer stores results in `state.files`

Returned metadata includes:

- `jsonPath`
- `atlasPath`
- `pngPaths`
- `animations`
- `skins`
- `version`
- `slots`
- `atlasPages`
- `estDrawcall`

### 2. Load current preview

1. Renderer picks the current file
2. `loadCurrentSpine()` destroys any previous preview
3. Renderer creates a new `SpineStage`
4. `SpineStage.loadSpine()` fetches assets via `spine-asset://`
5. Main process serves file bytes through the custom protocol
6. `pixi-spine` builds the runtime skeleton
7. Renderer selects an initial skin and animation
8. Stage fits the skeleton to the viewport
9. Pixi ticker drives playback updates

### 3. Sound playback

1. Renderer scans a sound folder separately
2. It tries to match sound files by current file name or animation name
3. When playback starts, renderer creates an `Audio` instance from `spine-asset://...`
4. Optional delay is applied from `soundOffsetMs`

### 4. Export Spine package

The export flow is intentionally separate from preview mode.

1. User scans a Spine source folder
2. Renderer stores source metadata in `state.files`
3. `Export Spine` button becomes enabled only when scan returns valid files
4. Clicking `Export Spine` switches `state.uiMode` from `preview` to `export`
5. Export view auto-fills `outputDir` from the scanned source folder path
6. User can override the output directory, choose many files, and set `Spine Pivot X/Y`
7. Renderer renders each selected Spine file offscreen with Pixi
8. Renderer sends a batch payload to `save-batch-spine-export`
9. Main process writes a new Spine package per file:
   - `.png`
   - `.atlas`
   - `.json`
10. Exported package names are suffixed with `_pivot` to avoid overwriting source assets

## Export Spine: Technical Design

### Why export is not "PNG only"

The runtime goal is not just to create a flattened image.

The exported result needs to be scannable by this app again and consumable as a lightweight Spine asset package. Because of that, export now writes:

- a baked texture image
- a minimal atlas file
- a minimal Spine JSON file

This avoids the earlier problem where "PNG anchor" had no meaning to downstream consumers.

### Renderer-side export payload

`src/renderer.js` builds one export item per selected source file. Each item currently includes:

- `pngDataUrl`
- `width`
- `height`
- `pivotX`
- `pivotY`
- `spineVersion`
- `relativeBasePath`

Important implementation notes:

- Export rendering is done offscreen using a temporary `SpineStage`
- The renderer uses the first/default skin and a preferred idle/default animation when available
- The exported base path currently appends `_pivot`
- The final width/height are taken from the extracted canvas, not just the logical local bounds

### Main-process file generation

`src/main.js` converts the renderer payload into a Spine package:

- `buildExportAtlas(...)` writes a single-page atlas referencing the generated PNG
- `buildExportJson(...)` writes a minimal Spine 3.7-style JSON skeleton
- `saveBatchSpineExportFiles(...)` writes all three files into the selected output directory

Current generated JSON structure is intentionally minimal:

- `skeleton`
- `bones`
- `slots`
- `skins`
- `animations`

The exported skeleton is a simple holder-based setup:

- `root`
- `holder`
- one slot named `image`
- one region attachment named from the exported base file name

### How pivot baking works

The export UI asks for `Spine Pivot X/Y`, both normalized to `0..1`.

These values are not stored as PNG metadata. Instead, they are baked into the exported Spine JSON by shifting the generated region attachment offset.

At the moment the baking formula is implemented in `buildExportJson(...)`:

- `centerX = width / 2 - pivotX`
- `centerY = pivotY - height / 2`

The intent is:

- export a centered holder-style Spine package
- allow downstream runtimes to use standard center anchoring
- preserve a custom logical pivot through JSON attachment offsets

### UI mode separation

The renderer now has two top-level modes:

- `preview`
- `export`

When `uiMode === 'export'`:

- preview workspace is hidden
- `Animation Preview App` hero section is hidden
- export panel becomes the only main workspace
- user can return via `Back To Preview`

This keeps export tasks from diluting the preview workflow.

### IPC compatibility note

To avoid breakage during hot reload / stale preload sessions, the app currently supports both:

- `save-batch-spine-export`
- `save-batch-png`

This aliasing is only for compatibility and should be treated as transitional behavior.

## Export Spine: Current Constraints

The current exporter is deliberately minimal and has important limits.

### 1. It exports a flattened Spine package, not the original rig

The exported package is:

- one atlas page
- one region
- one slot
- one holder skeleton

So it is suitable for pivot-aware packaging, but not for reconstructing the original rig, bones, meshes, or animations.

### 2. It is version-shaped around Spine 3.7-style JSON

Current source assets in this project are primarily Spine `3.7.x`, so generated JSON is aligned to that ecosystem.

### 3. Output should go to a separate folder

Exporting into the same source folder is risky because:

- source assets may be overwritten
- scan results can mix original and generated files
- troubleshooting becomes harder

Although the exporter now appends `_pivot`, a separate output folder is still recommended.

### 4. Cocos Creator compatibility is not solved yet

The current package is designed to be scannable by this preview app again.

That does **not** guarantee that Cocos Creator or a custom runtime pipeline will accept it exactly as-is. If downstream tooling expects a different atlas/json convention, export logic will need another pass.

This is the next technical validation area.

## Why the custom protocol exists

The app uses `spine-asset://` to avoid directly exposing arbitrary file URLs in the renderer.

Benefits:

- renderer can use `fetch()` naturally
- asset loading works with Pixi and browser APIs
- Windows drive-letter paths are normalized in one place
- content-type headers are set centrally

## State Model

`src/renderer.js` keeps one large `state` object with two layers:

- app-level state
  - folders
  - scanned files
  - UI theme/background
  - search and status
- preview-level state
  - current `stage`
  - current Spine instance
  - playback and timing
  - zoom
  - sequence mode
  - sound mode
  - fullscreen modal state

This is simple and workable for a small app, but it also makes `renderer.js` a monolith.

## Current Architectural Strengths

- Clear Electron boundary: main, preload, renderer are separated correctly
- Good use of `contextIsolation`
- Custom protocol keeps local asset loading centralized
- `SpineStage` isolates Pixi and Spine-specific rendering logic
- Preview loading guards against races with `previewRequestId`
- Expanded preview reuses the same stage instead of duplicating rendering work

## Current Architectural Weak Spots

### `src/renderer.js` is doing too much

It mixes:

- state store
- action handlers
- DOM templating
- event binding
- business logic

This makes future changes riskier and harder to test.

### Synchronous filesystem work in the main process

The scan helpers use `readdirSync()` and `readFileSync()`.

For small internal folders this is acceptable, but large folders could temporarily block the Electron main process and make the window feel unresponsive.

### Shared utility duplication

`toAssetUrl()` exists in both:

- `src/renderer.js`
- `src/spineStage.js`

This should become one shared helper.

### No test or lint safety net

`package.json` currently has no real lint/test pipeline, so refactors rely mostly on manual verification.

## Suggested Refactor Direction

The safest next step is to split `src/renderer.js` without changing behavior.

Suggested target structure:

```text
src/
  renderer/
    state.js
    actions/
      files.js
      preview.js
      playback.js
      sound.js
      sequence.js
    view/
      layout.js
      previewPanel.js
      expandedPreview.js
    events.js
  shared/
    assetUrl.js
```

Refactor order:

1. Extract `toAssetUrl()` to `src/shared/assetUrl.js`
2. Extract state and pure helpers from `renderer.js`
3. Extract preview lifecycle and playback actions
4. Extract markup builders
5. Extract event wiring

This order minimizes breakage because rendering behavior can stay the same while responsibilities become clearer.

## Quick Mental Model

If you need to change something, use this rule of thumb:

- Need folder scanning or filesystem logic: edit `src/main.js`
- Need Electron-to-UI API: edit `src/preload.js`
- Need button behavior or screen state: edit `src/renderer.js`
- Need Spine camera, zoom, fit, or playback primitives: edit `src/spineStage.js`
