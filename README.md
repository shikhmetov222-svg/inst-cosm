# Онлайн-запись к косметологу Зареме

- `docs/` — сайт (GitHub Pages): страница записи и `docs/admin/` — админка.
- `supabase/functions/api/index.ts` — серверная часть (Supabase Edge Function).
- База данных — Supabase (таблицы services, work_hours, closed_dates, settings, bookings).

Секреты (ADMIN_PASSWORD, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) задаются в Supabase → Edge Functions → Secrets и в коде не хранятся.
