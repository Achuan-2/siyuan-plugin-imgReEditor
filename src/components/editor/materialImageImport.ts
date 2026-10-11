import { FabricImage } from 'fabric';
import type { MaterialLibrary, MaterialSnapshot } from './materialLibrary';

function readImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('Image file read failed'));
        reader.onabort = () => reject(new Error('Image file read cancelled'));
        reader.readAsDataURL(file);
    });
}

/** Store the original image data, with a small preview and native editable image properties. */
export async function createImageMaterialSnapshot(file: File): Promise<MaterialSnapshot> {
    if (file.type && !file.type.startsWith('image/')) throw new Error('Not an image file');
    const source = await readImageFile(file);
    const image = await FabricImage.fromURL(source);
    try {
        if (!(image.width > 0 && image.height > 0)) throw new Error('Invalid image dimensions');
        const data = { ...image.toObject(), _originalSrc: source, _cropOffset: { x: 0, y: 0 } };
        const multiplier = Math.min(1, 192 / image.width, 144 / image.height);
        return { version: 1, objects: [data], thumbnail: image.toDataURL({ format: 'png', multiplier }) };
    } finally {
        image.dispose();
    }
}

export interface MaterialImageImportResult {
    imported: number;
    failures: { name: string; error: string }[];
}

/** Process one file at a time to limit memory use; a damaged image does not block later files. */
export async function importMaterialImages(
    files: File[], folderId: string | null, library: MaterialLibrary,
    onProgress: (completed: number, total: number) => void = () => {}
): Promise<MaterialImageImportResult> {
    const result: MaterialImageImportResult = { imported: 0, failures: [] };
    onProgress(0, files.length);
    for (const [index, file] of files.entries()) {
        try {
            const snapshot = await createImageMaterialSnapshot(file);
            const name = file.name.replace(/\.[^.]+$/, '').trim() || file.name || 'Image';
            await library.addItem(name, folderId, snapshot);
            result.imported++;
        } catch (error) {
            result.failures.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
        }
        onProgress(index + 1, files.length);
    }
    return result;
}
