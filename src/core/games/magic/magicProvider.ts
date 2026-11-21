import type { GameProvider, NameEntry } from '../types';

export const magicProvider: GameProvider = {
  id: 'magic',
  displayName: 'Magic: The Gathering',
  cardAspect: 63 / 88,
  // Faixa do nome no frame moderno. Começa um pouco depois da borda esquerda e
  // termina antes do custo de mana (que fica à direita) — o resto é sobra que o
  // corretor de nomes ignora.
  nameRegion: { x: 0.065, y: 0.04, w: 0.72, h: 0.065 },
  // Topo da área de detecção, largura inteira, 28% da altura: aceita a carta um
  // pouco deslocada, menor ou maior que a moldura.
  nameSearchBand: { x: 0, y: 0, w: 1, h: 0.28 },
  nameCharWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',-",

  async loadNames(baseUrl) {
    const res = await fetch(`${baseUrl}data/magic-names.json`);
    if (!res.ok) throw new Error(`Lista de nomes não encontrada (HTTP ${res.status})`);
    const json = (await res.json()) as { names: string[]; updatedAt?: string };

    const entries: NameEntry[] = [];
    for (const name of json.names) {
      entries.push({ matchText: name, cardName: name });
      // Cartas de duas faces/split ("Fire // Ice"): na carta física aparece só
      // o nome de uma face, então cada face também vira uma entrada.
      if (name.includes(' // ')) {
        for (const face of name.split(' // ')) entries.push({ matchText: face, cardName: name });
      }
    }
    return { entries, updatedAt: json.updatedAt };
  },
};
