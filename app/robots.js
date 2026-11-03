import { SITE } from '@/lib/seo';
export default function robots() {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/staff', '/control', '/duty'] }], sitemap: SITE + '/sitemap.xml' };
}
