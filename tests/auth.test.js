'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {verifyTelegramInitData}=require('../src/auth');
function sign(token,fields){const entries=Object.entries(fields).sort(([a],[b])=>a.localeCompare(b));const check=entries.map(([k,v])=>`${k}=${v}`).join('\n');const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();const hash=crypto.createHmac('sha256',secret).update(check).digest('hex');return new URLSearchParams({...fields,hash}).toString();}
test('accepts valid Telegram HMAC with current auth_date',()=>{const token='test-secret',raw=sign(token,{auth_date:String(Math.floor(Date.now()/1000)),query_id:'AAAB',user:JSON.stringify({id:1234,first_name:'Test'})});assert.equal(verifyTelegramInitData(raw,token).id,'1234');});
test('rejects forged initData',()=>{const raw=sign('valid',{auth_date:String(Math.floor(Date.now()/1000)),user:'{"id":1234}'});assert.throws(()=>verifyTelegramInitData(raw,'wrong'),/Invalid authorization/);});
test('rejects expired initData',()=>{const raw=sign('secret',{auth_date:'1111111111',user:'{"id":1234}'});assert.throws(()=>verifyTelegramInitData(raw,'secret'),/Expired authorization/);});
test('rejects missing user data',()=>{const raw=sign('secret',{auth_date:String(Math.floor(Date.now()/1000))});assert.throws(()=>verifyTelegramInitData(raw,'secret'),/Invalid Telegram user/);});
