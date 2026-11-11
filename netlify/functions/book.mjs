import { json, sb, computeAvailability, toInstant, notifyTelegram, escapeHtml, humanDate } from './_lib.mjs';
export const config = { path: '/api/book' };

function normalizeContact(type, raw) {
  const nick = String(raw || '').trim().replace(/^https?:\/\/(www\.)?(t\.me|instagram\.com)\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
  if (!/^[A-Za-z0-9_.]{2,32}$/.test(nick)) return null;
  if (type !== 'telegram' && type !== 'instagram') return null;
  return { type, nick, text: `${type === 'telegram' ? 'Telegram' : 'Instagram'}: @${nick}` };
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const name = String(b.name || '').trim().slice(0, 80);
  const contact = normalizeContact(b.contactType, b.contact);
  const date = String(b.date || '');
  const time = String(b.time || '');
  const serviceId = parseInt(b.serviceId, 10);
  if (!name) return json({ error: 'name', message: 'Укажите имя' }, 400);
  if (!contact) return json({ error: 'contact', message: 'Проверьте ник: латиница, цифры, _ и точка' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !serviceId) return json({ error: 'bad_request' }, 400);

  const s = await sb(`services?select=*&id=eq.${serviceId}&active=eq.true`);
  if (!s.ok || !s.data?.length) return json({ error: 'service' }, 404);
  const svc = s.data[0];

  // Слот должен быть в списке реально свободных (учитывает часы, закрытые даты, занятость)
  const avail = await computeAvailability(svc.duration_min);
  if (!(avail[date] || []).includes(time)) return json({ error: 'taken', message: 'Это время уже занято' }, 409);

  const start = toInstant(date, time);
  const end = new Date(start.getTime() + svc.duration_min * 60000);
  const ins = await sb('bookings', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      service_id: svc.id, service_name: svc.name, client_name: name, contact: contact.text,
      start_at: start.toISOString(), end_at: end.toISOString(),
    },
  });
  // 23P01 = сработала защита базы от пересечения записей
  if (ins.status === 409 || ins.data?.code === '23P01') return json({ error: 'taken', message: 'Это время уже занято' }, 409);
  if (!ins.ok) return json({ error: 'db' }, 500);

  const link = contact.type === 'telegram' ? `https://t.me/${contact.nick}` : `https://instagram.com/${contact.nick}`;
  await notifyTelegram(
    `<b>Новая запись</b>\n\n` +
    `Процедура: ${escapeHtml(svc.name)} (${svc.duration_min} мин, ${escapeHtml(svc.price_text)})\n` +
    `Когда: ${humanDate(date)}, ${time}\n` +
    `Клиент: ${escapeHtml(name)}\n` +
    `Контакт: <a href="${link}">${escapeHtml(contact.text)}</a>`
  );
  return json({ ok: true, booking: { service: svc.name, date, time, durationMin: svc.duration_min, price: svc.price_text, dateHuman: humanDate(date) } });
};
