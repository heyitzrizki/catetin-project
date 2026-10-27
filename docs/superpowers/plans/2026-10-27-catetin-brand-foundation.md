# Catetin Brand Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and integrate the approved conversational `c` mark and Petrona wordmark across Catetin's web, favicon, PWA, and social assets.

**Architecture:** Maintain one canonical self-contained SVG geometry for the mark and lockup, then derive raster exports from those sources through a repeatable development script. The React UI composes the SVG mark with a Petrona wordmark while preserving existing layout and accessible naming.

**Tech Stack:** SVG, React 19, CSS, Fontsource Petrona, Node asset generation with Sharp, Vite.

**Spec:** `docs/superpowers/specs/2026-10-27-catetin-brand-foundation-design.md`

## Production Asset Handoff

The approved production logo package has already been created and visually verified under `public/brand/` and `public/icons/`. Tasks 1 and 2 below document how the package was produced and are complete; an integration agent must not redraw, regenerate, substitute, or reinterpret these assets. The remaining implementation work is Task 3 only: wire the supplied files into the existing UI and metadata without redesigning surrounding surfaces.

## Global Constraints

- Approved colors are navy `#172F49`, ivory `#FAF9F6`, and powder blue `#CFE2F1`.
- Wordmark text is exactly lowercase `catetin` in Petrona SemiBold 600.
- Petrona is limited to the brand wordmark; existing typography roles remain unchanged.
- Do not alter layout or unrelated UI.
- Production assets must be local and generated from canonical vector sources.
- Preserve all existing untracked `.design/` files.

## Review Focus

- The mark must remain recognizable at 16px without the three bars collapsing together.
- Reversed and monochrome assets must preserve sufficient contrast and silhouette.
- Header and footer must retain their current dimensions without layout shift.
- PWA maskable artwork must keep the mark inside the safe zone.
- PNG/OG exports must be regenerated deterministically from the approved SVG source.

---

### Task 1: Canonical vector identity and Petrona source

**Files:**
- Create: `src/assets/brand/catetin-mark.svg`
- Create: `src/assets/brand/catetin-lockup.svg`
- Create: `src/assets/brand/catetin-lockup-reversed.svg`
- Create: `src/assets/brand/README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/brand/brand-assets.test.ts`

**Interfaces:**
- Produces: canonical SVGs with stable viewBoxes, approved colors, accessible titles, and the exact `catetin` wordmark.
- Produces: locally installed Petrona 600 through `@fontsource/petrona`.

- [ ] **Step 1: Write failing asset-contract tests**

Assert that all canonical SVG files exist, parse as SVG, contain the approved viewBoxes/colors, exclude raster data and external URLs, and expose the exact brand name where applicable.

- [ ] **Step 2: Run the brand asset test and confirm it fails**

Run: `npx.cmd tsx --test tests/brand/brand-assets.test.ts`

- [ ] **Step 3: Add Petrona and draw the canonical SVG assets**

Create the conversational `c` silhouette, speech tail, and three optically spaced rhythm bars. Build horizontal lockups using Petrona SemiBold 600 and document clear space, minimum size, palette, and usage constraints in `src/assets/brand/README.md`.

- [ ] **Step 4: Run the brand asset test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/assets/brand tests/brand/brand-assets.test.ts
git commit -m "feat: add Catetin brand identity sources"
```

### Task 2: Deterministic favicon, PWA, PNG, and social exports

**Files:**
- Create: `scripts/generate-brand-assets.mjs`
- Create: `public/brand/catetin-mark.png`
- Create: `public/brand/catetin-lockup.png`
- Create: `public/brand/catetin-lockup-reversed.png`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `public/icons/icon-maskable-512.png`
- Create: `public/og/catetin-og.png`
- Modify: `public/icon.svg`
- Modify: `public/manifest.webmanifest`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/brand/brand-exports.test.ts`

**Interfaces:**
- Consumes: canonical SVG assets from Task 1.
- Produces: `npm run brand:build` and deterministic public assets at declared dimensions.

- [ ] **Step 1: Write failing export-contract tests**

Assert expected files, PNG signatures, exact pixel dimensions, manifest icon declarations, SVG favicon validity, and maskable safe-zone sizing.

- [ ] **Step 2: Run the export test and confirm it fails**

Run: `npx.cmd tsx --test tests/brand/brand-exports.test.ts`

- [ ] **Step 3: Implement the asset-generation script**

Add Sharp as a development dependency and implement `npm run brand:build` to render all PNG and OG outputs from the canonical SVGs without network access.

- [ ] **Step 4: Generate assets and run the export test**

Expected: generation succeeds and tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/generate-brand-assets.mjs public tests/brand/brand-exports.test.ts
git commit -m "feat: generate Catetin brand assets"
```

### Task 3: Integrate the identity without redesigning the UI

**Files:**
- Create: `src/components/brand/CatetinBrand.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/index.css`
- Modify: `index.html`
- Test: `tests/brand/catetin-brand.test.tsx`

**Interfaces:**
- Consumes: `catetin-mark.svg` and local Petrona 600.
- Produces: `CatetinBrand({ showMark, inverse, className })` for header/footer brand rendering.

- [ ] **Step 1: Write failing component tests**

Assert exact visible name, accessible home label, decorative mark behavior, optional reversed state, and absence of layout-changing wrapper markup.

- [ ] **Step 2: Run the component test and confirm it fails**

Run: `npx.cmd tsx --test tests/brand/catetin-brand.test.tsx`

- [ ] **Step 3: Implement and integrate `CatetinBrand`**

Import Petrona 600 locally, replace the legacy text-only header/footer treatment, preserve button behavior, and add OG metadata pointing to `/og/catetin-og.png`.

- [ ] **Step 4: Run targeted tests and typecheck**

Run: `npx.cmd tsx --test tests/brand/*.test.ts tests/brand/*.test.tsx`

Run: `npm.cmd run lint`

Expected: PASS with zero TypeScript errors.

- [ ] **Step 5: Run full verification**

Run: `npm.cmd test`

Run: `npm.cmd run build`

Run: `git diff --check`

Expected: all tests pass, Vite build succeeds, and diff check is clean.

- [ ] **Step 6: Commit**

```bash
git add index.html src tests/brand
git commit -m "feat: apply Catetin brand identity"
```

