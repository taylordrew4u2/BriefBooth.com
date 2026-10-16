import { copyFileSync, existsSync } from 'node:fs';
// Keep rewrite targets outside their source prefixes. Pages rejects targets
// such as /book/demo/index.html as a potential canonical-URL redirect loop.
for (const [source, target] of [
  ['out/book/demo/index.html', 'out/booking-shell.html'],
  ['out/manage/preview/index.html', 'out/management-shell.html'],
]) {
  if (!existsSync(source)) throw new Error(`Missing static route: ${source}`);
  copyFileSync(source, target);
}
