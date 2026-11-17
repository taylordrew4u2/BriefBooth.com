import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import nextEnv from '@next/env';
// Next and this separate export step must use the same public configuration.
nextEnv.loadEnvConfig(process.cwd());
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
if (recovery && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error('The booking build requires the existing public account configuration.');
}
if (recovery) buildSync({
  entryPoints: ['scripts/recovery-gateway.mjs'],
  outfile: 'out/_worker.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  // Reuse the same public Auth project as the account UI. Never inline the
  // entire environment: Calendar, email and owner-key secrets stay in bindings.
  define: {
    'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL || ''),
    'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''),
  },
});
else copyFileSync('scripts/zoom-gateway.js','out/_worker.js');
writeFileSync('out/_routes.json',JSON.stringify({version:1,include:['/api/zoom/*','/api/google/callback','/api/calendar/*',...(recovery?['/api/recovery/*']:[])],exclude:[]}));
