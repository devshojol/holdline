/**
 * Optional weapon skins: GLB models in public/models/weapons that replace the blocky
 * first-person guns (and the bots' rifle).
 *
 * On sidearms the grip point is the middle of the grip (the hold is raised onto it in AnimatedArms).
 *
 * Each model is described by a few points measured on it (after `yaw` turns the barrel to +Z,
 * with +Y up and the model centred on X): the trigger-hand grip, the support-hand handguard,
 * the muzzle and the top of the sight line. The game scales the model to a target length and
 * places it so the grip lands where the first-person hand (or the bot's IK target) is.
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { WeaponId } from '../../types';
import { TransformNode, Vector3, type AbstractMesh, type Scene } from '../rendering/babylon';
import { loadContainer } from '../rendering/gltf';
import { applyGunReflections } from '../rendering/gunEnvironment';

/** A [y, z] point on the model (model units, barrel along +Z). */
type YZ = [number, number];

export interface SkinSpec {
  file: string;
  /** Yaw that points the barrel along +Z. */
  yaw: number;
  /** Model length along the barrel (stock to muzzle), in model units. */
  length: number;
  /** Length the gun is drawn at in first person, in metres (default: 0.92 for primaries, 0.34 for sidearms). */
  viewLength?: number;
  grip: YZ;
  handguard: YZ | null;
  muzzle: YZ;
  /** Height of the top of the gun along the sight line (aim-down-sights alignment). */
  sightY: number;
  /** The sight is an optic you look through: `sightY` is its axis, which aiming puts on the screen centre. */
  aimThrough?: boolean;
  /** Node holding the detachable magazine (drops out on reload). */
  magNode?: string;
  /** Bolt node (bolt action) and a point on the axis it turns about and slides along. */
  boltNode?: string;
  boltAxis?: YZ;
  /** Revolver cylinder node: turns around its local Z axis after each shot. */
  cylinderNode?: string;
  /** Turn per shot = full circle / chambers. */
  chambers?: number;
}

// Our own guns, modelled from code in Blender (tools/blender/make_weapons.py): barrel along +Z, in metres.
// Written by tools/blender/apply_specs.py from tools/blender/out/specs.json.
const SKIN_SPECS: Partial<Record<WeaponId, SkinSpec>> = {
  // Kestrel
  vandal: {
    file: 'models/weapons/vandal.glb',
    yaw: 0,
    length: 0.9104,
    grip: [-0.1, -0.082],
    handguard: [-0.03, 0.26],
    muzzle: [0.0, 0.556],
    sightY: 0.068,
    magNode: 'mag',
  },
  // Halcyon
  phantom: {
    file: 'models/weapons/phantom.glb',
    yaw: 0,
    length: 0.9274,
    grip: [-0.1, -0.076],
    handguard: [-0.03, 0.27],
    muzzle: [0.0, 0.582],
    sightY: 0.067,
    magNode: 'mag',
    aimThrough: true,
  },
  // Hornet
  spectre: {
    file: 'models/weapons/spectre.glb',
    yaw: 0,
    length: 0.6854,
    viewLength: 0.68,
    grip: [-0.104, -0.094],
    handguard: [-0.038, 0.19],
    muzzle: [0.0, 0.3255],
    sightY: 0.059,
    magNode: 'mag',
  },
  // Arbiter
  guardian: {
    file: 'models/weapons/guardian.glb',
    yaw: 0,
    length: 1.1124,
    viewLength: 1.1,
    grip: [-0.106, -0.088],
    handguard: [-0.028, 0.3],
    muzzle: [0.0, 0.712],
    sightY: 0.091,
    magNode: 'mag',
  },
  // Monarch
  operator: {
    file: 'models/weapons/operator.glb',
    yaw: 0,
    length: 1.3024,
    viewLength: 1.2,
    grip: [-0.112, -0.09],
    handguard: [-0.056, 0.3],
    muzzle: [0.0, 0.8005],
    sightY: 0.089,
    magNode: 'mag',
    boltNode: 'bolt',
    boltAxis: [0.0, -0.215],
  },
  // Pilot
  classic: {
    file: 'models/weapons/classic.glb',
    yaw: 0,
    length: 0.2087,
    viewLength: 0.31,
    grip: [-0.078, -0.072],
    handguard: null,
    muzzle: [0.0, 0.1046],
    sightY: 0.0275,
    magNode: 'mag',
  },
  // Whisper
  ghost: {
    file: 'models/weapons/ghost.glb',
    yaw: 0,
    length: 0.4133,
    viewLength: 0.55,
    grip: [-0.078, -0.072],
    handguard: null,
    muzzle: [0.0, 0.3076],
    sightY: 0.034,
    magNode: 'mag',
  },
  // Magnate
  sheriff: {
    file: 'models/weapons/sheriff.glb',
    yaw: 0,
    length: 0.2689,
    grip: [-0.09, -0.076],
    handguard: null,
    muzzle: [0.0, 0.1667],
    sightY: 0.027,
    cylinderNode: 'cylinder',
    chambers: 6,
  },
};

/** The model file of a gun, relative to the site root (null: it has none). */
export function weaponSkinFile(id: WeaponId): string | null {
  return SKIN_SPECS[id]?.file ?? null;
}

/** One placed copy of a skin. Points are in the parent's space. */
export interface PlacedSkin {
  holder: TransformNode;
  meshes: AbstractMesh[];
  scale: number;
  muzzle: Vector3;
  handguard: Vector3 | null;
  sightY: number;
  mag: TransformNode | null;
  cylinder: TransformNode | null;
  bolt: TransformNode | null;
  boltAxis: Vector3 | null;
  dispose(): void;
}

export class WeaponSkin {
  constructor(
    readonly id: WeaponId,
    readonly spec: SkinSpec,
    private readonly container: AssetContainer,
  ) {}

  /** Instantiate under `parent`, scaled to `length` metres, with the trigger grip at `gripAt`. */
  place(parent: TransformNode, length: number, gripAt: Vector3): PlacedSkin {
    const spec = this.spec;
    const s = length / spec.length;
    const holder = new TransformNode(`skin-${this.id}`, parent.getScene());
    holder.parent = parent;
    holder.rotation.y = spec.yaw;
    holder.scaling.setAll(s);
    holder.position.set(gripAt.x, gripAt.y - spec.grip[0] * s, gripAt.z - spec.grip[1] * s);
    const entries = this.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    for (const r of entries.rootNodes) r.parent = holder;
    const at = ([y, z]: YZ) => new Vector3(gripAt.x, holder.position.y + y * s, holder.position.z + z * s);
    const find = (name?: string) =>
      name ? ((holder.getDescendants(false).find((n) => n.name === name) as TransformNode | undefined) ?? null) : null;
    const skeletons: Skeleton[] = entries.skeletons;
    return {
      holder,
      meshes: holder.getChildMeshes(false),
      scale: s,
      muzzle: at(spec.muzzle),
      handguard: spec.handguard ? at(spec.handguard) : null,
      sightY: holder.position.y + spec.sightY * s,
      mag: find(spec.magNode),
      cylinder: find(spec.cylinderNode),
      bolt: find(spec.boltNode),
      boltAxis: spec.boltAxis ? at(spec.boltAxis) : null,
      dispose() {
        holder.dispose(false, false); // materials belong to the shared template
        for (const k of skeletons) k.dispose();
      },
    };
  }

  dispose() {
    this.container.dispose();
  }
}

/** Load the skins for the given weapons (missing or broken files are skipped). */
export async function loadWeaponSkins(scene: Scene, ids: WeaponId[]): Promise<Map<WeaponId, WeaponSkin>> {
  const out = new Map<WeaponId, WeaponSkin>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const spec = SKIN_SPECS[id];
      if (!spec) return;
      try {
        const container = await loadContainer(scene, spec.file);
        applyGunReflections(scene, container); // metal needs something to reflect, or it reads as plastic
        out.set(id, new WeaponSkin(id, spec, container));
      } catch (err) {
        console.warn(`[weapons] ${id} skin unavailable — using the simple model`, err);
      }
    }),
  );
  return out;
}
