import type { TMember } from "../infra/taiga";

/**
 * Papéis (roles do Taiga) que aparecem como cards na página da sprint.
 * Pode ser trocado em DEV_ROLES (.env.local), separados por vírgula; use DEV_ROLES=* para mostrar todos.
 */
export const DEFAULT_ROLES = [
  "Desenvolvedor",
  "Analista de negócio e requisitos",
  "Analista de UX",
  "Analista de teste de qualidade",
  "Arquiteto",
  "Administrador de dados",
  "Estagiário",
];

/** Normaliza para comparar: sem acento, minúsculas e sem plural ("Negócios" = "NEGÓCIO"). */
export function normRole(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ")
    .map((w) => (w.length > 4 && w.endsWith("ores") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

/** Lista exibida na ajuda; null = sem filtro (todos os papéis). */
export function allowedRoleNames(): string[] | null {
  const env = process.env.DEV_ROLES?.trim();
  if (env === "*") return null;
  const list = env ? env.split(",").map((r) => r.trim()).filter(Boolean) : DEFAULT_ROLES;
  return list.length ? list : DEFAULT_ROLES;
}

export function allowedRoleSet(): Set<string> | null {
  const names = allowedRoleNames();
  return names ? new Set(names.map(normRole)) : null;
}

/** Pessoa do time, como o front exibe (foto pode faltar). */
export type Person = { name: string; photo: string | null };

/** Quem tem o papel "Scrum Master" no projeto (ignora maiúsculas, acentos e plural). Só membros ativos, com conta. */
export function scrumMastersOf(members: TMember[]): Person[] {
  return members
    .filter((m) => m.user && m.is_active !== false && m.is_user_active !== false && normRole(m.role_name ?? "") === "scrum master")
    .map((m) => ({ name: m.full_name, photo: m.photo ?? null }));
}
