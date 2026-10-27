// Cache-busting for the app shell's own module and style URLs.
//
// index.html carried a literal `?v=130-ui-copy` from v130 through v134, so four
// consecutive deploys served a new app.js behind an unchanged URL: a reader only
// saw the new code if their browser happened to revalidate. Deriving the token
// from the build identity makes "a new build means a new URL" a property of the
// build rather than a thing someone has to remember to edit.
//
// This module is deliberately free of side effects: server.mjs starts listening
// when it is imported, so it cannot be imported by a unit test.

// Which build identity to stamp. BUILD_SHA is authoritative; APP_VERSION is the
// fallback for a build that has no commit (a local run); '' means "no token",
// which is honest about not knowing rather than inventing a plausible one.
export function assetVersionToken(sha, version) {
  if (sha) return sha;
  if (version && version !== '0-dev') return version;
  return '';
}

// The only files the shell is allowed to version. Anchoring the pattern to this
// allowlist means a token can never be splashed into arbitrary HTML, and a URL
// that is not a shell asset (an API link, a book file) keeps its own query.
const SHELL_ASSETS = [
  'app\\.js', 'styles\\.css', 'i18n\\.mjs', 'citations\\.mjs', 'pdf-structure\\.mjs',
  'search\\.mjs', 'epub-engine\\.mjs', 'offline\\.mjs', 'downloads\\.mjs', 'ocr-layer\\.mjs',
  'book-variants\\.mjs', 'book-links\\.mjs',
];
const VERSION_PATTERN = new RegExp(`/(?:${SHELL_ASSETS.join('|')})\\?v=[^"'\\s>]*`, 'g');

export function versionShellAssets(html, token) {
  if (!token) return html;
  const suffix = `?v=${encodeURIComponent(token)}`;
  return html.replace(VERSION_PATTERN, match => match.slice(0, match.indexOf('?v=')) + suffix);
}
