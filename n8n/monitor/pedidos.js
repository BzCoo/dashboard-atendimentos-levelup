// Um item por pedido pendente (ligar/desligar)
const p = $('Pegar catalogo e pedidos').first().json.pedidos || [];
return p.map((x) => ({ json: x }));
