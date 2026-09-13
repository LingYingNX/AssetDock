# External Index Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a read-only external source such as `E:\素材` maintain a hierarchical WebP and JSON index cache inside its active library, synchronized through native filesystem events.

**Architecture:** Keep `<library>/.mediahub/library.db` as the authoritative transactional store. Add an index-only cache at `.mediahub/index-cache/source-<source_index_id>/`, use sidecar JSON as SQLite materialization, and retain canonical `@index:<id>/<source-relative-path>` database keys. Extend the existing scanner, watcher, thumbnail service, `thumb://` protocol, and IPC mutation handlers rather than adding a second index pipeline.

**Tech Stack:** Electron 33, TypeScript, `better-sqlite3`, Node `fs/promises`, `chokidar`, `sharp`, `ffmpeg-static`, Vitest running under Electron Node ABI, OpenSpec.

---

## File map

- Create: `src/main/services/cacheFiles.ts` — atomic write, file move, and bounded empty-directory pruning shared by thumbnails and index sidecars.
- Create: `src/main/services/indexCache.ts` — validates source-relative paths, computes index-cache paths, serializes an indexed `AssetRow` to JSON, and performs cache-pair operations.
- Create: `tests/indexCache.test.ts` — physical cache layout, JSON serialization, path escape rejection, cache move, and cleanup tests.
- Modify: `src/main/services/fingerprint.ts` — include source modification time in the cache identity.
- Modify: `src/main/services/thumbs.ts` — support an explicit cache target and forced regeneration while retaining root-library cache behavior.
- Modify: `src/main/services/store.ts` — return scan upsert outcomes, refresh scanned identity fields, and preserve metadata while relocating one missing indexed record.
- Modify: `src/main/services/watch.ts` — use native Windows events, pair indexed rename events in both orders, and defer true indexed deletes for 1500 ms.
- Modify: `src/main/services/libraryDb.ts` — expose the library's index-cache directory alongside its database and root-thumbnail directories.
- Modify: `src/main/services/libResolve.ts` — resolve the exact thumbnail path for indexed assets instead of always returning the flat thumbnail directory.
- Modify: `src/main/services/thumbsLookup.ts` — lazily materialize a thumbnail to the resolved file path.
- Modify: `src/main/index.ts` — read the resolved thumbnail file in `thumb://` protocol handling.
- Modify: `src/main/ipc.ts` — materialize indexed cache pairs after scans and edits, move/delete pairs for source structure changes, and wire callbacks from the watcher.
- Modify: `tests/libraryConsistency.test.ts` — scan-update and missing-record relocation contracts.
- Modify: `tests/watch.test.ts` — native watcher options plus indexed rename and true-delete contracts.
- Create: `openspec/changes/external-index-cache/{proposal.md,design.md,tasks.md}` and `openspec/changes/external-index-cache/specs/{library-index,thumbnails,library-portable}/spec.md` — ownership specifications for this behavior.

## Task 1: Add the owning OpenSpec change

**Files:**
- Create: `openspec/changes/external-index-cache/proposal.md`
- Create: `openspec/changes/external-index-cache/design.md`
- Create: `openspec/changes/external-index-cache/tasks.md`
- Create: `openspec/changes/external-index-cache/specs/library-index/spec.md`
- Create: `openspec/changes/external-index-cache/specs/thumbnails/spec.md`
- Create: `openspec/changes/external-index-cache/specs/library-portable/spec.md`

- [ ] **Step 1: State the constrained source ownership in the proposal**

Document these non-negotiable outcomes: `E:\素材` is only read; SQLite is the source of truth; sidecar JSON is one-way materialization; deleted source files remove only library-owned derivatives; cut-mode libraries are explicitly outside this change.

- [ ] **Step 2: Specify data and synchronization ownership in the design**

Define the concrete layout below and require canonical source IDs rather than display-name-derived paths.

```text
<library>/.mediahub/index-cache/source-<id>/<source-relative-file>.webp
<library>/.mediahub/index-cache/source-<id>/<source-relative-file>.json
```

Specify native watcher events, a 300 ms debounce, a 1500 ms unlink/add pairing window, a single startup reconciliation, and source-root relocation as an explicit rebind condition.

- [ ] **Step 3: Add delta scenarios to their actual owning specs**

`library-index` owns read-only source synchronization, rename retention, and deletion behavior. `thumbnails` owns indexed WebP resolution and regeneration. `library-portable` owns the additional `.mediahub/index-cache/` portable-library directory. Do not duplicate sidebar or cut-mode requirements.

- [ ] **Step 4: Create a checklist in `tasks.md` that mirrors Tasks 2-7 below**

Use unchecked items for cache files, scan/store semantics, watcher behavior, protocol/IPC integration, focused tests, and full verification.

- [ ] **Step 5: Validate the change structure**

Run: `openspec validate external-index-cache --type change --strict`

Expected: exit code `0`.

## Task 2: Build cache-path and sidecar primitives first

**Files:**
- Create: `src/main/services/cacheFiles.ts`
- Create: `src/main/services/indexCache.ts`
- Create: `tests/indexCache.test.ts`
- Modify: `src/main/services/libraryDb.ts`
- Modify: `src/main/services/thumbs.ts`

- [ ] **Step 1: Write failing cache-layout tests**

```ts
it('writes a sidecar next to an indexed thumbnail without escaping its source root', async () => {
  const paths = indexCachePaths(root, 12, 'scenery/forest/leaf.png')
  expect(paths.thumbnail).toBe(join(root, '.mediahub', 'index-cache', 'source-12', 'scenery', 'forest', 'leaf.png.webp'))
  expect(paths.sidecar).toBe(join(root, '.mediahub', 'index-cache', 'source-12', 'scenery', 'forest', 'leaf.png.json'))
  await writeIndexSidecar(paths.sidecar, fixtureAsset())
  expect(JSON.parse(await readFile(paths.sidecar, 'utf8'))).toMatchObject({
    schemaVersion: 1,
    source: { indexId: 12, relativePath: 'scenery/forest/leaf.png' },
    asset: { tags: [{ name: 'nature', color: '#3ECF8E' }] }
  })
  expect(() => indexCachePaths(root, 12, '../outside.png')).toThrow('invalid source-relative path')
})

it('moves and removes only the two derived files for one indexed source asset', async () => {
  const from = indexCachePaths(root, 12, 'old/leaf.png')
  const to = indexCachePaths(root, 12, 'new/leaf.png')
  await writeFile(from.thumbnail, 'thumb')
  await writeIndexSidecar(from.sidecar, fixtureAsset())
  await moveIndexCachePair(from, to)
  await removeIndexCachePair(to)
  await expect(access(to.thumbnail)).rejects.toThrow()
  await expect(access(to.sidecar)).rejects.toThrow()
})
```

- [ ] **Step 2: Run the focused tests and observe the missing-module failure**

Run:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& .\node_modules\electron\dist\electron.exe .\node_modules\vitest\vitest.mjs run tests/indexCache.test.ts --pool=threads
```

Expected: failure because `indexCache.ts` has not been created.

- [ ] **Step 3: Implement bounded cache filesystem operations**

Create `cacheFiles.ts` with a random temporary sibling and atomic rename. `removeFileAndPrune` must stop at the supplied root and must use non-recursive `rmdir` calls only.

```ts
export async function writeFileAtomically(target: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temp, contents)
    await rename(temp, target)
  } finally {
    await rm(temp, { force: true })
  }
}
```

Create `indexCache.ts` with `indexCachePaths`, `writeIndexSidecar`, `moveIndexCachePair`, and `removeIndexCachePair`. Normalize source-relative paths to forward slashes, reject empty, absolute, and `..` segments, and verify the final paths with `isPathWithinRoot` before any write, move, or delete.

Add `libIndexCacheDir(libPath)` in `libraryDb.ts`. Extend `ThumbRequest` with `targetPath?: string` and `force?: boolean`; `ensureThumb` must use `targetPath` when supplied, skip the existing-file return only when `force` is true, and write its output using `writeFileAtomically`.

- [ ] **Step 4: Re-run the focused cache tests**

Run the Step 2 command.

Expected: `tests/indexCache.test.ts` passes, including atomic JSON writes and bounded cleanup.

## Task 3: Make scan results update identity and retain metadata across indexed moves

**Files:**
- Modify: `src/main/services/fingerprint.ts`
- Modify: `src/main/services/scan.ts`
- Modify: `src/main/services/store.ts`
- Modify: `tests/libraryConsistency.test.ts`

- [ ] **Step 1: Write failing store contracts**

```ts
it('updates a changed indexed file while preserving editable metadata', () => {
  const db = openMemoryLibDb()
  db.prepare('INSERT INTO index_sources(id, path, name) VALUES (1, ?, ?)').run('C:/source', 'source')
  const [first] = upsertScanned(db, 1, [entry('a.jpg', 'first', 1)], 1)
  updateAsset(db, first.assetId, { note: 'keep me', source_url: 'https://example.test/ref' })
  const [changed] = upsertScanned(db, 1, [entry('a.jpg', 'second', 2)], 1)
  expect(changed.action).toBe('changed')
  expect(assetById(db, 1, first.assetId)).toMatchObject({ fingerprint: 'second', mtime_ms: 2, note: 'keep me' })
})

it('relocates one missing indexed record with its tags and note', () => {
  const db = openMemoryLibDb()
  db.prepare('INSERT INTO index_sources(id, path, name) VALUES (1, ?, ?)').run('C:/source', 'source')
  const [old] = upsertScanned(db, 1, [entry('old/a.jpg', 'same', 1)], 1)
  addTag(db, old.assetId, 'nature')
  updateAsset(db, old.assetId, { note: 'move with file' })
  setAssetMissing(db, 1, canonicalIndexRelPath(1, 'old/a.jpg'), true)
  const [moved] = upsertScanned(db, 1, [entry('new/a.jpg', 'same', 1)], 1)
  expect(moved).toMatchObject({ assetId: old.assetId, action: 'relocated', previousRelPath: canonicalIndexRelPath(1, 'old/a.jpg') })
  expect(assetById(db, 1, old.assetId)).toMatchObject({ rel_path: canonicalIndexRelPath(1, 'new/a.jpg'), missing: 0, note: 'move with file', tags: [{ name: 'nature', color: expect.any(String) }] })
})
```

- [ ] **Step 2: Run the focused consistency test and observe the old behavior**

Run:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& .\node_modules\electron\dist\electron.exe .\node_modules\vitest\vitest.mjs run tests/libraryConsistency.test.ts --pool=threads
```

Expected: failure because current `upsertScanned` returns no outcome, keeps its prior fingerprint on an existing row, and inserts a new record for a missing indexed move.

- [ ] **Step 3: Implement scan-upsert outcomes and missing-record relocation**

Change `fingerprint(absPath, size, mtimeMs)` to hash the first 64 KiB, size, and exact `mtimeMs`; pass the stat modification time from `scan.ts` and `watch.ts`. A rename normally retains its modification time, while a content change gets a new cache identity even if the leading 64 KiB and total size are unchanged.

Make `upsertScanned` return one result per entry:

```ts
export interface ScanUpsertResult {
  assetId: number
  action: 'added' | 'changed' | 'unchanged' | 'relocated'
  relPath: string
  previousRelPath?: string
}
```

For an existing path, update `name`, media type, format, scan metadata, `fingerprint`, and `missing`, leaving user-editable columns and tag relations untouched. For an absent indexed path, select missing candidates by `(library_id, source_index_id, fingerprint)`; relocate only when exactly one candidate exists, otherwise insert a distinct record. Add `assetById(db, libraryId, assetId)` returning the complete asset row and its tags for sidecar serialization.

Add `mergeIndexedRename(db, libraryId, sourceIndexId, oldSourceRel, newSourceRel)`. In one SQLite transaction it finds the original and transient rows, deletes the transient row, changes the original row to the new canonical path, clears `missing`, and returns the original asset ID. It returns `null` unless both rows belong to the same source and have the same fingerprint.

- [ ] **Step 4: Re-run focused scan/store tests**

Run the Step 2 command.

Expected: all `libraryConsistency` tests pass and prove changed content refresh plus lossless missing-record relocation.

## Task 4: Resolve index thumbnails to their hierarchical cache paths

**Files:**
- Modify: `src/main/services/libResolve.ts`
- Modify: `src/main/services/thumbsLookup.ts`
- Modify: `src/main/index.ts`
- Modify: `tests/libraryConsistency.test.ts`

- [ ] **Step 1: Write a failing resolved-thumbnail-path assertion**

```ts
it('returns an indexed cache path for an indexed fingerprint', () => {
  const hit = findByFingerprint('indexed-fingerprint', fallbackThumbs, registryDb)
  expect(hit?.thumbPath).toBe(join(libraryRoot, '.mediahub', 'index-cache', 'source-7', 'scenery', 'leaf.png.webp'))
})
```

- [ ] **Step 2: Run the focused test and observe the flat-cache result**

Run the Step 2 command from Task 3.

Expected: failure because `findByFingerprint` exposes `thumbsDir`, which always points to the flat cache.

- [ ] **Step 3: Resolve and serve the exact target file**

Make `findByFingerprint` return `thumbPath` for every hit. Root-library and fallback records use `thumbPathIn(libThumbsDir, fingerprint)`; indexed records derive `sourceRelativePath` then call `indexCachePaths(lib.path, source_index_id, sourceRel).thumbnail`.

Update `ensureThumbByFingerprint` to call `ensureThumb({ targetPath: hit.thumbPath })`. In `index.ts`, replace the directory-based existence and read calls with direct `access(hit.thumbPath)` and `readFile(hit.thumbPath)`. Keep the `thumb://<fingerprint>.webp` renderer contract unchanged.

- [ ] **Step 4: Re-run the focused protocol-resolution tests**

Run the Step 2 command from Task 3.

Expected: root fallback remains on its current cache path and indexed hits resolve under `index-cache/source-<id>`.

## Task 5: Make the watcher native, incremental, and rename-safe

**Files:**
- Modify: `src/main/services/watch.ts`
- Modify: `tests/watch.test.ts`
- Modify: `tests/libraryConsistency.test.ts`

- [ ] **Step 1: Add failing watcher tests for the two rename event orders and true deletion**

```ts
it('uses native events instead of Windows polling', () => {
  expect(WATCH_OPTIONS.usePolling).toBe(false)
})

it('keeps indexed metadata when unlink arrives before add', async () => {
  await rename(join(root, 'old.jpg'), join(root, 'new.jpg'))
  await vi.waitFor(() => expect(indexedAssets(db)).toEqual([
    expect.objectContaining({ rel_path: canonicalIndexRelPath(1, 'new.jpg'), note: 'preserved', missing: 0 })
  ]), { timeout: 5000 })
})

it('merges a transient indexed add when its matching unlink arrives afterward', () => {
  const originalId = seedIndexedAsset(db, 'old.jpg', 'same', 'preserved')
  const transientId = seedIndexedAsset(db, 'new.jpg', 'same', '')
  expect(mergeIndexedRename(db, 1, 1, 'old.jpg', 'new.jpg')).toBe(originalId)
  expect(assetById(db, 1, originalId)).toMatchObject({ rel_path: canonicalIndexRelPath(1, 'new.jpg'), note: 'preserved', missing: 0 })
  expect(assetById(db, 1, transientId)).toBeUndefined()
})

it('removes a truly deleted indexed record only after the rename window', async () => {
  await rm(join(root, 'gone.jpg'))
  await vi.waitFor(() => expect(indexedAssets(db)).toHaveLength(0), { timeout: 5000 })
})
```

The transient-add merge is a store-level test because Windows does not guarantee cross-directory rename event ordering. The real watcher rename test covers normal filesystem delivery; the database test proves the alternate order retains the original metadata.

- [ ] **Step 2: Run watcher tests and observe polling plus metadata-loss failures**

Run:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& .\node_modules\electron\dist\electron.exe .\node_modules\vitest\vitest.mjs run tests/watch.test.ts tests/libraryConsistency.test.ts --pool=threads
```

Expected: the polling assertion fails, and the rename/deletion contracts are unavailable or fail against the current generic unlink handling.

- [ ] **Step 3: Implement indexed event pairing without changing root-library semantics**

Export immutable `WATCH_OPTIONS` with `usePolling: false`, retain `ignoreInitial`, ignored-path pruning, and `awaitWriteFinish`. Use a watcher-local `recentAdds` map keyed by source ID and fingerprint, and clear all timers/maps when the watcher closes.

For indexed `add`, call `upsertScanned`, remember the returned entry for 1500 ms, and surface its action. When an existing missing row was relocated, surface both relative paths. For indexed `unlink`, first check for one fresh matching add; when found, call `mergeIndexedRename` so the transient row is removed and the original ID, tags, note, link, rating, flags, palette, and `folder_path` survive at the new canonical path. When no pair exists, set only that indexed row to `missing = 1` and invoke a delayed callback after 1500 ms. The delayed callback must first re-read the row and delete only if it is still missing at the old canonical path.

Add these index-only callbacks to `WatchOptions`:

```ts
onIndexedRelocated?: (assetId: number, previousSourceRel: string, sourceRel: string) => void
onIndexedDeleted?: (assetId: number, sourceRel: string) => Promise<void>
```

Existing library-root events continue using their current missing/recovery behavior and do not use the indexed deletion callback.

- [ ] **Step 4: Re-run watcher tests**

Run the Step 2 command.

Expected: all watcher tests pass; idle watcher configuration contains no polling interval, and both event orders retain indexed metadata.

## Task 6: Connect scans, metadata edits, sidecars, and cleanup in IPC

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `tests/indexCache.test.ts`
- Modify: `tests/watch.test.ts`

- [ ] **Step 1: Add failing IPC-level cache synchronization tests**

```ts
it('rewrites indexed JSON after a tag, note, and source-link edit', async () => {
  await invoke('assets:update', libraryId, assetId, { note: 'reference', source_url: 'https://example.test/ref' })
  await invoke('assets:addTag', libraryId, assetId, 'nature')
  expect(JSON.parse(await readFile(sidecarPath, 'utf8'))).toMatchObject({
    asset: { note: 'reference', sourceUrl: 'https://example.test/ref', tags: [{ name: 'nature' }] }
  })
})

it('removes an indexed sidecar pair when the source watcher confirms deletion', async () => {
  await confirmedIndexedDelete(assetId, 'scenery/gone.png')
  await expect(access(thumbPath)).rejects.toThrow()
  await expect(access(sidecarPath)).rejects.toThrow()
  expect(assetById(db, libraryId, assetId)).toBeUndefined()
})
```

- [ ] **Step 2: Run focused tests and observe the missing synchronization**

Run:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& .\node_modules\electron\dist\electron.exe .\node_modules\vitest\vitest.mjs run tests/indexCache.test.ts tests/watch.test.ts --pool=threads
```

Expected: failure because the current IPC handlers update only SQLite and the current index watcher does not materialize or remove hierarchical cache files.

- [ ] **Step 3: Add one indexed-derivative coordinator inside `ipc.ts`**

Implement `syncIndexedDerivative(libraryId, assetId, forceThumbnail)` adjacent to existing `ensureThumbAndPalette`:

```ts
async function syncIndexedDerivative(libraryId: number, assetId: number, forceThumbnail: boolean): Promise<void> {
  const scope = scopeFor(libraryId)
  if (!scope) return
  const asset = assetById(scope.db, libraryId, assetId)
  if (!asset || asset.source_index_id == null || asset.missing) return
  const sourceRel = sourceRelativePath(asset.rel_path, asset.source_index_id)
  if (sourceRel == null) return
  const paths = indexCachePaths(scope.libPath, asset.source_index_id, sourceRel)
  const thumb = await ensureThumb({
    fingerprint: asset.fingerprint,
    absPath: absPathFor(scope, asset.rel_path, asset.source_index_id),
    type: asset.type,
    format: asset.format,
    targetPath: paths.thumbnail,
    force: forceThumbnail
  })
  if (asset.type === 'image' && !thumb.placeholder) await updatePaletteThenReload(scope.db, libraryId, asset.id, thumb.path)
  const current = assetById(scope.db, libraryId, asset.id)
  if (current) await writeIndexSidecar(paths.sidecar, current)
}
```

Refactor the existing root-media path only enough to keep its current flat cache. `scanIndex` uses `ScanUpsertResult` to call this coordinator for added and changed records; unchanged records are only materialized when their files are absent. The index watcher calls it on added/changed entries, moves the pair on `onIndexedRelocated`, and runs `removeIndexCachePair` before deleting the confirmed record on `onIndexedDeleted`.

Turn `assets:update`, `assets:addTag`, `assets:removeTag`, and the indexed branch of `assets:move` into async handlers that await a JSON refresh after their SQLite transaction. Return `{ ok: true, warning }` if derived-file writing fails after a successful database transaction, and broadcast `assets:changed` with that warning. On the next scan, thumbnail request, or edit, retry sidecar materialization from SQLite.

On `index:remove`, close the watcher, remove only `.mediahub/index-cache/source-<id>`, then delete that source's assets and `index_sources` row. In `assets:purgeMissing`, use the same pair cleanup before deleting any legacy missing indexed records.

- [ ] **Step 4: Re-run focused synchronization tests**

Run the Step 2 command.

Expected: sidecars mirror transactional edits, actual source deletion removes the pair and row, and cache write warnings do not roll back committed metadata.

## Task 7: Verify end-to-end behavior and update change state

**Files:**
- Modify: `openspec/changes/external-index-cache/tasks.md`
- Test: `tests/indexCache.test.ts`
- Test: `tests/libraryConsistency.test.ts`
- Test: `tests/watch.test.ts`

- [ ] **Step 1: Run the full Electron-ABI test suite**

Run:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& .\node_modules\electron\dist\electron.exe .\node_modules\vitest\vitest.mjs run --pool=threads
```

Expected: all tests pass. Do not use `npm test`, because the shell Node ABI does not match the installed Electron-native `better-sqlite3` build.

- [ ] **Step 2: Run type and build checks**

Run:

```powershell
npm run typecheck
npm run build
git diff --check
openspec validate external-index-cache --type change --strict
```

Expected: every command exits with code `0`.

- [ ] **Step 3: Perform a manual Electron acceptance pass against a disposable source fixture**

Create a temporary source directory outside the project, add it through the existing “索引目录到当前库” flow, then verify all of the following in the running app:

1. Adding an image creates exactly one mirrored `.webp` and `.json` pair under the active library, while the source directory receives no file.
2. Editing a tag, note, and link refreshes the adjacent JSON without changing source media.
3. Moving an image and moving a containing folder retain its metadata and relocate the cache pair.
4. Editing image content refreshes the visible thumbnail and sidecar fingerprint.
5. Deleting the source image removes the card, SQLite record, WebP, JSON, and empty cache directories after the 1500 ms window.
6. Leaving the app idle does not create a periodic polling workload; the watcher responds when a source file changes.

- [ ] **Step 4: Record actual verification outcomes in the change checklist**

Check only completed tasks. Record any unavailable native-window validation as incomplete rather than treating static tests as UI proof.

- [ ] **Step 5: Do not commit without separate user authorization**

Preserve all pre-existing dirty worktree changes. Report the exact modified files and verification status; wait for explicit authorization before staging or committing any file.
