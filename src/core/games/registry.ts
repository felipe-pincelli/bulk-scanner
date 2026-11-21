import type { GameProvider } from './types';
import { magicProvider } from './magic/magicProvider';

/** Jogos disponíveis. Para adicionar um novo TCG, crie o provider e inclua aqui. */
export const games: Record<string, GameProvider> = {
  [magicProvider.id]: magicProvider,
};

export const defaultGame = magicProvider;
