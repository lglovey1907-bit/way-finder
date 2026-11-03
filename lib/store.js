// Data store, in order of preference:
//   1. Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) — free plan, no card needed
//   2. Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)
//   3. A local JSON file in .data/ so the app runs on a laptop with no setup.
import { Redis } from '@upstash/redis';
import fs from 'fs';
import path from 'path';
import seed from './seed.json';
import { supabase } from './supabase';

export const COLS = ['facilities', 'qrpoints', 'photos', 'layout', 'survey', 'indoor'];
const rUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const rToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = !supabase && rUrl && rToken ? new Redis({ url: rUrl, token: rToken }) : null;
const key = (c) => 'wf:' + c;
const TABLE = 'wf_docs';

export const storeMode = () => (supabase ? 'supabase' : redis ? 'redis' : 'local');

// ---------- local file ----------
const FILE = path.join(process.cwd(), '.data', 'store.json');
let mem = null;
function local() {
  if (!mem) {
    try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { mem = JSON.parse(JSON.stringify(seed)); }
    COLS.forEach((c) => (mem[c] = mem[c] || {}));
  }
  return mem;
}
const localCol = (c) => { const m = local(); return (m[c] = m[c] || {}); };
function saveLocal() {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(mem, null, 1)); }
  catch { /* read-only filesystem: keep in memory only */ }
}

// ---------- Supabase ----------
let sbSeeded = false;
async function seedSupabaseOnce() {
  if (sbSeeded) return;
  const { data, error } = await supabase.from(TABLE).select('id').eq('col', '_meta').eq('id', 'seeded').maybeSingle();
  if (error) throw new Error('Supabase: ' + error.message + ' (did you run supabase-setup.sql?)');
  if (!data) {
    const rows = [];
    for (const c of COLS) for (const [id, d] of Object.entries(seed[c] || {})) rows.push({ col: c, id, data: d });
    if (rows.length) {
      const r = await supabase.from(TABLE).upsert(rows, { onConflict: 'col,id', ignoreDuplicates: true });
      if (r.error) throw new Error('Supabase seed: ' + r.error.message);
    }
    await supabase.from(TABLE).upsert({ col: '_meta', id: 'seeded', data: { at: new Date().toISOString() } }, { onConflict: 'col,id' });
  }
  sbSeeded = true;
}

// ---------- Redis ----------
async function seedRedisOnce() {
  const first = await redis.set('wf:seeded', new Date().toISOString(), { nx: true });
  if (first !== 'OK') return;
  for (const c of COLS) if (seed[c] && Object.keys(seed[c]).length) await redis.hset(key(c), seed[c]);
}

// ---------- API ----------
export async function getAll() {
  if (supabase) {
    await seedSupabaseOnce();
    const out = {};
    COLS.forEach((c) => (out[c] = {}));
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(TABLE).select('col,id,data').in('col', COLS).order('col').order('id').range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data) out[r.col][r.id] = r.data;
      if (data.length < 1000) break;
    }
    return out;
  }
  if (redis) {
    await seedRedisOnce();
    const p = redis.pipeline();
    COLS.forEach((c) => p.hgetall(key(c)));
    const res = await p.exec();
    const out = {};
    COLS.forEach((c, i) => {
      const h = res[i] || {};
      out[c] = {};
      for (const k of Object.keys(h)) out[c][k] = typeof h[k] === 'string' ? JSON.parse(h[k]) : h[k];
    });
    return out;
  }
  const m = local(), out = {};
  COLS.forEach((c) => (out[c] = m[c] || {}));
  return out;
}

export async function putDoc(col, id, data) {
  if (supabase) {
    const { error } = await supabase.from(TABLE).upsert({ col, id, data, updated_at: new Date().toISOString() }, { onConflict: 'col,id' });
    if (error) throw new Error(error.message);
    return;
  }
  if (redis) { await redis.hset(key(col), { [id]: data }); return; }
  localCol(col)[id] = data; saveLocal();
}

export async function deleteDoc(col, id) {
  if (supabase) {
    const { error } = await supabase.from(TABLE).delete().eq('col', col).eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  if (redis) { await redis.hdel(key(col), id); return; }
  delete localCol(col)[id]; saveLocal();
}

// ---------- private collections (staff accounts, duty log, passenger feedback) ----------
// These live in the same table under their own `col` names. They are never part of COLS,
// so /api/data never sends them to browsers; only the routes in app/api/u, duty, fb read them.
export async function getDoc(col, id) {
  if (supabase) {
    const { data, error } = await supabase.from(TABLE).select('data').eq('col', col).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? data.data : null;
  }
  if (redis) { const v = await redis.hget(key(col), id); return v == null ? null : typeof v === 'string' ? JSON.parse(v) : v; }
  const v = localCol(col)[id];
  return v ? JSON.parse(JSON.stringify(v)) : null;
}

// List a collection, newest id first. opts: { gte, lt } id range, { eq: { field: value } } on the JSON, limit.
export async function listDocs(col, opts = {}) {
  const limit = opts.limit || 5000;
  const eq = opts.eq || {};
  if (supabase) {
    const out = [];
    for (let from = 0; out.length < limit; from += 1000) {
      let q = supabase.from(TABLE).select('id,data').eq('col', col);
      if (opts.gte) q = q.gte('id', opts.gte);
      if (opts.lt) q = q.lt('id', opts.lt);
      for (const [f, v] of Object.entries(eq)) q = q.eq('data->>' + f, String(v));
      const { data, error } = await q.order('id', { ascending: false }).range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data) out.push({ id: r.id, ...r.data });
      if (data.length < 1000) break;
    }
    return out.slice(0, limit);
  }
  let rows;
  if (redis) {
    const h = (await redis.hgetall(key(col))) || {};
    rows = Object.entries(h).map(([id, v]) => ({ id, ...(typeof v === 'string' ? JSON.parse(v) : v) }));
  } else rows = Object.entries(localCol(col)).map(([id, v]) => ({ id, ...JSON.parse(JSON.stringify(v)) }));
  return rows
    .filter((r) => (!opts.gte || r.id >= opts.gte) && (!opts.lt || r.id < opts.lt))
    .filter((r) => Object.entries(eq).every(([f, v]) => String(r[f]) === String(v)))
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .slice(0, limit);
}
