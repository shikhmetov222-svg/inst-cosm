// Общие помощники: доступ к базе, время Махачкалы (UTC+3, без перехода на летнее время), расчёт свободных слотов.
const TZ = '+03:00';
const TZ_MS = 3 * 3600 * 1000;

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Не заданы SUPABASE_URL / SUPABASE_SERVICE_KEY');
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

const pad = (n) => String(n).padStart(2, '0');
export const todayLocal = () => new Date(Date.now() + TZ_MS).toISOString().slice(0, 10);
export const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const weekdayOf = (ymd) => ((new Date(ymd + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1; // 1=Пн..7=Вс
const toMin = (t) => { const [h, m] = t.split(':'); return +h * 60 + +m; };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const toInstant = (ymd, hm) => new Date(`${ymd}T${hm}:00${TZ}`);

export async function loadSettings() {
  const r = await sb('settings?select=key,value');
  const s = Object.fromEntries((r.data || []).map((x) => [x.key, x.value]));
  return {
    step: Math.max(5, parseInt(s.slot_step_min || '30', 10)),
    daysAhead: Math.min(120, Math.max(1, parseInt(s.days_ahead || '30', 10))),
    notice: Math.max(0, parseInt(s.min_notice_hours || '3', 10)),
  };
}

// Возвращает { 'YYYY-MM-DD': ['10:00', '10:30', ...] } для процедуры длительностью durationMin
export async function computeAvailability(durationMin) {
  const settings = await loadSettings();
  const from = todayLocal();
  const to = addDays(from, settings.daysAhead);
  const [hoursR, closedR, bookR] = await Promise.all([
    sb('work_hours?select=*'),
    sb(`closed_dates?select=day&day=gte.${from}&day=lte.${to}`),
    sb(`bookings?select=start_at,end_at&status=eq.active&end_at=gt.${encodeURIComponent(new Date().toISOString())}`),
  ]);
  const hours = Object.fromEntries((hoursR.data || []).map((h) => [h.weekday, h]));
  const closed = new Set((closedR.data || []).map((c) => c.day));
  const busy = (bookR.data || []).map((b) => [Date.parse(b.start_at), Date.parse(b.end_at)]);
  const earliest = Date.now() + settings.notice * 3600 * 1000;
  const out = {};
  for (let i = 0; i <= settings.daysAhead; i++) {
    const day = addDays(from, i);
    const h = hours[weekdayOf(day)];
    out[day] = [];
    if (!h || !h.enabled || closed.has(day)) continue;
    const start = toMin(h.start_time.slice(0, 5));
    const end = toMin(h.end_time.slice(0, 5));
    for (let m = start; m + durationMin <= end; m += settings.step) {
      const t0 = toInstant(day, fromMin(m)).getTime();
      const t1 = t0 + durationMin * 60000;
      if (t0 < earliest) continue;
      if (busy.some(([a, b]) => t0 < b && t1 > a)) continue;
      out[day].push(fromMin(m));
    }
  }
  return out;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export async function notifyTelegram(html) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, reason: 'telegram not configured' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return { ok: r.ok };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

export const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export const DOW = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
export function humanDate(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${DOW[d.getUTCDay()]}`;
}
