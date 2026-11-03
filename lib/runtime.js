// Browser-side data layer. Gives the wayfinder the same small API it used as a prototype
// (window.claude.use('db' | 'user' | 'assets' | 'downloads')), backed by this app's /api routes.
const COLS = ['facilities', 'qrpoints', 'photos', 'layout', 'survey', 'indoor'];
const CACHE_KEY = 'wf-data-v1';

export function installRuntime() {
  if (window.claude && window.claude.__wf) return;
  const st = { admin: false, data: null, subs: {}, loaded: false };
  COLS.forEach((c) => (st.subs[c] = []));

  const rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
  const snap = (col) => {
    const m = (st.data && st.data[col]) || {};
    const docs = Object.keys(m).map((id) => ({ id, exists: true, data: () => m[id] }));
    return { docs, empty: !docs.length, size: docs.length };
  };
  const emit = () => COLS.forEach((c) => st.subs[c].forEach((s) => s.next(snap(c))));
  const setOffline = (on) => {
    let el = document.getElementById('offlineBadge');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'offlineBadge';
      el.className = 'offline';
      el.textContent = 'Offline · showing saved station data';
      document.body.appendChild(el);
    } else if (!on && el) el.remove();
  };

  async function refresh() {
    try {
      const r = await fetch('/api/data', { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      const next = {};
      COLS.forEach((c) => (next[c] = j[c] || {}));
      const sig = JSON.stringify(next);
      st.changed = sig !== st.sig;
      st.sig = sig;
      st.data = next;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(st.data)); } catch (e) {}
      setOffline(false);
    } catch (e) {
      if (!st.data) {
        try { const c = localStorage.getItem(CACHE_KEY); if (c) st.data = JSON.parse(c); } catch (e2) {}
      }
      if (!navigator.onLine || st.data) setOffline(true);
    }
    const first = !st.loaded;
    st.loaded = true;
    // Only re-render when something actually changed, so staff forms aren't reset mid-edit.
    if (st.data) { if (first || st.changed) emit(); }
    else COLS.forEach((c) => st.subs[c].forEach((s) => s.err && s.err({ code: 'unavailable', message: 'offline' })));
    st.changed = false;
  }

  const meP = fetch('/api/me', { cache: 'no-store' })
    .then((r) => r.json())
    .then((j) => { st.admin = !!j.admin; st.blob = !!j.blob; })
    .catch(() => { st.admin = false; });
  const firstLoad = refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh);

  async function write(method, col, id, data) {
    const r = await fetch(`/api/${col}/${encodeURIComponent(id)}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (r.status === 401 || r.status === 403) throw { code: 'invalid_argument', message: 'Staff sign-in required' };
    if (!r.ok) { const t = await r.text().catch(() => ''); throw { code: 'unavailable', status: r.status, message: t || 'HTTP ' + r.status }; }
    st.data = st.data || {};
    st.data[col] = st.data[col] || {};
    if (method === 'DELETE') delete st.data[col][id];
    else st.data[col][id] = data;
    st.sig = JSON.stringify(st.data);
    emit();
  }

  const docRef = (path) => {
    const [col, id] = path.split('/');
    return {
      id, path,
      set: (data) => write('PUT', col, id, data),
      update: (data) => write('PUT', col, id, Object.assign({}, (st.data && st.data[col] && st.data[col][id]) || {}, data)),
      delete: () => write('DELETE', col, id),
    };
  };
  const db = {
    doc: docRef,
    collection: (col) => ({
      path: col,
      doc: (id) => docRef(col + '/' + (id || rid())),
      onSnapshot(next, err) {
        const sub = { next, err };
        (st.subs[col] = st.subs[col] || []).push(sub);
        if (st.data) setTimeout(() => next(snap(col)), 0);
        else firstLoad.then(() => { if (!st.data && err) err({ code: 'unavailable' }); });
        return () => { st.subs[col] = st.subs[col].filter((s) => s !== sub); };
      },
    }),
  };

  const user = {
    canEdit: async () => { await meP; return st.admin; },
    isOwner: async () => { await meP; return st.admin; },
    can: async () => { await meP; return st.admin; },
    id: async () => { await meP; return st.admin ? 'staff' : null; },
    profiles: async (ids) => Object.fromEntries([].concat(ids).map((i) => [i, { id: i, name: i === 'staff' ? 'Staff' : '', guest: false }])),
  };

  const assets = {
    async upload(blob) {
      const fd = new FormData();
      fd.append('file', blob, 'photo.jpg');
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      if (r.status === 401) throw { code: 'not_granted', message: 'Staff sign-in required' };
      if (r.status === 413) throw { code: 'too_large', message: 'Photo too large' };
      if (!r.ok) throw { code: 'store_unavailable', message: await r.text() };
      const j = await r.json();
      return { id: j.url, url: j.url, sizeBytes: blob.size, contentType: 'image/jpeg' };
    },
    async delete(id) {
      await fetch('/api/upload?url=' + encodeURIComponent(id), { method: 'DELETE' });
    },
  };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 8000);
      return { status: 'saved' };
    },
  };

  window.claude = {
    __wf: true,
    async use(name) {
      await meP;
      if (name === 'db') return db;
      if (name === 'user') return user;
      if (name === 'downloads') return downloads;
      if (name === 'assets') return st.admin ? assets : null;
      return null;
    },
  };
}
