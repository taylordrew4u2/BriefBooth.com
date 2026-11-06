import assert from 'node:assert/strict';
const origin = process.env.PAGES_TEST_URL || 'http://localhost:3000';
for (const path of ['/', '/account/', '/studio/', '/book/demo', '/book/a-new-consultant', '/manage/11111111-1111-4111-8111-111111111111/']) {
  const response = await fetch(new URL(path, origin), {redirect:'manual'});
  assert.equal(response.status, 200, `Static route failed: ${path}`);
  assert.equal(response.headers.get('location'), null, `Rewrite changed public URL: ${path}`);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  if (path.startsWith('/manage/')) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
  }
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/_next\/[^"?]+)/g)].map(match=>match[1]);
  assert(assets.length > 0, `No app assets: ${path}`);
  for (const asset of new Set(assets)) {
    const result = await fetch(new URL(asset,origin));
    assert.equal(result.status,200,`Missing app asset: ${asset}`);
  }
}
const missing = await fetch(new URL('/this-page-does-not-exist',origin));
assert.equal(missing.status,404);
console.log('Pages checks passed: public and private deep links, preserved URLs, app assets, security headers, private no-cache/no-index, genuine 404.');
