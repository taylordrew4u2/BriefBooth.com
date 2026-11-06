import assert from 'node:assert/strict';
import {calendarFeed} from '../supabase/functions/calendar/format.mjs';
const event={id:'example',title:'A, B; C\nBEGIN:BAD',start:'2026-11-01T12:00:00Z',end:'2026-11-01T12:30:00Z',revision:2,status:'cancelled',notes:'PRIVATE',client_email:'PRIVATE'};
const text=calendarFeed([event]);assert(text.includes('STATUS:CANCELLED'));assert(text.includes('SEQUENCE:2'));assert(text.includes('UID:example@briefbooth.com'));assert(!text.includes('PRIVATE'));assert(!text.includes('\r\nBEGIN:BAD'));assert(text.includes('DTSTART:20261101T120000Z'));console.log('PASS calendar subscription stable identity, cancellation, escaping and private-data minimization');

assert(calendarFeed([{...event,title:'é'.repeat(100)}]).split('\r\n').every(l=>new TextEncoder().encode(l).length<=75));
