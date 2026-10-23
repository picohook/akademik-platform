# Reader copying — v116

Status: implemented, **24/24 unit tests and 13/13 targeted real Edge checks pass**.
The browser run was performed by the implementing author. A separate agent
reviewed the code; its EPUB deselection finding was fixed and rechecked.

## Behavior

- Selection toolbar offers **Kopyala / Atıfla kopyala** (EN: Copy / Copy with citation).
- PDF citations use the selected pane's physical-page anchor and its PDF PageLabel;
  no label means explicit PDF sayfası N / PDF page N. Selecting the second page
  of a spread correctly cites that page, not the toolbar's primary page.
- EPUB quotations use bibliography plus chapter label, or EPUB if no chapter is
  known. CFI is not presented as a printed page number.
- Copy/cut restrictions apply to selected book text in PDF (including scroll
  panes) and each EPUB chapter document. Input/textarea/contenteditable text,
  users' own notes, and bibliographic citation copying remain available.
- Selecting/highlighting is preserved when copying is disabled. This is a browser
  interaction policy, not DRM or a guarantee that content cannot be extracted.
- PDF page navigation dismisses stale copy actions. PDF selection no longer
  automatically focuses the note input, so it keeps its
  native selection available for copying. The note field remains reachable.
- Clipboard API is attempted first; checked execCommand fallback is used when
  unavailable. Failure displays a failure message, never a success toast.
- Toolbar wraps inside 320 CSS px, and its controls participate in the reader
  keyboard focus cycle. No new dependencies or migrations.

## Validation — 2026-10-23

Unit commands:

```powershell
node spike/app/test/citations.test.mjs
node spike/app/test/epub-copy-policy.test.mjs
```

Citation tests: 17/17; EPUB policy tests: 7/7. JavaScript syntax checks pass.
Real Microsoft Edge 155.0.4283.45, headless through Playwright on Windows,
1440 x 1000 and 320 x 780, isolated demo server, fresh browser profile. Ten
application files were snapshotted and verified unchanged after the run.

Browser coverage: real clipboard plain copy; mapped PDF citation; secondary
spread-page citation; forced Clipboard API failure with successful fallback;
PDF copy/cut denial while selection and note creation remain functional; own
note copying; bibliographic citation copying under denied book-copy policy;
EPUB copying/chapter citation; iframe copy/cut denial with note creation; new
chapter policy; keyboard/offline already-open reader copying; 320 px bounds;
English labels and success toast. Thirteen grouped cases passed, including clearing stale selections after a click inside the EPUB iframe and keyboard PDF page navigation.

Windows clipboard CRLF is normalized in test comparisons. Product clipboard
text is unchanged. Screen-reader behavior, native mobile selection menus,
cold offline startup, and complete WCAG acceptance remain outside this run.

Evidence: [all cases](reader-evidence/v116-2026-10-23/results.json),
[source and artifact hashes](reader-evidence/v116-2026-10-23/manifest.json),
[harness](reader-evidence/v116-2026-10-23/browser-harness.mjs),
[320 px](reader-evidence/v116-2026-10-23/copy-toolbar-320px.png),
[English toolbar](reader-evidence/v116-2026-10-23/copy-toolbar-english.png).

App v116 / CSS v44 / service-worker cache v7. No production deployment was
performed in this work. Capacity-test preparation is tracked separately in
[CAPACITY-TEST.md](CAPACITY-TEST.md); it does not establish reader capacity.
