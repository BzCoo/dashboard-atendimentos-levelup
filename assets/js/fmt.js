/* Formatação pura (sem navegador): usada pelo site e pela função do servidor que monta o relatório agendado */
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
