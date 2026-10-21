# Créditos dos assets

Todos os arquivos abaixo são **CC0 (domínio público)**. Baixados em 2026-10-21.
Versões `_1k` de HDRI são reduções feitas localmente a partir do arquivo 2K (script `blender/hdr-tool.mjs`), não downloads.

## HDRI (Poly Haven)

| Arquivo | Origem | Licença | Tamanho |
|---|---|---|---|
| hdri/quarry_01_2k.hdr | https://polyhaven.com/a/quarry_01 | CC0 | 6,0 MB |
| hdri/aarfontein_dawn_2_2k.hdr | https://polyhaven.com/a/aarfontein_dawn_2 | CC0 | 6,2 MB |
| hdri/qwantani_mid_morning_puresky_2k.hdr | https://polyhaven.com/a/qwantani_mid_morning_puresky | CC0 | 4,4 MB |
| hdri/modern_buildings_night_2k.hdr | https://polyhaven.com/a/modern_buildings_night | CC0 | 6,5 MB |
| hdri/*_1k.hdr (4 arquivos, derivados) | reduções locais dos 2K acima | CC0 | 2,1 MB cada |

## Texturas PBR 1K (Poly Haven) — cor, normal GL e ARM (oclusão/rugosidade/metal)

| Conjunto | Origem | Licença | Uso | Tamanho (3 arquivos) |
|---|---|---|---|---|
| tex/concrete_layers_02_* | https://polyhaven.com/a/concrete_layers_02 | CC0 | concreto de fôrma (Casa Duna, Capela, lajes da Torre) | 1,8 MB |
| tex/preconcrete_wall_001_* | https://polyhaven.com/a/preconcrete_wall_001 | CC0 | pedra porosa clara no lugar do travertino (arcos, bancos, deck) | 0,5 MB |
| tex/large_floor_tiles_02_* | https://polyhaven.com/a/large_floor_tiles_02 | CC0 | piso da praça do Pavilhão | 1,0 MB |
| tex/dense_sand_* | https://polyhaven.com/a/dense_sand | CC0 | areia (deserto e Casa Duna) | 2,4 MB |
| tex/asphalt_02_* | https://polyhaven.com/a/asphalt_02 | CC0 | asfalto da Torre | 2,3 MB |
| tex/granite_tile_03_* | https://polyhaven.com/a/granite_tile_03 | CC0 | pedras do caminho da Capela | 2,3 MB |
| tex/forrest_ground_01_* | https://polyhaven.com/a/forrest_ground_01 | CC0 | solo sob o capim da Capela | 2,6 MB |

## Modelos glTF (Poly Haven) — originais 1K baixados fora de `assets/`, reduzidos no Blender 5.2 (`blender/vegetacao.py`) e exportados em GLB com Draco

| Arquivo | Origem | Licença | Redução | Tamanho |
|---|---|---|---|---|
| models/arvore.glb | https://polyhaven.com/a/island_tree_02 | CC0 | 1,07 M → 46,5 mil triângulos (34% das folhas, ampliadas 1,45×; texturas de tronco e galhos em 512 px) | 2,2 MB |
| models/rocha.glb | https://polyhaven.com/a/namaqualand_boulder_04 | CC0 | 59 mil → 3 mil triângulos | 2,4 MB |
| models/arbusto-seco.glb | https://polyhaven.com/a/wild_rooibos_bush | CC0 | variantes a–c, 23,6 mil → 9 mil triângulos | 2,1 MB |
| models/arbusto.glb | https://polyhaven.com/a/othonna_cerarioides | CC0 | variantes b, d, f, 40 mil → 12 mil triângulos (texturas de caule em 512 px) | 0,7 MB |

Decodificador Draco: `three@0.160.0/examples/jsm/libs/draco/gltf/` via cdn.jsdelivr.net (versão fixa).
