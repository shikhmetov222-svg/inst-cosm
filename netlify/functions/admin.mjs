import { timingSafeEqual } from 'node:crypto';
import { json, sb } from './_lib.mjs';
export const config = { path: '/api/admin' };

function authorized(req) {
  const pass = process.env.ADMIN_PASSWORD || '';
  const given = req.headers.get('x-admin-password') || '';
  if (!pass || pass.length < 6) return false;
  const a = Buffer.from(given), b = Buffer.from(pass);
  return a.length === b.length && timingSafeEqual(a, b);
}
const num = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const timeOk = (t) => /^\d{2}:\d{2}$/.test(t);

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!authorized(req)) {
    await new Promise((r) => setTimeout(r, 800)); // притормаживаем подбор пароля
    return json({ error: 'auth' }, 401);
  }
  let b;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  switch (b.action) {
    case 'load': {
      const [services, hours, closed, settings, bookings] = await Promise.all([
        sb('services?select=*&order=sort.asc,id.asc'),
        sb('work_hours?select=*&order=weekday.asc'),
        sb('closed_dates?select=*&order=day.asc'),
        sb('settings?select=*'),
        sb(`bookings?select=*&status=eq.active&end_at=gt.${encodeURIComponent(new Date().toISOString())}&order=start_at.asc`),
      ]);
      return json({
        services: services.data, hours: hours.data, closed: closed.data,
        settings: Object.fromEntries((settings.data || []).map((x) => [x.key, x.value])),
        bookings: bookings.data,
      });
    }
    case 'saveServices': {
      const list = Array.isArray(b.services) ? b.services : [];
      const keep = [];
      for (const [i, s] of list.entries()) {
        const row = {
          name: String(s.name || '').trim().slice(0, 120) || 'Без названия',
          price_text: String(s.price_text || '').trim().slice(0, 60),
          duration_min: Math.min(600, Math.max(5, num(s.duration_min, 60))),
          sort: i, active: s.active !== false,
        };
        if (s.id) { await sb(`services?id=eq.${num(s.id)}`, { method: 'PATCH', body: row }); keep.push(num(s.id)); }
        else { const r = await sb('services', { method: 'POST', prefer: 'return=representation', body: row }); if (r.data?.[0]) keep.push(r.data[0].id); }
      }
      if (keep.length) await sb(`services?id=not.in.(${keep.join(',')})`, { method: 'DELETE' });
      return json({ ok: true });
    }
    case 'saveHours': {
      for (const h of b.hours || []) {
        const wd = num(h.weekday, 0);
        if (wd < 1 || wd > 7 || !timeOk(h.start_time) || !timeOk(h.end_time)) continue;
        await sb(`work_hours?weekday=eq.${wd}`, { method: 'PATCH', body: { enabled: !!h.enabled, start_time: h.start_time, end_time: h.end_time } });
      }
      return json({ ok: true });
    }
    case 'saveSettings': {
      const s = b.settings || {};
      const rows = [
        { key: 'slot_step_min', value: String(Math.min(240, Math.max(5, num(s.slot_step_min, 30)))) },
        { key: 'days_ahead', value: String(Math.min(120, Math.max(1, num(s.days_ahead, 30)))) },
        { key: 'min_notice_hours', value: String(Math.min(168, Math.max(0, num(s.min_notice_hours, 3)))) },
      ];
      await sb('settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates', body: rows });
      return json({ ok: true });
    }
    case 'closeDate': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day || '')) return json({ error: 'bad_date' }, 400);
      await sb('closed_dates?on_conflict=day', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { day: b.day, note: String(b.note || '').slice(0, 100) } });
      return json({ ok: true });
    }
    case 'openDate': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day || '')) return json({ error: 'bad_date' }, 400);
      await sb(`closed_dates?day=eq.${b.day}`, { method: 'DELETE' });
      return json({ ok: true });
    }
    case 'cancelBooking': {
      await sb(`bookings?id=eq.${encodeURIComponent(b.id)}`, { method: 'PATCH', body: { status: 'cancelled' } });
      return json({ ok: true });
    }
    default:
      return json({ error: 'unknown_action' }, 400);
  }
};
