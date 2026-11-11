import { json, sb, computeAvailability } from './_lib.mjs';
export const config = { path: '/api/availability' };
export default async (req) => {
  const id = parseInt(new URL(req.url).searchParams.get('service'), 10);
  if (!id) return json({ error: 'service' }, 400);
  const s = await sb(`services?select=duration_min&id=eq.${id}&active=eq.true`);
  if (!s.ok || !s.data?.length) return json({ error: 'not_found' }, 404);
  return json({ days: await computeAvailability(s.data[0].duration_min) });
};
