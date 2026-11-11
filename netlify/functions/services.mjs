import { json, sb } from './_lib.mjs';
export const config = { path: '/api/services' };
export default async () => {
  const r = await sb('services?select=id,name,price_text,duration_min&active=eq.true&order=sort.asc,id.asc');
  if (!r.ok) return json({ error: 'db' }, 500);
  return json({ services: r.data });
};
