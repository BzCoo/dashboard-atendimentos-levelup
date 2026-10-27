import { $, $$, el, clone, rpc, funcaoAdmin, fmt, toast, copiar, gerarSenha } from './core.js?v=202610271521';

const SITE = () => location.origin + location.pathname;

const abrir = (dlg) => { dlg.showModal(); const f = $('input:not([type=hidden]):not([type=radio]), select', dlg); if (f && window.matchMedia('(pointer: fine)').matches) f.focus(); };
const fechar = (dlg) => dlg.close();
const erroEm = (form, texto) => { const m = $('.lu-msg.erro', form); m.textContent = texto || ''; m.hidden = !texto; };
const ocupado = (form, sim) => { const b = $('button[type=submit]', form); b.disabled = sim; b.dataset.label ??= b.textContent; b.textContent = sim ? 'Salvando…' : b.dataset.label; };

// Liga botões "Cancelar" e "Gerar" dos diálogos uma única vez
let ligado = false;
const ligarDialogos = () => {
  if (ligado) return; ligado = true;
  $$('.lu-dialog').forEach((d) => {
    $$('.act-cancelar, .act-fechar', d).forEach((b) => b.addEventListener('click', () => fechar(d)));
    $$('.act-gerar-senha', d).forEach((b) => b.addEventListener('click', () => { const i = b.parentElement.querySelector('input'); i.value = gerarSenha(); i.focus(); i.select(); }));
    d.addEventListener('click', (e) => { if (e.target === d) fechar(d); });
  });
};

export const renderAcessos = async (main, ctx) => {
  ligarDialogos();
  main.replaceChildren(clone('tpl-acessos'));
  const tbody = $('#tb-membros tbody', main);
  const busca = $('.q-membros', main);
  let membros = [];
  const todasLojas = ctx.me.lojas; // admin vê todas

  const draw = () => {
    const termo = busca.value.trim().toLowerCase();
    const r = membros.filter((m) => !termo || [m.nome, m.email, ...(m.lojas_nomes || [])].join(' ').toLowerCase().includes(termo));
    $('.slot-total', main).textContent = membros.length + (membros.length === 1 ? ' acesso' : ' acessos') + ' · ' + membros.filter((m) => m.papel === 'admin').length + ' administrador(es)';
    if (!r.length) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt muted', colspan: 6, text: termo ? 'Nada encontrado.' : 'Nenhum acesso criado ainda.' }))); return; }
    tbody.replaceChildren(...r.map((m) => el('tr', { 'data-id': m.id },
      el('td', { class: 'txt name' }, el('div', { text: m.nome || '—' }), el('div', { class: 'muted', style: 'font-weight:400;font-size:12px', text: m.email + (m.eu ? ' · você' : '') })),
      el('td', { class: 'txt' }, el('span', { class: 'lu-badge' + (m.papel === 'admin' ? ' admin' : ''), text: m.papel === 'admin' ? 'Administrador' : 'Membro de loja' })),
      el('td', { class: 'txt' }, m.papel === 'admin' ? el('span', { class: 'muted', text: 'Todas as lojas' }) : el('div', { class: 'lu-chips' }, ...(m.lojas_nomes || []).map((n) => el('span', { text: n })))),
      el('td', { class: 'mono hide-sm', text: m.ultimo_acesso ? fmt.dt(m.ultimo_acesso) : 'nunca entrou' }),
      el('td', { class: 'txt' }, el('span', { class: 'lu-badge' + (m.ativo ? '' : ' off'), text: m.ativo ? 'Ativo' : 'Bloqueado' })),
      el('td', {}, el('div', { class: 'lu-actions' },
        el('button', { type: 'button', class: 'lu-ghost sm', 'data-act': 'editar', text: 'Editar' }),
        el('button', { type: 'button', class: 'lu-ghost sm', 'data-act': 'senha', text: 'Senha' }),
        m.eu ? null : el('button', { type: 'button', class: 'lu-ghost sm danger', 'data-act': 'remover', text: 'Remover' }))),
    )));
  };
  const carregar = async () => {
    tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt sk', colspan: 6, text: 'Carregando…' })));
    try { membros = await rpc('atend_admin_membros') || []; draw(); }
    catch (e) { tbody.replaceChildren(el('tr', {}, el('td', { class: 'txt', colspan: 6 }, el('div', { class: 'lu-fail', text: e.message })))); }
  };
  busca.addEventListener('input', draw);

  /* ---- Formulário de acesso (novo / editar) ---- */
  const dlg = $('#dlg-membro'), form = $('#f-membro');
  const lista = $('.f-lojas', form), filtroLojas = $('.f-lojas-q', form);
  const contagem = $('.f-contagem', form);
  const atualizarContagem = () => {
    const n = $$('input[name=lojas]:checked', form).length;
    contagem.replaceChildren(n ? el('b', { text: String(n) }) : '', n === 0 ? 'Nenhuma selecionada' : n === 1 ? ' loja selecionada' : ' lojas selecionadas');
  };
  const montarLojas = (marcadas) => {
    lista.replaceChildren(...todasLojas.map((l) => el('label', { 'data-nome': String(l.loja).toLowerCase(), title: String(l.loja) },
      el('input', { type: 'checkbox', class: 'lu-check', name: 'lojas', value: l.loja_id, checked: marcadas.includes(Number(l.loja_id)) }),
      el('span', { text: String(l.loja) }))),
      el('p', { class: 'vazio', hidden: true, text: 'Nenhuma loja encontrada.' }));
    atualizarContagem();
  };
  lista.addEventListener('change', atualizarContagem);
  filtroLojas.oninput = () => {
    const t = filtroLojas.value.trim().toLowerCase();
    let vis = 0;
    $$('label', lista).forEach((l) => { l.hidden = !!t && !l.dataset.nome.includes(t); if (!l.hidden) vis++; });
    const v = $('.vazio', lista); if (v) v.hidden = vis > 0;
  };
  const marcarVisiveis = (sim) => { $$('label:not([hidden]) input[name=lojas]', lista).forEach((i) => { i.checked = sim; }); atualizarContagem(); };
  $('.act-todas', form).onclick = () => marcarVisiveis(true);
  $('.act-nenhuma', form).onclick = () => marcarVisiveis(false);
  const papelAtual = () => $('input[name=papel]:checked', form).value;
  const syncPapel = () => { $('.f-lojas-box', form).hidden = papelAtual() === 'admin'; };
  $$('input[name=papel]', form).forEach((r) => { r.onchange = syncPapel; });

  let editando = null;
  const abrirForm = (m) => {
    editando = m || null;
    form.reset(); erroEm(form, ''); filtroLojas.value = '';
    $('#dlg-membro-t').textContent = m ? 'Editar acesso' : 'Novo acesso';
    form.nome.value = m?.nome || '';
    form.email.value = m?.email || ''; form.email.readOnly = !!m;
    $(`input[name=papel][value=${m?.papel || 'loja'}]`, form).checked = true;
    montarLojas((m?.lojas || []).map(Number));
    filtroLojas.oninput();
    $('.f-senha-box', form).hidden = !!m;
    form.senha.value = m ? '' : gerarSenha();
    $('.f-ativo-box', form).hidden = !m;
    form.ativo.checked = m ? !!m.ativo : true;
    syncPapel();
    abrir(dlg);
  };
  $('.act-novo', main).addEventListener('click', () => abrirForm(null));

  form.onsubmit = async (e) => {
    e.preventDefault();
    const papel = papelAtual();
    const lojas = $$('input[name=lojas]:checked', form).map((i) => Number(i.value));
    const nome = form.nome.value.trim(), email = form.email.value.trim().toLowerCase(), senha = form.senha.value.trim();
    if (!nome) return erroEm(form, 'Informe o nome.');
    if (!editando && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erroEm(form, 'Informe um e-mail válido.');
    if (papel === 'loja' && !lojas.length) return erroEm(form, 'Marque ao menos uma loja.');
    if (!editando && senha.length < 8) return erroEm(form, 'A senha inicial precisa ter pelo menos 8 caracteres.');
    erroEm(form, ''); ocupado(form, true);
    try {
      if (editando) {
        await rpc('atend_admin_salvar_membro', { p_id: editando.id, p_nome: nome, p_papel: papel, p_lojas: lojas, p_ativo: form.ativo.checked });
        fechar(dlg); toast('Acesso atualizado.');
      } else {
        const r = await funcaoAdmin({ acao: 'criar', nome, email, papel, lojas, senha });
        fechar(dlg);
        const nomesLojas = papel === 'admin' ? 'Todas (administrador)' : todasLojas.filter((l) => lojas.includes(Number(l.loja_id))).map((l) => l.loja).join(', ');
        const cred = `Acesso ao Dashboard de Atendimentos – Level Up\n\nSite: ${SITE()}\nE-mail: ${email}\n` +
          (r.ja_existia ? 'Senha: a mesma que você já usa nos painéis da Level Up\n' : `Senha: ${senha}\n`) +
          `Lojas: ${nomesLojas}\n\nDepois de entrar, você pode trocar a senha no menu da sua conta.`;
        const dc = $('#dlg-cred');
        $('.lu-cred', dc).textContent = cred;
        $('.act-copiar-cred', dc).onclick = () => copiar(cred);
        abrir(dc);
      }
      await carregar();
    } catch (err) { erroEm(form, err.message); }
    finally { ocupado(form, false); }
  };

  /* ---- Redefinir senha ---- */
  const dlgS = $('#dlg-senha'), formS = $('#f-senha');
  let alvoSenha = null;
  formS.onsubmit = async (e) => {
    e.preventDefault();
    const senha = formS.senha.value.trim();
    if (senha.length < 8) return erroEm(formS, 'A senha precisa ter pelo menos 8 caracteres.');
    erroEm(formS, ''); ocupado(formS, true);
    try {
      await funcaoAdmin({ acao: 'senha', membro_id: alvoSenha.id, senha });
      fechar(dlgS);
      const cred = `Nova senha do Dashboard de Atendimentos – Level Up\n\nSite: ${SITE()}\nE-mail: ${alvoSenha.email}\nSenha: ${senha}`;
      const dc = $('#dlg-cred');
      $('#dlg-cred-t').textContent = 'Senha redefinida';
      $('.lu-cred', dc).textContent = cred;
      $('.act-copiar-cred', dc).onclick = () => copiar(cred);
      abrir(dc);
    } catch (err) { erroEm(formS, err.message); }
    finally { ocupado(formS, false); }
  };

  /* ---- Remover ---- */
  const dlgC = $('#dlg-confirma');

  tbody.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const m = membros.find((x) => x.id === b.closest('tr').dataset.id); if (!m) return;
    if (b.dataset.act === 'editar') abrirForm(m);
    if (b.dataset.act === 'senha') {
      alvoSenha = m; formS.reset(); erroEm(formS, '');
      $('.slot-quem', dlgS).textContent = (m.nome || m.email) + ' · ' + m.email + '. A pessoa vai entrar com a nova senha a partir de agora.';
      formS.senha.value = gerarSenha(); abrir(dlgS);
    }
    if (b.dataset.act === 'remover') {
      $('.slot-texto', dlgC).textContent = `${m.nome || m.email} perde o acesso ao painel. O login dela continua existindo (pode ser usado em outros painéis da Level Up) e você pode liberar de novo depois.`;
      $('.act-ok', dlgC).onclick = async () => {
        try { await rpc('atend_admin_remover_membro', { p_id: m.id }); fechar(dlgC); toast('Acesso removido.'); await carregar(); }
        catch (err) { fechar(dlgC); toast(err.message, true); }
      };
      abrir(dlgC);
    }
  });

  $('#dlg-cred').addEventListener('close', () => { $('#dlg-cred-t').textContent = 'Acesso pronto'; $('.lu-cred', $('#dlg-cred')).textContent = ''; }, { once: false });
  await carregar();
};
