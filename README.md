# Bulk Scanner

App web para caçar cartas valiosas no meio do bulk de Magic: The Gathering.
Você aponta a câmera, passa as cartas uma após a outra e o app avisa quando aparece
uma carta cara.

> **Status:** Etapa 3. O app lê o nome da carta pela câmera, mostra a faixa de
> preço em reais e avisa (som + flash na tela inteira) quando aparece uma carta que
> vale mais que o seu mínimo. A lista final da sessão vem na Etapa 4.

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
2. Coloque a carta **dentro do quadrado** (cantos brancos), em pé, deitada ou de
   cabeça para baixo. Não precisa alinhar com precisão: o app procura o nome numa
   faixa larga perto da borda da carta. Use "Tamanho da área de detecção" para que
   a carta ocupe boa parte do quadrado (útil com webcam fixa no PC).
3. Leia o painel:
   - **Nome grande**: amarelo = reconhecido uma vez; verde = confirmado
     (lido igual 2 vezes seguidas).
   - **Faixa colorida no quadrado**: onde o app está procurando o nome agora.
   - **OCR leu**: o texto cru que o OCR enxergou (linhas separadas por `|`).
   - **Palpite**: o nome mais parecido na lista e a % de semelhança.
   - **Orientação**: em pé, deitada ou de cabeça para baixo. O app descobre
     sozinho e "gruda" na orientação que funcionou. Desmarque "Detectar carta
     deitada" se você sempre usa a carta em pé: fica um pouco mais rápido.
   - **OCR (ms)**: quanto tempo cada leitura levou.
   - **Miniatura**: exatamente o recorte enviado ao OCR. Se o nome não aparece
     nítido ali, ajuste a distância, o foco ou a luz.
   - **Cartas confirmadas**: lista para você conferir quantas acertou.

**No PC:** se houver mais de uma webcam, aparece um seletor no topo. A escolha
fica salva.
**No iPhone:** o app usa a câmera traseira.

## Alertas

1. Toque em **Iniciar sessão**. Esse toque também libera o som (exigência do iPhone)
   e mantém a tela ligada enquanto a sessão estiver aberta.
2. Defina **"Alertar a partir de R$"**. O valor fica salvo no aparelho.
3. Quando uma carta reconhecida passa do mínimo:
   - **Amarelo** (2 bipes): vale mais que o mínimo.
   - **Vermelho** (4 bipes, pisca 2 vezes): vale mais que **5×** o mínimo.
   - **Azul** (borda + bipe grave): "confira a edição". Só alguma edição específica
     vale o mínimo (veja o critério abaixo).
4. **Cooldown:** a mesma carta só alerta uma vez enquanto estiver na frente da
   câmera. Se ela sair e voltar (ex.: outra cópia), alerta de novo.

Em **Alertas** você escolhe:
- **Critério "Seguro" (padrão):** alerta amarelo/vermelho só quando até a versão
  **mais barata** da carta vale o mínimo, ou seja, qualquer cópia vale. Se só uma
  edição cara vale (ex.: Lightning Bolt, que tem um promo de US$ 650), mostra o
  aviso azul.
- **Critério "Qualquer edição":** alerta quando a versão **mais cara** vale o
  mínimo. Dispara bem mais.
- Considerar foil no preço máximo, aviso azul, som, e botões para testar cada alerta.

**Som no iPhone:** em iOS 16.4 ou mais recente, o som toca mesmo com a chave de
silencioso ligada. Em versões antigas, desligue o modo silencioso. Confira o volume
de mídia.

## Preços

- **Fonte:** Scryfall, com os preços do TCGplayer em dólar. Para cada nome de carta,
  o app guarda o preço da impressão **mais barata** e da **mais cara** (incluindo
  foil), além da edição da mais cara.
- **Conversão para reais:** cotação do dia pela Frankfurter (Banco Central Europeu),
  com a ExchangeRate-API de reserva. Fica guardada por 12h. O valor aparece no rodapé.
- **Atualização:** o GitHub gera um índice novo todo dia (às 09:17 UTC) a partir dos
  dados do Scryfall. O app baixa esse índice (~2 MB) e guarda no aparelho
  (IndexedDB), então funciona offline. Ele procura uma versão nova a cada 12h,
  ou na hora pelo botão **Atualizar preços**.
- **Atenção:** a faixa é do NOME da carta, não da sua cópia. Uma comum com uma
  versão promo cara vai mostrar um máximo alto. Por isso aparece a edição da mais
  cara e o preço máximo sem foil.

Para gerar o índice localmente (opcional):

```bash
npm run data
```

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

Depois abra http://localhost:5173 no navegador. O `npm run data` baixa os dados do
Scryfall (~500 MB, leva 1–2 minutos) e gera `public/data/magic-index.json`. Só
precisa ser rodado de vez em quando.

> No iPhone, o endereço local (`http://192.168...`) **não** libera a câmera, porque
> não é https. Para testar no iPhone, use o link do GitHub Pages.

## Como o projeto está organizado

```
scripts/            scripts que rodam fora do navegador
  build-data.ts       baixa dados do Scryfall → índice enxuto em public/data/
  copy-tesseract.ts   copia o motor de OCR → public/tesseract/
.github/workflows/  publicação automática (GitHub Actions → GitHub Pages)
src/core/           TODA a lógica, sem interface (reaproveitável no Capacitor)
  camera/             câmera e geometria da moldura
  ocr/                contrato do OCR, Tesseract.js e pré-processamento da imagem
  matching/           corretor de nomes (busca aproximada)
  games/              um "provider" por jogo (hoje só magic/)
  prices/             índice de preços (IndexedDB) e cotação do dólar
  alerts/             regras de alerta (níveis, critério) e cooldown por carta
  platform/           som, tela ligada e "feedback" (onde entrará a vibração via Capacitor)
  settings/           preferências salvas no aparelho
  storage/            acesso ao IndexedDB
  scanner/            laço de leitura contínua
src/ui/             interface (React)
```

### Decisões técnicas
- **Tesseract.js** para o OCR: roda 100% no aparelho, funciona no Safari e é
  estável. Para ser rápido, lê só uma faixa perto da borda da carta (no máximo 4
  leituras por segundo), com dois leitores em paralelo usando modos diferentes de
  separar linhas. Cada modo sozinho falhava em casos diferentes; juntos são
  bem mais confiáveis.
- **Nomes curtos** ("Moat", "Opt"): um terceiro leitor lê só a linha que o app
  acha que é o nome, recortando as bordas pretas da carta, que confundiam o
  Tesseract. Nomes curtos e médios exigem leitura mais confiável, para evitar
  alarmes falsos.
- **Orientação automática**: a cada leitura, testa primeiro a orientação que
  vinha funcionando. Só se não achar nada, testa mais uma das outras três.
- **Corretor de nomes**: o OCR não precisa acertar todas as letras. O texto lido é
  comparado com todos os nomes oficiais de Magic, e o mais parecido vence.
- **Dados do Scryfall** são baixados pelo GitHub Actions uma vez por dia, nunca
  pelos celulares. Assim seguimos as regras de uso do Scryfall (poucas requisições,
  cache de 24h, User-Agent identificado).

Dados de cartas cortesia do [Scryfall](https://scryfall.com). Este projeto não é
afiliado à Wizards of the Coast.
