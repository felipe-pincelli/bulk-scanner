/**
 * Cooldown: sabe qual carta está na frente da câmera, para alertar UMA vez por
 * carta. A mesma carta só alerta de novo depois de sair da câmera (algumas
 * leituras seguidas sem ela) e voltar — por exemplo, outra cópia.
 */
export class CardPresence {
  private current: string | null = null;
  private absent = 0;

  /** @param readsToForget leituras sem a carta para considerar que ela saiu (~4 = 1 s). */
  constructor(private readsToForget = 4) {}

  /**
   * Informa o resultado de uma leitura. Devolve o nome da carta se ela ACABOU de
   * aparecer (é aí que se alerta); senão, null.
   */
  update(cardName: string | null, confirmed: boolean): string | null {
    if (cardName && cardName === this.current) {
      this.absent = 0;
      return null;
    }
    if (cardName && confirmed) {
      this.current = cardName;
      this.absent = 0;
      return cardName;
    }
    // Nenhuma carta (ou só um palpite ainda não confirmado de outra carta).
    if (++this.absent >= this.readsToForget) this.current = null;
    return null;
  }

  reset() {
    this.current = null;
    this.absent = 0;
  }
}
