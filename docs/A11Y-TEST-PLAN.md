# Accessibility test plan — WCAG 2.2 AA

This is the manual/automated verification pass on top of `docs/ACCESSIBILITY.md`.

## 1. axe DevTools (automated)

Install the **axe DevTools** extension in Edge or Chrome. Open `http://localhost:8080/?v=80`.

Run **Scan all of my page** on:

1. Login screen.
2. Catalog (logged in as librarian).
3. Edit modal, Upload modal, Citation modal, Password modal, Access grants modal.
4. PDF reader: TOC, Search, Pages, Notes, highlight bar.
5. EPUB reader: TOC, search, EPUB content.

Expected: **no critical or serious issues**. Minor/moderate findings are logged in the PR/issue.

For EPUB content, use axe’s **include frames** option; EPUB.js renders into a sandboxed iframe. If the extension cannot reach it, run the axe API inside the frame:

```js
// DevTools console while the EPUB is open
const frame = document.querySelector('#epubView iframe');
frame.contentWindow.eval('axe.run(document, { runOnly: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"] })');
```

Do not paste third-party scripts into production; this is a local audit only.

## 2. Screen reader

Use **NVDA + Edge** on Windows (free) or **VoiceOver + Safari** on macOS.

### Login
- Heading is announced; email/password have names; error is announced.
- Tab order: email → password → submit → language toggle.

### Catalog
- One `h1`; cards read title, publisher, subjects, actions.
- “Add book” and “Access” buttons announce their purpose.

### Reader
- Opening a book announces a dialog; background is not reachable.
- Page/chapter changes are announced (`aria-live`).
- TOC tabs announce selected state; arrows change tabs.
- Search status announces result count; results are buttons with page/chapter.
- Notes and highlights are readable; delete button has a name.
- Closing returns focus to the card that opened the reader.

### EPUB
- The iframe is announced with its title; content headings/links are readable in browse mode.
- Keyboard can reach the EPUB content and return to reader controls.
- TOC/search jumps move the reading position.

Record: task, expected, actual, severity (critical/serious/moderate/minor).

## 3. Zoom and reflow

Test at **200% browser zoom** and **400% at 1280px wide** (≈320 CSS px):

- Login, catalog, reader top bar, TOC panel, notes, modals.
- No horizontal page scroll except the PDF/EPUB viewport.
- No controls clipped or overlapping; icon buttons remain reachable.
- Text does not require two-dimensional scrolling.
- Focus ring visible at every zoom level.

Use DevTools device toolbar at 320×640 and 1280×720.

## 4. EPUB iframe specifics

- `iframe` has a title and `lang` matching the book language (v80 sets this).
- EPUB content: `html[lang]`, heading order, image `alt`, table headers, link text.
- `allowScriptedContent` remains false (untrusted publisher scripts do not run).
- Fixed-layout EPUBs: zoom/reflow expectations differ; document as a known limitation.
- Test one reflow EPUB and one fixed-layout EPUB if available.

## 5. Sign-off

- [ ] axe: no critical/serious on all screens.
- [ ] NVDA or VoiceOver: all tasks above pass.
- [ ] 200%/400% zoom: no clipped controls.
- [ ] EPUB iframe: title/lang/reading order checked.
- [ ] Findings fixed or logged with owner and target version.

Evidence: screenshot/recording per finding, axe JSON export, browser/OS versions.
