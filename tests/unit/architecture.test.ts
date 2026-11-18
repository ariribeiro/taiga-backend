import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regras estruturais da arquitetura (veja .claude/skills/farol-architecture/SKILL.md).
 * São verificações simples sobre o texto dos arquivos: servem para o CI barrar violações óbvias,
 * não para substituir a revisão. Se uma regra precisar mudar, mude a skill e este teste juntos.
 */
const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const read = (dir: string) =>
  readdirSync(join(SRC, dir)).filter((f) => f.endsWith(".ts")).map((f) => ({ file: `${dir}/${f}`, text: readFileSync(join(SRC, dir, f), "utf8") }));
const all = ["domain", "infra", "routes", "services", "."].flatMap((d) => (d === "." ? readdirSync(SRC).filter((f) => f.endsWith(".ts")).map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") })) : read(d)));
const imports = (text: string) => [...text.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => ({ typeOnly: !!m[1], from: m[2] }));

describe("arquitetura do back", () => {
  it("domain é puro: sem Fastify, sem fetch e só importa tipos da infra", () => {
    for (const { file, text } of read("domain")) {
      expect(text, `${file} usa fetch`).not.toMatch(/\bfetch\(/);
      for (const i of imports(text)) {
        expect(i.from, `${file} importa o Fastify`).not.toBe("fastify");
        if (/infra|routes|services/.test(i.from)) expect(i.typeOnly, `${file} importa código (não só tipo) de ${i.from}`).toBe(true);
      }
    }
  });

  it("services não dependem de routes nem do Fastify", () => {
    for (const { file, text } of read("services"))
      for (const i of imports(text)) {
        expect(i.from, `${file}`).not.toMatch(/routes/);
        expect(i.from, `${file}`).not.toBe("fastify");
      }
  });

  it("infra não depende de routes nem de services", () => {
    for (const { file, text } of read("infra"))
      for (const i of imports(text)) expect(i.from, `${file}`).not.toMatch(/routes|services/);
  });

  it("só infra/taiga.ts conversa com o Taiga (fetch e /api/v1)", () => {
    for (const { file, text } of all.filter((f) => f.file !== "infra/taiga.ts")) {
      expect(text, `${file} chama fetch`).not.toMatch(/\bfetch\(/);
      expect(text, `${file} monta URL da API do Taiga`).not.toMatch(/\/api\/v1/);
    }
  });

  it("toda rota de dados exige sessão, e toda rota com projeto passa por guardProject", () => {
    for (const { file, text } of read("routes").filter((f) => !/\/(health|auth|guards)\.ts$/.test(f.file))) {
      expect(text, `${file} não chama requireSession`).toMatch(/requireSession\(/);
      if (/:id|q\.project|\.project\b/.test(text)) expect(text, `${file} recebe um projeto e não chama guardProject`).toMatch(/guardProject\(/);
    }
  });

  it("rotas não consultam o Taiga direto: usam services ou funções nomeadas da infra", () => {
    for (const { file, text } of read("routes")) expect(text, `${file} usa taigaGet`).not.toMatch(/\btaigaGet(Paged)?\(/);
  });

  it("o Taiga é só leitura: nenhuma chamada além de GET (e do login do usuário de serviço)", () => {
    const t = readFileSync(join(SRC, "infra/taiga.ts"), "utf8");
    const methods = [...t.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods.every((m) => m === "POST"), "só o POST de /auth e /auth/refresh é permitido").toBe(true);
    expect(t.match(/authPost\("([^"]+)"/g)?.length ?? 0, "authPost só para auth/refresh").toBeGreaterThan(0);
    for (const m of t.matchAll(/authPost\("([^"]+)"/g)) expect(m[1]).toMatch(/^\/auth(\/refresh)?$/);
  });

  it("segredos nunca vão para o log", () => {
    for (const { file, text } of all) expect(text, `${file} loga senha/token`).not.toMatch(/(log|console)\.[a-z]+\([^)]*(password|auth_token|TAIGA_SERVICE_PASSWORD)/i);
  });
});
