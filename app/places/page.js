import Link from 'next/link';
import { loadPlaces, CAT, CATS, SITE } from '@/lib/seo';
import '../place/place.css';

export const revalidate = 3600;
export const metadata = {
  title: 'Facilities at New Delhi Railway Station (NDLS) – toilets, water, food, lounges, tickets | NDLS Wayfinder',
  description: 'Every passenger facility at New Delhi Railway Station with platform and pillar numbers: toilets, drinking water, food stalls, AC lounges, waiting rooms, ticket counters, ATMs, cloak room and more, in English and Hindi.',
  alternates: { canonical: SITE + '/places' },
  openGraph: { title: 'Facilities at New Delhi Railway Station', url: SITE + '/places', type: 'website', locale: 'en_IN' },
};

export default async function Places() {
  let list = [];
  try { list = await loadPlaces(); } catch (_) {}
  const groups = CATS.map((c) => [CAT[c[0]], list.filter((a) => a.cat === c[0]).sort((x, y) => x.name.localeCompare(y.name))]).filter(([, l]) => l.length);
  return (
    <main className="pl">
      <header className="pl-top"><Link href="/">← NDLS Wayfinder</Link></header>
      <h1>Facilities at New Delhi Railway Station <span lang="hi">नई दिल्ली रेलवे स्टेशन की सुविधाएँ</span></h1>
      <p className="pl-lead">{list.length} places, with where to find them. Open any place for walking directions from the QR board you are standing at.</p>
      <nav className="pl-jump">{groups.map(([c, l]) => <a key={c.id} href={'#' + c.id}>{c.en} ({l.length})</a>)}</nav>
      {groups.map(([c, l]) => (
        <section key={c.id} id={c.id}>
          <h2>{c.en} <span lang="hi">{c.hi}</span></h2>
          <ul className="pl-list">{l.map((a) => (
            <li key={a.id}><Link href={'/place/' + a.id}><b>{a.name}</b>{a.hi ? <span lang="hi"> · {a.hi}</span> : null}<small>{a.where || 'New Delhi Railway Station'}{(a.status || 'open') !== 'open' ? ' · closed now' : ''}</small></Link></li>
          ))}</ul>
        </section>
      ))}
    </main>
  );
}
