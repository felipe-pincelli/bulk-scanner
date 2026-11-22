import type { GameProvider } from './types';
import { magicProvider } from './magic/magicProvider';
import { pokemonProvider } from './pokemon/pokemonProvider';
import { onepieceProvider } from './onepiece/onepieceProvider';

/** Jogos disponíveis. Para adicionar um novo TCG, crie o provider e inclua aqui. */
export const games: Record<string, GameProvider> = {
  [magicProvider.id]: magicProvider,
  [pokemonProvider.id]: pokemonProvider,
  [onepieceProvider.id]: onepieceProvider,
};

export const gameList: GameProvider[] = Object.values(games);
export const defaultGame = magicProvider;
