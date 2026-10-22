# Copywriting and language revision

22 October 2026. Indonesian UI uses a professional, approachable voice and consistent Anda address. English UI is available through a flat globe dropdown. Preference persists locally. User transcript content is preserved; Indonesian samples are labeled. A separate English notebook illustration is loaded for English.

Examples of copy findings and replacements:
- Beri setiap suara tempatnya -> Rapikan setiap bagian percakapan. Replaced abstract metaphor with a clear editing benefit.
- Naskah siap dibawa -> Naskah siap diekspor. Names the actual action.
- Penyimpanan dijelaskan terbuka -> Penyimpanan sementara. Explains the product behavior.
- Draft / reload / memori tab -> Draf / memuat ulang halaman / tersimpan sementara selama tab terbuka. More natural and clear.
- Ruang untuk setiap cerita -> Editor transkrip. Describes the workspace task.
- Mixed kamu/Anda -> consistent Anda in product guidance.

Verification: TypeScript and production build passed. Browser tests passed for dropdown keyboard open/Escape/focus return, ID/EN switching, localized hero, FAQ and dialogs, draft preservation across language/sample changes, TXT export, search/clear, language persistence after reload, and mobile tools. No runtime errors or page overflow in either language at 320, 390, 834, 1440px. Existing Vite configuration warning remains; build also reports a bundle size warning. No automatic transcription or persistent draft storage added.