# SAGA Bake & Export — Blender add-on (4.2+ / 5.x)
#
# INSTALL (once): Edit > Preferences > Add-ons > ⌄ (top right) > Install from Disk… > pick this
# file > tick "SAGA Bake & Export". Then in the 3D Viewport press N and open the "SAGA" tab.
#
# USE: select your model > SAGA tab > Bake & Export. The .glb lands next to your .blend (or on
# your Desktop if unsaved) — drop it onto the SAGA table.
#
# Bakes procedural nodes, color ramps, noise, vertex colors and image textures into one small
# .glb. Never changes your original model: it bakes onto a copy, exports it, then deletes it.

bl_info = {
    "name": "SAGA Bake & Export",
    "author": "LBCC DMA",
    "version": (1, 1, 0),
    "blender": (4, 2, 0),
    "location": "3D Viewport > Sidebar (N) > SAGA",
    "description": "One click: bake your model's look into a small .glb for the SAGA playtest table",
    "category": "Import-Export",
}

import bpy
import os
import time

# ---- settings you can change ------------------------------------------------------------
TEXTURE_SIZE = 1024        # 1024 is plenty for a game piece; 2048 for big hero models
SAMPLES = 16               # bake quality; higher = slower, rarely needed for plain color
JPEG_QUALITY = 85          # smaller file = faster for everyone at the table
# ------------------------------------------------------------------------------------------

OUTPUT_FOLDER = ""        # add-on panel can set a folder; empty = next to the .blend
LIMIT_MB, LIMIT_TRIS = 15, 100_000
UV_NAME = "SAGA_Bake"


def fail(msg):
    raise RuntimeError("SAGA bake: " + msg)


def triangles(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    mesh = obj.evaluated_get(deps).to_mesh()
    n = sum(len(p.vertices) - 2 for p in mesh.polygons)
    obj.evaluated_get(deps).to_mesh_clear()
    return n


def ensure_material(obj):
    if not obj.material_slots or all(s.material is None for s in obj.material_slots):
        mat = bpy.data.materials.new(obj.name + "_Color")
        mat.use_nodes = True
        obj.data.materials.append(mat)
    for slot in obj.material_slots:
        if slot.material and not slot.material.use_nodes:
            slot.material.use_nodes = True


def unwrap(obj):
    uv = obj.data.uv_layers.get(UV_NAME) or obj.data.uv_layers.new(name=UV_NAME)
    obj.data.uv_layers.active = uv
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    # Low-poly models with many separate faces can end up squeezed into a thin strip, leaving
    # each face only a few pixels (which shows up as a dotted pattern in SAGA). Evening out the
    # island sizes and repacking fills the whole square instead.
    bpy.ops.uv.select_all(action="SELECT")
    for step in (lambda: bpy.ops.uv.average_islands_scale(),
                 lambda: bpy.ops.uv.pack_islands(rotate=True, margin=0.004)):
        try:
            step()
        except (TypeError, RuntimeError):
            pass
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_color(obj):
    img = bpy.data.images.new(obj.name + "_baked", TEXTURE_SIZE, TEXTURE_SIZE)
    img.generated_color = (0.5, 0.5, 0.5, 1.0)
    temp_nodes = []
    for slot in obj.material_slots:
        if not slot.material:
            continue
        nodes = slot.material.node_tree.nodes
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        nodes.active = node           # Blender bakes into the *active* image node
        temp_nodes.append((nodes, node))

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = SAMPLES
    scene.cycles.device = "CPU"      # works on every school computer
    bake = scene.render.bake
    bake.use_pass_direct = False      # color only — no baked-in shadows or lights
    bake.use_pass_indirect = False
    bake.use_pass_color = True
    # A wide margin pushes each face's color out past its edges, so distant (mipmapped) views
    # never blend in the empty black between islands.
    bake.margin = max(16, TEXTURE_SIZE // 32)
    try:
        bake.margin_type = "EXTEND"
    except (AttributeError, TypeError):
        pass

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="DIFFUSE")

    for nodes, node in temp_nodes:
        nodes.remove(node)
    img.pack()
    return img


def baked_copy(obj, img):
    copy = obj.copy()
    copy.data = obj.data.copy()
    bpy.context.collection.objects.link(copy)
    for uv in [u for u in copy.data.uv_layers if u.name != UV_NAME]:
        copy.data.uv_layers.remove(uv)

    mat = bpy.data.materials.new(obj.name + "_SAGA")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.7

    copy.data.materials.clear()
    copy.data.materials.append(mat)
    return copy, mat


def ensure_gltf_exporter():
    """The glTF exporter ships with Blender but can be switched off in Preferences."""
    if hasattr(bpy.ops.export_scene, "gltf") and "gltf" in dir(bpy.ops.export_scene):
        return
    import addon_utils
    for module in ("io_scene_gltf2", "bl_ext.blender_org.io_scene_gltf2"):
        try:
            addon_utils.enable(module, default_set=True, persistent=True)
        except Exception:
            continue
        if "gltf" in dir(bpy.ops.export_scene):
            return
    fail("the glTF exporter is turned off. Edit > Preferences > Add-ons, search 'glTF', tick "
         "'Import-Export: glTF 2.0 format', then Run again.")


def export(copies, name):
    ensure_gltf_exporter()
    folder = OUTPUT_FOLDER or (os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.path.join(os.path.expanduser("~"), "Desktop"))
    if not os.path.isdir(folder):
        folder = os.path.expanduser("~")
    path = os.path.join(folder, name + ".glb")
    bpy.ops.object.select_all(action="DESELECT")
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    opts = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                export_animations=False, export_draco_mesh_compression_enable=False,
                export_image_format="JPEG")
    # Option names shift a little between Blender versions: try the richest set first.
    attempts = [dict(opts, export_jpeg_quality=JPEG_QUALITY), dict(opts, export_image_quality=JPEG_QUALITY), opts,
                {k: v for k, v in opts.items() if k != "export_image_format"}]
    for i, attempt in enumerate(attempts):
        try:
            bpy.ops.export_scene.gltf(**attempt)
            return path
        except TypeError:
            if i == len(attempts) - 1:
                raise
    return path


def run():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    meshes = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    if not meshes:
        fail("select your model first (click it in the viewport), then Run again.")

    ensure_gltf_exporter()  # check before spending time on a bake
    start = time.time()
    tris = sum(triangles(o) for o in meshes)
    copies, temp = [], []
    try:
        for obj in meshes:
            ensure_material(obj)
            unwrap(obj)
            img = bake_color(obj)
            copy, mat = baked_copy(obj, img)
            copies.append(copy)
            temp.append((copy, mat, img))
        name = bpy.path.clean_name(meshes[0].name) or "model"
        path = export(copies, name)
    finally:
        # Always tidy up — even if a step failed — leaving the original scene as it was
        # (apart from an extra "SAGA_Bake" UV map on each original, which is harmless).
        for copy, mat, img in temp:
            mesh = copy.data
            bpy.data.objects.remove(copy)
            bpy.data.meshes.remove(mesh)
            bpy.data.materials.remove(mat)
            bpy.data.images.remove(img)
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)

    mb = os.path.getsize(path) / 1024 / 1024
    notes = []
    if mb > LIMIT_MB:
        notes.append(f"file is {mb:.1f} MB (limit {LIMIT_MB}) — set TEXTURE_SIZE = 512 and run again")
    if tris > LIMIT_TRIS:
        notes.append(f"{tris:,} triangles (limit {LIMIT_TRIS:,}) — add a Decimate modifier (ratio 0.5) and run again")
    msg = f"Saved {path}  ({mb:.2f} MB, {tris:,} triangles, {time.time() - start:.0f}s)"
    print("SAGA bake:", msg)
    for n in notes:
        print("SAGA bake: WARNING", n)
    return {"path": path, "mb": round(mb, 3), "triangles": tris, "warnings": notes}



# ---------------------------------------------------------------- add-on UI

def _output_folder(ctx):
    custom = bpy.path.abspath(ctx.scene.saga_output) if ctx.scene.saga_output else ""
    return custom if custom and os.path.isdir(custom) else ""


class SAGA_OT_bake_export(bpy.types.Operator):
    """Bake the selected model's look into one small .glb for SAGA"""
    bl_idname = "saga.bake_export"
    bl_label = "Bake & Export"
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, ctx):
        return any(o.type == "MESH" for o in ctx.selected_objects)

    def execute(self, ctx):
        global TEXTURE_SIZE, SAMPLES, JPEG_QUALITY, OUTPUT_FOLDER
        s = ctx.scene
        TEXTURE_SIZE, SAMPLES, JPEG_QUALITY = int(s.saga_texture_size), s.saga_samples, s.saga_jpeg_quality
        OUTPUT_FOLDER = _output_folder(ctx)
        try:
            result = run()
        except Exception as err:  # show students the reason instead of a traceback
            self.report({"ERROR"}, str(err))
            return {"CANCELLED"}
        s.saga_last_result = f"{os.path.basename(result['path'])} · {result['mb']:.2f} MB · {result['triangles']:,} tris"
        for w in result["warnings"]:
            self.report({"WARNING"}, w)
        self.report({"INFO"}, "Saved " + result["path"])
        return {"FINISHED"}


class SAGA_OT_open_folder(bpy.types.Operator):
    """Open the folder the last .glb was saved to"""
    bl_idname = "saga.open_folder"
    bl_label = "Open folder"

    def execute(self, ctx):
        folder = _output_folder(ctx) or (os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.path.join(os.path.expanduser("~"), "Desktop"))
        bpy.ops.wm.path_open(filepath=folder)
        return {"FINISHED"}


class SAGA_PT_panel(bpy.types.Panel):
    bl_label = "SAGA Bake & Export"
    bl_idname = "SAGA_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "SAGA"

    def draw(self, ctx):
        s, col = ctx.scene, self.layout.column(align=False)
        n = sum(1 for o in ctx.selected_objects if o.type == "MESH")
        col.label(text=f"{n} model{'s' if n != 1 else ''} selected" if n else "Select your model first", icon="MESH_DATA" if n else "INFO")
        row = col.row()
        row.scale_y = 1.6
        row.operator("saga.bake_export", icon="EXPORT")
        if s.saga_last_result:
            box = col.box()
            box.label(text="Last export:", icon="CHECKMARK")
            box.label(text=s.saga_last_result)
            box.operator("saga.open_folder", icon="FILE_FOLDER")
        col.separator()
        col.label(text="Settings")
        col.prop(s, "saga_texture_size", text="Texture")
        col.prop(s, "saga_jpeg_quality", text="JPEG quality")
        col.prop(s, "saga_samples", text="Bake samples")
        col.prop(s, "saga_output", text="Save to")
        col.label(text="Empty = next to your .blend file", icon="BLANK1")


_PROPS = {
    "saga_texture_size": bpy.props.EnumProperty(
        name="Texture size", default="1024",
        items=[("512", "512 px (smallest)", ""), ("1024", "1024 px (recommended)", ""), ("2048", "2048 px (big models)", "")]),
    "saga_jpeg_quality": bpy.props.IntProperty(name="JPEG quality", default=85, min=40, max=100),
    "saga_samples": bpy.props.IntProperty(name="Bake samples", default=16, min=1, max=256),
    "saga_output": bpy.props.StringProperty(name="Save to", subtype="DIR_PATH", default=""),
    "saga_last_result": bpy.props.StringProperty(default=""),
}
_CLASSES = (SAGA_OT_bake_export, SAGA_OT_open_folder, SAGA_PT_panel)


def register():
    for name, prop in _PROPS.items():
        setattr(bpy.types.Scene, name, prop)
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)
    for name in _PROPS:
        delattr(bpy.types.Scene, name)
