# Lista objetos, materiais e triângulos de um glTF (blender -b --python inspecionar.py -- arquivo.gltf)
import bpy, sys
path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
tot = 0
for o in bpy.context.scene.objects:
    if o.type != 'MESH':
        print('OBJ', o.name, o.type); continue
    me = o.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    tot += tris
    print('MESH', o.name, 'tris', tris, 'mats', [m.name for m in me.materials if m], 'dims', tuple(round(x, 2) for x in o.dimensions), 'parent', o.parent.name if o.parent else None)
print('TOTAL', tot)
