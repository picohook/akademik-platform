# Book links

This candidate includes the book-variant selector and adds clickable book-provided links. AWS browser acceptance remains pending.

PDF link annotations are drawn over their actual page rectangles using the same viewport as the canvas. Web/DOI and email links open separately with noopener/noreferrer; GoTo destinations navigate to the referenced physical page in the current asset. Named destinations and zero-based first-page targets are supported. Crop boxes, scale and rotation use PDF.js coordinate conversion. Single, two-page and continuous-scroll panes share the renderer.

Optional annotation loading does not block first-page completion. Per-render tokens prevent delayed results or destination lookups from changing another page/book; link layers are cleared on redraw, secondary-pane removal, close and reopen. Links have labels, native keyboard activation and visible focus styles.

EPUB chapter/fragment links keep epub.js navigation. External links are intercepted in chapter documents and opened synchronously from the parent under the user gesture. This does not enable publisher scripts or broaden iframe sandbox permissions. Chapter cleanup removes these handlers together with existing copy-policy handlers.

Only http, https and mailto are allowed for external navigation. Script/data/file/blob/other protocols, embedded credentials and literal control characters are rejected. No PDF forms, executable actions or attachment launching are implemented. Printed URLs without a PDF Link annotation are not automatically detected; internal navigation goes to the target page rather than reproducing every PDF zoom/XYZ destination instruction.

Validation: 97 local tests passed, including seven new link tests, the existing EPUB copy-policy suite, variants, HTTP/range/authentication, ticketed delivery, watermark, search and citations. A generated PDF is parsed with the installed PDF.js version to check actual link annotations, named destinations, crop/zoom/rotation geometry. Syntax checks pass. Real AWS UI acceptance still required; no database migration, AI calls or GitHub Actions were used.

Serve index app.js?v=127-links1 and shell cache v22. Build one new image containing both variants and links, preserve the previous image tag, then verify a real external link and a footnote/TOC GoTo link. Test the same in EPUB when available.
