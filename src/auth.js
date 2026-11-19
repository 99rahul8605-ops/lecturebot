'use strict';
const crypto = require('node:crypto');

function verifyTelegramInitData(raw, botToken, maxAgeSeconds = 86400, now = Date.now()) {
  if (!raw || !botToken || typeof raw !== 'string' || raw.length > 8192) throw new Error('Missing Telegram authorization');
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid auth hash');
  const seen = new Set();
  const entries = [];
  for (const [key, val] of params.entries()) {
    if (seen.has(key)) throw new Error('Duplicate authorization parameter');
    seen.add(key);
    if (key !== 'hash') entries.push([key, val]);
  }
  const checkString = entries.sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(checkString).digest();
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), computed)) throw new Error('Invalid authorization');
  const date = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(date) || Math.abs(Math.floor(now/1000)-date) > maxAgeSeconds) throw new Error('Expired authorization');
  let user;
  try { user = JSON.parse(params.get('user') || '{}'); } catch { throw new Error('Invalid user data'); }
  if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Invalid Telegram user');
  return {id:String(user.id), firstName:String(user.first_name||''), lastName:String(user.last_name||''), username:String(user.username||'')};
}
module.exports={verifyTelegramInitData};
