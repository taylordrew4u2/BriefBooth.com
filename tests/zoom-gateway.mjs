import assert from 'node:assert/strict';
import gateway from '../scripts/zoom-gateway.js';
const original=globalThis.fetch;let seen;
globalThis.fetch=async(url,options)=>{seen={url,options};return new Response(null,{status:303,headers:{Location:'https://briefbooth.com/studio/?zoom=connected'}})};
try{
let r=await gateway.fetch(new Request('https://briefbooth.com/api/zoom/callback?code=test&state=nonce',{headers:{cookie:'private',authorization:'private'}}));
assert.equal(r.status,303);assert.equal(r.headers.get('cache-control'),'no-store');
assert.equal(seen.url,'https://kjjfpacypvdfdktkssst.supabase.co/functions/v1/zoom/callback?code=test&state=nonce');
assert.equal(seen.options.headers.get('cookie'),null);assert.equal(seen.options.headers.get('authorization'),null);
await gateway.fetch(new Request('https://briefbooth.com/api/zoom/deauthorize',{method:'POST',body:'{"event":"check"}',headers:{'x-zm-signature':'signed','x-zm-request-timestamp':'123'}}));
assert.equal(new TextDecoder().decode(seen.options.body),'{"event":"check"}');assert.equal(seen.options.headers.get('x-zm-signature'),'signed');
assert.equal((await gateway.fetch(new Request('https://briefbooth.com/api/zoom/arbitrary'))).status,404);
assert.equal((await gateway.fetch(new Request('https://briefbooth.com/api/zoom/deauthorize',{method:'POST',body:'a'.repeat(17000)}))).status,413);
console.log('PASS fixed upstream, callback redirect, unchanged signed body, no credential forwarding and size limit');
}finally{globalThis.fetch=original;}
