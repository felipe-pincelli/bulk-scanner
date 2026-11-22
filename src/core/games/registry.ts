import type { GameProvider } from './types';
import { magicProvider } from './magic/magicProvider';
import { pokemonProvider } from './pokemon/pokemonProvider';
import { onepieceProvider } from './onepiece/onepieceProvider';
import { yugiohProvider } from './yugioh/yugiohProvider';
import { lorcanaProvider } from './lorcana/lorcanaProvider';

/** Jogos disponíveis. Para adicionar um novo TCG, crie o provider e inclua aqui. */
export const games: Record<string, GameProvider> = {
  [magicProvider.id]: magicProvider,
  [pokemonProvider.id]: pokemonProvider,
  [onepieceProvider.id]: onepieceProvider,
  [yugiohProvider.id]: yugiohProvider,
  [lorcanaProvider.id]: lorcanaProvider,
};

export const gameList: GameProvider[] = Object.values(games);
export const defaultGame = magicProvider;
