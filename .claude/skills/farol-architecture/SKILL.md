---
name: farol-architecture
description: Regras de arquitetura da API do Farol (back, Fastify/TypeScript). Use ANTES de criar ou alterar rotas, services, regras de métricas, chamadas ao Taiga, autenticação/sessão, cache, configuração (variáveis de ambiente), contrato da API ou testes do back. Garante que a evolução não quebre as camadas, a segurança nem o contrato com o front.
---

# Farol · arquitetura do back (API / BFF)

O back consulta o Taiga com um **usuário de serviço**, aplica as regras de negócio e entrega ao front os dados **já calculados**. O front só desenha. Ele roda **dentro do cluster**, sem `Route`: só o front o alcança (`NetworkPolicy` + `x-api-key`).

```
routes  →  services  →  infra  (Taiga, sessão, limites, links)
   ↘          ↘
          domain  (regras puras: métricas, papéis, períodos)
```

## Camadas (quem pode depender de quem)

| Camada | Pode | Não pode |
|---|---|---|
| `routes/` | validar entrada, exigir sessão, chamar `services`/funções nomeadas da `infra`, compor a resposta (pode aplicar uma função **pura** de `domain`, como `paceOf`) | consultar o Taiga direto (`taigaGet`), conter regra de negócio, usar `fetch` |
| `services/` | orquestrar várias chamadas à `infra` e aplicar `domain` | importar `routes` ou `fastify`, conhecer HTTP (req/reply) |
| `domain/` | funções **puras** (entram dados, saem dados) | `fetch`, Fastify, importar **código** da infra (só `import type`), efeitos colaterais |
| `infra/` | falar com o Taiga, sessão, limites, cache, links | importar `routes` ou `services` |

Regra de negócio nova (métrica, classificação, critério) vai em **`domain/`** com teste unitário. Nunca no front e nunca dentro de uma rota.

## Invariantes (não negocie sem avisar o usuário)

1. **Só `infra/taiga.ts` fala com o Taiga.** Use `taigaGet`/`taigaGetPaged` (já trazem semáforo de concorrência, timeout, retentativas e renovação do token). Para dado novo, crie uma função **nomeada** nesse arquivo (ex.: `getMilestones`) e use-a nos services. O Taiga é **somente leitura**: só `GET`; o único `POST` permitido é `/auth` e `/auth/refresh` do usuário de serviço.
2. **Toda rota de dados exige sessão**: `requireSession(req, reply)` primeiro. Toda rota que receba um **projeto** (`:id` ou `?project=`) passa por `guardProject()`. O usuário de serviço enxerga mais do que deve aparecer; esse guard é a única barreira.
3. **Detalhe de item confere o dono.** Qualquer dado buscado por id (story, task, anexo…) precisa ser verificado como pertencente ao projeto já autorizado (veja `loadItem` → `ItemNotFound`). Trocar o `?project=` não pode abrir outro projeto.
4. **Quem vê o quê:** toda pessoa autenticada vê os projetos de que o **usuário de serviço é membro**, e só eles. Não existe filtro por perfil de acesso (decisão tomada). `DEV_ROLES` só filtra quais papéis viram **cards** na sprint (exibição), não acesso.
5. **Sessão guarda só identidade** (`Session`), nunca token do Taiga nem segredo. O login hoje valida credenciais no Taiga; **vai migrar para AD** (aguardando especificação). Mantenha a prova de identidade **isolada em `routes/auth.ts`** e não espalhe a suposição de que `userId` é um id do Taiga em código novo.
6. **Erros:** sempre `{ "error": "CODIGO" }`, sem detalhe interno. Erros do Taiga viram `TaigaError` e são traduzidos em `app.ts`. Código novo ⇒ documente em `docs/API.md` e trate no front (`app/page.tsx` e `api-error.tsx`).
7. **Respostas** levam `Cache-Control: no-store` (já é hook global). Não remova.
8. **Logs** são JSON via `req.log`/`app.log`. Nunca logue senha, token, `x-api-key`, nem corpo de login. Dados de pessoas só quando indispensável.
9. **Estado em memória** (sessões, limitadores, caches) vive em `globalThis` e roda em **uma réplica**. Todo estado novo precisa de **limite** (TTL e/ou teto de itens) e deve ser registrado em `docs/MELHORIAS-PENDENTES.md` como candidato ao Redis. Cache de dados do Taiga é **por projeto, nunca por pessoa** (o usuário de serviço devolve o mesmo para todos).
10. **Carga sobre o Taiga:** cada requisição nossa vira várias ao Taiga. Faça em paralelo (`Promise.all`), páginas com `taigaGetPaged` quando o volume for grande, e evite chamar por item dentro de laço sem limite. Rota que dispare muitas chamadas por ação do usuário precisa de cache ou limite.
11. **Configuração:** variável nova ⇒ `.env.example` + tabela do `README.md` + `deploy/openshift/configmap.yaml` (não sensível) **ou** `secret.example.yaml` (sensível). Nunca valor real no repositório. Segredo não tem padrão no código. O `.env.local` é só de desenvolvimento e nunca entra na imagem.
12. **Dados de desempenho individual são sensíveis (LGPD).** A decisão de governança ainda está em aberto. Funcionalidade nova que exponha números **por pessoa** deve ser sinalizada ao usuário antes de implementar.

## Contrato com o front (duas cópias!)

O contrato é descrito em `docs/API.md` e **copiado à mão** em `lib/api/types.ts` no front. Ao mudar a resposta de uma rota:
1. ajuste o código do back e o `docs/API.md`;
2. ajuste `lib/api/types.ts` **no front** e a tela que usa;
3. atualize `scripts/mock-taiga.mjs` se o dado novo vem de um endpoint do Taiga, para os testes cobrirem;
4. acrescente o caso em `tests/api/` e, se houver tela, em `frontend/tests/e2e/`.
Campo novo na resposta é seguro; renomear/remover é mudança incompatível: avise o usuário.

## Receita: nova rota que mostra dados de um projeto

1. Função nomeada em `infra/taiga.ts` (tipos `T*` só com os campos usados).
2. Regra em `domain/` (pura) + teste em `tests/unit/`.
3. Orquestração em `services/` (sem Fastify).
4. Rota em `routes/`: `requireSession` → `guardProject` → service → resposta. Registre em `app.ts`.
5. Teste de API em `tests/api/` (use `startStack`; `login` para sessão, `sessionAs()` para pessoa comum) cobrindo: 401 sem sessão, 400 id inválido, 403 projeto fora da lista, sucesso, falha do Taiga.
6. `docs/API.md`, tipos do front, E2E se houver tela.

## Verificação (obrigatória antes de dar por pronto)

- `npm test` (typecheck + testes). **Rode pelo PowerShell/terminal do VS Code**: no Git Bash o Vitest falha de forma intermitente neste ambiente.
- `tests/unit/architecture.test.ts` faz parte da suíte e barra: `domain` impuro, `services`/`infra` dependendo de camada acima, `fetch`/`/api/v1` fora de `infra/taiga.ts`, rota sem `requireSession`, rota de projeto sem `guardProject`, `taigaGet` direto em rota, escrita no Taiga, segredo em log. **Se ele falhar, corrija o código, não o teste.** Só altere o teste junto com esta skill, quando a regra mudar de verdade.
- Mudou algo que o front consome? Rode também o E2E do front: `BACK_DIR=<pasta do back> npm run e2e` (no front). Em máquina com pouca memória use `NODE_OPTIONS=--max-old-space-size=4096`.

## Dívidas conhecidas (não copie o padrão)

- `services/item-detail.ts` usa `any` (resposta do Taiga sem validação); código novo deve tipar (a meta é validar com zod).
- Variáveis de ambiente lidas em vários arquivos; a meta é um `config.ts` central.
- `console.error/warn` em `infra/` (prefira `req.log` onde houver requisição).
- Sessões e limitadores só em memória (uma réplica), previsto Redis.
- Login provisório até a integração com AD.

## Pare e pergunte ao usuário quando a mudança

- precisar quebrar uma regra acima ou o contrato de forma incompatível;
- adicionar dependência nova (o projeto é enxuto de propósito: Fastify e pouco mais);
- escrever no Taiga, expor a API fora do cluster, guardar token/segredo na sessão, ou mostrar dado individual de pessoas de outra forma;
- criar estado compartilhado entre réplicas.
