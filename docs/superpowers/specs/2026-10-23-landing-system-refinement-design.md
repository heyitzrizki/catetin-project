# Catetin Landing System Refinement

## Intent

Refine the existing Catetin landing page without changing its product identity or rebuilding its narrative. The work should make the page easier to read, make the comparison section easier to scan, and turn the closing CTA into a credible product-led conversion moment.

Catetin is a browser-based transcription workspace centered on local file handling, listening, editing, and export. The landing page should feel calm, editorial, trustworthy, and specific to that workflow.

## Why now

The current page has a strong visual foundation, but several areas interrupt the experience:

- Supporting text is frequently too small, especially captions, notes, and comparison content.
- The comparison table gives too much space to decorative architecture diagrams and too little emphasis to decision-making information.
- The closing CTA is visually unfinished and does not demonstrate the Studio experience.
- Low-contrast transcript examples can look disabled rather than readable.
- The hierarchy varies between sections instead of behaving as one coherent type and spacing system.

## Goals

- Preserve the existing editorial serif and warm ivory/navy identity.
- Establish a readable, consistent typography system across the full landing page.
- Make the local-versus-cloud comparison quick to understand on desktop and mobile.
- Remove the comparison illustrations and replace their space with clearer information hierarchy.
- Redesign the closing CTA as a two-column product showcase based on the supplied reference.
- Use a truthful, polished close-up of the real Catetin Studio interface in the CTA.
- Improve contrast and visual emphasis without making the page loud or sales-heavy.
- Preserve current interactions, localization, responsive behavior, and accessibility semantics.

## Non-goals

- No full landing-page redesign.
- No change to Catetin's core brand direction, primary palette, or editorial character.
- No fabricated product capabilities, metrics, testimonials, integrations, or security claims.
- No new framework or UI dependency.
- No redesign of the Studio workspace outside what is needed to create the truthful CTA preview.
- No new automatic transcription, cloud sync, authentication, or persistence behavior.

## Anti-goals

- Do not repeat the hero laptop artwork inside the closing CTA.
- Do not make the CTA preview a raw, unreadable full-screen screenshot.
- Do not invent controls or states solely to make the product look more advanced.
- Do not keep two narrow comparison columns on small screens at the cost of legibility.
- Do not solve hierarchy only by making every heading larger.
- Do not add generic gradients, glass effects, decorative badges, or excessive shadows.

## Constraints

- Existing stack: React 19, TypeScript, Vite, CSS, Radix primitives, Lucide, and Motion.
- Continue using DM Serif Display, Plus Jakarta Sans, and JetBrains Mono in their current roles.
- Indonesian and English content must remain supported.
- Interactive controls must retain visible focus and at least 44px touch targets where applicable.
- Normal body copy should target WCAG AA contrast and must not rely on color alone.
- The CTA artwork must be built from supported Catetin UI and realistic example content.
- The landing page must remain usable at 320, 390, 834, and 1440 CSS pixels, and at 200% text zoom without clipped content or document-level horizontal overflow.

## Approaches considered

### 1. Local polish

Change only the closing CTA, comparison table, and a few font sizes.

Tradeoff: fastest and lowest risk, but leaves inconsistent text roles, contrast, and section rhythm elsewhere.

### 2. System refinement (selected)

Keep the current information architecture and brand, while treating the CTA, comparison, typography, contrast, and spacing as one coordinated system.

Tradeoff: broader than a component patch, but produces a coherent result without the cost and risk of a full redesign.

### 3. Full redesign

Recompose every landing section and establish a new art direction.

Tradeoff: maximum visual change, but unnecessary because the current narrative and identity are already strong.

## Design direction

Maintain the existing restrained editorial character:

- **Energy:** calm and assured.
- **Rhythm:** structured with a few deliberate asymmetrical moments.
- **Motion:** limited to useful hover/focus feedback and restrained entrance transitions.
- **Color:** warm ivory canvas, deep navy text/actions, powder blue for local-processing emphasis, and coral only when it conveys a real boundary or distinction.
- **Typography:** serif for major editorial statements; Jakarta Sans for all working information; Mono only for timestamps and technical metadata.

## Typography system

Define semantic roles and apply them consistently rather than increasing every size globally.

- Display headings remain responsive and editorial, with controlled line lengths.
- Section introductions and normal body copy should render at approximately 16–18px on desktop and no smaller than 15–16px on mobile.
- Table facts, FAQ answers, transcript examples, and supporting descriptions should use readable body or compact-body roles, generally no smaller than 14px.
- Eyebrows and metadata may be smaller, but should generally remain at 11–12px with sufficient weight and contrast.
- Legal-style notes and captions should not drop below approximately 12px unless visually nonessential; essential privacy qualifications must remain comfortably readable.
- Line heights should remain generous for prose and tighter for labels/headings.
- Muted text tokens should be darkened where the current rendering resembles a disabled state.

These are role targets, not arbitrary one-off overrides. Exact responsive values should be centralized in CSS custom properties or stable shared selectors.

## Comparison section

### Content hierarchy

The comparison is a decision aid, not a pair of marketing cards.

1. Section title and short neutral explanation.
2. Two clearly named approaches: Catetin/local and cloud services.
3. A concise orientation sentence for each approach.
4. Aligned comparison criteria and answers.
5. A qualification note explaining that cloud behavior varies by provider.

### Desktop composition

- Remove both architecture illustrations.
- Use a real comparison matrix with a dedicated criterion column followed by Catetin and cloud columns.
- Give the Catetin column subtle emphasis through background or border role, not oversized decoration.
- Keep row labels concise and visually stronger than row descriptions.
- Use consistent vertical alignment and spacing so readers can compare across a row.
- Reduce total section height and bring the data closer to the heading.

### Mobile composition

- Do not preserve the existing squeezed side-by-side cards.
- Transform each criterion into a readable comparison group: criterion label followed by Catetin and cloud values, clearly identified.
- Keep both approaches visible within the same group to preserve comparison.
- Avoid horizontal page scrolling and avoid text below the compact-body minimum.

### Content integrity

Keep neutral language. Do not turn the cloud column into a straw man. Preserve qualifications such as provider-dependent retention and policies.

## Closing CTA

### Composition

- A prominent warm surface inside the page container with a restrained border and elevation.
- Two-column desktop layout, copy on the left and product composition on the right.
- Stack on mobile with copy first and the product preview second.
- Use generous internal spacing and a stronger visual presence than the current empty bordered panel.

### Copy side

- Keep the existing specific message: listen, edit, and save the transcript.
- Retain one primary action leading to a real sample in Studio.
- Supporting text should explain that visitors can explore a sample before opening their own recording.
- The button label must remain specific, such as "Coba contoh di Studio".

### Product visual side

Create a polished but truthful close-up from the actual Catetin Studio vocabulary:

- Visible waveform or playback position.
- Speaker name and timestamp.
- A short realistic transcript segment with an active text selection or caret.
- A visible, supported export affordance when it fits without clutter.
- Subtle perspective, layering, and shadow are allowed to improve marketing presentation.
- The visual may show the supported local Whisper transcription workflow, but must not imply that transcription starts without an explicit user action or has already completed before the user initiates it.

The preview should be implemented from real semantic UI/CSS or a captured composition derived from the actual interface, whichever produces the best responsive and accessible result without falsifying functionality. It is a product demonstration, not a decorative illustration.

## Remaining page refinements

- Increase readability of workflow descriptions, trust statements, example transcripts, FAQ supporting copy, captions, and footer copy.
- Improve contrast where transcript/example content currently appears disabled.
- Rebalance vertical spacing after the comparison illustrations are removed.
- Preserve the hero's current product-led role; do not redesign it or reuse it in the CTA.
- Normalize the raster hero artwork's outer backdrop to the same warm ivory canvas as the page so the image boundary disappears. Preserve powder-blue accents inside the depicted Catetin interface, including selection, waveform, and speaker markers, because those communicate interaction and remain part of the product language.
- Preserve working navigation, language switching, sample selection, FAQ, and Studio entry points.

## Responsive behavior

- Desktop should retain the editorial breadth and two-column CTA.
- Tablet should reduce gutters and allow the CTA artwork to remain alongside copy only while both remain legible.
- Mobile should stack the CTA and comparison groups, increase tap comfort, and prioritize readable text over preserving desktop proportions.
- Long English and Indonesian strings must wrap without clipping.
- No document-level horizontal overflow at 320px.

## Accessibility and interaction

- Maintain semantic table relationships on desktop or provide equivalent accessible grouping when the visual layout changes on mobile.
- Do not use font size or color alone to distinguish Catetin from cloud.
- Preserve keyboard operation, focus-visible treatment, and reduced-motion handling.
- Decorative presentation layers in the CTA must be hidden from assistive technology when equivalent text already exists.
- Essential product-preview text should meet contrast requirements when it is intended to be read.

## Verification criteria

- TypeScript check and production build pass.
- Landing page is visually inspected at 1440, 834, 390, and 320 CSS pixels.
- No page-level horizontal overflow at those widths.
- Comparison body content renders at the defined compact-body minimum, meets the intended contrast target, and retains clear local/cloud associations.
- CTA product visual contains only currently supported UI concepts.
- Primary CTA opens the intended sample in Studio.
- Language switching is checked for affected content and layout.
- Keyboard focus and reduced-motion behavior remain intact.
- Text contrast is checked for the modified muted/body roles.

## Open implementation calls

The builder may choose the exact CSS technique for the CTA perspective and the exact responsive breakpoint, provided the result follows the constraints above. If a captured Studio composition is used, it must remain crisp at target sizes and have appropriate alternative treatment; semantic CTA copy and action must remain HTML.
