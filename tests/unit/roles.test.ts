import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ROLES, allowedRoleNames, allowedRoleSet, normRole, scrumMastersOf } from "@/domain/roles";
import type { TMember } from "@/infra/taiga";

afterEach(() => { delete process.env.DEV_ROLES; });

describe("normRole", () => {
  it("ignora maiúsculas, acentos e plural", () => {
    expect(normRole("Analista de negócios e requisitos")).toBe(normRole("ANALISTA DE NEGÓCIO E REQUISITOS"));
    expect(normRole("Desenvolvedores")).toBe(normRole("DESENVOLVEDOR"));
    expect(normRole("Estagiários")).toBe(normRole("estagiário"));
  });
  it("não confunde papéis diferentes", () => {
    expect(normRole("Analista de UX")).not.toBe(normRole("Analista de teste de qualidade"));
    expect(normRole("Product Owner")).not.toBe(normRole("Desenvolvedor"));
  });
});

describe("papéis permitidos", () => {
  it("o padrão tem os 7 papéis e aceita as variações do Taiga", () => {
    const set = allowedRoleSet()!;
    expect(DEFAULT_ROLES).toHaveLength(7);
    for (const r of ["DESENVOLVEDOR", "Analista de negócios e requisitos", "ANALISTA DE TESTE DE QUALIDADE", "ADMINISTRADOR DE DADOS", "Estagiário", "Arquiteto", "Analista de UX"])
      expect(set.has(normRole(r)), r).toBe(true);
  });
  it("rejeita outros papéis", () => {
    const set = allowedRoleSet()!;
    for (const r of ["Product Owner", "Gerente de Projeto", "Analista de Sistemas", "Fora do projeto"]) expect(set.has(normRole(r)), r).toBe(false);
  });
  it("DEV_ROLES troca a lista", () => {
    process.env.DEV_ROLES = "Desenvolvedor, Arquiteto";
    expect(allowedRoleNames()).toEqual(["Desenvolvedor", "Arquiteto"]);
    expect(allowedRoleSet()!.has(normRole("Estagiário"))).toBe(false);
  });
  it("DEV_ROLES=* desliga o filtro", () => {
    process.env.DEV_ROLES = "*";
    expect(allowedRoleNames()).toBeNull();
    expect(allowedRoleSet()).toBeNull();
  });
  it("DEV_ROLES vazio volta ao padrão", () => {
    process.env.DEV_ROLES = "  ";
    expect(allowedRoleNames()).toEqual(DEFAULT_ROLES);
  });
});

describe("scrumMastersOf", () => {
  const m = (role: string, extra: Partial<TMember> = {}): TMember => ({ user: 1, full_name: `Pessoa ${role}`, photo: "http://x/f.png", role_name: role, ...extra });
  it("acha o papel Scrum Master sem diferenciar maiúsculas, acentos ou plural", () => {
    const r = scrumMastersOf([m("SCRUM MASTER"), m("Scrum Master", { user: 2 }), m("scrum masters", { user: 3 }), m("Scrum  Máster", { user: 4 })]);
    expect(r).toHaveLength(4);                     // o acento de "Máster" também é ignorado
  });
  it("devolve nome e foto (foto ausente vira null)", () => {
    expect(scrumMastersOf([m("Scrum Master", { full_name: "Marina", photo: null })])).toEqual([{ name: "Marina", photo: null }]);
  });
  it("ignora outros papéis, contas desativadas e convites sem usuário", () => {
    expect(scrumMastersOf([
      m("Desenvolvedor"), m("Product Owner", { user: 2 }), m("Scrum Master", { user: 3, is_active: false }),
      m("Scrum Master", { user: 4, is_user_active: false }), m("Scrum Master", { user: null }),
    ])).toEqual([]);
  });
  it("vários Scrum Masters no mesmo projeto: devolve todos, na ordem do Taiga", () => {
    expect(scrumMastersOf([m("Scrum Master", { full_name: "A" }), m("Scrum Master", { user: 2, full_name: "B" })]).map((p) => p.name)).toEqual(["A", "B"]);
  });
});
