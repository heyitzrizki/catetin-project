# Catetin Landing System Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine Catetin's landing typography, comparison matrix, hero integration, and closing CTA without changing its brand, information architecture, or product truth.

**Architecture:** Extract the comparison and closing CTA from the large landing component into focused semantic React components, while keeping state ownership and navigation callbacks in `LandingPage`. Centralize landing type roles in CSS, use semantic desktop table markup with a CSS-only mobile reflow, and build the CTA preview from real Catetin transcript/playback/export concepts rather than a fabricated screenshot.

**Tech Stack:** React 19, TypeScript, Vite, CSS, Lucide, React DOM server rendering, Node test runner through `tsx`, headless Chrome for visual checks.

**Spec:** `docs/superpowers/specs/2026-10-23-landing-system-refinement-design.md`

## Global Constraints

- Preserve the existing warm ivory, navy, powder-blue, and restrained coral roles.
- Keep DM Serif Display for editorial headings, Plus Jakarta Sans for interface/body copy, and JetBrains Mono only for timestamps or technical metadata.
- Add no new dependency and do not change Studio behavior.
- Support both Indonesian and English through the existing `t()` catalog resolution.
- Do not fabricate features, metrics, integrations, security claims, or automatic actions.
- Preserve keyboard focus, reduced motion, and minimum 44px interactive targets.
- Verify at 1440, 834, 390, and 320 CSS pixels with no document-level horizontal overflow.
- Modified normal text must target WCAG AA contrast; essential body text must remain at least 15px on mobile and comparison compact text at least 14px.

## Review Focus

- Long English comparison values must wrap without breaking row associations or causing horizontal overflow; covered in Task 2 browser fixtures.
- Mobile comparison groups must retain an explicit criterion, Catetin value, and cloud value in accessible reading order; covered in Task 2 markup tests.
- CTA must open the same selected sample represented by its preview and must not invent unsupported controls; covered in Task 3 component tests.
- Language switching must resolve every new CTA/comparison string rather than leaking Indonesian keys into English; covered in Task 3 catalog tests.
- Hero artwork must not expose a visible rectangular backdrop against `#faf9f6` while its internal blue interaction accents remain intact; covered in Task 5 visual checks.

---

### Task 1: Establish landing typography roles

**Files:**
- Modify: `src/index.css:414-475`
- Create: `tests/landing/typography.test.ts`

**Interfaces:**
- Consumes: existing landing selectors and CSS custom properties.
- Produces: `--lp-body`, `--lp-body-mobile`, `--lp-compact`, `--lp-meta`, and `--lp-muted` landing tokens used by later tasks.

- [ ] **Step 1: Write the failing CSS contract test**

Create a Node test that reads `src/index.css` and asserts the five token names exist, `--lp-body` is at least `16px`, `--lp-body-mobile` is at least `15px`, `--lp-compact` is at least `14px`, and the mobile media query applies the mobile body role.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx tsx --test tests/landing/typography.test.ts`

Expected: FAIL because the landing type-role tokens do not yet exist.

- [ ] **Step 3: Add the semantic type tokens and replace undersized landing copy rules**

Update the landing section of `src/index.css`. Apply body/compact/meta roles to workflow descriptions, trust copy, comparison copy, example transcripts, FAQ support copy, captions, CTA support copy, and footer copy. Keep nonessential metadata at 11–12px, but do not leave essential explanatory copy at 10–12px. Darken muted text where it currently resembles a disabled state.

- [ ] **Step 4: Run focused and project checks**

Run: `npx tsx --test tests/landing/typography.test.ts && npm run lint && npm run build`

Expected: typography test PASS, TypeScript exits 0, Vite build exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/index.css tests/landing/typography.test.ts
git commit -m "style: establish readable landing typography"
```

### Task 2: Replace illustrated comparison cards with a semantic matrix

**Files:**
- Create: `src/components/landing/ComparisonSection.tsx`
- Create: `tests/landing/comparison-section.test.tsx`
- Modify: `src/components/LandingPage.tsx:41-50`
- Modify: `src/index.css:433-475`
- Modify: `src/lib/messages-extra.json`

**Interfaces:**
- Consumes: `t(key: string)` from `src/lib/i18n.ts`.
- Produces: `ComparisonSection(): JSX.Element`; semantic table classes `.comparison-matrix`, `.comparison-criterion`, `.comparison-local`, and `.comparison-cloud`.

- [ ] **Step 1: Write failing semantic rendering tests**

Render `ComparisonSection` with `renderToStaticMarkup`. Assert one caption, three column headers (criterion, Catetin, cloud), six row headers with `scope="row"`, no `architecture-local.svg` or `architecture-cloud.svg`, and both local/cloud values in every data row.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx tsx --test tests/landing/comparison-section.test.tsx`

Expected: FAIL because `ComparisonSection` does not exist.

- [ ] **Step 3: Implement `ComparisonSection(): JSX.Element`**

Move the comparison data and markup out of `LandingPage`. Use a three-column table on desktop. Preserve the neutral provider-dependent caveats. Add any new criterion-column strings to both ID and EN entries in `messages-extra.json`.

- [ ] **Step 4: Implement the mobile grouped-row reflow**

Use CSS labels or pseudo-label helpers so each mobile criterion reads in this order: criterion, Catetin value, cloud value. Do not use page-level horizontal scrolling and do not reduce comparison body text below `var(--lp-compact)`.

- [ ] **Step 5: Run component and project checks**

Run: `npx tsx --test tests/landing/comparison-section.test.tsx && npm run lint && npm run build`

Expected: all commands PASS; production output contains no references to the two architecture SVGs from the comparison component.

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/ComparisonSection.tsx src/components/LandingPage.tsx src/index.css src/lib/messages-extra.json tests/landing/comparison-section.test.tsx
git commit -m "refactor: clarify local and cloud comparison"
```

### Task 3: Build the truthful product-led closing CTA

**Files:**
- Create: `src/components/landing/ClosingCTA.tsx`
- Create: `tests/landing/closing-cta.test.tsx`
- Modify: `src/components/LandingPage.tsx:54`
- Modify: `src/index.css:427-475`
- Modify: `src/lib/messages-extra.json`

**Interfaces:**
- Consumes: `Recording` data from `src/lib/transcript.ts`, `t()`, existing `Button`, and Lucide icons.
- Produces: `ClosingCTA({ recording, onOpenStudio }: { recording: Recording; onOpenStudio: (sampleId: string) => void }): JSX.Element`.

- [ ] **Step 1: Write failing component tests**

Render the CTA with the first real recording. Assert the output contains its speaker, timestamp, transcript excerpt, a waveform/play control presentation, supported export labels (`TXT`, `SRT`, `DOC`), exactly one primary CTA, and no unsupported feature label. Invoke the CTA callback in a focused interaction test and assert it receives `recording.id`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx tsx --test tests/landing/closing-cta.test.tsx`

Expected: FAIL because `ClosingCTA` does not exist.

- [ ] **Step 3: Implement `ClosingCTA` with real product vocabulary**

Build a two-column section: approved copy and primary action on the left; semantic product composition on the right using one real transcript segment, speaker/timestamp, waveform/playback state, active text selection treatment, and supported export formats. Presentation layers that duplicate text should use `aria-hidden="true"`; the CTA action must call `onOpenStudio(recording.id)`.

- [ ] **Step 4: Add complete ID/EN catalog entries**

Add only new CTA labels and preview descriptors. Test both `setLanguage('id')` and `setLanguage('en')` renders so English never falls back to an Indonesian source key.

- [ ] **Step 5: Add responsive CTA styling**

Match the approved reference's hierarchy without copying it literally: warm contained surface, copy left, product close-up right, restrained border/elevation, subtle perspective, and stacked mobile composition. Use no hero laptop reuse and no fabricated screenshot.

- [ ] **Step 6: Run component and project checks**

Run: `npx tsx --test tests/landing/closing-cta.test.tsx && npm run lint && npm run build`

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/landing/ClosingCTA.tsx src/components/LandingPage.tsx src/index.css src/lib/messages-extra.json tests/landing/closing-cta.test.tsx
git commit -m "feat: add product-led closing CTA"
```

### Task 4: Integrate the hero artwork with the ivory canvas

**Files:**
- Modify: `public/illustrations/notebook-hero.png`
- Modify: `public/illustrations/notebook-hero-en.png`
- Modify: `src/index.css:439-442`
- Modify: `public/illustrations/README.md`

**Interfaces:**
- Consumes: existing 1536×1024 localized hero artwork and page canvas `#faf9f6`.
- Produces: localized hero images with an outer warm-ivory backdrop that visually merges into the page while retaining internal powder-blue UI accents.

- [ ] **Step 1: Record baseline screenshots**

Capture the hero in ID and EN at 1440 and 390 CSS pixels before editing. Save them under `.design/qa-landing-refinement/baseline/` and confirm the current rectangular boundary is visible.

- [ ] **Step 2: Edit both localized hero assets**

Use the image editing workflow on each source asset with the same instruction: normalize only the outer backdrop to the page's warm ivory `#faf9f6`; preserve the laptop, text, shadows, waveform, speaker markers, and powder-blue selection accents exactly. Do not regenerate or reinterpret the UI.

- [ ] **Step 3: Tune CSS integration**

Keep the hero wrapper on `#faf9f6`, remove any filter/blend treatment that introduces a cool cast or visible rectangle, and preserve intrinsic aspect ratio and current click behavior.

- [ ] **Step 4: Verify the localized assets visually**

Capture ID and EN after images at 1440 and 390. Compare each against its baseline: the outer image boundary should disappear, UI text must remain unchanged and legible, and blue interaction accents must remain visible.

- [ ] **Step 5: Run project checks**

Run: `npm run lint && npm run build`

Expected: both commands PASS and both hero assets return HTTP 200 in the local preview.

- [ ] **Step 6: Commit**

```bash
git add public/illustrations/notebook-hero.png public/illustrations/notebook-hero-en.png public/illustrations/README.md src/index.css .design/qa-landing-refinement
git commit -m "style: blend hero artwork into ivory canvas"
```

### Task 5: Full responsive, interaction, and accessibility verification

**Files:**
- Create: `.design/landing-system-refinement-report.md`
- Create: `.design/qa-landing-refinement/final/`
- Modify as needed from findings: `src/components/landing/ComparisonSection.tsx`, `src/components/landing/ClosingCTA.tsx`, `src/components/LandingPage.tsx`, `src/index.css`, `src/lib/messages-extra.json`

**Interfaces:**
- Consumes: outputs of Tasks 1–4.
- Produces: verified landing implementation and an evidence-backed QA report.

- [ ] **Step 1: Run all automated checks**

Run: `npx tsx --test tests/landing/*.test.ts tests/landing/*.test.tsx && npm run lint && npm run build && git diff --check`

Expected: all tests PASS; TypeScript and build exit 0; no whitespace errors.

- [ ] **Step 2: Capture both languages at all target widths**

Use headless Chrome with a stable render budget. Capture ID and EN at 1440×1000, 834×1112, 390×844, and 320×800. Save full-page and focused comparison/CTA screenshots under `.design/qa-landing-refinement/final/`.

- [ ] **Step 3: Verify responsive and content behavior**

At every width, assert `document.documentElement.scrollWidth === document.documentElement.clientWidth`; inspect long English wrapping; confirm mobile comparison reading order; confirm the CTA preview matches the selected sample; and confirm the CTA opens that sample in Studio.

- [ ] **Step 4: Verify keyboard, focus, language, and reduced motion**

Keyboard through navigation, comparison-adjacent controls, sample choices, FAQ, and CTA. Verify visible focus, language switch layout, focus return from dialogs, and no nonessential transform/transition under `prefers-reduced-motion: reduce`.

- [ ] **Step 5: Verify text roles and contrast**

Inspect computed sizes for normal body, mobile body, compact comparison, metadata, and captions. Check changed foreground/background pairs against WCAG AA targets and record exact values in the report.

- [ ] **Step 6: Fix only confirmed QA defects and rerun affected checks**

Keep fixes within the approved refinement scope. Repeat the relevant automated command and recapture any changed screenshot.

- [ ] **Step 7: Write the QA report**

Document viewport/language coverage, screenshot paths, automated command results, contrast pairs, interaction results, remaining browser/device limits, and confirmation that no unsupported product behavior was introduced.

- [ ] **Step 8: Commit**

```bash
git add src public tests .design/landing-system-refinement-report.md .design/qa-landing-refinement
git commit -m "test: verify landing system refinement"
```

## Self-review result

- Spec coverage: typography, comparison, CTA, hero canvas, responsive behavior, localization, accessibility, and verification each have an owning task.
- Step scan: each implementation task has a failing contract/component test or explicit visual baseline before implementation, followed by focused verification.
- Type consistency: `ComparisonSection()` is prop-free; `ClosingCTA` consumes a real `Recording` and a string-ID callback matching `LandingPage` state.
- Review focus: long English, mobile association, selected-sample behavior, translation completeness, and hero boundary are explicitly exercised.
- Proportion: the plan names exact files, interfaces, checks, and design constraints without prescribing component bodies.
