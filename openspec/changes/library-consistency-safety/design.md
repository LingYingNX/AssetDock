## Context

See `proposal.md` for motivation. A library normally owns its assets and index sources in `.mediahub/library.db`, while the global database retains the library registry and can temporarily act as a migration fallback. The current implementation mixes those scopes in root watchers and path-based updates. It also encodes an index source's display name into `assets.rel_path`, despite `source_index_id` already being the durable source identity.

The existing unique key is `(library_id, rel_path)`. Rebuilding the assets table solely to make an index ID part of that key would increase migration risk. The design instead gives indexed rows a canonical internal `rel_path` namespace derived from their immutable source ID, while retaining their source-relative suffix for filesystem resolution.

## Goals / Non-Goals

**Goals:**

- Make scans, reconciliation, watchers, thumbnails, and missing-state updates use the database selected for the active library.
- Make indexed asset identity independent of an index directory's display name and unambiguous when names collide.
- Keep filesystem folder renames, persisted asset paths, indexed-folder assignments, and the rendered list in agreement.
- Restrict `media://` to the requested library's real root or the requested asset's real index root.
- Preserve the current fallback database as a recoverable root-asset mode without silently reporting a broken index registration as successful.

**Non-Goals:**

- No new dependency, user-facing feature, file-copy behavior, or change to the visible index directory name.
- No destructive repair of historic global records or automatic removal of migration residuals.
- No attempt to reconstruct metadata that was already overwritten by the old same-name-index collision; a subsequent source rescan may recreate the missing source record.

## Decisions

### Canonical indexed paths use source IDs, not display names

Indexed assets will store a canonical internal key such as `@index:<sourceId>/<source-relative-path>`. The reserved key is derived from `source_index_id`, which remains stable when the library database is copied or migrated because `migrateLibrary` preserves source IDs. Library-owned assets keep their existing root-relative `rel_path`.

All source-sensitive paths will be produced and decoded by one small shared helper. Scans, reconciliation, watcher events, thumbnail lookup, `media://` URLs, and absolute-path resolution will pass or read `source_index_id`; they will no longer infer a source from the first display-name segment. The renderer will continue to show `index_name` from the index record, while index assets remain grouped by their existing `folder_path` classification rather than exposing the internal key.

At the first library-scope access before a scan or watcher is attached, legacy index rows will be normalized in a transaction: for each row with `source_index_id`, remove that source's legacy display-name prefix when present and persist the canonical key. This avoids a table rebuild and makes later scanning idempotent. If prior same-name scans overwrote one source's row, the next reconciliation creates the absent source row from its external directory.

Alternative considered: add a source-relative path column and rebuild the unique constraint as `(library_id, source_index_id, rel_path)`. That is more expressive, but it requires a data-table migration and changes NULL uniqueness semantics; the canonical key uses the current schema and is sufficient for the supported source model.

### Scope ownership is captured once and applied to every path-based mutation

`scopeFor` remains the single selector for the active database, library root, and index list. Root watcher attachment will obtain that scope and pass its `db` into `watchLibrary`; root callbacks will only notify after the watcher has changed the same database. Scan, thumbnail backfill, reconciliation, and watcher lookup/update statements will include `library_id` and, when relevant, the source identity instead of querying by a bare `rel_path`.

Newly created libraries will attempt to create/migrate their per-library storage before their initial watcher and scan are attached. This makes a newly added index immediately listable, previewable, and watchable in the normal writable case. If the library directory cannot host its database, root assets continue in the global fallback scope, but index registration must return a clear failure instead of returning success with an index that cannot be listed or resolved. Fallback updates always filter by `library_id`.

Alternative considered: extend the global `index_sources` schema with a library mapping and make every fallback index fully persistent. That increases the global migration surface and is unnecessary to meet the portable-library design when the library directory is writable; explicit failure is safer than the current false success when it is not.

### Directory rename synchronizes real and virtual asset locations with recovery

For a manual library-folder rename, validate both the filesystem operation and affected database rows before notifying the renderer. After the filesystem rename succeeds, a single database transaction will:

- rewrite `rel_path` for root-owned assets equal to the old relative directory or below its `old/` boundary;
- rewrite `folder_path` for indexed assets assigned to that library directory, using exact-or-descendant segment boundaries;
- leave indexed assets' canonical `rel_path`, source ID, and external files untouched.

The watcher continues to see the underlying directory events, but its idempotent canonical upserts run after the synchronous database update and cannot recreate the old root path. If the database transaction fails after the filesystem rename, the handler attempts to rename the directory back before returning the failure; it sends `assets:changed` only after the filesystem and database agree. A failed compensating rename is surfaced as an explicit error for manual recovery rather than claiming success.

Alternative considered: update SQLite before renaming on disk. The filesystem operation is asynchronous and cannot participate in the SQLite transaction, so filesystem-first plus bounded compensation leaves less durable database divergence.

### `media://` resolves one declared source and validates a real containment boundary

The renderer will include the asset's `source_index_id` in its internal media request. The protocol resolves that ID only from the requesting library's selected scope; it does not query by index display name and it does not include roots belonging to other libraries. It resolves both the allowed root and requested file with `realpath`, then uses the standard `path.relative` containment test: the target is allowed only when it is the same path or a non-absolute relative descendant that does not begin with `..`.

The file must still exist and be a regular file before streaming. This rejects string-prefix neighbors such as `C:\\Media-backup`, `..` traversal, and symlink/Junction escapes after their real destination is resolved.

Alternative considered: retain normalized `startsWith` comparisons. That is shorter but cannot distinguish a directory boundary and has already caused the adjacent-prefix bug.

### Partial batch results refresh before the error is reported

The existing move IPC result already returns `moved`. The renderer will call `reloadActiveLibrary()` before reporting an error when `moved > 0`; it will not force navigation to the requested folder on that failure path. A complete success retains the current navigation and reload behavior.

Alternative considered: optimistic local mutation for every completed asset. A single authoritative reload is smaller, handles watcher/metadata side effects, and cannot leave mixed indexed and physical moves stale.

## Risks / Trade-offs

- [Legacy duplicate-name collision may already have lost one indexed row] -> Normalize surviving rows by source ID, then let reconciliation re-add records discovered on each external source; do not guess at lost user metadata.
- [Filesystem and SQLite cannot form one atomic transaction] -> Preflight, transact immediately after rename, compensate with the reverse rename on database failure, and never publish a successful refresh while states disagree.
- [A non-writable library cannot support portable index metadata] -> Preserve root fallback behavior but reject index registration clearly, avoiding an invisible unusable index.
- [Realpath may fail for a disappeared file or unavailable root] -> Treat it as denied/not-found, never fall back to a permissive string comparison.
- [Canonical keys are internal data] -> Keep the encoding/decoding helper private to the main-process services and derive all UI labels from index records.

## Migration Plan

1. Add focused store/scope helpers and tests that establish source-aware path identity and `library_id` filtering in both in-memory and per-library database schemas.
2. On opening a library scope, normalize legacy indexed `rel_path` values before watcher attachment, reconciliation, or preview requests; this transaction is repeatable and does not alter root-owned paths, index source definitions, or external files.
3. Create/use library-local storage before a new library's first scan. Preserve the existing global data and thumbnail fallback if migration cannot write to the library directory.
4. Deploy the watcher, reconciliation, folder-rename, renderer refresh, and protocol changes together so all producers and consumers understand canonical index paths.
5. Roll back code by restoring the prior build; canonical index rows remain safely readable only by the new build, so rollback after data has been normalized requires restoring the library database from its pre-upgrade backup or re-running the forward build. The implementation must therefore verify migration behavior in temporary library databases before release.

## Open Questions

None.
