# Index cache for external source folders

**Status:** approved design, awaiting written-spec review  
**Scope:** index-mode libraries only

## Goal

Treat `E:\素材` (and later user-selected external folders) as read-only index sources. The active library owns only derived thumbnails and metadata. Its cache mirrors each source folder's relative hierarchy so the library is portable without copying, moving, or writing to source media.

## Decisions

- SQLite in `<library>/.mediahub/library.db` remains the only authoritative store for assets, tags, notes, links, ratings, favorites, review flags, palettes, source registrations, and folder classifications.
- JSON files are one-way materialized sidecars from SQLite. They are readable and portable copies, never an input that overwrites SQLite.
- Existing `source_index_id` and canonical `@index:<id>/<relative-path>` keys remain the durable identity of indexed assets. Display names remain presentation-only.
- Index sources use real-time native filesystem events. Windows polling is disabled. Events are debounced and the source is reconciled once at startup to catch offline changes.
- This change applies only to index-mode libraries. A future cut-mode library is out of scope: images may open directly there, while video and 3D preview requirements will be designed separately.

## Cache layout

```text
<library>/.mediahub/
  library.db
  thumbs/                                      # existing library-owned media cache
  index-cache/
    source-12/                                 # stable source_index_id
      scenery/forest/leaf.png.webp              # derived thumbnail
      scenery/forest/leaf.png.json              # SQLite sidecar
```

The cache preserves all source-relative directories below a `source-<id>` namespace. Keeping the original extension in the derived names avoids collisions such as `leaf.jpg` and `leaf.png`. The source root path is deliberately absent from sidecar files, so a copied library does not expose machine-specific absolute paths.

## Sidecar format

Each `<source-file-name>.json` is atomically written and contains only cache-safe, inspectable data:

```json
{
  "schemaVersion": 1,
  "source": {
    "indexId": 12,
    "relativePath": "scenery/forest/leaf.png",
    "fingerprint": "a1b2c3d4e5f60718293a",
    "sizeBytes": 0,
    "mtimeMs": 0
  },
  "asset": {
    "name": "leaf",
    "tags": [{ "name": "nature", "color": "#3ECF8E" }],
    "note": "",
    "sourceUrl": null,
    "rating": 0,
    "favorite": false,
    "reviewFlag": false,
    "folderPath": null,
    "palette": []
  },
  "derived": {
    "type": "image",
    "format": "PNG",
    "width": 0,
    "height": 0,
    "duration": null
  },
  "writtenAt": "2026-09-05T00:00:00.000Z"
}
```

The JSON schema version permits future additive changes. It does not include the absolute source location or raw media bytes.

## Synchronization flow

1. Adding `E:\素材` through the existing index entry registers one `index_sources` row, scans only that source, then writes its asset rows and derived cache files.
2. Metadata edits (`assets:update`, tag add/remove, and indexed-folder classification) commit to SQLite first, reload the complete asset with tags, then atomically rewrite that asset's JSON sidecar.
3. Source add or content change updates scanned metadata including the cache fingerprint and regenerates that asset's hierarchical WebP and JSON. The thumbnail path is passed through the existing `thumb://` protocol so indexed media reads its hierarchical cache rather than duplicating the same WebP in `thumbs/`.
4. Source file moves and renames are detected as a short-lived unlink/add pair from the same `source_index_id` with the same fingerprint. The original asset row and its user metadata are retained; `rel_path` is changed to the new canonical key and the sidecar pair is moved to the corresponding cache path.
5. Directory moves resolve through the same file-level rename pairing. Empty source directories do not create index records or empty cache directories.
6. An unlink waits 1500 ms for a matching add event. If none appears, it is a deletion: delete the indexed asset row, its WebP and JSON sidecars, then prune empty directories below that source's cache root. Source files are never deleted.
7. The source root itself remains a fixed registration at `E:\素材`. Moving that root outside its registered path is an index disconnection and requires user rebinding; the application must not search arbitrary disks for it.

## Real-time resource boundary

The watcher will use native Windows filesystem events instead of the current one-second polling loop. Idle CPU usage should be negligible; resource use is mainly one operating-system watch registration per watched directory, so memory and handle use scale with directory count. A 300 ms event debounce and 1500 ms rename-pair grace period prevent bursts from editors or directory moves from producing repeated scans. The normal event path handles only affected files or subtrees; it never launches a full-source rescan. One startup reconciliation is retained for changes made while the app was closed.

## Consistency and failures

- Cache writes use a temporary file plus atomic rename, so a reader sees either the prior complete file or the next complete file.
- SQLite success is not rolled back when a derived cache write fails. The UI receives an error, and the next source event, explicit scan, or thumbnail request retries the sidecar materialization from SQLite.
- Cache cleanup is constrained to `<library>/.mediahub/index-cache/source-<id>` after source-relative path validation. It never performs a recursive deletion on a computed path outside that root.
- A source content change must update its stored fingerprint even when its size is unchanged. The fingerprint input includes the current modification time in addition to the existing sampled content and size, ensuring stale thumbnails cannot remain visible while ordinary renames retain their identity.

## Verification

- Unit/integration coverage: cache paths and JSON fields; metadata edit sidecar rewrite; file content change; file rename; directory move; actual delete cleanup; source-root disconnect; failed atomic write retry; and the no-polling watcher option.
- Electron-ABI Vitest coverage: add `E:\素材`-style external source fixtures, browse indexed previews through `thumb://`, edit tags/notes/links, restart, and verify SQLite/JSON parity.
- Manual Electron verification: external source remains untouched; active library shows the mirrored cache; moving/deleting source media updates the browser and derived files in real time; idle monitoring shows no polling loop.

## Non-goals

- No source-media copying, moving, tagging, JSON files, thumbnails, or hidden metadata directories.
- No automatic discovery when the entire `E:\素材` root moves elsewhere.
- No cut-mode library behavior, direct image opening, or new video/3D preview rules.
