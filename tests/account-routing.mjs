import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { accountCallbackPath, accountDestination, accountPasswordCallbackPath, accountSignInPath, consultantWorkspacePath, needsAccountAccess, needsConsultantWorkspace, isRecoveryOwnerWorkspace, recoveryOwnerId, usesRecoveryBooking } from '../lib/account-routing.ts';
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

// A valid staged callback can return after the owner's app session expires.
// Sign-in, including email/OAuth confirmation, must return to completion rather
// than strand the grant at the default workspace. Only a fixed view marker is
// retained; the server still requires its browser cookie and verified owner.
for (const search of ['?google=pending', '?connect=google&google=pending', '?google=pending&next=https://attacker.example&code=private-code&token=private-token&state=private-state']) {
  const signIn = accountSignInPath(search);
  assert.equal(signIn, '/account/sign-in/?connect=google&google=pending');
  const callback = accountCallbackPath(new URL(signIn, 'https://briefbooth.com').search);
  assert.equal(callback, '/account/?connect=google&google=pending');
  const destination = accountDestination('consultant', false, new URL(callback, 'https://briefbooth.com').search, true);
  assert.equal(destination, '/studio/?workspace=consultant&connect=google&google=pending');
  assert.equal(needsAccountAccess(new URL(callback, 'https://briefbooth.com').search), true);
  for (const value of [signIn, callback, destination]) assert.doesNotMatch(value, /attacker|private-|token|state|code=/);
  assert.equal(accountDestination('client', false, search, true), '/client/?workspace=account');
  assert.equal(accountDestination('consultant', true, search, true), '/client/?workspace=account');
}
for (const search of ['?google=connected', '?google=failed', '?google=https://attacker.example', '?google=pending&connect=https://attacker.example']) {
  assert.equal(accountSignInPath(search), '/account/sign-in/');
  assert.equal(accountCallbackPath(search), '/account/');
}
assert.equal(accountSignInPath('?connect=zoom&google=pending'), '/account/sign-in/?connect=zoom', 'A Google marker cannot change an explicit Zoom intent');

// Execute the actual post-auth handler, including failure and client-intent paths.
const file = 'components/account-access.tsx';
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let routeCallback, submitFunction, savePasswordFunction;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'routeAccount') routeCallback = node.initializer.arguments[0];
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'submit') submitFunction = node;
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'savePassword') savePasswordFunction = node;
  ts.forEachChild(node, visit);
}
visit(source);
assert(routeCallback);
assert(submitFunction);
assert(savePasswordFunction);
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
for(const [search,expected] of [
  ['?connect=google','?connect=google'],
  ['?connect=zoom','?connect=zoom'],
  ['?connect=google&next=https://attacker.example','?connect=google'],
  ['?google=pending','?connect=google&google=pending'],
  ['?connect=google&google=pending&code=private-code&next=//attacker.example','?connect=google&google=pending'],
  ['?connect=https://attacker.example&returnTo=//attacker.example',''],
  ['',''],
]) {
  for(const expression of callbackExpressions) {
    const destination=vm.runInNewContext(expression,{accountCallbackPath,location:{origin:'https://briefbooth.com',search}});
    assert.equal(destination,`https://briefbooth.com/account/${expected}`);
    assert.equal(new URL(destination).origin,'https://briefbooth.com');
    assert.equal(accountDestination('consultant',false,new URL(destination).search,true),`/studio/?workspace=consultant${expected?'&'+expected.slice(1):''}`);
  }
}
const js = ts.transpileModule(`const routeAccount = ${routeCallback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

// Password recovery is an external round trip too. Exercise the real reset
// submit, then the real password-save/role-routing handler at the returned URL.
// Only view intent survives; neither the callback nor a pending marker grants
// consultant privileges or changes the deliberately separate client intent.
const passwordCases = [
  { search: '', callback: '/account?mode=password', recovery: '/studio/?workspace=consultant', legacy: '/studio' },
  { search: '?connect=google', callback: '/account?mode=password&connect=google', recovery: '/studio/?workspace=consultant&connect=google', legacy: '/studio/?connect=google' },
  { search: '?connect=zoom', callback: '/account?mode=password&connect=zoom', recovery: '/studio/?workspace=consultant&connect=zoom', legacy: '/studio/?connect=zoom' },
  { search: '?google=pending', callback: '/account?mode=password&connect=google&google=pending', recovery: '/studio/?workspace=consultant&connect=google&google=pending', legacy: '/studio/?connect=google' },
  { search: '?connect=google&google=pending&mode=signup&next=https://attacker.example&returnTo=//attacker.example&redirect_uri=https://attacker.example&code=private-code&token=private-token&state=private-state', callback: '/account?mode=password&connect=google&google=pending', recovery: '/studio/?workspace=consultant&connect=google&google=pending', legacy: '/studio/?connect=google' },
  { search: '?connect=zoom&google=pending', callback: '/account?mode=password&connect=zoom', recovery: '/studio/?workspace=consultant&connect=zoom', legacy: '/studio/?connect=zoom' },
  { search: '?connect=https%3A%2F%2Fattacker.example&google=pending&mode=signup&next=%2F%2Fattacker.example', callback: '/account?mode=password', recovery: '/studio/?workspace=consultant', legacy: '/studio' },
  { search: '?google=failed&mode=signup&next=//attacker.example&code=private-code', callback: '/account?mode=password', recovery: '/studio/?workspace=consultant', legacy: '/studio' },
];
const submitJs = ts.transpileModule(submitFunction.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const savePasswordJs = ts.transpileModule(savePasswordFunction.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const { search, callback, recovery, legacy } of passwordCases) {
  const requests = [], busy = [], messages = [];
  const submit = vm.runInNewContext(`${submitJs}; submit`, {
    mode: 'reset', accountPasswordCallbackPath, location: { origin: 'https://briefbooth.com', search },
    FormData: class { get(key) { return key === 'email' ? 'reset-fixture@example.invalid' : ''; } },
    db: () => ({ auth: { resetPasswordForEmail: async (email, options) => { requests.push({ email, ...options }); return { error: null }; } } }),
    setBusy: value => busy.push(value), setMessage: value => messages.push(value),
  });
  await submit({ preventDefault() {}, currentTarget: {} });
  assert.deepEqual(requests, [{ email: 'reset-fixture@example.invalid', redirectTo: 'https://briefbooth.com' + callback }]);
  assert.deepEqual(busy, [true, false]);
  assert.equal(messages.at(-1), 'Check your email for the password reset link.');
  const returned = new URL(requests[0].redirectTo);
  assert.equal(returned.origin, 'https://briefbooth.com');
  assert.deepEqual(returned.searchParams.getAll('mode'), ['password']);
  assert.equal(needsAccountAccess(returned.search), true);
  assert.doesNotMatch(returned.href, /attacker|private-|signup|returnTo|redirect_uri|code=|token=|state=/);
  for (const enabled of [true, false]) {
    for (const [role, clientIntent] of [['consultant', false], ['client', false], ['consultant', true]]) {
      const routes = [], calls = [], removals = [], saveBusy = [], saveMessages = [];
      const save = vm.runInNewContext(`${js}; ${savePasswordJs}; savePassword`, {
        accountDestination, process: { env: { NEXT_PUBLIC_BOOKING_RECOVERY: enabled ? '1' : '0' } },
        window: { location: { search: returned.search } },
        FormData: class { get() { return 'test-only-placeholder'; } },
        db: () => ({
          auth: { updateUser: async () => { calls.push('updateUser'); return { error: null }; } },
          rpc: async name => { calls.push(name); return { data: role, error: null }; },
        }),
        router: { replace: path => routes.push(path) },
        localStorage: { getItem: () => clientIntent ? String(Date.now()) : null, removeItem: key => removals.push(key) },
        setBusy: value => saveBusy.push(value), setMessage: value => saveMessages.push(value),
      });
      await save({ preventDefault() {}, currentTarget: {} });
      const destination = role === 'consultant' && !clientIntent ? (enabled ? recovery : legacy) : (enabled ? '/client/?workspace=account' : '/client');
      assert.deepEqual(routes, [destination], 'Password recovery keeps permitted connection intent and the verified role/client destination');
      assert.deepEqual(calls, ['updateUser', 'account_role']);
      assert.deepEqual(removals, ['briefbooth_client_login']);
      assert.deepEqual(saveBusy, [true, false]);
      assert.deepEqual(saveMessages, ['']);
    }
  }
}
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
console.log('PASS account roles, client intent, provider/password callbacks, safe fixed redirects, owner isolation, recovery booking routing, and loaded-request search');
