import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { accountCallbackPath, accountDestination, accountSignInPath, consultantWorkspacePath, needsAccountAccess, needsConsultantWorkspace, isRecoveryOwnerWorkspace, recoveryOwnerId, usesRecoveryBooking } from '../lib/account-routing.ts';
import { bookingMatchesSearch } from '../lib/booking-search.ts';
import { observeWorkspaceIdentity } from '../lib/workspace-session.ts';

// Recovery and account workspaces share callback URLs, but never identities.
for (const provider of ['google', 'zoom']) {
  assert.equal(needsConsultantWorkspace(`?${provider}=connected`), true);
  assert.equal(needsConsultantWorkspace(`?${provider}=failed`), true);
  assert.equal(needsConsultantWorkspace(`?connect=${provider}`), true);
  assert.equal(needsAccountAccess(`?connect=${provider}`), true);
  assert.equal(accountSignInPath(`?connect=${provider}&next=https://attacker.example`), `/account/sign-in/?connect=${provider}`);
  assert.equal(consultantWorkspacePath(`?connect=${provider}`), `/studio/?workspace=consultant&connect=${provider}`);
}
assert.equal(needsConsultantWorkspace(''), false, 'Default Studio retains the private owner review');
assert.equal(needsConsultantWorkspace('?workspace=consultant'), true);
assert.equal(needsConsultantWorkspace('?workspace=https://attacker.example'), false);
assert.equal(accountSignInPath('?connect=https://attacker.example&returnTo=//attacker.example'), '/account/sign-in/');
assert.equal(needsAccountAccess('?mode=password'), true, 'Existing password callback remains usable');
assert.equal(needsAccountAccess('?code=opaque'), true, 'Existing auth callback remains usable');
assert.equal(needsAccountAccess(''), false, 'Default account route retains private booking access');
assert.equal(isRecoveryOwnerWorkspace(recoveryOwnerId, true), true);
assert.equal(isRecoveryOwnerWorkspace('isolated-consultant', true), false);
assert.equal(isRecoveryOwnerWorkspace(recoveryOwnerId, false), false);
for (const path of ['/book/4u-digital', '/book/4u-digital/']) assert.equal(usesRecoveryBooking(path, true), true);
for (const path of ['/book/zoom-review-consultant/', '/book/demo/', '/book/4u-digital-other/', '/book/4u-digital/manage']) assert.equal(usesRecoveryBooking(path, true), false);
assert.equal(usesRecoveryBooking('/book/4u-digital/', false), false);

// Execute the actual post-auth handler, including failure and client-intent paths.
const file = 'components/account-access.tsx';
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let routeCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'routeAccount') routeCallback = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
assert(routeCallback);
// Execute both real signup and OAuth callback expressions. The fixed callback
// retains a recognized provider through external confirmation without accepting
// arbitrary redirect targets from URL parameters.
const callbackExpressions=[];
function findAuthCallbacks(node) {
  if(ts.isCallExpression(node)&&['db().auth.signUp','db().auth.signInWithOAuth'].includes(node.expression.getText(source))) {
    const options=node.arguments[0].properties.find(property=>property.name?.getText(source)==='options').initializer;
    callbackExpressions.push(options.properties.find(property=>['emailRedirectTo','redirectTo'].includes(property.name?.getText(source))).initializer.getText(source));
  }
  ts.forEachChild(node,findAuthCallbacks);
}
findAuthCallbacks(source);assert.equal(callbackExpressions.length,2);
for(const search of ['?connect=google','?connect=zoom','?connect=google&next=https://attacker.example','?connect=https://attacker.example&returnTo=//attacker.example','']) {
  const intent=new URLSearchParams(search).get('connect');
  const expected=['google','zoom'].includes(intent)?`?connect=${intent}`:'';
  for(const expression of callbackExpressions) {
    const destination=vm.runInNewContext(expression,{accountCallbackPath,location:{origin:'https://briefbooth.com',search}});
    assert.equal(destination,`https://briefbooth.com/account/${expected}`);
    assert.equal(new URL(destination).origin,'https://briefbooth.com');
    assert.equal(accountDestination('consultant',false,new URL(destination).search,true),`/studio/?workspace=consultant${expected?'&connect='+intent:''}`);
  }
}
const js = ts.transpileModule(`const routeAccount = ${routeCallback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [role, clientIntent, error] of [['consultant', false, false], ['client', false, false], ['consultant', true, false], ['consultant', false, true]]) {
  const routes = [], removed = [], messages = [];
  const run = vm.runInNewContext(`${js}; routeAccount`, {
    accountDestination, process: { env: { NEXT_PUBLIC_BOOKING_RECOVERY: '1' } },
    db: () => ({ rpc: async name => { assert.equal(name, 'account_role'); return { data: role, error }; } }),
    router: { replace: path => routes.push(path) },
    window: { location: { search: '?connect=google&next=https://attacker.example' } },
    localStorage: { getItem: () => clientIntent ? String(Date.now()) : null, removeItem: key => removed.push(key) },
    setMessage: message => messages.push(message),
  });
  await run();
  if (error) {
    assert.deepEqual(routes, []); assert.deepEqual(removed, []); assert.equal(messages.length, 1);
  } else {
    assert.deepEqual(routes, [role === 'consultant' && !clientIntent ? '/studio/?workspace=consultant&connect=google' : '/client/?workspace=account']);
    assert.deepEqual(removed, ['briefbooth_client_login']);
  }
}

// The real consultant loader checks the authenticated identity before reading
// profiles or mounting connection controls, even when a callback selects it.
const studioSource = ts.createSourceFile('app/studio/page.tsx', fs.readFileSync('app/studio/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loadFunction;
function findLoad(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'load') loadFunction = node;
  ts.forEachChild(node, findLoad);
}
findLoad(studioSource);
assert(loadFunction);
const loadJs = ts.transpileModule(loadFunction.getText(studioSource), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [user, role, destination] of [[null, null, '/account/sign-in/?connect=google'], [{ id: recoveryOwnerId }, 'consultant', '/booking-review/'], [{ id: 'isolated-client' }, 'client', '/client/?workspace=account']]) {
  const routes = [], calls = [], loading = [], errors = [];
  const run = vm.runInNewContext(`${loadJs}; load`, {
    accountSignInPath, isRecoveryOwnerWorkspace, clientWorkspacePath: '/client/?workspace=account', process: { env: { NEXT_PUBLIC_BOOKING_RECOVERY: '1' } },
    window: { location: { search: '?connect=google' } },
    db: () => ({
      auth: { getUser: async () => { calls.push('getUser'); return { data: { user } }; } },
      rpc: async name => { calls.push(name); return { data: role, error: null }; },
      from: () => { throw new Error('Identity gate must run before any profile query'); },
    }),
    router: { replace: path => routes.push(path) }, setLoading: value => loading.push(value), setMessage: value => errors.push(value),
  });
  await run();
  assert.deepEqual(routes, [destination]);
  assert.equal(calls[0], 'getUser');
  assert.equal(calls.includes('account_role'), user?.id === 'isolated-client');
  assert.deepEqual(errors, []);
  assert.deepEqual(loading, [false]);
}

// Search only inspects the loaded, authorized cards. It does not search notes or fetch more data.
const rows = [{ id: 'booking-A', client_name: 'Google Review Nov15', client_email: 'demo@example.com' }, { id: 'booking-B', client_name: 'Unrelated Client', client_email: 'other@example.com' }, { id: 'reserved-time' }];
assert.deepEqual(rows.filter(row => bookingMatchesSearch(row, '  REVIEW NOV15  ')).map(row => row.id), ['booking-A']);
assert.deepEqual(rows.filter(row => bookingMatchesSearch(row, 'DEMO@EXAMPLE.COM')).map(row => row.id), ['booking-A']);
assert.deepEqual(rows.filter(row => bookingMatchesSearch(row, 'booking-b')).map(row => row.id), ['booking-B']);
assert.equal(bookingMatchesSearch(rows[2], 'reserved'), true);
assert.equal(bookingMatchesSearch(rows[2], 'missing'), false);
assert.equal(rows.filter(row => bookingMatchesSearch(row, '   ')).length, rows.length);

// Out-of-order Auth checks cannot restore a prior user's workspace after a
// switch or sign-out. Auth errors leave the independent owner controls usable.
const identities = [], checks = [];
let authEvent, unsubscribed = false;
const stop = observeWorkspaceIdentity({
  getUser: () => new Promise((resolve, reject) => checks.push({ resolve, reject })),
  onAuthStateChange: callback => { authEvent = callback; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; },
}, value => identities.push(value));
assert.deepEqual(identities.at(-1), { checked: false, userId: null });
authEvent('SIGNED_IN');
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(checks.length, 2);
checks[0].resolve({ data: { user: { id: 'previous-user' } } });
await new Promise(setImmediate);
assert.deepEqual(identities.at(-1), { checked: false, userId: null });
checks[1].resolve({ data: { user: { id: 'current-user' } } });
await new Promise(setImmediate);
assert.deepEqual(identities.at(-1), { checked: true, userId: 'current-user' });
authEvent('TOKEN_REFRESHED');
await new Promise(resolve => setTimeout(resolve, 5));
authEvent('SIGNED_OUT');
checks[2].resolve({ data: { user: { id: 'current-user' } } });
await new Promise(setImmediate);
assert.deepEqual(identities.at(-1), { checked: true, userId: null });
authEvent('SIGNED_IN');
await new Promise(resolve => setTimeout(resolve, 5));
checks[3].reject(new Error('Auth unavailable'));
await new Promise(setImmediate);
assert.deepEqual(identities.at(-1), { checked: true, userId: null });
stop();
const before = identities.length;
authEvent('SIGNED_IN');
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(identities.length, before);
assert.equal(unsubscribed, true);
console.log('PASS account roles, client intent, provider callbacks, safe fixed redirects, owner isolation, recovery booking routing, and loaded-request search');
