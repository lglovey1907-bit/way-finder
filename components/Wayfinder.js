'use client';
import { useEffect } from 'react';
import { MARKUP } from './markup';

export default function Wayfinder() {
  useEffect(() => {
    if (window.__wfBooted) return;
    window.__wfBooted = true;
    (async () => {
      const [three, qr, zip] = await Promise.all([import('three'), import('qrcode-generator'), import('jszip')]);
      window.THREE = three;
      window.qrcode = qr.default || qr;
      window.JSZip = zip.default || zip;
      const { installRuntime } = await import('../lib/runtime');
      installRuntime();
      const { boot } = await import('../lib/wayfinder-app');
      boot();
      const { initScanner } = await import('../lib/scanner');
      initScanner();
    })();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return <div dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
