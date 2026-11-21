/**
 * Preferências do usuário, salvas no próprio aparelho (localStorage).
 * Se o armazenamento estiver bloqueado (aba anônima), usa os valores padrão.
 */
export function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: ignora */
  }
}
