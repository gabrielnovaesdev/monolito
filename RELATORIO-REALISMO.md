# Relatório: realismo do MONÓLITO

Execução autônoma agendada, 2026-10-21, branch `monolito` (sem push, sem merge).
Layout, textos, transições e a coreografia da porta não foram alterados.

## Como foi verificado

O `preview_start` do servidor "monolito" foi recusado nesta execução (não havia ninguém para aprovar). Em vez de
subir outro servidor por fora, a verificação foi feita com o Chrome headless (GPU real, D3D11) controlado pelo
DevTools Protocol: as requisições a `http://monolito.test/` são interceptadas e respondidas direto do disco, sem servidor HTTP.
A câmera é posicionada com `__mono.lenis.scrollTo(y, {immediate:true})` + `ScrollTrigger.update()`, como pedia o plano.
Capturas em 1440×900 e 390×844 (DPR 2, toque). FPS medido com `requestAnimationFrame` por 3 s, com vsync desligado
(`--disable-gpu-vsync --disable-frame-rate-limit`), então os números mostram a folga real, não o teto de 60/120.

**Lighthouse:** o pacote não está instalado e baixá-lo pelo npm sairia do que foi autorizado (só bibliotecas JS via CDN).
No lugar, as mesmas métricas de laboratório foram medidas pelo DevTools (`PerformanceObserver`): FCP, LCP, TBT (soma de
tarefas longas > 50 ms depois do FCP, nos primeiros 10 s), CLS e bytes. Não é a nota oficial do Lighthouse.

## Fase 1: as 5 etapas do plano

### Etapa 1 — HDRI por cenário + AgX (commit `82c91e2`)
- 4 HDRI 2K do Poly Haven: `quarry_01` (deserto e Casa Duna), `aarfontein_dawn_2` (Capela), `qwantani_mid_morning_puresky` (Pavilhão), `modern_buildings_night` (Torre).
- O panorama é girado para o sol do HDRI coincidir com a `DirectionalLight` de cada cena; o pico do sol é cortado no mapa de ambiente (a luz direcional já faz esse papel, sem contar o sol duas vezes).
- HDRI como fundo na Casa Duna e no Pavilhão (céu fotográfico); na Capela, na Torre e no deserto do hero o céu procedural fica (estrelas, anoitecer animado do contato) e o HDRI só ilumina.
- Névoa puxada para a cor medida no horizonte do HDRI. Sol do Pavilhão elevado para ~40°, igual ao do HDRI.
- `AgXToneMapping`, exposição 1,12, e um ajuste "punchy" (saturação 1,22 + curva em S) no passe de acabamento, porque o AgX base deixa a paleta quente acinzentada.
- Celular usa versões 1K geradas localmente a partir dos 2K. Carregamento sempre assíncrono; o hero não espera.

### Etapa 2 — Texturas PBR (commit `fce8609`)
- 8 conjuntos 1K do Poly Haven (cor, normal GL, ARM). O `dark_rock` foi removido depois, na etapa 4, quando as rochas viraram glTF.
- UVs das caixas recalculadas em metros, face a face, e os planos grandes escalados: cada textura repete na escala real (`size` em metros).
- **ambientCG ficou de fora:** o download (`ambientcg.com/get?...`) redireciona para `acg-download.struffelproductions.com`, domínio fora da lista autorizada. Não há travertino no Poly Haven; usei `preconcrete_wall_001` (pedra porosa clara) em escala de 1,2 m.
- O motor só mostra um projeto depois que HDRI e texturas chegaram e o shader final foi compilado (sem quadro preto nem engasgo na transição).

### Etapa 3 — Pós-processamento (commit `2e40aba`)
- **N8AO 1.9.4** via jsDelivr (versão fixa), funcionando com three 0.160. Uma instância compartilhada pelos mundos dentro do `WorldMixPass` (troca `scene`/`camera` por mundo), meia resolução, `gammaCorrection` desligado (o pipeline segue linear até o `OutputPass`). O pacote importa `postprocessing` só para a variante que não usamos; um stub local (`vendor/postprocessing-shim.js`) satisfaz o import sem baixar a biblioteca.
- **SMAA** depois do tone mapping.
- **Bokeh sutil** só nos projetos: desfoque em espiral a partir da profundidade do N8AO, foco no ponto que a câmera olha, silhuetas da frente preservadas e céu sempre nítido.
- **Espelho d'água real** (`Water`/Reflector do three) na piscina da Casa Duna e no espelho d'água do Pavilhão.
- Tudo isso só no desktop. No celular: DPR ≤ 1,25, sem N8AO, SMAA, bokeh ou reflexo.
- Vidro com Reflector não foi feito: num volume de vidro fechado o reflexo planar não faz sentido; o vidro reflete o HDRI.

### Etapa 4 — Vegetação e pessoas (commit `88235dd`)
- Os glTF de árvore do Poly Haven são pesados demais para a web (jacarandá 215 MB, `tree_small_02` 4,6 M polígonos). Escolhi `island_tree_02` (46 MB, 1,07 M triângulos), baixei para uma pasta temporária e reduzi no Blender para 46,5 mil triângulos (34% das folhas, ampliadas para manter a copa; tronco e galhos com Decimate). GLB com Draco: 2,2 MB.
- Também: rocha `namaqualand_boulder_04` (Casa Duna), arbusto seco `wild_rooibos_bush` (dunas) e arbusto `othonna_cerarioides` (capim da Capela), todos reduzidos e em Draco.
- Instanciados (`InstancedMesh`), com vento nas folhas no vertex shader. Os icosaedros e dodecaedros saíram.
- Pessoas: ~7,5 cabeças, tronco e quadril separados, pescoço, cabelo, braços que balançam em oposição às pernas e roupa/pele variadas. Sem Mixamo.

### Etapa 5 — Edifícios no Blender (commit `1592016`)
- Blender 5.2.2 encontrado em `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`. Script headless `blender/edificios.py`.
- **Casa Duna:** mesmas medidas da versão em código (o enquadramento não muda), com chanfros, porta recuada com batentes, pingadeira na laje, caixilhos com perfil nos quatro lados, travessas, piso de madeira, sofá com almofadas, mesa de centro, mesa de jantar com seis cadeiras, ilha e armários, estante, pendentes, escada com viga lateral e corrimão, rasgo de luz com moldura e rufo.
- **Capela:** frente como uma laje única, com a cruz recortada por booleana (a primeira versão, em peças, vazava luz pelas juntas), bancos, degrau e altar.
- AO assado no Cycles (UV1, 2048 px), exportação GLB/Draco; o site troca cada material pelo PBR de mesmo nome e usa o AO assado como `aoMap`. Isso também dá oclusão no celular, onde o N8AO fica desligado.
- Pavilhão (arcos já extrudados com chanfro) e Torre seguem em código.

### Desempenho da fase 1

FPS (desktop 1440×900, vsync desligado, GPU desta máquina):

| Cenário | FPS | Cenário | FPS |
|---|---|---|---|
| hero | 375 | Casa Duna (início/meio) | 335 / 269 |
| fresta | 360 | Capela | 288 / 291 |
| giro | 320 | Pavilhão | 250 / 233 |
| corredor | 303 | Torre | 369 / 350 |
| porta de luz | 205 | fenda (dois mundos) | 156 |
| contato | 357 | | |

Carregamento (mediana de 3 cargas, cache desligado, sem limitação de rede):

| | antes (`90624f9`) | depois da fase 1 |
|---|---|---|
| FCP | 60–430 ms | 70–180 ms |
| LCP | 4,0 s (é a animação de entrada do texto) | 4,0 s |
| TBT (≈) | 0,34–0,69 s | 1,0–1,2 s |
| CLS | 0 | 0 |
| Bytes (local + CDN) | 0,44 MB | ~77 MB nos primeiros 10 s, porque os 4 projetos pré-carregam em segundo plano depois da entrada |

O TBT chegou a 2,3 s na primeira versão. Baixou para ~1,1 s depois de mover decodificação, rotação e corte dos HDRI para um Web Worker (`hdr-worker.js`), gerar o mapa de ambiente em 1K (o PMREM fica do mesmo tamanho e a troca não recompila os shaders) e usar `renderer.compileAsync`. A tarefa longa de ~1,5 s no início já existia antes (criação do deserto).

### Assets baixados (cópia de `assets/CREDITOS.md`)

Ver `assets/CREDITOS.md`. Resumo: 4 HDRI 2K (+4 reduções 1K locais), 7 conjuntos PBR 1K, 4 glTF 1K (só as versões reduzidas ficaram em `assets/`), tudo do Poly Haven, CC0. Total em `monolito/assets/`: 54 MB (limite 120 MB).

### Limitações e o que ficou de fora na fase 1
- Lighthouse oficial não rodou (ver acima).
- Nada do ambientCG (redirecionamento para outro domínio).
- Aviso de compilação do ANGLE/D3D (`X3595`, derivadas em laço) vindo de um shader de terceiros (SMAA ou N8AO). Só no desktop; não é erro e não afeta a imagem.
- Os 77 MB são baixados em segundo plano depois do hero. Em rede lenta, o projeto 1 pode não estar pronto quando a porta abre; nesse caso a porta mostra o deserto até ele chegar.

## Fase 2: ciclo de melhoria

Notas de 0 a 10 em cinco critérios: **L** iluminação, **M** materiais, **Mo** modelos, **V** vida, **C** acabamento de câmera.
São avaliações visuais minhas a partir das capturas, não uma métrica automática.

### Iteração 1

Notas na entrada (fim da fase 1):

| Cenário | L | M | Mo | V | C | Média |
|---|---|---|---|---|---|---|
| hero | 8 | 8 | 6 | 6 | 8 | 7,2 |
| fresta / giro | 7,5 | 7 | 6 | 6 | 8 | 6,9 |
| corredor | 6 | 5 | 6 | 5 | 7 | 5,8 |
| porta de luz | 7 | 7 | 7 | 6 | 7 | 6,8 |
| Casa Duna | 7 | 7 | 7,5 | 7 | 8 | 7,3 |
| Capela | 7 | 7 | 7 | 7 | 8 | 7,2 |
| Pavilhão | 8 | 6,5 | 6,5 | 7,5 | 8,5 | 7,4 |
| Torre | 5,5 | 5 | 5 | 6 | 6 | 5,5 |
| fenda | 5 | 7 | 7 | 6 | 7 | 6,4 |
| contato | 8 | 8 | 6 | 6 | 8 | 7,2 |
| **média geral** | | | | | | **6,8** |

Defeitos mais visíveis:
1. Torre, início do trajeto: um prédio sorteado ao acaso tapava a câmera (já acontecia antes); janelas esticadas conforme a altura de cada prédio e janelas acesas até nos telhados.
2. Corredor: a pedra das paredes usava o mapa do monólito (0,85 m de largura) esticado por 10 m, criando estrias horizontais que estouravam com o sol rasante.
3. Fenda: o véu de bloom da transição ficou mais branco com o AgX (estouro).
4. Pavilhão: a pedra porosa dos arcos parecia esponja bege, não travertino.

O que mudou:
- Torre: nenhum prédio no corredor de visão da câmera inicial; janelas em escala real por instância (8 colunas de 3,2 m e 20 andares de 3,5 m por repetição, calculado no shader a partir da escala de cada instância); telhados com concreto escuro.
- Corredor: material próprio para paredes e piso, com a pedra repetindo ao longo dos 10 m e normal mais suave (0,35).
- Fenda: o reforço de bloom durante a transição caiu de 0,25 para 0,12. A máscara e o brilho âmbar da borda não mudaram.
- Arcos: `concrete_layers_02` em tom creme, com estratos horizontais finos, mais próximo de travertino.

Notas na saída: corredor 6,4 · Torre 6,6 · fenda 6,8 · Pavilhão 7,5 · demais iguais. **Média geral 7,0** (+0,2).

FPS desktop (vsync desligado): hero 370 · corredor 302 · porta 204 · Duna 330/268 · Capela 284/285 · Pavilhão 246/232 · Torre 390/324 · fenda 154 · contato 355.
Carregamento (mediana de 3): FCP 276 ms · LCP 4,2 s · TBT ≈ 1,15 s · CLS 0.
Capturas: `relatorio/iter1/antes` e `relatorio/iter1/depois`.

### Iteração 2

Defeitos priorizados:
1. Torre: a fachada parecia um código de barras (192 listras de 10 cm por lado) e o vidro não refletia nada; a cidade tinha janelas quadradas genéricas.
2. Ao dar reflexo ao vidro, surgiu um ponto azul estourado: o especular da lua (luz direcional) num vidro liso demais. Também era preciso limitar os postes do HDRI noturno.
3. Pavilhão: o piso `large_floor_tiles_02` deixava a praça cinza e suja, e os arcos ficavam cinza-concreto ou bege-esponja, conforme o tom.
4. Casa Duna: a cor da areia variava entre perto (cinza) e longe (laranja).

O que mudou:
- Fachada da Torre redesenhada: vãos de 1,5 m com caixilho, luminária linear no forro, gradiente de luz, móveis em silhueta, persianas e vãos apagados; quatro variantes alternadas por andar. Vidro com reflexo do HDRI (rugosidade 0,16) e pico do HDRI limitado a 4× o horizonte.
- Cidade: mesma lógica (vãos de 2,4 m × 3,5 m, luz quente ou fria, persianas), em escala real por instância.
- Novo modo `tone` no `pbr()`: a cor do material define o albedo e a textura só entra como variação de luminância. Assim a praça vira pedra lioz clara com as juntas, os arcos ficam creme com estratos, e a areia da Duna tem a mesma cor perto e longe.

Notas na saída: Torre 7,0 (L 7 · M 7 · Mo 6,5 · V 7 · C 7,5) · Pavilhão 8,0 (L 8,5 · M 8 · Mo 7 · V 8 · C 8,5) · Casa Duna 7,5. Demais iguais. **Média geral 7,1** (+0,1: ganho concentrado em 3 dos 11 cenários).

FPS desktop: hero 370 · corredor 300 · porta 203 · Duna 338/266 · Capela 283/285 · Pavilhão 248/229 · Torre 336/328 · fenda 153 · contato 360.
Carregamento: FCP 352 ms · LCP 4,3 s · TBT ≈ 1,2 s · CLS 0.
Capturas: `relatorio/iter2/antes` e `relatorio/iter2/depois`.
