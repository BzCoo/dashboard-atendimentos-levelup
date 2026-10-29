import { sb, $, $$, clone, rpc, toast, lerRota, irPara, trocarFiltros, LOGO, RETORNO_AUTH, URL_SITE } from './core.js?v=202610291203';
import { renderPainel } from './painel.js?v=202610291203';
import { renderAcessos } from './acessos.js?v=202610291203';
import { renderRelatorio } from './relatorio.js?v=202610291203';
import { renderMetas } from './metas.js?v=202610291203';
import { renderEtapas } from './etapas.js?v=202610291203';

const PAGINAS_ADM = { acessos: ['Acessos', renderAcessos], relatorio: ['Montar relatório', renderRelatorio], metas: ['Metas', renderMetas], etapas: ['Etapas do funil', renderEtapas] };

const app = $('#app');
let ctx = null;          // { me, admin, filtros, trocar }
let limpar = null;       // limpeza da página atual
let shellPronto = false;
let logoN = 0;

const pintarLogos = (root) => $$('.slot-logo', root).forEach((s) => {
  s.outerHTML = LOGO('lu-logo-' + (++logoN), s.closest('.lu-login-head') ? 'lu-logo-xl' : 'lu-mark');
});

/* ---------- Animação de entrada ao rolar ---------- */
let io;
const revelar = (root) => {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  app.classList.add('lu-anim');
  io ??= new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  const els = $$('.lu-reveal', root);
  els.forEach((x) => io.observe(x));
  setTimeout(() => els.forEach((x) => x.classList.add('is-in')), 2600);
};

/* ---------- Login ---------- */
const limparEndereco = () => history.replaceState(null, '', location.pathname + '#/painel');
const ERROS_LINK = { otp_expired: 'Este link expirou ou já foi usado. Peça um novo abaixo.', access_denied: 'Este link não é mais válido. Peça um novo abaixo.' };

const telaLogin = (modo = 'login', aviso = '') => {
  shellPronto = false; ctx = null;
  app.replaceChildren(clone('tpl-login'));
  pintarLogos(app);
  const form = $('#f-login'), msg = $('.lu-msg', form), btn = $('button[type=submit]', form);
  const fEsq = $('#f-esqueci'), fNova = $('#f-nova-senha'), intro = $('.lu-login-head p');
  const mostrar = (qual) => {
    form.hidden = qual !== 'login'; fEsq.hidden = qual !== 'esqueci'; fNova.hidden = qual !== 'nova';
    intro.textContent = qual === 'esqueci' ? 'Recuperar o acesso' : qual === 'nova' ? 'Criar nova senha' : 'Entre com o e-mail e a senha que você recebeu.';
    const alvo = $('input', qual === 'login' ? form : qual === 'esqueci' ? fEsq : fNova);
    if (alvo && matchMedia('(pointer: fine)').matches) alvo.focus();
  };
  $('.act-esqueci', form).addEventListener('click', () => { fEsq.email.value = form.email.value.trim(); mostrar('esqueci'); });
  $('.act-voltar', fEsq).addEventListener('click', () => mostrar('login'));
  fEsq.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('.lu-msg', fEsq), b = $('button[type=submit]', fEsq), email = fEsq.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { m.className = 'lu-msg erro'; m.textContent = 'Digite um e-mail válido.'; m.hidden = false; return; }
    b.disabled = true; b.textContent = 'Enviando…';
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: URL_SITE });
    b.disabled = false; b.textContent = 'Enviar link';
    if (error && /rate|seconds|limit/i.test(error.message)) { m.className = 'lu-msg erro'; m.textContent = 'Muitos pedidos seguidos. Espere alguns minutos e tente de novo.'; m.hidden = false; return; }
    if (error) { m.className = 'lu-msg erro'; m.textContent = 'Não foi possível enviar agora: ' + error.message; m.hidden = false; return; }
    m.className = 'lu-msg ok'; m.textContent = 'Pronto. Se ' + email + ' tiver acesso, o link chega em alguns minutos (confira também o spam). Ele vale por 1 hora.'; m.hidden = false;
  });
  fNova.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('.lu-msg', fNova), b = $('button[type=submit]', fNova);
    const erro = (t) => { m.textContent = t; m.hidden = false; };
    if (fNova.senha.value.length < 8) return erro('A senha precisa ter pelo menos 8 caracteres.');
    if (fNova.senha.value !== fNova.senha2.value) return erro('As senhas não conferem.');
    b.disabled = true; b.textContent = 'Salvando…';
    const { error } = await sb.auth.updateUser({ password: fNova.senha.value });
    b.disabled = false; b.textContent = 'Salvar e entrar';
    if (error) return erro(/same|different/i.test(error.message) ? 'A nova senha precisa ser diferente da anterior.' : /session|JWT|expired/i.test(error.message) ? 'O link expirou. Peça um novo em "Esqueci minha senha".' : 'Não foi possível salvar: ' + error.message);
    toast('Senha criada. Bem-vindo de volta!');
    limparEndereco();
    await iniciar();
  });
  if (modo !== 'login') mostrar(modo);
  if (aviso) { msg.textContent = aviso; msg.hidden = false; }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim(), senha = form.senha.value;
    if (!email || !senha) { msg.textContent = 'Preencha e-mail e senha.'; msg.hidden = false; return; }
    msg.hidden = true; btn.disabled = true; btn.textContent = 'Entrando…';
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    btn.disabled = false; btn.textContent = 'Entrar';
    if (error) {
      msg.textContent = /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar: ' + error.message;
      msg.hidden = false; form.senha.select(); return;
    }
    await iniciar();
  });
  if (matchMedia('(pointer: fine)').matches) form.email.focus();
};

const sair = async () => { await sb.auth.signOut(); history.replaceState(null, '', location.pathname); telaLogin(); };

/* ---------- Estrutura com navegação ---------- */
const montarShell = () => {
  app.replaceChildren(clone('tpl-shell'));
  pintarLogos(app);
  const { me, admin } = ctx;
  $$('[data-admin]', app).forEach((n) => { n.hidden = !admin; });
  $$('#nav-secoes [data-multi]', app).forEach((n) => { n.hidden = (me.lojas || []).length <= 1; });
  $('.slot-inicial', app).textContent = (me.nome || me.email || '?').trim().charAt(0).toUpperCase();
  $('.slot-nome', app).textContent = me.nome || 'Sua conta';
  $('.slot-email', app).textContent = me.email || '';

  // Menus suspensos
  const menus = $$('.lu-menu', app);
  const fecharMenus = (exceto) => menus.forEach((m) => { if (m === exceto) return; $('button', m).setAttribute('aria-expanded', 'false'); $('.lu-pop', m).hidden = true; });
  menus.forEach((m) => {
    const b = $('button', m), pop = $('.lu-pop', m);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const abrir = pop.hidden; fecharMenus(m);
      pop.hidden = !abrir; b.setAttribute('aria-expanded', String(abrir));
      if (abrir) $('[role=menuitem]', pop)?.focus();
    });
    pop.addEventListener('keydown', (e) => {
      const itens = $$('[role=menuitem]', pop), i = itens.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); itens[(i + 1) % itens.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); itens[(i - 1 + itens.length) % itens.length].focus(); }
      if (e.key === 'Escape') { fecharMenus(); b.focus(); }
    });
    pop.addEventListener('click', (e) => { if (e.target.closest('[role=menuitem]')) fecharMenus(); });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.lu-menu')) fecharMenus(); });

  // Links de rota (mantêm os filtros)
  app.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-rota]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault(); irPara(a.dataset.rota, ctx.filtros);
  });
  // Seções do painel
  $('#nav-secoes', app).addEventListener('click', (e) => {
    const a = e.target.closest('a[data-go]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const ir = () => { const alvo = document.getElementById(a.dataset.go); alvo?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
    if (lerRota().rota !== 'painel') { irPara('painel', ctx.filtros); setTimeout(ir, 400); } else ir();
  });

  $('.act-sair', app).addEventListener('click', sair);
  $('.act-senha', app).addEventListener('click', () => {
    const d = $('#dlg-minha-senha'), f = $('#f-minha-senha'), msg = $('.lu-msg', f);
    f.reset(); msg.hidden = true; d.showModal();
    $('.act-cancelar', d).onclick = () => d.close();
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.senha.value.length < 8) { msg.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; msg.hidden = false; return; }
      if (f.senha.value !== f.senha2.value) { msg.textContent = 'As senhas não conferem.'; msg.hidden = false; return; }
      const { error } = await sb.auth.updateUser({ password: f.senha.value });
      if (error) { msg.textContent = 'Não foi possível trocar a senha: ' + error.message; msg.hidden = false; return; }
      d.close(); toast('Senha alterada.');
    };
  });
  shellPronto = true;
};

/* ---------- Rotas ---------- */
const rotear = async () => {
  if (!ctx) return;
  const { rota, secao, filtros } = lerRota();
  // membros de loja só podem pedir lojas permitidas (o banco também bloqueia)
  if (filtros.conta && !ctx.me.lojas.some((l) => Number(l.loja_id) === filtros.conta)) filtros.conta = null;
  ctx.filtros = filtros;
  const destino = PAGINAS_ADM[rota] && ctx.admin ? rota : 'painel';
  if (!shellPronto) montarShell();
  limpar?.(); limpar = null;
  const main = $('#conteudo', app);
  $$('.btn-admin', app).forEach((b) => b.classList.toggle('on', destino !== 'painel'));
  $$('#nav-secoes a', app).forEach((a) => a.removeAttribute('aria-current'));
  document.title = (PAGINAS_ADM[destino]?.[0] || 'Painel') + ' · Dashboard de Atendimentos · Level Up';
  try {
    if (PAGINAS_ADM[destino]) {
      const p = PAGINAS_ADM[destino][1](main, ctx);
      revelar(main); window.scrollTo({ top: 0 });
      const l = await p; if (typeof l === 'function') limpar = l;
      return;
    } else {
      const p = renderPainel(main, ctx);
      revelar(main);
      if (secao) requestAnimationFrame(() => document.getElementById(secao)?.scrollIntoView({ block: 'start' }));
      limpar = await p;
      return;
    }
  } catch (e) { toast(e.message, true); }
  revelar(main);
  window.scrollTo({ top: 0 });
};

/* ---------- Início ---------- */
let retorno = RETORNO_AUTH;
const iniciar = async () => {
  const { data: { session } } = await sb.auth.getSession();
  // Volta do e-mail de recuperação: pede a nova senha antes de abrir o painel
  if (retorno) {
    const r = retorno; retorno = null;
    if (r.tipo === 'recovery' && session) return telaLogin('nova');
    limparEndereco();
    if (r.tipo === 'erro') { telaLogin('esqueci'); const m = $('#f-esqueci .lu-msg'); m.className = 'lu-msg erro'; m.textContent = ERROS_LINK[r.codigo] || ('Não foi possível usar o link: ' + (r.texto || r.codigo)); m.hidden = false; return; }
  }
  if (!session) return telaLogin();
  let me;
  try { me = await rpc('atend_me'); }
  catch (e) { if (/sessão|JWT/i.test(e.message)) { await sb.auth.signOut(); return telaLogin(); } toast(e.message, true); return; }
  if (!me) {
    shellPronto = false;
    app.replaceChildren(clone('tpl-sem-acesso'));
    pintarLogos(app);
    $('.slot-email', app).textContent = session.user.email;
    $('.act-sair', app).addEventListener('click', sair);
    return;
  }
  me.lojas = me.lojas || [];
  rpc('atend_registrar_acesso').catch(() => {});
  let metas = null;
  try { metas = await rpc('atend_metas'); } catch { /* metas são opcionais */ }
  ctx = { me, metas, admin: me.papel === 'admin', filtros: lerRota().filtros, trocar: (mud) => trocarFiltros(lerRota().rota === 'relatorio' ? 'relatorio' : 'painel', { ...ctx.filtros, ...mud }) };
  shellPronto = false;
  await rotear();
};

window.addEventListener('hashchange', rotear);
sb.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT' && ctx) { ctx = null; telaLogin(); } });
iniciar();
