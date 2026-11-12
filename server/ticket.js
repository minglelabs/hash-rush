// Checks the entry ticket the mingle app gives a chat room member:
// "<base64url JSON {room, userId, name, exp}>.<base64url HMAC-SHA256 of the first part>".
// Mirrors mingle-app/src/server/hash-rush/ticket.ts.

import { createHmac, timingSafeEqual } from 'node:crypto';

const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function verifyTicket(ticket, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const [body, signature] = String(ticket || '').split('.');
  if (!body || !signature || !secret) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = fromB64url(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < nowSec || typeof payload.room !== 'string') return null;
    return { room: payload.room, userId: String(payload.userId || ''), name: String(payload.name || ''), exp: payload.exp };
  } catch {
    return null;
  }
}
