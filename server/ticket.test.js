import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyTicket } from './ticket.js';

const b64url = (v) => Buffer.from(v).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(createHmac('sha256', secret).update(body).digest())}`;
}

test('a mingle ticket is accepted only with the right secret and before it expires', () => {
  const payload = { room: 'mingle-abc', userId: 'user-1', name: 'Mia', exp: 2_000_000_000 };
  const ticket = sign(payload, 's1');
  assert.deepEqual(verifyTicket(ticket, 's1', 1_900_000_000), payload);
  assert.equal(verifyTicket(ticket, 's2', 1_900_000_000), null);
  assert.equal(verifyTicket(ticket, 's1', 2_100_000_000), null);
  assert.equal(verifyTicket(`${ticket}x`, 's1', 1_900_000_000), null);
  assert.equal(verifyTicket('', 's1'), null);
});
