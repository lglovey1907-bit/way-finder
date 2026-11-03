import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadPlaces, CAT, SITE } from '@/lib/seo';
import '../place.css';

export const revalidate = 3600;
export const dynamicParams = true;

async function find(id) {
  try { return (await loadPlaces()).find((a) => a.id === id) || null; } catch (_) { return null; }
}
function describe(a) {
  const c = CAT[a.cat];
  return `${a.name}${a.hi ? ' (' + a.hi + ')' : ''} – ${c.en.toLowerCase()} at New Delhi Railway Station${a.where ? ', ' + a.where : ''}.${a.note ? ' ' + a.note + '.' : ''} Get step-by-step walking directions from any gate or platform.`;
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const a = await find(id);
  if (!a) return { title: 'Place not found | NDLS Wayfinder' };
  const c = CAT[a.cat];
  const same = a.name.toLowerCase().replace(/s$/, '') === c.en.toLowerCase().replace(/s$/, '');
  const title = `${a.name}${a.where ? ' – ' + a.where : ''}${same ? '' : ' | ' + c.en} at New Delhi Railway Station (NDLS)`;
  return {
    title,
    description: describe(a).slice(0, 300),
    keywords: [...new Set([a.name, a.hi, ...a.aliases, ...a.kw, c.en, c.hi, 'New Delhi Railway Station', 'NDLS', 'नई दिल्ली रेलवे स्टेशन'].filter(Boolean))].slice(0, 60),
    alternates: { canonical: `${SITE}/place/${a.id}` },
    openGraph: { title, description: describe(a), url: `${SITE}/place/${a.id}`, type: 'website', locale: 'en_IN', siteName: 'NDLS Wayfinder' },
  };
}

export default async function Place({ params }) {
  const { id } = await params;
  const a = await find(id);
  if (!a) notFound();
  const c = CAT[a.cat];
  const open = (a.status || 'open') === 'open';
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: a.name,
    alternateName: [a.hi, ...a.aliases].filter(Boolean),
    description: describe(a),
    url: `${SITE}/place/${a.id}`,
    ...(a.lat && a.lng ? { geo: { '@type': 'GeoCoordinates', latitude: a.lat, longitude: a.lng } } : {}),
    address: { '@type': 'PostalAddress', streetAddress: ['New Delhi Railway Station', a.where].filter(Boolean).join(', '), addressLocality: 'New Delhi', postalCode: '110055', addressCountry: 'IN' },
    containedInPlace: { '@type': 'TrainStation', name: 'New Delhi Railway Station', alternateName: 'NDLS', geo: { '@type': 'GeoCoordinates', latitude: 28.6431, longitude: 77.2197 } },
    keywords: a.kw.join(', '),
  };
  return (
    <main className="pl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <header className="pl-top"><Link href="/places">← All facilities at NDLS</Link></header>
      <p className="pl-cat">{c.en} · <span lang="hi">{c.hi}</span></p>
      <h1>{a.name}</h1>
      {a.hi ? <p className="pl-hi" lang="hi">{a.hi}</p> : null}
      <dl className="pl-facts">
        <dt>Where</dt><dd>New Delhi Railway Station{a.where ? ' · ' + a.where : ''}</dd>
        {a.note ? (<><dt>Timings / note</dt><dd>{a.note}</dd></>) : null}
        <dt>Status</dt><dd>{open ? 'Open' : 'Closed right now' + (a.statusNote ? ' · ' + a.statusNote : '')}</dd>
        {a.aliases.length ? (<><dt>Also called</dt><dd>{a.aliases.join(', ')}</dd></>) : null}
      </dl>
      <a className="pl-go" href={'/?to=' + encodeURIComponent(a.id)}>Get walking directions · रास्ता देखें</a>
      <p className="pl-tip">At the station, scan the QR board near you so the route starts from where you are standing. You can also speak your destination in Hindi or English.</p>
      {a.kw.length ? <p className="pl-kw"><b>People also search:</b> {a.kw.slice(0, 30).join(' · ')}</p> : null}
    </main>
  );
}
