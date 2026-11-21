# Bulk Scanner

App web para caçar cartas valiosas no meio do bulk de Magic: The Gathering.
Você aponta a câmera, passa as cartas uma após a outra e o app avisa quando aparece
uma carta cara.

> **Status:** Etapa 1, o protótipo de OCR. O app lê o nome da carta pela câmera e
> corrige erros de leitura usando a lista oficial de nomes. Preços e alertas vêm nas
> próximas etapas.

## Como usar (sem instalar nada)

O app é publicado automaticamente no GitHub Pages a cada mudança:

**https://felipe-pincelli.github.io/bulk-scanner/**

Funciona no Chrome/Edge do Windows e no Safari do iPhone. A câmera só funciona em
endereços `https://`, e o GitHub Pages já fornece isso.

### Configuração única do GitHub Pages
1. No GitHub, abra o repositório → **Settings** → **Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Se o repositório for **privado** numa conta gratuita, o GitHub não oferece Pages.
   Nesse caso: **Settings → General → Danger Zone → Change visibility → Public**.
   O código não contém senhas nem dados pessoais.
4. Vá na aba **Actions** → workflow **Deploy** → **Run workflow**. Em ~2 minutos
   o link acima passa a funcionar.

## Como testar o protótipo

1. Abra o link e toque em **Iniciar**. Permita o uso da câmera.
2. Encaixe a carta na moldura branca, com o **nome dentro da faixa tracejada**.
   Use o controle "Tamanho da moldura" para ajustar (útil com webcam fixa no PC).
3. Leia o painel:
   - **Nome grande**: amarelo = reconhecido uma vez; verde = confirmado
     (lido igual 2 vezes seguidas).
   - **OCR leu**: o texto cru que o OCR enxergou.
   - **Palpite**: o nome mais parecido na lista e a % de semelhança.
   - **OCR (ms)**: quanto tempo cada leitura levou.
   - **Miniatura branca**: exatamente o recorte enviado ao OCR. Se o nome não
     aparece nítido ali, ajuste a moldura, a distância ou a luz.
   - **Cartas confirmadas**: lista para você conferir quantas acertou.

**No PC:** se houver mais de uma webcam, aparece um seletor no topo. A escolha
fica salva.
**No iPhone:** o app usa a câmera traseira.

## Rodar no seu computador (opcional, para desenvolvimento)

Precisa do [Node.js](https://nodejs.org) versão 22 ou superior (instalador "LTS").
No terminal (PowerShell no Windows), dentro da pasta do projeto:

```bash
npm install
```

```bash
npm run data
```

```bash
npm run dev
```

Depois abra http://localhost:5173 no navegador. O `npm run data` baixa a lista
de nomes do Scryfall e só precisa ser rodado de vez em quando.

> No iPhone, o endereço local (`http://192.168...`) **não** libera a câmera, porque
> não é https. Para testar no iPhone, use o link do GitHub Pages.

## Como o projeto está organizado

```
scripts/            scripts que rodam fora do navegador
  build-data.ts       baixa dados do Scryfall → public/data/
  copy-tesseract.ts   copia o motor de OCR → public/tesseract/
.github/workflows/  publicação automática (GitHub Actions → GitHub Pages)
src/core/           TODA a lógica, sem interface (reaproveitável no Capacitor)
  camera/             câmera e geometria da moldura
  ocr/                contrato do OCR, Tesseract.js e pré-processamento da imagem
  matching/           corretor de nomes (busca aproximada)
  games/              um "provider" por jogo (hoje só magic/)
  scanner/            laço de leitura contínua
src/ui/             interface (React)
```

### Decisões técnicas
- **Tesseract.js** para o OCR: roda 100% no aparelho, funciona no Safari e é
  estável. Para ser rápido, lê só a faixa do nome, em modo "uma linha", com no
  máximo 4 leituras por segundo.
- **Corretor de nomes**: o OCR não precisa acertar todas as letras. O texto lido é
  comparado com todos os nomes oficiais de Magic, e o mais parecido vence.
- **Dados do Scryfall** são baixados pelo GitHub Actions uma vez por dia, nunca
  pelos celulares. Assim seguimos as regras de uso do Scryfall (poucas requisições,
  cache de 24h, User-Agent identificado).

Dados de cartas cortesia do [Scryfall](https://scryfall.com). Este projeto não é
afiliado à Wizards of the Coast.
