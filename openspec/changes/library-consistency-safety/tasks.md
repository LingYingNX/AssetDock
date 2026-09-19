## 1. Source Identity And Storage Scope

- [x] 1.1 Add one main-process helper for canonical indexed paths and legacy indexed-path normalization, then verify focused tests prove two same-named source directories retain separate `source_index_id` records and source-relative paths.
- [x] 1.2 Make store lookups, upserts, missing-state changes, and reconciliation selectors include `library_id` and canonical source identity; verify a global-fallback test with two libraries containing the same relative path changes only the intended record.
- [x] 1.3 Create or migrate writable library-local storage before a newly created library starts watching or scanning, and reject index registration when that storage cannot be created; verify a new library can add, list, and resolve an index in the same session while the failed-storage path returns an error rather than an unusable success.

## 2. Scan And Watch Consistency

- [x] 2.1 Route root and index watchers through the database returned by `scopeFor`, including add, change, unlink, restore, thumbnail backfill, and notification callbacks; verify watcher tests mutate the selected library database without changing the global or another fallback library database.
- [x] 2.2 Update root/index scans and startup reconciliation to generate canonical index paths and filter their known/on-disk comparison by the current library and source; verify an old display-name-prefixed row normalizes idempotently and rescan rebuilds both sources after a same-name collision.

## 3. Folder And Batch Operation Consistency

- [x] 3.1 Extend the folder-rename persistence update to rewrite root-owned `rel_path` descendants and indexed `folder_path` descendants in one transaction, then compensate the filesystem rename if the database update fails; verify a temporary library rename keeps a real asset previewable and keeps indexed source files and canonical paths unchanged.
- [x] 3.2 Refresh the active library before showing an `assets:move` partial-failure error when the IPC result reports `moved > 0`; verify a mixed batch result displays completed assets at their actual location and leaves failed assets at their original location.

## 4. Media Protocol Isolation

- [x] 4.1 Change media request construction and source resolution to carry `source_index_id` rather than infer a source from its display name; verify previews from two same-named index directories read their own original files.
- [x] 4.2 Replace prefix-only media authorization with realpath plus `path.relative` containment against only the requesting library root or selected index root; verify sibling-prefix, traversal, and symlink/Junction escape requests are denied while an in-root file streams with existing range behavior.

## 5. Verification

- [x] 5.1 Run the focused Vitest suites with Electron's Node ABI, then the full Vitest suite, `npm run typecheck`, and `npm run build`; verify every command exits successfully and record any environment-only limitation separately.
- [x] 5.2 In a running Electron build, verify a migrated library root change, non-empty folder rename, partial batch move failure, and rejected `media://` neighbor path. (Index-related items — immediate new-library indexing and two same-named index roots — were dropped with the 2026-09-10 removal of the external-index concept.)
      - Verified 2026-09-19 in a disposable temp library (registered via the dev debug bridge, deregistered + deleted afterwards): root file addition appeared in the library-local DB within 500 ms and streamed via `media://`; non-empty `sub` -> `sub-renamed` rename kept record, disk and preview consistent; batch move `[existing, missing]` moved the first, refused the missing one (`缺失文件不能移动`) and left no duplicate records; `media://` returned 200 for in-root files and 403 for `..%2F` traversal, a Junction escape whose real path lands outside the root, and a string-prefix neighbor directory.
- [x] 5.3 Validate the change after implementation and resolve every mismatch before reporting the change ready for user review. (`openspec verify` does not exist in openspec 1.11.0; the equivalent gates were run: `openspec validate library-consistency-safety --strict` -> valid, `openspec validate --all --strict` -> 18 passed / 0 failed, `openspec doctor` -> ok.)
