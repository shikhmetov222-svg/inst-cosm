// Серверная часть записи к Зареме (Supabase Edge Function).
// Секреты (задаются в панели Supabase): ADMIN_PASSWORD, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет автоматически.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TZ = "+03:00"; // Махачкала, без перехода на летнее время
const TZ_MS = 3 * 3600 * 1000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-admin-password, authorization, apikey",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// deno-lint-ignore no-explicit-any
type Any = any;

async function sb(path: string, opts: { method?: string; body?: unknown; prefer?: string } = {}) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: opts.method ?? "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(opts.prefer ? { prefer: opts.prefer } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data: Any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

const pad = (n: number) => String(n).padStart(2, "0");
const todayLocal = () => new Date(Date.now() + TZ_MS).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (ymd: string) => ((new Date(ymd + "T00:00:00Z").getUTCDay() + 6) % 7) + 1; // 1=Пн..7=Вс
const toMin = (t: string) => { const [h, m] = t.split(":"); return +h * 60 + +m; };
const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const toInstant = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00${TZ}`);

const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const DOW = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
const humanDate = (ymd: string) => {
  const d = new Date(ymd + "T00:00:00Z");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${DOW[d.getUTCDay()]}`;
};
const escapeHtml = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function loadSettings() {
  const r = await sb("settings?select=key,value");
  const s: Record<string, string> = Object.fromEntries((r.data || []).map((x: Any) => [x.key, x.value]));
  return {
    step: Math.max(5, parseInt(s.slot_step_min || "30", 10)),
    daysAhead: Math.min(120, Math.max(1, parseInt(s.days_ahead || "30", 10))),
    notice: Math.max(0, parseInt(s.min_notice_hours || "3", 10)),
  };
}

async function computeAvailability(durationMin: number) {
  const settings = await loadSettings();
  const from = todayLocal();
  const to = addDays(from, settings.daysAhead);
  const [hoursR, closedR, bookR] = await Promise.all([
    sb("work_hours?select=*"),
    sb(`closed_dates?select=day&day=gte.${from}&day=lte.${to}`),
    sb(`bookings?select=start_at,end_at&status=eq.active&end_at=gt.${encodeURIComponent(new Date().toISOString())}`),
  ]);
  const hours: Record<number, Any> = Object.fromEntries((hoursR.data || []).map((h: Any) => [h.weekday, h]));
  const closed = new Set((closedR.data || []).map((c: Any) => c.day));
  const busy: [number, number][] = (bookR.data || []).map((b: Any) => [Date.parse(b.start_at), Date.parse(b.end_at)]);
  const earliest = Date.now() + settings.notice * 3600 * 1000;
  const out: Record<string, string[]> = {};
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

async function notifyTelegram(html: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch (_) { /* запись уже сохранена, сбой уведомления не должен ломать её */ }
}

function normalizeContact(type: string, raw: string) {
  const nick = String(raw || "").trim().replace(/^https?:\/\/(www\.)?(t\.me|instagram\.com)\//i, "").replace(/^@/, "").replace(/\/.*$/, "");
  if (!/^[A-Za-z0-9_.]{2,32}$/.test(nick)) return null;
  if (type !== "telegram" && type !== "instagram") return null;
  return { type, nick, text: `${type === "telegram" ? "Telegram" : "Instagram"}: @${nick}` };
}

function safeEqual(a: string, b: string) {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
const num = (v: unknown, d?: number) => (Number.isFinite(parseInt(String(v), 10)) ? parseInt(String(v), 10) : d as number);
const timeOk = (t: string) => /^\d{2}:\d{2}$/.test(t);
const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

async function handleBook(req: Request) {
  let b: Any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const name = String(b.name || "").trim().slice(0, 80);
  const contact = normalizeContact(b.contactType, b.contact);
  const date = String(b.date || "");
  const time = String(b.time || "");
  const serviceId = parseInt(b.serviceId, 10);
  if (!name) return json({ error: "name", message: "Укажите имя" }, 400);
  if (!contact) return json({ error: "contact", message: "Проверьте ник: латиница, цифры, _ и точка" }, 400);
  if (!dateOk(date) || !/^\d{2}:\d{2}$/.test(time) || !serviceId) return json({ error: "bad_request" }, 400);

  const s = await sb(`services?select=*&id=eq.${serviceId}&active=eq.true`);
  if (!s.ok || !s.data?.length) return json({ error: "service" }, 404);
  const svc = s.data[0];

  const avail = await computeAvailability(svc.duration_min);
  if (!(avail[date] || []).includes(time)) return json({ error: "taken", message: "Это время уже занято" }, 409);

  const start = toInstant(date, time);
  const end = new Date(start.getTime() + svc.duration_min * 60000);
  const ins = await sb("bookings", {
    method: "POST",
    prefer: "return=representation",
    body: {
      service_id: svc.id, service_name: svc.name, client_name: name, contact: contact.text,
      start_at: start.toISOString(), end_at: end.toISOString(),
    },
  });
  // 23P01: сработала защита базы от пересечения записей
  if (ins.status === 409 || ins.data?.code === "23P01") return json({ error: "taken", message: "Это время уже занято" }, 409);
  if (!ins.ok) return json({ error: "db" }, 500);

  const link = contact.type === "telegram" ? `https://t.me/${contact.nick}` : `https://instagram.com/${contact.nick}`;
  await notifyTelegram(
    `<b>Новая запись</b>\n\n` +
    `Процедура: ${escapeHtml(svc.name)} (${svc.duration_min} мин, ${escapeHtml(svc.price_text)})\n` +
    `Когда: ${humanDate(date)}, ${time}\n` +
    `Клиент: ${escapeHtml(name)}\n` +
    `Контакт: <a href="${link}">${escapeHtml(contact.text)}</a>`,
  );
  return json({ ok: true, booking: { service: svc.name, date, time, durationMin: svc.duration_min, price: svc.price_text, dateHuman: humanDate(date) } });
}

async function handleAdmin(req: Request) {
  const pass = Deno.env.get("ADMIN_PASSWORD") || "";
  const given = req.headers.get("x-admin-password") || "";
  if (pass.length < 6 || !safeEqual(given, pass)) {
    await new Promise((r) => setTimeout(r, 800)); // притормаживаем подбор пароля
    return json({ error: "auth" }, 401);
  }
  let b: Any;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  switch (b.action) {
    case "load": {
      const [services, hours, closed, settings, bookings] = await Promise.all([
        sb("services?select=*&order=sort.asc,id.asc"),
        sb("work_hours?select=*&order=weekday.asc"),
        sb("closed_dates?select=*&order=day.asc"),
        sb("settings?select=*"),
        sb(`bookings?select=*&status=eq.active&end_at=gt.${encodeURIComponent(new Date().toISOString())}&order=start_at.asc`),
      ]);
      return json({
        services: services.data, hours: hours.data, closed: closed.data,
        settings: Object.fromEntries((settings.data || []).map((x: Any) => [x.key, x.value])),
        bookings: bookings.data,
      });
    }
    case "saveServices": {
      const list: Any[] = Array.isArray(b.services) ? b.services : [];
      const keep: number[] = [];
      for (const [i, s] of list.entries()) {
        const row = {
          name: String(s.name || "").trim().slice(0, 120) || "Без названия",
          price_text: String(s.price_text || "").trim().slice(0, 60),
          duration_min: Math.min(600, Math.max(5, num(s.duration_min, 60))),
          sort: i, active: s.active !== false,
        };
        if (s.id) { await sb(`services?id=eq.${num(s.id)}`, { method: "PATCH", body: row }); keep.push(num(s.id)); }
        else { const r = await sb("services", { method: "POST", prefer: "return=representation", body: row }); if (r.data?.[0]) keep.push(r.data[0].id); }
      }
      if (keep.length) await sb(`services?id=not.in.(${keep.join(",")})`, { method: "DELETE" });
      return json({ ok: true });
    }
    case "saveHours": {
      for (const h of b.hours || []) {
        const wd = num(h.weekday, 0);
        if (wd < 1 || wd > 7 || !timeOk(h.start_time) || !timeOk(h.end_time)) continue;
        await sb(`work_hours?weekday=eq.${wd}`, { method: "PATCH", body: { enabled: !!h.enabled, start_time: h.start_time, end_time: h.end_time } });
      }
      return json({ ok: true });
    }
    case "saveSettings": {
      const s = b.settings || {};
      const rows = [
        { key: "slot_step_min", value: String(Math.min(240, Math.max(5, num(s.slot_step_min, 30)))) },
        { key: "days_ahead", value: String(Math.min(120, Math.max(1, num(s.days_ahead, 30)))) },
        { key: "min_notice_hours", value: String(Math.min(168, Math.max(0, num(s.min_notice_hours, 3)))) },
      ];
      await sb("settings?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates", body: rows });
      return json({ ok: true });
    }
    case "closeDate": {
      if (!dateOk(b.day)) return json({ error: "bad_date" }, 400);
      await sb("closed_dates?on_conflict=day", { method: "POST", prefer: "resolution=merge-duplicates", body: { day: b.day, note: String(b.note || "").slice(0, 100) } });
      return json({ ok: true });
    }
    case "openDate": {
      if (!dateOk(b.day)) return json({ error: "bad_date" }, 400);
      await sb(`closed_dates?day=eq.${b.day}`, { method: "DELETE" });
      return json({ ok: true });
    }
    case "cancelBooking": {
      await sb(`bookings?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", body: { status: "cancelled" } });
      return json({ ok: true });
    }
    default:
      return json({ error: "unknown_action" }, 400);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop();
  try {
    if (route === "services" && req.method === "GET") {
      const r = await sb("services?select=id,name,price_text,duration_min&active=eq.true&order=sort.asc,id.asc");
      return r.ok ? json({ services: r.data }) : json({ error: "db" }, 500);
    }
    if (route === "availability" && req.method === "GET") {
      const id = parseInt(url.searchParams.get("service") || "", 10);
      if (!id) return json({ error: "service" }, 400);
      const s = await sb(`services?select=duration_min&id=eq.${id}&active=eq.true`);
      if (!s.ok || !s.data?.length) return json({ error: "not_found" }, 404);
      return json({ days: await computeAvailability(s.data[0].duration_min) });
    }
    if (route === "book" && req.method === "POST") return await handleBook(req);
    if (route === "admin" && req.method === "POST") return await handleAdmin(req);
    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "server" }, 500);
  }
});
