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
assets/js/relatorio.js montagem da mensagem, envio pelo WhatsApp e PDF
assets/js/metas.js    metas por loja (admin)
assets/js/etapas.js   nomes das etapas do funil (admin)
n8n/                  código do fluxo "DASH ATENDIMENTOS - Fila do painel"
assets/fonts/         Geist e Geist Mono (SIL Open Font License)
```

## Supabase

- Schema `dash_atend`: tabelas `membros` (perfil e lojas de cada login) e `eventos` (registro das ações de administração).
- Funções públicas: `atend_me`, `atend_lojas`, `atend_kpis`, `atend_serie`, `atend_por_loja`,
  `atend_vendedores`, `atend_etapas`, `atend_horarios`, `atend_automacao` (só admin),
  `atend_admin_membros`, `atend_admin_salvar_membro`, `atend_admin_remover_membro` (só admin).
- Versão 2 (`supabase/migrations/02..06`): investimento e custo por atendimento (`atend_investimento`),
  anúncios e veículos (`atend_anuncios`), metas (`dash_atend.metas`, `atend_metas`), nomes de etapas vindos do CRM
  (`dash_atend.etapa_nomes`), vendas por etapa de venda, histórico de acessos (`dash_atend.acessos`) e fila de
  envio de mensagens (`dash_atend.envios`).
- Investimento é por **empresa** (conta de anúncio do Meta), somando os atendimentos de todas as subcontas dela.
  Um membro só vê o investimento de uma empresa se tiver acesso a todas as subcontas ativas dela.
- Edge Function `atend-admin`: cria logins com senha e redefine senhas (só admin).
- A chave em `config.js` é a **publicável** (pode ficar no navegador). Nenhuma chave secreta fica no site.

## Fluxo no n8n (envio no WhatsApp e etapas)

O fluxo **DASH ATENDIMENTOS - Fila do painel (WhatsApp e etapas)** roda a cada minuto: pega as mensagens que um
admin mandou enviar pelo site (o grupo é resolvido no banco, nunca pelo navegador), envia pelo Stevo e grava
`enviado` / `falhou` / `incerto`. Mensagens sem confirmação não são reenviadas sozinhas. O mesmo passo lê os
nomes das etapas do pipeline principal no CRM uma vez por dia (ou quando o admin clica em “Sincronizar”).

## Atualização dos dados

O fluxo **GERAL - Atualizacao de todas as contas** (n8n) carrega o CRM para o banco à 01h e a cada 2 horas
das 8h às 22h (8h, 10h, …, 22h, horário de Brasília). Cada carga é incremental (desde a anterior, com 6h de folga) e usa a
trava `sync-geral-contas` (1h50) para nunca rodar duas ao mesmo tempo; se der erro, a trava é liberada na hora. Conta ativa
sem configuração completa (ex.: sem token) é pulada em vez de interromper a carga. Só a carga da madrugada dispara o
Pipeline Inteligente, que depende de crédito na OpenAI: sem crédito ele marca a conta como falha ("IA não respondeu").

## Saúde dos dados, conversão e cache

- **Administração → Saúde dos dados**: alertas por loja e o vendedor padrão (responsável usado pela carga quando o lead chega
  sem dono no CRM), mais o histórico de ações dos administradores.
- **Painel → Conversão**: leads do período que viraram venda, tempo até a venda e clientes que voltaram.
- Os números do painel ficam guardados no banco até a próxima carga (`dash_atend.cache`), então abrir o painel de novo é imediato.

## Automações (Administração → Automações)

O ADM escolhe a automação, as contas e os filtros. O pedido vai para `dash_atend.auto_execucoes` / `auto_itens` e o fluxo
**DASH ATENDIMENTOS - Automações do painel** (n8n, a cada minuto, uma execução por vez) roda conta por conta chamando o fluxo
de cada automação e grava andamento e resultado. A página mostra a barra de progresso, o tempo estimado (média das contas já
feitas, senão o histórico) e o relatório por conta. Pipeline Inteligente, Aguardando → Atendimento e Anúncio de origem têm
modo de simulação (não alteram CRM nem banco) e botão "Executar de verdade" depois da simulação.

| Automação | Fluxo do n8n | Entrada adicionada |
|---|---|---|
| Recarregar dados do GHL | ATUALIZAÇÃO MANUAL DO BANCO — SUBCONTA E PERÍODO | RECEBER DO PAINEL |
| Pipeline Inteligente | GERAL - Worker Pipeline Inteligente - Uma Subconta | dry_run, janela_dias, reanalisar |
| Aguardando → Atendimento | GERAL - Varredura Aguardando -> Atendimento | Receber do painel |
| Sincronizar etapas | (no próprio fluxo do painel) | — |
| Gravar anúncio de origem | GERAL - Anúncio de Origem no GHL | RECEBER DO PAINEL (painel, simulacao, conta) |
| Relatório com IA | Relatório Específico | RECEBER DO PAINEL / ENTRADA DO PAINEL (enviar ou só gerar) |

O código do fluxo está em `n8n/automacoes-do-painel.workflow.js` (fonte) e `n8n/automacoes-do-painel.sdk.js` (gerado).

## Plano de ação no relatório

Em **Montar relatório**, a opção "Plano de ação" (ligada por padrão) acrescenta até 5 problemas do período, cada um com o número
que o comprova e as ações sugeridas. As regras ficam em `assets/js/plano.js` e usam as metas da loja (ou 80% de SLA e
90% de resposta quando não há meta): SLA abaixo da meta ou em queda, leads sem resposta, dias sem cobertura, funil parado,
vendas não marcadas, queda de volume, custo por atendimento subindo, concentração em um vendedor, anúncios que não avançam
e, no relatório de várias lojas, quais lojas atacar primeiro. O texto pode ser editado antes de enviar.

## Esqueci minha senha

A tela de login tem "Esqueci minha senha". O link do e-mail volta para o próprio site, que pede a nova senha.
Para isso o endereço do site precisa estar em **Supabase → Authentication → URL Configuration → Redirect URLs**
(`https://bzcoo.github.io/dashboard-atendimentos-levelup/**`). Sem isso, o Supabase manda o link para a Site URL.

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
