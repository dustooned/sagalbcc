// 3D models on the table: limits and the student-facing explanations for them. Shared so the
// browser's pre-check and the server's check agree on numbers and wording exactly.

export const MODEL_LIMITS = {
  /** Upload size, in MB. */
  maxMB: 15,
  /** Triangles across the whole model. Plenty for a game piece; a raw sculpt is millions. */
  maxTriangles: 100_000,
  /** Largest texture edge, in pixels. */
  maxTexturePx: 4096,
} as const;

export interface ModelProblem {
  /** One line: what's wrong. */
  error: string;
  /** Why it matters and exactly how to fix it in Blender. */
  fix: string;
}

const EXPORT_STEPS = 'In Blender: File → Export → glTF 2.0 (.glb/.gltf). On the right, set Format to "glTF Binary (.glb)", tick Include → Selected Objects and Data → Mesh → Apply Modifiers, leave Compression off, then Export. Load that .glb file here.';

/** glTF extensions that pack meshes in a way this table's loader doesn't decode. */
export const UNSUPPORTED_GLTF_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression'];

/** The export checklist shown from the ⓘ next to "Add 3D model". */
export const BLENDER_EXPORT_HELP: ModelProblem = {
  error: 'Exporting a 3D model from Blender',
  fix: [
    'Easiest: the SAGA Blender add-on bakes and exports in one click. Download it from the Manual (📖 in Table Tools → 3D models).',
    'By hand — before exporting: select only your model, then Ctrl+A → All Transforms.',
    'File → Export → glTF 2.0, then set:',
    '• Format: glTF Binary (.glb)',
    '• Include: ☑ Selected Objects',
    '• Data → Mesh: ☑ Apply Modifiers',
    '• Data → Compression: OFF',
    '• Animation: OFF',
    'Limits: 15 MB · 100,000 triangles · textures up to 4096 px (2048 is better).',
    'Size and position don’t matter: the table scales it to about 3 inches.',
    'Quick option: .obj or .stl also work, but show as one plain color (no textures).',
  ].join('\n'),
};

export const modelProblems = {
  wrongFormat: (name: string): ModelProblem => ({
    error: `"${name}" isn't a 3D format the table can load.`,
    fix: `Use .glb (keeps colors and textures) — or .obj / .stl for a quick plain-colored shape. ${EXPORT_STEPS}`,
  }),
  tooBig: (mb: number): ModelProblem => ({
    error: `This model is ${mb.toFixed(1)} MB — the limit is ${MODEL_LIMITS.maxMB} MB.`,
    fix: 'Big files are slow for everyone at the table to download. Usually it\'s the textures: in Blender, open the Image Editor, then Image → Resize to 1024 or 2048, and re-export. If it\'s still big, reduce polygons (see below).',
  }),
  tooManyTriangles: (tris: number): ModelProblem => ({
    error: `This model has ${tris.toLocaleString()} triangles — the limit is ${MODEL_LIMITS.maxTriangles.toLocaleString()}.`,
    fix: 'Too many triangles makes the table stutter on school laptops and phones. In Blender: select the model, add a Decimate modifier (Properties → wrench icon → Add Modifier → Generate → Decimate), lower Ratio until the triangle count at the bottom of the screen is under the limit, then apply it and re-export. For a game piece, 5,000–20,000 triangles is plenty.',
  }),
  textureTooLarge: (px: number): ModelProblem => ({
    error: `One texture is ${px} px wide — the limit is ${MODEL_LIMITS.maxTexturePx} px.`,
    fix: 'Huge textures eat memory and can crash phones. In Blender: open the Image Editor, pick the texture, then Image → Resize to 2048 (or 1024), and re-export.',
  }),
  externalFiles: (): ModelProblem => ({
    error: 'This model points to separate texture or data files.',
    fix: `Only a single self-contained file can be shared with the table. ${EXPORT_STEPS} "glTF Binary" packs everything into one file.`,
  }),
  compressed: (): ModelProblem => ({
    error: 'This model uses mesh compression (Draco), which the table can’t read.',
    fix: `Re-export with compression turned off: in the glTF export panel, open Data → Compression and untick it. ${EXPORT_STEPS}`,
  }),
  unreadable: (): ModelProblem => ({
    error: 'That file couldn\'t be read as a 3D model.',
    fix: `It may be damaged or not really a glTF file. ${EXPORT_STEPS}`,
  }),
  empty: (): ModelProblem => ({
    error: 'That model has nothing to show.',
    fix: 'The export had no visible mesh. In Blender, make sure the object is selected (or uncheck "Selected Objects" under Include when exporting), then export again.',
  }),
};
