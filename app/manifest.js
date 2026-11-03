export default function manifest() {
  return {
    id: '/',
    name: 'NDLS Wayfinder · New Delhi Railway Station',
    short_name: 'NDLS Wayfinder',
    description: 'Scan a station QR code and get directions to lounges, waiting rooms, toilets, platforms and more.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#E8EBE5',
    theme_color: '#18212B',
    lang: 'en-IN',
    categories: ['travel', 'navigation'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Scan a station QR', short_name: 'Scan', url: '/#scan' },
    ],
  };
}
