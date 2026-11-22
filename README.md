# Bulk Scanner

App para caçar cartas valiosas no meio do bulk de **Magic: The Gathering** e
**Pokémon TCG**.
Você aponta a câmera, passa as cartas uma após a outra e o app avisa, com som e um
flash de cor na tela inteira, quando aparece uma carta que vale mais que o mínimo
que você definiu. Não é um app de coleção: o foco é velocidade.

**Abrir o app:** https://felipe-pincelli.github.io/bulk-scanner/

Funciona no **Chrome/Edge do Windows** (webcam) e no **Safari do iPhone** (câmera
traseira), e pode ser instalado na tela inicial. Tudo roda no próprio aparelho:
nenhuma imagem é enviada para servidor.

---

## Sumário
1. [Instalar na tela inicial](#1-instalar-na-tela-inicial)
2. [Como usar](#2-como-usar)
3. [Alertas](#3-alertas)
4. [Resumo da sessão e exportação](#4-resumo-da-sessão-e-exportação)
5. [Preços e atualização dos dados](#5-preços-e-atualização-dos-dados)
6. [Funcionamento offline](#6-funcionamento-offline)
7. [Publicação (GitHub Pages)](#7-publicação-github-pages)
8. [Rodar no seu computador](#8-rodar-no-seu-computador-opcional)
9. [Como o projeto está organizado](#9-como-o-projeto-está-organizado)
10. [Limitações conhecidas](#10-limitações-conhecidas)
11. [Próximos passos possíveis](#11-próximos-passos-possíveis)

---

## 1. Instalar na tela inicial

**iPhone (Safari):**
1. Abra o link acima **no Safari**. Outros navegadores do iPhone podem não oferecer
   a opção.
2. Toque no botão **Compartilhar** (quadrado com seta para cima).
3. Role e toque em **Adicionar à Tela de Início** → **Adicionar**.
4. Abra pelo ícone novo. O app abre em tela cheia, sem a barra do Safari.

**PC (Chrome ou Edge):** abra o link e clique no ícone de **instalar** na barra de
endereço (um monitor com seta), ou use o menu ⋮ → *Instalar Bulk Scanner*.

> **Importante no iPhone:** o app instalado guarda os dados **separados** do Safari.
> Na primeira vez que abrir pelo ícone, ele baixa os preços de novo, e as
> configurações e sessões do Safari não aparecem lá.
> O iPhone também pode pedir a permissão da câmera a cada vez que o app é aberto.
> É um comportamento do iOS.

Quando houver uma versão nova publicada, aparece o aviso **"Nova versão
disponível → Atualizar"**. Nada muda sozinho no meio de uma sessão.

## 2. Como usar

0. Escolha o **jogo** no topo (Magic ou Pokémon). A escolha fica salva. O app
   carrega só os dados daquele jogo e cada jogo tem a sua própria sessão. Para
   trocar, pare a sessão primeiro.
1. Toque em **Iniciar sessão** e permita o uso da câmera. Esse toque também libera
   o som (exigência do iPhone) e mantém a tela ligada durante a sessão.
2. Coloque a carta **dentro do quadrado** (cantos brancos), em pé, deitada ou de
   cabeça para baixo. Não precisa alinhar com precisão: o app procura o nome numa
   faixa larga perto da borda da carta.
3. Passe as cartas uma após a outra. Os cantos do quadrado ficam amarelos (lido
   uma vez) e verdes (confirmado). O nome reconhecido aparece no painel:
   amarelo = lido uma vez, verde = confirmado (lido igual 2 vezes seguidas). A
   faixa de preço em R$ aparece logo abaixo.
4. Toque em **Parar** para ver o resumo da sessão.

**Lote (cartas já separadas):** em **Próximas cartas**, escolha o acabamento
(normal / foil / foil etched; no Pokémon normal / reverse holo / 1ª edição) e/ou a
condição (NM / SP / MP / HP / DMG). Isso vale para **todas as cartas lidas daí em
diante**, até você mudar: o preço mostrado, os alertas e a sessão já usam esses
valores. Enquanto houver lote ativo, aparece um aviso sobre a câmera
(ex.: "Lote: foil · SP"). Se uma carta do lote não existir naquele acabamento (ex.:
um Moat num lote foil), o app usa o preço normal dela. Dá para corrigir carta a
carta no resumo.

**Dicas:**
- Use **Ajustes e diagnóstico → Tamanho da área de detecção** para a carta ocupar
  boa parte do quadrado. É especialmente útil com webcam fixa no PC.
- Boa luz e foco ajudam muito. A miniatura em "Ajustes e diagnóstico" mostra
  exatamente o que o OCR está vendo.
- Se você sempre usa as cartas em pé, desmarque **"Detectar carta deitada"**. Fica
  um pouco mais rápido.
- **No PC**, com mais de uma webcam, aparece um seletor no topo. A escolha fica salva.

## 3. Alertas

Defina **"Alertar a partir de R$"** no painel. O valor fica salvo no aparelho.

| Alerta | Quando | Como avisa |
|---|---|---|
| 🟡 **Amarelo** | vale mais que o mínimo | flash amarelo + 2 bipes |
| 🔴 **Vermelho** | vale mais que **5×** o mínimo | flash vermelho piscando 2× + 4 bipes |
| 🔵 **Azul** | "confira a edição" (veja abaixo) | borda azul + 1 bipe grave |

**Edição pelo rodapé:** cartas de 2015 em diante trazem no canto inferior esquerdo
o número de colecionador e o código da edição (ex.: `117/384 R` e `2X2 • EN`).
Quando o preço da carta **depende da edição** (alguma versão passa do mínimo e
outra não), o app lê esse rodapé e usa o **preço exato daquela impressão**:
- edição identificada e cara → amarelo/vermelho com o preço certo;
- edição identificada e barata, mas a versão foil passa do mínimo → azul
  **"confira se é foil"**;
- rodapé não lido (carta antiga, borrada, fora do quadrado) → azul **"confira a
  edição"**, como antes.

Nesses casos o alerta espera até ~1,5 s pela leitura do rodapé. Cartas que não
dependem da edição (ex.: Moat, cara em qualquer versão) alertam na hora. O painel
mostra "Edição: …" quando ela é identificada.

**Cooldown:** a mesma carta só alerta uma vez enquanto estiver na frente da câmera.
Se ela sair e voltar (por exemplo, outra cópia), alerta de novo.

**Critério** (em **Alertas**):
- **Seguro (padrão):** amarelo/vermelho só quando até a versão **mais barata** da
  carta vale o mínimo, ou seja, qualquer cópia vale (ex.: Moat). Se só uma edição
  cara vale (ex.: Lightning Bolt, que tem um promo de ~US$ 650), mostra o aviso
  azul, para você olhar o símbolo da edição.
- **Qualquer edição:** alerta quando a versão **mais cara** vale o mínimo. Dispara
  bem mais.
- Também em **Alertas**: considerar foil no preço máximo, ligar/desligar o aviso
  azul, som, e botões para **testar** cada alerta.

**Som no iPhone:** no iOS 16.4 ou mais recente, toca mesmo com a chave de silencioso
ligada. Em versões antigas, desligue o modo silencioso. Confira o volume de mídia.

## 4. Resumo da sessão e exportação

Ao tocar em **Parar**:
- Aparecem as cartas com alerta, da mais valiosa para a menos, com a edição
  identificada (ou a faixa de preço e a edição mais cara, se não identificada), e o
  **total estimado**. O total é a soma da versão mais
  barata de cada carta com alerta, ou seja, o mínimo garantido. Logo abaixo aparece
  quanto daria se todas fossem as edições mais caras.
- **Condição:** cada carta também tem botões **NM / SP / MP / HP / DMG**. Os
  preços do TCGplayer são de cartas NM; para as demais o app aplica um desconto
  aproximado (SP 85%, MP 70%, HP 50%, DMG 35%) no preço, no alerta e no total. A
  condição vai para o CSV.
- **Acabamento:** o app não detecta foil pela câmera (o brilho depende demais da
  luz e do ângulo). Em cada carta do resumo há botões **normal / foil / foil
  etched** (no Pokémon: **normal / reverse holo / 1ª edição**). Ao marcar, o
  preço passa a ser o daquele acabamento, e o alerta, o total e a exportação se
  ajustam. Uma carta sem alerta marcada como foil pode passar a valer (seção
  "Outras cartas lidas"). Na exportação do Moxfield sai `*F*` (foil) ou `*E*`
  (etched).
- **remover** tira um alerta falso da lista.
- **Copiar resumo**: texto pronto para WhatsApp ou notas.
- **Exportar**:
  - **Lista com edição** (`1 Lightning Bolt (2X2) 117`): formato do **Moxfield**
    (Collection ou deck → Import), aceito também pelo **Archidekt** e **ManaBox**.
    Cartas sem edição identificada saem só com o nome.
  - **Lista simples** (`2 Moat`): só quantidade e nome, aceita por praticamente
    qualquer site (**MTGGoldfish**, **TappedOut**, **Deckstats**, **Scryfall**…).
  - Nas listas, cópias repetidas são somadas.
  - **CSV** para Excel, Google Sheets ou Numbers, com quantidade, edição e número
    (quando identificados), preços em R$ e US$ e a edição mais cara. Usa o padrão brasileiro: `;` como separador e vírgula
    decimal.
  - Escolha quais cartas entram (só com alerta, com alerta + azul, ou todas) e use
    **Copiar**, **Baixar arquivo** ou **Compartilhar…**. No iPhone, este último
    abre o menu de compartilhar do sistema.
- **Continuar escaneando** ou **Nova sessão**, que apaga a lista atual.

A sessão fica **salva no aparelho**. Se a página recarregar, nada se perde: o
botão vira "Continuar sessão" e o botão **Resumo** fica disponível no topo.

## 5. Preços e atualização dos dados

**Pokémon:** os dados vêm do [TCGCSV](https://tcgcsv.com), uma cópia diária dos
preços do TCGplayer, coleção por coleção. O índice guarda cada impressão com o
número e o total da coleção (`063/198`), o preço normal, o de reverse holo/holo e
o de 1ª edição (cartas antigas). No rodapé da carta o app lê esse número, que fica
à esquerda nas cartas novas e à direita nas antigas, e assim identifica a coleção
mesmo sem o código impresso. A exportação "com edição" usa o formato do Pokémon
TCG Live / Limitless (`1 Pikachu SVI 63`). As siglas vêm do TCGplayer e podem
diferir em alguns sites.

**Magic:**

- **Fonte:** [Scryfall](https://scryfall.com), com os preços do TCGplayer em dólar.
  Para cada nome de carta, o app guarda o preço da impressão **mais barata**, da
  **mais cara** (incluindo foil), da mais cara **sem foil**, qual edição é a mais
  cara, e o preço de **cada impressão** (edição + número), usado na leitura do
  rodapé. Ficam de fora tokens, cartas só digitais (Arena/MTGO) e cartas numeradas
  (tipo "123/500"), que nunca aparecem em bulk.
- **Reais:** cotação do dia pela [Frankfurter](https://frankfurter.dev) (dados do
  Banco Central Europeu), com a ExchangeRate-API de reserva. Fica guardada por 12h
  e aparece no rodapé.
- **Atualização automática:** todo dia às 09:17 UTC, o GitHub Actions baixa o
  arquivo "Default Cards" do Scryfall (~80 MB compactado, ~120 mil impressões) e
  gera um **índice enxuto** (~34 mil cartas, com os preços de cada impressão),
  publicado junto com o app.
  Os celulares nunca baixam o arquivo grande. Isso respeita as regras de uso do
  Scryfall: uma requisição por dia, com User-Agent identificado.
- **No aparelho:** o app guarda o índice no IndexedDB e procura uma versão nova a
  cada 12h, ou na hora pelo botão **Atualizar preços** no rodapé.
- **Para forçar uma atualização dos dados no site:** GitHub → aba **Actions** →
  **Deploy** → **Run workflow**.
- **Trava de segurança:** se o índice gerado tiver menos de 20 mil cartas (por
  exemplo, se o Scryfall mudar o formato), a publicação falha e o site continua
  com a versão anterior.

## 6. Funcionamento offline

Depois de abrir o app uma vez com internet **e iniciar uma sessão** (é aí que o
motor de OCR é baixado, ~12 MB), ele funciona sem internet: abre, lê as cartas,
mostra os preços guardados e dispara os alertas. Sem internet, a cotação usada é
a última salva.

O "esqueleto" do app (~340 KB) fica guardado por um service worker. O motor de OCR
é guardado na primeira vez que é usado, e os preços ficam no IndexedDB.

## 7. Publicação (GitHub Pages)

A cada mudança na branch `main` (e todo dia, para atualizar os preços), o GitHub
Actions gera e publica o site (`.github/workflows/deploy.yml`).

Configuração feita uma única vez:
1. Repositório → **Settings** → **Pages** → **Source: GitHub Actions**.
2. Em conta gratuita, o Pages só funciona com o repositório **público**
   (**Settings → General → Danger Zone → Change visibility**). O código não contém
   senhas nem dados pessoais.

## 8. Rodar no seu computador (opcional)

Só é necessário para desenvolver. Para usar o app, o link já basta.

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

Depois abra http://localhost:5173. O `npm run data` baixa os dados do Scryfall
(~80 MB) e gera `public/data/magic-index.json`. Só precisa ser rodado de vez em
quando.

Para gerar a versão final (a mesma que vai para o site), use o comando abaixo e
depois `npm run preview`:

```bash
npm run build
```

> No iPhone, o endereço local (`http://192.168...`) **não** libera a câmera, porque
> não é https. Para testar no iPhone, use o link do GitHub Pages.

## 9. Como o projeto está organizado

```
scripts/              rodam fora do navegador
  build-data.ts         gera os índices de todos os jogos em public/data/ (roda no GitHub)
  pokemon.ts            Pokémon: TCGCSV → índice
  lib/indexBuilder.ts   formato comum dos índices
  copy-tesseract.ts     copia o motor de OCR → public/tesseract/
.github/workflows/    publicação automática (GitHub Actions → GitHub Pages)
public/icons/         ícones do app
src/core/             TODA a lógica, sem interface (reaproveitável no Capacitor)
  camera/               câmera e geometria da área de detecção
  ocr/                  contrato do OCR, Tesseract.js, preparo da imagem, dica de linha
  edition/              rodapé: onde fica, leitura da edição/número, preço da impressão
  matching/             corretor de nomes (busca aproximada)
  scanner/              laço de leitura contínua e orientação automática
  games/                um "provider" por jogo (magic/, pokemon/) + formato do índice
  prices/               índice de preços (IndexedDB) e cotação do dólar
  alerts/               regras de alerta, cooldown e fluxo (alertar já ou esperar a edição)
  session/              sessão, resumo e exportação
  platform/             som, tela ligada e "feedback" (onde entrará a vibração)
  settings/, storage/   preferências e IndexedDB
src/ui/               interface (React): App, resumo, exportação, aviso de versão
```

**Adicionar outro jogo** (ex.: Yu-Gi-Oh!): criar `src/core/games/<jogo>/`
implementando o contrato `GameProvider` (`src/core/games/types.ts`), registrá-lo
em `games/registry.ts` e gerar o índice dele em `scripts/` com o `IndexBuilder`.

**Vibração no iPhone (Capacitor):** criar outra implementação de `Feedback`
(`src/core/platform/feedback.ts`) que também chama o plugin Haptics. O resto do
app não muda.

### Decisões técnicas
- **Tesseract.js** para o OCR: roda 100% no aparelho, funciona no Safari e é
  estável. Para ser rápido, lê só uma faixa perto da borda da carta, no máximo 4
  vezes por segundo, com **três leitores em paralelo**:
  - dois leem a faixa inteira com modos diferentes de separar linhas (cada um
    sozinho falhava em casos diferentes por causa da arte);
  - o terceiro lê só a linha que o app acha que é o nome, recortando as bordas
    pretas da carta. É ele que pega nomes curtos como "Moat" e "Opt".
- **Edição pelo rodapé:** pela largura da barra do nome, o app calcula o tamanho e
  a posição da carta, e daí onde fica o rodapé. Um quarto leitor lê esse trecho
  (ampliado e com as cores invertidas, porque o texto é branco sobre preto), e o
  resultado é comparado **só com as edições em que aquela carta existe**. Isso
  tolera erros do OCR como O/0, I/1 e S/5. O rodapé só é lido quando o preço
  depende da edição, para não perder velocidade.
- **Corretor de nomes:** o texto lido é comparado com todos os nomes oficiais (busca
  por trigramas + distância de edição), então o OCR não precisa acertar todas as
  letras. Nomes curtos e médios exigem leitura mais confiável, para evitar alarmes
  falsos.
- **Orientação automática:** testa primeiro a orientação que vinha funcionando. Só
  se não achar nada, testa mais uma das outras três.
- **Índice gerado no servidor (GitHub Actions)**, não no celular: o arquivo
  completo do Scryfall é grande demais para processar no iPhone.

## 10. Limitações conhecidas

- **Só nomes em inglês.** Cartas em outros idiomas não são reconhecidas (e não
  geram alarme falso).
- **Edição só em cartas de 2015 em diante:** cartas mais antigas não têm código
  no rodapé, então o app mostra a faixa de preço de todas as edições. O app
  também não detecta se a carta é **foil** (por isso o aviso "confira se é foil").
- O rodapé é pequeno: precisa de **boa luz e foco**, e a carta não pode estar
  muito pequena no quadrado.
- **Frames especiais** (borderless, showcase, nome em fundo escuro) podem ser
  lidos com menos confiabilidade.
- **Preços do TCGplayer (EUA)** convertidos para reais. Não refletem o mercado
  brasileiro (ex.: Liga Magic, que não tem API pública).
- No iPhone instalado, a tela só fica ligada (Wake Lock) em versões recentes do
  iOS. Se apagar, ajuste o bloqueio automático nos Ajustes do iPhone.

## 11. Próximos passos possíveis

- Reconhecer nomes em outros idiomas (português, japonês…).
- Empacotar com Capacitor para ganhar vibração no iPhone.
- Adicionar Yu-Gi-Oh! (YGOPRODeck).

---

Dados de cartas cortesia do [Scryfall](https://scryfall.com). Este projeto não é
afiliado à Wizards of the Coast.
