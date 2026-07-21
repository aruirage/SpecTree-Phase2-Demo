import assert from 'node:assert/strict';
import { closeResultTab, upsertResultTab } from './resultTabs.js';

const first = { sessionId: 'session-a', label: 'A' };
const second = { sessionId: 'session-b', label: 'B' };

const opened = upsertResultTab([first], second);
assert.deepEqual(opened.map((tab) => tab.sessionId), ['session-a', 'session-b']);

const activatedExisting = upsertResultTab(opened, { sessionId: 'session-a', label: 'A updated' });
assert.equal(activatedExisting.length, 2);
assert.equal(activatedExisting[0].label, 'A updated');

const closedInactive = closeResultTab(activatedExisting, 'session-b', 'session-a');
assert.equal(closedInactive.activeSessionId, 'session-a');
assert.deepEqual(closedInactive.tabs.map((tab) => tab.sessionId), ['session-a']);

const closedActive = closeResultTab(opened, 'session-a', 'session-a');
assert.equal(closedActive.activeSessionId, 'session-b');
assert.deepEqual(closedActive.tabs.map((tab) => tab.sessionId), ['session-b']);
