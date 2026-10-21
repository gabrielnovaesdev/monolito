# Plano: realismo nos projetos (opção 2)

Brief para uma sessão autônoma agendada. O usuário aprovou a opção 2 em 2026-10-20.

## Contexto
- Site em `monolito/` (branch git `monolito`), HTML/CSS/JS sem build, Three.js 0.160 via importmap.
- Arquivos: `engine.js` (renderizador, WorldMixPass, bloom/grade), `desert.js` (deserto + monólito), `projects.js` (4 projetos), `kit.js` (céu, materiais, pessoas, árvores), `textures.js`, `main.js` (rolagem/UI), `styles.css`, `index.html`.
- Servidor local: `preview_start` com o nome `monolito` (porta 5175). Inspeção no console: `__mono.engine.debug()`, `__mono.lenis`.
- Fonte: Inter Tight. Não mudar layout, textos, transições nem coreografia da porta. O objetivo é **somente realismo visual**.

## Fontes e limites de download aprovados pelo usuário
- Fontes permitidas, todas CC0: **polyhaven.com** (API `api.polyhaven.com`, arquivos `dl.polyhaven.org`) e **ambientcg.com**.
- Nada de outras origens, nada executável, nada que exija login.
- Limites: HDRI em **2K, .hdr**, no máximo 5 arquivos. Texturas PBR em **1K, JPG**, no máximo 8 conjuntos. Modelos glTF do Poly Haven em **1K**, no máximo 6. **Total ≤ 120 MB** em `monolito/assets/`.
- Registrar cada arquivo em `monolito/assets/CREDITOS.md`, com nome, URL, licença e tamanho.

## Etapas, em ordem de impacto (commit ao fim de cada uma)
1. **HDRI por cenário + AgX.**
   - Escolher pela API do Poly Haven: deserto ao pôr do sol (Casa Duna e o deserto do monólito), campo ao anoitecer (Capela), céu limpo de manhã (Pavilhão), cidade à noite (Torre).
   - Carregar com `RGBELoader`, usar como `scene.environment` e, onde fizer sentido, como fundo. Manter a névoa coerente.
   - Trocar o tone mapping para `THREE.AgXToneMapping` e reajustar a exposição.
2. **Texturas PBR** (ambientCG ou Poly Haven) para concreto de fôrma, travertino, areia, asfalto e pedra do caminho. Mapas de cor, normal, rugosidade e AO, com `repeat` em escala real.
3. **Pós-processamento.**
   - Adicionar oclusão de ambiente com N8AO via CDN em versão fixa, que funcione com three 0.160. Se não houver compatibilidade, usar `SAOPass` ou `GTAOPass` do three.
   - Adicionar anti-aliasing com `SMAAPass` e um bokeh sutil, só nos projetos.
   - Água e vidro: `Reflector` do three na Casa Duna e no Pavilhão Arco, só no desktop.
4. **Vegetação e pessoas.**
   - Modelos glTF CC0 do Poly Haven (árvores e plantas) no lugar dos icosaedros.
   - Pessoas: manter as silhuetas, mas com proporção melhor. Não usar Mixamo, porque exige login.
5. **Edifícios.** Só se o Blender estiver instalado (`where blender`).
   - Modelar em Python headless: chanfros, caixilhos, mobiliário, bake de AO.
   - Exportar glTF com Draco.
   - Sem Blender, refinar em código: `RoundedBoxGeometry` nas lajes, caixilhos com perfil, peitoris e pingadeiras.

## Critérios de aceite e verificação
- Console sem erros. Testar em 1440×900 e 390×844, com capturas do hero, da porta, dos 4 projetos e do contato.
- Para posicionar a câmera, usar `__mono.lenis.scrollTo(..., {immediate:true})` + `ScrollTrigger.update()`. Mostrar o painel do navegador com `show_pane preview`.
- Celular: DPR ≤ 1,25 e SSR/Reflector desligados; HDRI 1K no celular, se possível.
- Carregamento progressivo: o hero não pode esperar os assets dos projetos.
- Lighthouse desktop medido antes e depois, com os números anotados no relatório.
- Ao final: um commit por etapa no branch `monolito` (**sem push**) e um relatório em `monolito/RELATORIO-REALISMO.md` com o que foi feito, as capturas, os números e o que ficou de fora.
- Se algo falhar ou exceder os limites, parar aquela etapa, registrar no relatório e seguir para a próxima.
