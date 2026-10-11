import { FabricObject, Group, util } from 'fabric';
import type { TMat2D } from 'fabric';
import type { MaterialSnapshot } from './materialLibrary';
import { generateId } from '../../utils/uuid';

export function walkMaterialObjects(object: any, visit: (object: any) => void) {
    visit(object);
    object.getObjects?.().forEach((child: any) => walkMaterialObjects(child, visit));
}

/** Resolve image sources before saving so temporary URLs and deleted originals cannot break materials. */
export async function embedMaterialImageSources(data: any, load: (url: string) => Promise<string>) {
    const cache = new Map<string, Promise<string>>();
    async function walk(value: any) {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (['src', '_originalSrc', '_unborderedSrc', 'source'].includes(key) && typeof child === 'string' &&
                child && !child.startsWith('data:') && (key !== 'source' || /^(blob:|https?:|\/?assets\/)/.test(child))) {
                if (!cache.has(child)) cache.set(child, load(child));
                value[key] = await cache.get(child);
            } else await walk(child);
        }
    }
    await walk(data);
    return data;
}

async function loadImageDataURL(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Material image read failed (${response.status})`);
    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith('image/')) throw new Error('Invalid material image');
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('Material image read failed'));
        reader.readAsDataURL(blob);
    });
}

export async function createMaterialSnapshot(
    objects: FabricObject[], properties: string[], prepare: (object: any) => void
): Promise<MaterialSnapshot> {
    if (!objects.length) throw new Error('No material objects');
    const captured = objects.map(object => ({
        data: JSON.parse(JSON.stringify(object.toObject(properties))),
        matrix: [...object.calcTransformMatrix()] as TMat2D,
    }));
    await embedMaterialImageSources(captured.map(item => item.data), loadImageDataURL);
    const previewObjects = await util.enlivenObjects<FabricObject>(captured.map(item => item.data));
    const serialized = previewObjects.map((cloned, index) => {
        // Top-level objects inside an active selection need their full world transform.
        util.applyTransformToObject(cloned, captured[index].matrix);
        prepare(cloned);
        return cloned.toObject(properties);
    });
    const preview = previewObjects.length === 1 ? previewObjects[0] : new Group(previewObjects);
    try {
        const bounds = preview.getBoundingRect();
        const multiplier = Math.min(1, 192 / Math.max(1, bounds.width), 144 / Math.max(1, bounds.height));
        const thumbnail = preview.toDataURL({ format: 'png', multiplier });
        return { version: 1, objects: serialized, thumbnail };
    } finally {
        preview.dispose();
    }
}

/** Fresh identifiers keep linked objects and repeated insertions independent. */
export function remapMaterialObjectIds(objects: any[], newId = generateId) {
    const ids = new Map<string, string>();
    objects.forEach(object => walkMaterialObjects(object, child => {
        if (typeof child.id === 'string') ids.set(child.id, newId());
    }));
    objects.forEach(object => walkMaterialObjects(object, child => {
        for (const key of ['id', 'sourceId', 'viewId']) {
            if (typeof child[key] === 'string') child[key] = ids.get(child[key]) || null;
        }
    }));
}

export async function restoreMaterialObjects(snapshot: MaterialSnapshot, prepare: (object: any) => void) {
    if (snapshot.version !== 1 || !Array.isArray(snapshot.objects) || !snapshot.objects.length) throw new Error('Invalid material data');
    const objects = await util.enlivenObjects<FabricObject>(snapshot.objects);
    remapMaterialObjectIds(objects);
    objects.forEach(object => {
        prepare(object);
        walkMaterialObjects(object, child => {
            child.set({ lockMovementX: false, lockMovementY: false, lockRotation: false,
                lockScalingX: false, lockScalingY: false, hasControls: true,
                selectable: child.type !== 'magnifier-connection-line', evented: child.type !== 'magnifier-connection-line' });
        });
    });
    return objects;
}
