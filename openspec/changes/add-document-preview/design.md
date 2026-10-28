# Design

## Context

See `proposal.md` for motivation and the delta specs for observable behavior.

The current format registry in `src/shared/formats.ts` is the single source for scanning, thumbnails, media routing, filters and the lightbox. `AssetKind` currently ends at `image | video | model | style`; the thumbnail prewarm query also hard-codes those four kinds. The renderer cannot read disk directly: source assets go through `media://`, and derived previews already use content-fingerprint caches under `.mediahub/`.

The machine has no detected Microsoft Office, WPS or LibreOffice installation. The application now bundles `@file-viewer/doc` for legacy Word `.doc`; its package is about 333 KB and its parse/render entry has no browser, worker or Office runtime requirement. Phase one covers `TXT / Markdown / CSV / DOCX / XLSX / PPTX`; phase two adds built-in `DOC / XLS / XLSB / RTF / ODT / ODS / ODP` and reserves external conversion for `PPT / WPS / ET / DPS`.

## Goals / Non-Goals

**Goals:**

- Add a durable `document` asset kind without creating a second metadata store.
- Keep document structure: tables stay tables, slides stay pages, headings and lists remain visible.
- Use one format registry and one preview capability model across scan, import, watch, filters, cards, thumbnails and lightbox.
- Keep document rendering read-only and isolated from scripts, macros, network access and arbitrary filesystem access.
- Make expensive parsing cacheable by content fingerprint and renderer version, with bounded memory, time and concurrency.
- Keep the `.doc` parser small enough to ship inside the application and avoid an Office/WPS/LibreOffice installation.

**Non-Goals:**

- Editing or saving documents.
- Pixel-perfect fidelity for every Office feature.
- Running macros, scripts, embedded executables or remote content.
- Bundling Microsoft Office, WPS or LibreOffice.
- Implementing legacy PowerPoint, WPS spreadsheet or WPS presentation parsers ourselves.
- Supporting animated slide transitions or interactive form controls in phase one.

## Decisions

### 1. Model documents as a first-class asset kind with a preview shape

Add `document` to `AssetKind`. Keep one `document` kind rather than separate `text`, `spreadsheet` and `presentation` kinds, because metadata, folders, tags, trash and filters already operate on assets. Add a format-level preview shape: `text`, `markdown`, `sheet`, `doc`, or `slides`.

This avoids widening the database schema with three near-identical kinds and keeps existing asset queries generic. The shape is derived from the canonical format, not stored as a second source of truth.

Alternative rejected: separate asset kinds per document family. It would multiply filter, card, inspector and query branches without changing storage semantics.

### 2. Phase one: native read-only renderers

| Format | Parser / renderer | Fidelity target |
| --- | --- | --- |
| TXT | Native text decode + preformatted read-only view | Encoding and line breaks |
| Markdown | `markdown-it` with HTML disabled or sanitized | Headings, lists, tables, code, local images |
| CSV | RFC 4180 parser | Rows, columns, quoted commas and newlines |
| DOC | `@file-viewer/doc` binary Word parser | Paragraphs, basic character/paragraph styles, tables, embedded images and page breaks |
| DOCX | `docx-preview` | Headings, paragraphs, lists, tables, images, headers, footers, page flow |
| XLSX | `exceljs` for workbook structure + a bounded table renderer | Sheets, merged cells, column widths, number formats, common cell styles |
| PPTX | OOXML package parse into a slide model + static slide renderer | Slide order, text boxes, images, shapes, tables, basic fills and geometry |

For PPTX, prefer an explicit slide model over dumping text. The renderer positions text boxes, images, tables and common shapes using the slide coordinate system. Unsupported effects degrade to a readable placeholder or omit only the effect, never the slide structure.

Alternative rejected for phase one: convert every Office file to PDF. It gives better fidelity but requires an external converter that is not present on this machine and makes the built-in preview path depend on software the user may not have.

Alternative rejected: render PPTX with a closed-source preview bundle. The available package is not suitable as a repository dependency without an explicit licensing decision and does not solve DOCX/XLSX consistently.

### 3. Phase two: built-in DOC and external converter for remaining proprietary formats

Parse legacy Word `.doc` in-process with `@file-viewer/doc`, block external links/resources during rendering, sanitize the resulting CSS/HTML again, and reuse the same `preview.json`, thumbnail and lightbox path as other document formats. This keeps the final application self-contained without embedding the roughly 242 MB LibreOffice WASM runtime.

Add a configurable converter abstraction only for `PPT / WPS / ET / DPS`. Invoke executables with `execFile` argument arrays, never a shell. Convert to PDF in a temporary directory, validate the output is within the library's `.mediahub` preview cache, then reuse the existing PDF page renderer.

Capability levels:

- `built-in`: native read-only renderer is available.
- `external`: requires a configured office converter.
- `inventory-only`: can be stored and described but cannot be previewed.

External conversion is isolated behind a worker/process boundary with timeout, concurrency limit, maximum output size and cancellation. A missing converter is a normal capability result, not a crash.

### 4. Keep `media://` as the only source-file boundary

Document source files continue to be addressed as `media://<libraryId>/<encoded relPath>?v=<fingerprint>`. Parsed images and fonts must be copied or resolved to controlled library-local derived paths; the renderer must not receive arbitrary absolute paths.

The document preview HTML is generated as a self-contained or same-origin `srcDoc` document. It uses a CSP that denies scripts, frames, objects and network access, while allowing only inline styles and controlled image/data resources. If a document renderer needs a real URL, it uses a dedicated derived-preview query parameter on `media://`, validated like existing thumbnail/transcode routes.

### 5. Cache by fingerprint and renderer version

Proposed derived layout:

```text
.mediahub/
  previews/
    documents/
      <fingerprint>/
        preview.json
        page-001.jpg
        page-002.jpg
        converted.pdf
```

`preview.json` records renderer version, format, source fingerprint, page count, sheet count, slide count, failure kind and generated time. A content change creates a new fingerprint directory. A renderer upgrade invalidates old previews without touching source files.

Small text/Markdown/CSV previews may be rendered from a bounded payload rather than page images. Large DOCX/PPTX previews may render page images for stable display and thumbnails; XLSX should keep a structured table model within row/column limits.

### 6. Thumbnail strategy follows document shape

- TXT/Markdown/DOC/DOCX: render the first readable page or first bounded content block.
- CSV/XLSX: render the first visible worksheet's top-left region.
- PPTX: render slide 1.
- External conversion: render page 1 of the converted PDF.

The card thumbnail remains a 640px JPG contract. The lightbox may use higher-resolution page images or structured HTML, but both come from the same parser result.

### 7. Filtering semantics

Documents join the format filter under a `文档` group. They participate in rating, tag, search, favorite and trash filters. They are exempt from image shape and pixel-size filters because those fields do not describe document geometry. The UI should state that shape/size filters do not apply rather than silently classifying documents as square or small.

### 8. Failure taxonomy and retry

Use the existing `ThumbnailFailureKind` vocabulary where possible and add document-specific reasons:

- `corrupt`: malformed OOXML or unreadable text.
- `encrypted`: password-protected or rights-managed.
- `missing-tool`: no external converter.
- `too-large`: file, archive, page, cell or slide limit exceeded.
- `timeout`: parser or converter exceeded deadline.
- `unsupported`: valid file but a feature or legacy codec cannot be rendered.

Failures are cached with the fingerprint. Retry is explicit from the UI or triggered automatically when the file fingerprint or renderer version changes.

### 9. Security model

- Do not trust document XML, HTML, SVG, hyperlinks or embedded objects.
- Strip or reject scripts, event attributes, external URLs and active content.
- Do not execute macros or embedded files.
- Do not allow `file://`, `http://` or `https://` requests from the preview.
- Limit archive extraction depth and total uncompressed bytes.
- Keep parsing off the renderer thread where practical; use a utility process or worker with a hard timeout.
- External converters run with a temporary output directory and validated arguments.

### 10. Implementation order

1. Registry, asset kind, scan/import/watch and tests.
2. Text/Markdown/CSV renderers and document preview component.
3. DOC binary parser and DOCX parser with static HTML rendering.
4. XLSX workbook model and table renderer.
5. PPTX slide model and static slide renderer.
6. Document thumbnails, lightbox integration, filter/card/inspector integration.
7. Real-sample verification and failure cases.
8. Phase two converter abstraction and legacy/WPS/ODF formats.

## Risks / Trade-offs

- [PPTX layout fidelity] → Use slide-coordinate placement for common shapes and text; mark unsupported effects; do not promise pixel-perfect output.
- [DOCX page breaks] → HTML cannot always reproduce Word's layout; preserve explicit and rendered page breaks, accept reflow.
- [DOC fidelity] → Legacy Word has no reliable page layout model in HTML. Preserve paragraphs, styles, tables, images and explicit page breaks; do not promise Office pixel parity.
- [XLSX formula and style coverage] → Render cached values and common styles; do not recalculate formulas or claim full Excel parity.
- [Large files and zip bombs] → Enforce byte, uncompressed-size, page, cell, slide and timeout limits before rendering.
- [Renderer security] → Sandbox iframe, strict CSP, HTML sanitization and no active content.
- [External converter variability] → Treat converter version and output as capability data; cache and expose failures; test on a machine with the actual software.
- [No real samples on this machine] → Do not claim implementation verified until real TXT/MD/CSV/DOCX/XLSX/PPTX samples have been opened in an isolated instance.
- [Lockfile and dependency changes] → Add only parser dependencies required by the approved scope, after a real import/build spike; do not bump major versions unrelated to this change.

## Migration Plan

1. Add the new format entries and `document` kind without changing existing formats.
2. Existing libraries are picked up by the next scan or watcher event; no destructive database migration is required.
3. New documents receive normal `assets` rows and share tags, ratings, folders, trash and notes.
4. Add derived preview caches under `.mediahub/previews/documents/`; deleting this directory is safe and only causes regeneration.
5. If a renderer fails, keep the asset and show the failure state; rolling back the feature leaves source files and metadata intact.
6. Phase two converter settings are additive; absence of a converter degrades to `inventory-only` or external-open behavior.

## Open Questions

- Which exact external converter executables and command templates should be supported on Windows first for `PPT/WPS/ET/DPS`: WPS, Microsoft Office, LibreOffice, or all three through a generic configured command?
- Are password-protected documents expected to prompt for a password in phase two, or only report `encrypted` and offer external open?
- Does the product need print/export from the document preview, or is screen-only browsing sufficient?
