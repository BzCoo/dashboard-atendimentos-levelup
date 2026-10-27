# Dashboard de Atendimentos · Level Up

Site estático com login para acompanhar os atendimentos das lojas. Os dados vêm ao vivo do
Supabase (`metrics_dev`), então o painel atualiza sozinho a cada carga do banco.

## Quem vê o quê

| Perfil | Vê | Pode |
|---|---|---|
| **Administrador** | Todas as lojas, comparativo entre lojas e saúde da automação | Criar e editar acessos, redefinir senhas, montar relatórios |
| **Membro de loja** | Só as lojas marcadas no acesso dele | Ver o painel e trocar a própria senha |

A restrição por loja é feita **no banco**: todas as consultas passam por funções `public.atend_*`
(`SECURITY DEFINER`) que conferem o usuário logado em `dash_atend.membros`. Mesmo que alguém
altere o site ou a URL, não consegue dados de uma loja que não é dela.

## Estrutura

```
index.html            telas (login, painel, acessos, montar relatório) em <template>
assets/base.css       visual Level Up (cores, cards, tabelas, gráficos)
assets/app.css        login, menus, diálogos, relatório
assets/js/config.js   URL e chave publicável do Supabase
assets/js/core.js     cliente Supabase, formatação, rotas e filtros na URL
assets/js/painel.js   indicadores, gráficos e tabelas
assets/js/charts.js   gráficos (d3)
assets/js/acessos.js  administração de acessos
assets/js/relatorio.js montagem da mensagem no formato do WhatsApp
assets/fonts/         Geist e Geist Mono (SIL Open Font License)
```

## Supabase

- Schema `dash_atend`: tabelas `membros` (perfil e lojas de cada login) e `eventos` (registro das ações de administração).
- Funções públicas: `atend_me`, `atend_lojas`, `atend_kpis`, `atend_serie`, `atend_por_loja`,
  `atend_vendedores`, `atend_etapas`, `atend_horarios`, `atend_automacao` (só admin),
  `atend_admin_membros`, `atend_admin_salvar_membro`, `atend_admin_remover_membro` (só admin).
- Edge Function `atend-admin`: cria logins com senha e redefine senhas (só admin).
- A chave em `config.js` é a **publicável** (pode ficar no navegador). Nenhuma chave secreta fica no site.

## Publicar

É um site estático: funciona em GitHub Pages, Vercel, Netlify ou qualquer hospedagem.
No GitHub Pages: *Settings → Pages → Deploy from a branch → `main` / root*.

## Atualizações e cache do navegador

O `index.html` carrega CSS e JS com `?v=<versão>` (e os módulos se importam com a mesma versão),
para que cada navegador (Chrome, Opera GX, Edge…) baixe os arquivos novos a cada publicação.
Ao mudar CSS ou JS, troque a versão em todos os pontos de uma vez:

```bash
V=$(date +%Y%m%d%H%M); sed -i -E "s/\?v=[0-9]+/?v=$V/g" index.html assets/js/*.js
```
