import { loadPlaces, SITE } from '@/lib/seo';
export const revalidate = 3600;
export default async function sitemap() {
  let list = [];
  try { list = await loadPlaces(); } catch (_) {}
  return [
    { url: SITE + '/', changeFrequency: 'weekly', priority: 1 },
    { url: SITE + '/places', changeFrequency: 'daily', priority: 0.9 },
    ...list.map((a) => ({ url: `${SITE}/place/${a.id}`, lastModified: a.updatedAt ? new Date(a.updatedAt) : undefined, changeFrequency: 'weekly', priority: 0.7 })),
  ];
}
