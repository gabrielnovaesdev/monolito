# Modela os edifícios em Python headless e assa a oclusão de ambiente (Cycles).
# Uso: blender -b --factory-startup --python edificios.py -- <casa|capela> <pasta_saida>
# Coordenadas escritas como no three.js (x, y para cima, z para a câmera) e convertidas para o Blender (x, -z, y).
# Saída: <nome>.glb (Draco, UV0 em metros, UV1 = mapa de luz) e <nome>-ao.jpg (oclusão assada no UV1).
# Materiais por nome; o site troca cada um pelo material PBR correspondente.
import bpy, bmesh, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
which, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATS = {}

def mat(name):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        MATS[name] = m
    return MATS[name]

def to_bl(x, y, z): return Vector((x, -z, y))

def box(name, w, h, d, x, y, z, material, bevel=0.012, rot=0.0, bake=True):
    bpy.ops.mesh.primitive_cube_add(size=1, location=to_bl(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, d, h)
    o.rotation_euler = (0, 0, rot)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(mat(material))
    if bevel > 0:
        b = o.modifiers.new('chanfro', 'BEVEL')
        b.width = min(bevel, w / 3, h / 3, d / 3); b.segments = 2; b.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=b.name)
    o['bake'] = bake
    return o

def cyl(name, r, h, x, y, z, material, verts=24, bake=True):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=to_bl(x, y, z))
    o = bpy.context.active_object; o.name = name
    o.data.materials.append(mat(material)); o['bake'] = bake
    return o

def sphere(name, r, x, y, z, material, bake=False):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=24, ring_count=12, location=to_bl(x, y, z))
    o = bpy.context.active_object; o.name = name
    o.data.materials.append(mat(material)); o['bake'] = bake
    bpy.ops.object.shade_smooth()
    return o

def metric_uv(o):
    # UV0 em metros: projeção pela face dominante (a textura repete na escala real)
    bm = bmesh.new(); bm.from_mesh(o.data)
    uv = bm.loops.layers.uv.verify()
    mw = o.matrix_world
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            p = mw @ l.vert.co
            if ax == 0: l[uv].uv = (p.y, p.z)
            elif ax == 1: l[uv].uv = (p.x, p.z)
            else: l[uv].uv = (p.x, p.y)
    bm.to_mesh(o.data); bm.free()

def finish(prefix, ao_size=2048, ao_dist=1.2, samples=48):
    objs = [o for o in scene.objects if o.type == 'MESH']
    for o in objs:
        o.data.uv_layers.new(name='UVMap') if not o.data.uv_layers else None
        metric_uv(o)
    bakeable = [o for o in objs if o.get('bake', True)]
    # Junta tudo que recebe AO num único objeto (um mapa de luz só)
    bpy.ops.object.select_all(action='DESELECT')
    for o in bakeable: o.select_set(True)
    bpy.context.view_layer.objects.active = bakeable[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = prefix
    lm = body.data.uv_layers.new(name='lightmap')
    body.data.uv_layers.active = lm
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Chão de areia para a oclusão do contato com o terreno (não é exportado)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.001))
    ground = bpy.context.active_object
    # Assa a AO
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.world = bpy.data.worlds.new('mundo')
    scene.world.light_settings.distance = ao_dist
    img = bpy.data.images.new(prefix + '-ao', ao_size, ao_size, alpha=False)
    for m in body.data.materials:
        nt = m.node_tree
        node = nt.nodes.new('ShaderNodeTexImage'); node.image = img
        nt.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True, uv_layer='lightmap')
    img.filepath_raw = os.path.join(out, prefix + '-ao.jpg')
    img.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    img.save_render(img.filepath_raw, scene=scene)
    # Os nós do bake não vão para o glTF
    for m in body.data.materials:
        for n in [n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE']: m.node_tree.nodes.remove(n)
    bpy.data.objects.remove(ground, do_unlink=True)
    body.data.uv_layers.active = body.data.uv_layers[0]
    print('TRIS', sum(len(p.vertices) - 2 for o in scene.objects if o.type == 'MESH' for p in o.data.polygons))
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out, prefix + '.glb'), export_format='GLB', export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6, export_texcoords=True, export_normals=True, export_materials='EXPORT',
        export_image_format='NONE', export_apply=True,
    )

# ======================================================================
# 01 · CASA DUNA (mesmas medidas da versão em código)
# ======================================================================
def casa():
    C, D, BZ, V, L = 'concreto', 'deck', 'bronze', 'vidro', 'luz'
    box('deck', 30, 0.5, 16, 0, 0.25, 0, D, bevel=0.03)
    # Borda da piscina (a água continua no código)
    for (w, d, x, z) in [(13.6, 0.3, -5, 2.95), (13.6, 0.3, -5, 7.45), (0.3, 4.2, -11.65, 5.2), (0.3, 4.2, 1.65, 5.2)]:
        box('borda', w, 0.1, d, x, 0.55, z, D, bevel=0.015)
    # Volume térreo com porta recuada de vidro escuro
    box('terreo', 12, 3.2, 8, 2, 2.1, -2.5, C, bevel=0.02)
    box('porta-recuo', 2.0, 2.5, 0.12, 5.6, 1.75, 1.47, 'escuro', bevel=0.005)
    for dx in (-1.0, 1.0): box('porta-batente', 0.06, 2.5, 0.16, 5.6 + dx, 1.75, 1.5, BZ, bevel=0.004)
    box('porta-verga', 2.12, 0.06, 0.16, 5.6, 3.0, 1.5, BZ, bevel=0.004)
    # Laje do vidro com pingadeira (friso sob a borda)
    box('laje', 19, 0.3, 9.2, 4, 3.85, -2.4, C, bevel=0.02)
    box('pingadeira', 19.1, 0.03, 9.3, 4, 3.69, -2.4, BZ, bevel=0.0)
    # Faixa de vidro: caixilhos com perfil nos quatro lados, travessas em cima e embaixo
    X0, X1, Z0, Z1, Y0, Y1 = -3.0, 11.0, -6.2, 1.4, 4.0, 6.9
    box('vidro-frente', X1 - X0, Y1 - Y0, 0.02, 4, 5.45, Z1, V, bevel=0, bake=False)
    box('vidro-fundo', X1 - X0, Y1 - Y0, 0.02, 4, 5.45, Z0, V, bevel=0, bake=False)
    box('vidro-esq', 0.02, Y1 - Y0, Z1 - Z0, X0, 5.45, -2.4, V, bevel=0, bake=False)
    box('vidro-dir', 0.02, Y1 - Y0, Z1 - Z0, X1, 5.45, -2.4, V, bevel=0, bake=False)
    x = X0
    while x <= X1 + 0.01:
        for z in (Z1, Z0): box('montante', 0.06, Y1 - Y0, 0.12, x, 5.45, z, BZ, bevel=0.006)
        x += 1.4
    z = Z0
    while z <= Z1 + 0.01:
        for xx in (X0, X1): box('montante', 0.12, Y1 - Y0, 0.06, xx, 5.45, z, BZ, bevel=0.006)
        z += 1.52
    for y in (Y0 + 0.04, Y1 - 0.04):
        box('travessa', X1 - X0 + 0.1, 0.08, 0.12, 4, y, Z1, BZ, bevel=0.006)
        box('travessa', X1 - X0 + 0.1, 0.08, 0.12, 4, y, Z0, BZ, bevel=0.006)
        box('travessa', 0.12, 0.08, Z1 - Z0, X0, y, -2.4, BZ, bevel=0.006)
        box('travessa', 0.12, 0.08, Z1 - Z0, X1, y, -2.4, BZ, bevel=0.006)
    # Interior: piso de madeira, estar, jantar, cozinha, estante e luminárias
    box('piso', 13.8, 0.04, 7.4, 4, 4.02, -2.4, 'madeira', bevel=0)
    box('tapete', 4.2, 0.02, 3.0, 1.4, 4.05, -1.2, 'tecido', bevel=0.004)
    # Sofá: base, assento, encosto, braços e almofadas
    box('sofa-base', 3.4, 0.22, 1.05, 1.2, 4.17, -0.75, 'escuro', bevel=0.01)
    box('sofa-assento', 3.2, 0.2, 0.95, 1.2, 4.38, -0.72, 'sofa', bevel=0.05)
    box('sofa-encosto', 3.4, 0.55, 0.22, 1.2, 4.6, -1.2, 'sofa', bevel=0.06)
    for dx in (-1.62, 1.62): box('sofa-braco', 0.18, 0.42, 1.05, 1.2 + dx, 4.45, -0.75, 'sofa', bevel=0.05)
    for dx in (-0.8, 0.0, 0.8): box('almofada', 0.7, 0.42, 0.16, 1.2 + dx, 4.72, -1.02, 'tecido', bevel=0.06, rot=0.0)
    box('mesa-centro', 1.2, 0.06, 0.7, 1.4, 4.4, 0.35, 'madeira', bevel=0.01)
    for (dx, dz) in [(-0.5, -0.27), (0.5, -0.27), (-0.5, 0.27), (0.5, 0.27)]: box('pe', 0.04, 0.34, 0.04, 1.4 + dx, 4.2, 0.35 + dz, BZ, bevel=0)
    # Jantar: mesa e seis cadeiras
    box('mesa', 2.2, 0.06, 1.0, 6, 4.77, -1.6, 'madeira', bevel=0.01)
    for (dx, dz) in [(-1.0, -0.42), (1.0, -0.42), (-1.0, 0.42), (1.0, 0.42)]: box('pe', 0.06, 0.73, 0.06, 6 + dx, 4.38, -1.6 + dz, 'escuro', bevel=0.005)
    for i, dx in enumerate((-0.7, 0.0, 0.7)):
        for sz in (-1, 1):
            cz = -1.6 + sz * 0.78
            box('cadeira-assento', 0.46, 0.05, 0.46, 6 + dx, 4.47, cz, 'madeira', bevel=0.008)
            box('cadeira-encosto', 0.46, 0.42, 0.04, 6 + dx, 4.72, cz + sz * 0.21, 'madeira', bevel=0.008)
            for (ex, ez) in [(-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)]: box('pe', 0.03, 0.45, 0.03, 6 + dx + ex, 4.24, cz + ez, 'escuro', bevel=0)
    # Cozinha: ilha e armários no fundo
    box('ilha', 2.6, 0.92, 0.9, 9.0, 4.48, -3.6, 'concreto', bevel=0.015)
    box('ilha-tampo', 2.7, 0.04, 1.0, 9.0, 4.96, -3.6, 'escuro', bevel=0.006)
    box('armarios', 4.0, 2.3, 0.6, 9.0, 5.17, -5.75, 'madeira', bevel=0.01)
    # Estante no fundo do estar
    box('estante', 3.2, 2.2, 0.35, 1.0, 5.12, -5.9, 'madeira', bevel=0.008)
    for y in (4.6, 5.15, 5.7): box('prateleira-livros', 2.9, 0.26, 0.24, 1.0, y + 0.14, -5.85, 'tecido', bevel=0.01)
    # Pendentes sobre a mesa e luminária de piso (as esferas brilham no código)
    for dx in (-0.6, 0.6):
        cyl('pendente-fio', 0.006, 1.2, 6 + dx, 6.3, -1.6, 'escuro', verts=6)
        sphere('pendente', 0.16, 6 + dx, 5.62, -1.6, L)
    cyl('luminaria-haste', 0.015, 1.5, 8.8, 4.77, -0.4, BZ, verts=8)
    sphere('luminaria', 0.26, 8.8, 5.2, -0.4, L)
    box('forro-luz', 12, 0.04, 5.8, 4, 6.85, -2.4, L, bevel=0, bake=False)
    # Volume superior em balanço; rasgo de luz recuado com moldura
    box('superior', 21, 3.2, 8.6, 7, 8.6, -2.6, C, bevel=0.02)
    box('rasgo-moldura', 15.2, 0.62, 0.05, 8, 8.7, 1.71, 'escuro', bevel=0.004)
    box('rasgo-luz', 15, 0.42, 0.06, 8, 8.7, 1.73, L, bevel=0, bake=False)
    box('cobertura', 21.4, 0.22, 9, 7, 10.3, -2.6, BZ, bevel=0.01)
    box('rufo', 21.5, 0.04, 9.1, 7, 10.18, -2.6, 'escuro', bevel=0)
    # Escada: degraus, viga lateral de concreto e corrimão de bronze
    for i in range(9): box('degrau', 1.6, 0.18, 0.42, -4.8, 0.6 + i * 0.37, -6.6 + i * 0.42, C, bevel=0.01)
    for i in range(9): box('viga', 0.12, 0.5, 0.48, -5.66, 0.45 + i * 0.37, -6.6 + i * 0.42, C, bevel=0.008)
    import math as _m
    ang = _m.atan2(0.37, 0.42)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.022, depth=5.0, vertices=10, location=to_bl(-4.05, 2.95, -4.92))
    rail = bpy.context.active_object; rail.name = 'corrimao'
    rail.rotation_euler = (_m.pi / 2 - ang, 0, 0)
    rail.data.materials.append(mat(BZ)); rail['bake'] = True
    for i in (0, 4, 8): box('montante-corrimao', 0.03, 0.9, 0.03, -4.05, 1.05 + i * 0.37, -6.6 + i * 0.42, BZ, bevel=0)
    finish('casa-duna')

# ======================================================================
# 02 · CAPELA FENDA (cubo 8 × 9 × 8 m, paredes de 0,5 m, cruz vazada)
# ======================================================================
def capela():
    C = 'concreto'
    W, H, T = 8.0, 9.0, 0.5
    box('fundo', W, H, T, 0, H / 2, -W / 2 + T / 2, C, bevel=0.02)
    box('lado-esq', T, H, W, -W / 2 + T / 2, H / 2, 0, C, bevel=0.02)
    box('lado-dir', T, H, W, W / 2 - T / 2, H / 2, 0, C, bevel=0.02)
    box('teto', W, T, W, 0, H - T / 2, 0, C, bevel=0.02)
    box('piso', W, 0.2, W, 0, 0.1, 0, C, bevel=0.02)
    # Frente: uma laje só, com a cruz recortada por booleana (sem juntas por onde a luz vaze)
    y0, y1, s, cy, arm, z = H * 0.13, H * 0.88, 0.21, H * 0.66, 2.2, W / 2 - T / 2
    front = box('frente', W, H, T, 0, H / 2, z, C, bevel=0)
    cutters = [box('corte', 2 * s, y1 - y0, T * 3, 0, (y0 + y1) / 2, z, C, bevel=0), box('corte', 2 * arm, 2 * s, T * 3, 0, cy, z, C, bevel=0)]
    for k in cutters:
        m = front.modifiers.new('cruz', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = k; m.solver = 'EXACT'
        bpy.context.view_layer.objects.active = front
        bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.data.objects.remove(k, do_unlink=True)
    bv = front.modifiers.new('chanfro', 'BEVEL'); bv.width = 0.015; bv.segments = 2; bv.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = front
    bpy.ops.object.modifier_apply(modifier=bv.name)
    # Interior: bancos, altar de pedra e degrau
    for i in range(4):
        zz = 1.6 - i * 1.15
        for sx in (-1, 1):
            box('banco', 2.2, 0.08, 0.42, sx * 1.6, 0.66, zz, 'madeira', bevel=0.01)
            box('banco-encosto', 2.2, 0.4, 0.05, sx * 1.6, 0.98, zz - 0.2, 'madeira', bevel=0.01)
            for ex in (-0.95, 0.95): box('banco-pe', 0.06, 0.46, 0.4, sx * 1.6 + ex, 0.43, zz, 'escuro', bevel=0.004)
    box('degrau-altar', 4.4, 0.18, 1.6, 0, 0.29, -2.6, C, bevel=0.01)
    box('altar', 1.8, 0.95, 0.7, 0, 0.855, -2.7, 'pedra', bevel=0.02)
    finish('capela', ao_dist=1.6)

{'casa': casa, 'capela': capela}[which]()
