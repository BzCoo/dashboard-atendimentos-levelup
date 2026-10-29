import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, FUNCAO_ADMIN } from './config.js?v=202610291301';

/* Volta do link de "Esqueci minha senha": lido antes do Supabase limpar o endereço */
export const RETORNO_AUTH = (() => {
  const p = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  if (p.get('type') === 'recovery' && p.get('access_token')) return { tipo: 'recovery' };
  if (p.get('error_code') || p.get('error')) return { tipo: 'erro', codigo: p.get('error_code') || p.get('error'), texto: p.get('error_description') || '' };
  return null;
})();
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'lu-atendimentos-auth' },
});
export const URL_SITE = location.origin + location.pathname;

/* ---------- Formatação ---------- */
// Cores dos gráficos via variáveis do CSS: acompanham o tema claro/escuro sem redesenhar
export const ACC = 'var(--lu-chart)', PREV = 'var(--lu-prev)', GRID = 'rgba(var(--lu-ov), .06)', DEEP = 'var(--lu-chart-deep)', MUTED = 'var(--lu-ink3)';
export const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const fDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const fDiaAno = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const fSem = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const asDate = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00Z');
export const fmt = {
  int: (v) => (isNum(v) ? nf0.format(Number(v)) : '—'),
  pct: (v) => (isNum(v) ? nf1.format(Number(v)) + '%' : '—'),
  min: (v) => (isNum(v) ? nf1.format(Number(v)) + ' min' : '—'),
  num1: (v) => (isNum(v) ? nf1.format(Number(v)) : '—'),
  brl: (v) => (isNum(v) ? brl.format(Number(v)) : '—'),
  brl0: (v) => (isNum(v) ? brl0.format(Number(v)) : '—'),
  dm: (s) => (s ? fDia.format(asDate(s)) : '—'),
  dmy: (s) => (s ? fDiaAno.format(asDate(s)) : '—'),
  wdm: (s) => (s ? fSem.format(asDate(s)) : '—'),
  dt: (s) => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d) ? String(s) : fHora.format(d).replace(',', ' ·');
  },
  /* variação com sinal: kind 'pct' | 'pp' | 'min' | 'abs' */
  sinal: (v, kind) => {
    if (!isNum(v)) return '—';
    const n = Number(v), a = Math.abs(n);
    const s = n > 0 ? '+' : n < 0 ? '−' : '±';
    return s + (kind === 'pct' ? nf1.format(a) + '%' : kind === 'pp' ? nf1.format(a) + ' p.p.' : kind === 'min' ? nf1.format(a) + ' min' : kind === 'brl' ? brl.format(a) : nf0.format(a));
  },
};
export const delta = (el, v, kind, better) => {
  el.classList.remove('good', 'bad');
  el.textContent = fmt.sinal(v, kind);
  if (isNum(v) && Number(v) !== 0 && better) el.classList.add((Number(v) > 0) === (better === 'up') ? 'good' : 'bad');
};

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
};
export const clone = (id) => document.getElementById(id).content.cloneNode(true);

let toastTimer;
export const toast = (texto, erro = false) => {
  let t = $('.lu-toast');
  if (!t) { t = el('div', { class: 'lu-toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.className = 'lu-toast' + (erro ? ' erro' : '');
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
};

export const copiar = async (texto) => {
  try { await navigator.clipboard.writeText(texto); toast('Copiado.'); }
  catch { toast('Não foi possível copiar. Selecione o texto e copie manualmente.', true); }
};

/* ---------- Dados ---------- */
const traduzErro = (e) => {
  const m = String(e?.message || e || '');
  if (/nao permitida/i.test(m)) return 'Você não tem acesso a esta loja.';
  if (/nao autorizado/i.test(m)) return 'Seu login não tem acesso a este painel.';
  if (/Somente administradores/i.test(m)) return 'Somente administradores podem fazer isso.';
  if (/JWT|token/i.test(m)) return 'Sua sessão expirou. Entre novamente.';
  return m || 'Não foi possível carregar os dados.';
};
/* Se o token de acesso venceu (ex.: PC voltou da suspensão antes da renovação automática),
   renova a sessão uma vez e repete a chamada, em vez de mandar a pessoa para o login */
let renovando = null;
const renovar = () => (renovando ??= sb.auth.refreshSession().finally(() => { renovando = null; }));
export const rpc = async (nome, args = {}) => {
  let { data, error } = await sb.rpc(nome, args);
  if (error && /JWT|token/i.test(String(error.message || ''))) {
    const r = await renovar();
    if (!r.error && r.data?.session) ({ data, error } = await sb.rpc(nome, args));
  }
  if (error) throw new Error(traduzErro(error));
  return data;
};
export const funcaoAdmin = async (body) => {
  const { data, error } = await sb.functions.invoke(FUNCAO_ADMIN, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.erro) msg = j.erro; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
};

/* ---------- Período ---------- */
export const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const iso = (d) => d.toISOString().slice(0, 10);
export const addDias = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const PRESETS = [
  ['7', 'Últimos 7 dias'], ['semana', 'Semana passada (seg–dom)'], ['14', 'Últimos 14 dias'],
  ['30', 'Últimos 30 dias'], ['mes', 'Este mês'], ['mes_ant', 'Mês passado'], ['custom', 'Personalizado'],
];
export const intervalo = (p) => {
  const h = hoje();
  if (p === '7' || p === '14' || p === '30') { const n = Number(p); return [addDias(h, -n), addDias(h, -1)]; }
  if (p === 'semana') { const d = new Date(h + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; const seg = addDias(h, -dow - 7); return [seg, addDias(seg, 6)]; }
  if (p === 'mes') { const ini = h.slice(0, 8) + '01'; return [ini, h === ini ? h : addDias(h, -1)]; }
  if (p === 'mes_ant') { const ini = h.slice(0, 8) + '01'; const fim = addDias(ini, -1); return [fim.slice(0, 8) + '01', fim]; }
  return null;
};
export const presetDe = (a, b) => { for (const [p] of PRESETS) { const r = intervalo(p); if (r && r[0] === a && r[1] === b) return p; } return 'custom'; };
const DATA_OK = /^20\d{2}-[01]\d-[0-3]\d$/;

/* ---------- Estado na URL (#/rota?loja=..&de=..&ate=..) ---------- */
export const lerRota = () => {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(qs || '');
  const padrao = intervalo('7');
  let de = q.get('de'), ate = q.get('ate');
  if (!DATA_OK.test(de || '') || !DATA_OK.test(ate || '')) [de, ate] = padrao;
  if (de > ate) [de, ate] = [ate, de];
  const loja = Number(q.get('loja'));
  const cmp = ['mes', 'ano'].includes(q.get('cmp')) ? q.get('cmp') : 'anterior';
  return { rota: (path || 'painel').split('/')[0], secao: (path || '').split('/')[1] || null, vendedor: q.get('v') || null,
    filtros: { inicio: de, fim: ate, conta: Number.isInteger(loja) && loja > 0 ? loja : null, comparar: cmp } };
};
export const irPara = (rota, filtros, secao, extra) => {
  const q = new URLSearchParams();
  if (filtros?.conta) q.set('loja', filtros.conta);
  if (filtros?.inicio) q.set('de', filtros.inicio);
  if (filtros?.fim) q.set('ate', filtros.fim);
  if (filtros?.comparar && filtros.comparar !== 'anterior') q.set('cmp', filtros.comparar);
  for (const [k, v] of Object.entries(extra || {})) if (v) q.set(k, v);
  const h = '#/' + rota + (secao ? '/' + secao : '') + (q.toString() ? '?' + q : '');
  if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = h;
};
export const trocarFiltros = (rota, filtros) => {
  const q = new URLSearchParams();
  if (filtros.conta) q.set('loja', filtros.conta);
  q.set('de', filtros.inicio); q.set('ate', filtros.fim);
  if (filtros.comparar && filtros.comparar !== 'anterior') q.set('cmp', filtros.comparar);
  const v = lerRota().vendedor; if (rota === 'vendedor' && v) q.set('v', v);
  location.hash = '#/' + rota + '?' + q;
};

export const gerarSenha = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const a = new Uint32Array(12); crypto.getRandomValues(a);
  return [...a].map((n) => chars[n % chars.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
};

export const LOGO = (id, cls = 'lu-mark') =>
  `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><defs><radialGradient id="${id}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#3d6b14"/><stop offset=".65" stop-color="#1c2c0f"/><stop offset="1" stop-color="#121a0c"/></radialGradient></defs><circle cx="24" cy="24" r="20.5" fill="url(#${id})" stroke="#80ff00" stroke-width="3.2"/><path d="M15.5 31.5L24 14.5l8.5 17" fill="none" stroke="#80ff00" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* Meta aplicável: da loja filtrada, senão a padrão. Retorna objeto ou null. */
export const metaPara = (metas, lojaId) => {
  if (!metas) return null;
  const l = lojaId ? metas.lojas?.[String(lojaId)] : null;
  const p = metas.padrao || null;
  if (!l && !p) return null;
  const pega = (k) => (l && l[k] !== null && l[k] !== undefined ? l[k] : p ? p[k] : null);
  return { meta_sla: pega('meta_sla'), meta_resposta: pega('meta_resposta'), meta_tempo_min: pega('meta_tempo_min'), meta_custo_atend: pega('meta_custo_atend') };
};
/* Situação frente à meta: 'ok' | 'bad' | null. menorMelhor para tempo e custo. */
export const frenteMeta = (valor, meta, menorMelhor = false) => {
  if (!isNum(valor) || !isNum(meta)) return null;
  return (menorMelhor ? Number(valor) <= Number(meta) : Number(valor) >= Number(meta)) ? 'ok' : 'bad';
};

/* Período de comparação */
export const COMPARAR = [['anterior', 'Período anterior'], ['mes', 'Mesmos dias do mês passado'], ['ano', 'Mesmos dias do ano passado']];
export const rotuloComp = (c) => (c === 'mes' ? 'mês passado' : c === 'ano' ? 'ano passado' : 'anterior');

/* Planilha (.csv, separador ; e BOM para o Excel em português) a partir de uma tabela da tela */
export const baixarCsv = (table, nome) => {
  const esc = (v) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const cab = [...table.querySelectorAll('thead th')].map((th) => th.textContent.replace(/[↑↓]/g, '').trim());
  const linhas = [...table.querySelectorAll('tbody tr')].filter((tr) => tr.children.length === cab.length)
    .map((tr) => [...tr.children].map((td) => esc(td.dataset.csv ?? td.textContent)).join(';'));
  if (!linhas.length) { toast('Não há linhas para baixar.', true); return; }
  const blob = new Blob(['\ufeff' + [cab.map(esc).join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: nome.replace(/[^\w.-]+/g, '-').toLowerCase() + '.csv' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* Tema claro / escuro / automático (guardado só neste navegador) */
export const temaSalvo = () => { try { return localStorage.getItem('lu-tema') || 'escuro'; } catch { return 'escuro'; } };
export const aplicarTema = (t) => {
  const escuro = t === 'escuro' || (t === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = escuro ? 'dark' : 'light';
  try { localStorage.setItem('lu-tema', t); } catch { /* sem armazenamento */ }
  window.dispatchEvent(new Event('lu-tema'));
};
