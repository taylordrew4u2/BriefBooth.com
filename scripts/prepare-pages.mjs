import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
// Keep rewrite targets outside their source prefixes. Pages rejects targets
// such as /book/demo/index.html as a potential canonical-URL redirect loop.
for (const [source, target] of [
  ['out/book/demo/index.html', 'out/booking-shell.html'],
  ['out/manage/preview/index.html', 'out/management-shell.html'],
]) {
  if (!existsSync(source)) throw new Error(`Missing static route: ${source}`);
  copyFileSync(source, target);
}

const recovery = process.env.NEXT_PUBLIC_BOOKING_RECOVERY === '1';
if (recovery) buildSync({entryPoints:['scripts/recovery-gateway.mjs'],outfile:'out/_worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022'});
else copyFileSync('scripts/zoom-gateway.js','out/_worker.js');
writeFileSync('out/_routes.json',JSON.stringify({version:1,include:['/api/zoom/*','/api/google/callback','/api/calendar/*',...(recovery?['/api/recovery/*']:[])],exclude:[]}));
