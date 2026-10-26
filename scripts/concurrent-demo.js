'use strict';

const base = process.env.BASE_URL || 'http://localhost:3000';

async function login(login, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });
  if (!res.ok) throw new Error(`login ${login} failed`);
  return res.json();
}

async function book(token, body, key) {
  const res = await fetch(`${base}/api/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

function nextSlot() {
  const now = Date.now();
  const start = new Date(Math.ceil((now + 36 * 60 * 60 * 1000) / (30 * 60 * 1000)) * (30 * 60 * 1000));
  const mskHour = new Date(start.getTime() + 3 * 60 * 60 * 1000).getUTCHours();
  if (mskHour < 8 || mskHour >= 20) start.setTime(start.getTime() + 12 * 60 * 60 * 1000);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString()
  };
}

async function main() {
  const pass = process.env.DEMO_USER_PASSWORD || 'User12345';
  const a = await login('ivan', pass);
  const b = await login('maria', pass);
  const slot = nextSlot();
  const [ra, rb] = await Promise.all([
    book(a.token, { resourceId: 'res-pc-04', purpose: 'Конкурентная проверка Ивана', ...slot }, crypto.randomUUID()),
    book(b.token, { resourceId: 'res-pc-04', purpose: 'Конкурентная проверка Марии', ...slot }, crypto.randomUUID())
  ]);
  console.log(JSON.stringify({ slot, first: ra, second: rb }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });