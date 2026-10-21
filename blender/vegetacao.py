# Reduz modelos CC0 do Poly Haven para a web e exporta GLB com Draco.
# Uso: blender -b --factory-startup --python vegetacao.py -- <entrada.gltf> <saida.glb> <modo> [parametros]
#   modo "arvore": tronco/galhos com Decimate; folhas: mantém uma fração das folhas (ilhas inteiras) e amplia cada uma
#   modo "solido":  Decimate em tudo até o alvo de triângulos
#   Objetos cujo nome não está em `keep` (lista separada por vírgula, opcional) são descartados.
import bpy, bmesh, sys, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, mode = argv[0], argv[1], argv[2]
opts = dict(a.split('=') for a in argv[3:])
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if 'keep' in opts:
    keep = opts['keep'].split(',')
    for o in meshes:
        if o.name not in keep: bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)

def decimate(o, target):
    t = tris(o)
    if t <= target: return
    m = o.modifiers.new('dec', 'DECIMATE')
    m.ratio = max(0.002, target / t)
    m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)

def separate_by_material(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    return [x for x in bpy.context.selected_objects]

def thin_leaves(o, keep_frac, grow):
    # Remove folhas inteiras ao acaso e amplia as que ficam em torno do próprio centro (mantém a cobertura da copa)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    seen, islands = set(), []
    for f in bm.faces:
        if f.index in seen: continue
        stack, isl = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop(); isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen: seen.add(h.index); stack.append(h)
        islands.append(isl)
    kill = []
    for isl in islands:
        if random.random() > keep_frac: kill.extend(isl); continue
        verts = {v for f in isl for v in f.verts}
        c = sum((v.co for v in verts), Vector()) / len(verts)
        for v in verts: v.co = c + (v.co - c) * grow
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(o.data); bm.free()
    print('folhas: ilhas', len(islands), 'tris agora', tris(o))

if mode == 'arvore':
    parts = []
    for o in meshes: parts += separate_by_material(o)
    for p in parts:
        mat = p.data.materials[0].name if p.data.materials else ''
        if 'leaves' in mat:
            thin_leaves(p, float(opts.get('leaf_keep', 0.1)), float(opts.get('leaf_grow', 2.2)))
            decimate(p, int(opts.get('leaves', 20000)))
        elif 'branches' in mat:
            decimate(p, int(opts.get('branches', 8000)))
        else:
            decimate(p, int(opts.get('trunk', 3000)))
        print('PARTE', p.name, mat, tris(p))
else:
    total = sum(tris(o) for o in meshes)
    target = int(opts.get('target', 4000))
    for o in meshes: decimate(o, max(200, int(target * tris(o) / total)))
    for o in meshes: print('PARTE', o.name, tris(o))

print('TOTAL', sum(tris(o) for o in bpy.context.scene.objects if o.type == 'MESH'))

# Texturas: as que não são de folha caem para `tex` px (tronco e galhos aparecem pequenos na tela)
small = int(opts.get('tex', 0))
if small:
    for img in bpy.data.images:
        if img.size[0] > small and 'leaves' not in img.name:
            img.scale(small, small)
            print('TEX', img.name, small)
bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6, export_image_format='AUTO', export_apply=True,
)
