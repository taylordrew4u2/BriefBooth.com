import assert from 'node:assert/strict';
import {hmac,handleWebhook} from '../supabase/functions/zoom/webhook.mjs';
const now=Date.now(), timestamp=String(Math.floor(now/1000));
const config={client_id:'production-client',webhook_secret:'test-secret'};
let revocations=[];
const revoke=async(...args)=>revocations.push(args);
async function request(body,ts=timestamp,secret=config.webhook_secret){const raw=JSON.stringify(body);return new Request('https://example.com/deauthorize',{method:'POST',body:raw,headers:{'x-zm-request-timestamp':ts,'x-zm-signature':'v0='+await hmac(secret,`v0:${ts}:${raw}`)}});}
const body={event:'app_deauthorized',payload:{user_id:'consultant-one',client_id:config.client_id,deauthorization_time:new Date(now-1000).toISOString()}};
assert.equal((await handleWebhook(await request(body),config,revoke,now)).status,204);
assert.equal(revocations.length,1);
for(const req of [await request(body,timestamp,'wrong-secret'),await request(body,String(Number(timestamp)-301)),await request(body,String(Number(timestamp)+301))])assert.equal((await handleWebhook(req,config,revoke,now)).status,401);
assert.equal(revocations.length,1,'Unauthenticated or stale events cannot revoke');
assert.equal((await handleWebhook(await request({...body,payload:{...body.payload,client_id:'other-client'}}),config,revoke,now)).status,400);
const challenge={event:'endpoint.url_validation',payload:{plainToken:'challenge'}};
assert.deepEqual(await (await handleWebhook(await request(challenge),config,revoke,now)).json(),{plainToken:'challenge',encryptedToken:await hmac(config.webhook_secret,'challenge')});
assert.equal((await handleWebhook(await request(body),{},revoke,now)).status,503);
assert.equal((await handleWebhook(await request(body),config,async()=>{throw new Error('database unavailable')},now)).status,503);
assert.equal((await handleWebhook(await request({...body,payload:{...body.payload,deauthorization_time:'invalid'}}),config,revoke,now)).status,400);
console.log('PASS Zoom signature, timestamp, client identity, challenge, fail-closed configuration and retry response');
