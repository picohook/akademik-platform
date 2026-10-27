// Content-Security-Policy for the LibEdge app shell.
//
// 'blob:' in style-src is REQUIRED, not optional. The EPUB reader renders each
// chapter inside an iframe that epub.js sandboxes with only `allow-same-origin`
// (the engine passes allowScriptedContent: false), so that iframe inherits this
// policy instead of receiving its own. epub.js writes its theme and font-size
// stylesheet to a blob: URL and links it there. Without 'blob:' the stylesheet
// is silently dropped: publisher CSS and the reader's theme/size override never
// apply, with no error in the console beyond a CSP violation.
//
// Keep img-src/worker-src blob: for the same reason (cover images, workers).
// Do NOT add blob: to script-src: chapter documents must stay script-free.
export const APP_CSP = "default-src 'self'; script-src 'self'; "
  + "style-src 'self' 'unsafe-inline' blob:; "
  + "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
  + "frame-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
  + "form-action 'self'; frame-ancestors 'none'";
