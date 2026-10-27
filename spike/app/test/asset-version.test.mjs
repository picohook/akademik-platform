import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { versionShellAssets } from '../asset-version.mjs';

const shellHtml = () => readFile(new URL('../public/index.html', import.meta.url), 'utf8');

// The regression: index.html shipped a literal `?v=130-ui-copy` from v130, so
// v131–v134 all served a new app.js behind an unchanged URL. The token now comes
// from the build, which means these two things must hold.

test('the served shell carries the build token, not a hard-coded label', () => {
  const out = versionShellAssets('<link rel="stylesheet" href="/styles.css?v=0-dev" />'
    + '<script type="module" src="/app.js?v=0-dev"></script>', 'b6aa81a');
  assert.ok(out.includes('/styles.css?v=b6aa81a'), out);
  assert.ok(out.includes('/app.js?v=b6aa81a'), out);
  assert.ok(!out.includes('0-dev'), out);
});

test('index.html has no stale literal version left to go stale again', async () => {
  const html = await shellHtml();
  // Every shell asset URL must carry a ?v=, and none of them may be a hand-picked
  // label: those are exactly what silently stopped matching the deployed code.
  for (const name of ['styles.css', 'app.js']) {
    const match = html.match(new RegExp(`/${name.replace('.', '\\.')}\\?v=([^"'\\s>]*)`));
    assert.ok(match, `${name} has no ?v= in index.html`);
    assert.equal(match[1], '0-dev', `${name} carries a hand-picked version "${match[1]}"`);
  }
});

test('a token change changes the asset URL, which is the whole point', () => {
  const html = '<script type="module" src="/app.js?v=0-dev"></script>';
  const first = versionShellAssets(html, 'aaaaaaa');
  const second = versionShellAssets(html, 'bbbbbbb');
  assert.notEqual(first, second);
  assert.ok(!first.includes('?v=0-dev'));
});

test('no token means the file is served untouched rather than stamped with a guess', () => {
  // BUILD_SHA='' and APP_VERSION='0-dev' is a local run with nothing to identify.
  // Inventing a token here would be worse than no token: it would look real.
  const html = '<script type="module" src="/app.js?v=0-dev"></script>';
  assert.equal(versionShellAssets(html, ''), html);
});

test('only allowlisted shell assets are rewritten, not arbitrary HTML', () => {
  const html = '<a href="/api/books/x/file?v=1">x</a><script src="/evil.js?v=1"></script>';
  const out = versionShellAssets(html, 'abc1234');
  assert.equal(out, html, 'a non-shell URL kept a foreign version string alive');
});

test('a token is URL-encoded so a slash or space cannot break the attribute', () => {
  const out = versionShellAssets('<script src="/app.js?v=0-dev"></script>', 'a/b c');
  assert.ok(out.includes('?v=a%2Fb%20c'), out);
});

test('the service worker cache name was bumped for the body change', async () => {
  // v133 established the rule: a change to the '/' body or its headers needs a
  // cache rename, because an offline launch replays the captured shell. A v25
  // shell would keep pointing at the pre-token asset URL forever.
  const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const match = sw.match(/const CACHE = '([^']+)'/);
  assert.ok(match, 'sw.js has no CACHE constant');
  assert.notEqual(match[1], 'akademik-shell-v25', 'cache name was not bumped after the shell body changed');
});
