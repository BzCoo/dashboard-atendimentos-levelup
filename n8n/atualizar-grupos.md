# DASH ATENDIMENTOS - Atualizar grupos do WhatsApp (n8n XoOycElRObyIwrQE)

Antigo "ID Grupos WhatsApp". Mantém a lista de grupos de CRM do painel (dash_atend.grupos_crm) em dia.

Gatilhos
- **Botao do painel**: webhook POST `/webhook/dash-atend-grupos` (CORS só para https://bzcoo.github.io).
  O site manda `{"token": <access_token do login>}` como text/plain (sem preflight).
  O nó **Conferir se e ADM** chama `atend_admin_destinos` com o token do usuário: só ADM passa.
- **A cada 2 horas**: `17 7-21/2 * * *`.
- Manual (botão do editor).

Fluxo: Listar grupos no Stevo (HTTP `group/list`, chave no próprio nó; não versionar) →
Salvar grupos no painel (`atend_service_salvar_grupos` com a service key do ambiente) → Responder ao painel.

`atend_service_salvar_grupos` guarda só grupos com "CRM" no nome, liga cada um à empresa pelo nome
(`dash_atend.mapear_grupo`) e desativa os que sumiram do WhatsApp.
