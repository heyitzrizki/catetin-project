# Catetin Editorial, direction A

Approved for implementation in chat after the visual mock could not be displayed in the client. Scope: landing and Studio, desktop and mobile. No new UI libraries.

- Identity: calm Indonesian workspace for turning conversations into readable notes. Energy 2, rhythm 2, motion 1.
- Users: researchers, journalists, students, and people editing spoken material.
- Domain artifact: transcript with speakers and timestamps. Use it as the product visual rather than a miniature laptop frame.
- Composition: asymmetric landing with readable example; document-first Studio with secondary tools. Mobile recomposes tools into an accessible dialog.
- Typography: existing Plus Jakarta Sans, comfortable reading measure; JetBrains Mono only for technical timecodes.
- Palette: warm near-white canvas, white paper, dark ink, existing navy for actions and selection. Thin rules and 4/6/8/12px corners.
- Dekdek reference: learn from composition, narrative and restrained accent roles. Retain Catetin's own palette, typography and document vocabulary. Do not copy illustrations or orange branding.
- Evidence: the app currently has no transcription inference engine. Clearly label sample text and time simulation, let users play local audio and write manually, and avoid unsupported network/performance claims. Word-compatible HTML exports use .doc, not .docx.
- Controls: existing Radix Dialog, DropdownMenu, Tabs and Accordion; existing Button/Input wrappers. Minimum 44px touch controls, keyboard focus, native seek slider, reduced motion.
- Protect user work within the session when switching examples; warn before leaving edited drafts. No claim of account sync or persistent storage.

This selected direction supersedes the earlier hardware-showcase and 72px hero implementation. DESIGN.md remains the historical baseline. The audit that informed it is /workspace/catetin-audit/AUDIT.md.

## 22 October 2026: approved Scribe-informed product-led revision

Supersedes the asymmetric landing composition above. User approved a generated visual: centered editorial serif headline, large realistic product preview, navy workflow section, warm ivory surfaces. Privacy and local-file handling are primary content. Studio uses a session library sidebar, document-first center and contextual tools, adapting the practical audio-workspace pattern without claiming a faithful ElevenLabs clone.

Implemented workflow selector, sample selection, local-file entry from landing, local-data diagrams, qualified architecture comparison, expanded FAQ and responsive Studio library. Existing transcription/editing logic preserved. All illustration is repo-native HTML/CSS and Lucide, not generated bitmap UI; no external graphic assets required. New DM Serif Display font is loaded through the existing Google Fonts mechanism. Local audio handling does not imply offline availability. No automatic transcription or persistent storage added.

Verification: TypeScript and production build passed. Chrome headless exercised workflow choices, sample selection/opening, privacy FAQ, upload dialog, Studio recording selection, search and mobile tools dialog. No uncaught JavaScript errors. No page-level horizontal overflow at 1440, 834, 390, 320 CSS pixels for landing or Studio. Desktop and 390px screenshots saved in .design and visually inspected. Comparison table intentionally scrolls locally on narrow viewports. Existing Vite __dirname configuration warning remains. No deployment, commit or push performed.