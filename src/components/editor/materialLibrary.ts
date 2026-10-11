import { putFile } from '../../api';
import { generateId } from '../../utils/uuid';

export const MATERIAL_LIBRARY_DIR = 'data/storage/petal/siyuan-plugin-imgReEditor/materials';
export interface MaterialSnapshot { version: 1; objects: any[]; thumbnail: string; }
export interface MaterialFolder { id: string; name: string; parentId: string | null; }
export interface MaterialItem { id: string; name: string; folderId: string | null; thumbnail: string; createdAt: number; }
export interface MaterialIndex {
    version: 1;
    folders: MaterialFolder[];
    items: MaterialItem[];
    lastSaveFolderId?: string | null;
}
export interface MaterialStorage {
    read(path: string): Promise<string | null>;
    write(path: string, content: string): Promise<void>;
    remove(path: string): Promise<void>;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9-]+$/.test(id);
const nameOf = (name: string) => {
    const value = name.trim().slice(0, 100);
    if (!value) throw new Error('Material name is empty');
    return value;
};

/** One shared store serializes changes from editor tabs; failed writes never publish new state. */
export class MaterialLibrary {
    private state: MaterialIndex = { version: 1, folders: [], items: [] };
    private loaded = false;
    private loading: Promise<void> | null = null;
    private queue: Promise<unknown> = Promise.resolve();
    private listeners = new Set<(index: MaterialIndex) => void>();
    constructor(private storage: MaterialStorage, private newId = generateId) {}
    private itemPath(id: string) {
        if (!validId(id)) throw new Error('Invalid material ID');
        return `${MATERIAL_LIBRARY_DIR}/items/${id}.json`;
    }
    subscribe(listener: (index: MaterialIndex) => void) {
        this.listeners.add(listener);
        listener(copy(this.state));
        return () => this.listeners.delete(listener);
    }
    /** Call after load(); old libraries and deleted folders default to unfiled. */
    getLastSaveFolderId(): string | null {
        const id = this.state.lastSaveFolderId;
        return typeof id === 'string' && this.state.folders.some(folder => folder.id === id) ? id : null;
    }
    async load() {
        if (this.loaded) return;
        if (!this.loading) this.loading = (async () => {
            const content = await this.storage.read(`${MATERIAL_LIBRARY_DIR}/index.json`);
            if (content !== null) {
                const data = JSON.parse(content);
                if (data.version !== 1 || !Array.isArray(data.folders) || !Array.isArray(data.items) ||
                    data.folders.some((folder: any) => !validId(folder.id) || typeof folder.name !== 'string' ||
                        (folder.parentId !== null && !validId(folder.parentId))) ||
                    data.items.some((item: any) => !validId(item.id) || typeof item.name !== 'string' ||
                        (item.folderId !== null && !validId(item.folderId)))) throw new Error('Invalid material library');
                this.state = data;
            }
            this.loaded = true;
            this.publish();
        })().finally(() => { this.loading = null; });
        await this.loading;
    }
    private publish() { this.listeners.forEach(listener => listener(copy(this.state))); }
    private change<T>(operation: (next: MaterialIndex) => Promise<T>): Promise<T> {
        const task = this.queue.then(async () => {
            await this.load();
            const next = copy(this.state);
            const result = await operation(next);
            await this.storage.write(`${MATERIAL_LIBRARY_DIR}/index.json`, JSON.stringify(next));
            this.state = next;
            this.publish();
            return result;
        });
        this.queue = task.catch(() => {});
        return task;
    }
    private requireFolder(index: MaterialIndex, id: string | null) {
        if (id !== null && !index.folders.some(folder => folder.id === id)) throw new Error('Material folder does not exist');
    }
    addFolder(name: string, parentId: string | null) {
        return this.change(async next => {
            this.requireFolder(next, parentId);
            const folder = { id: this.newId(), name: nameOf(name), parentId };
            next.folders.push(folder);
            return folder;
        });
    }
    renameFolder(id: string, name: string) {
        return this.change(async next => {
            const folder = next.folders.find(folder => folder.id === id);
            if (!folder) throw new Error('Material folder does not exist');
            folder.name = nameOf(name);
        });
    }
    removeFolder(id: string) {
        return this.change(async next => {
            const folder = next.folders.find(folder => folder.id === id);
            if (!folder) throw new Error('Material folder does not exist');
            // Keep its contents by moving them to its parent folder.
            next.items.forEach(item => { if (item.folderId === id) item.folderId = folder.parentId; });
            next.folders.forEach(child => { if (child.parentId === id) child.parentId = folder.parentId; });
            next.folders = next.folders.filter(folder => folder.id !== id);
            if (next.lastSaveFolderId === id) next.lastSaveFolderId = null;
        });
    }
    addItem(name: string, folderId: string | null, snapshot: MaterialSnapshot) {
        // Capture immutable data before an operation waits in the queue.
        const payload = copy(snapshot);
        return this.change(async next => {
            this.requireFolder(next, folderId);
            if (payload.version !== 1 || !Array.isArray(payload.objects) || payload.objects.length === 0) throw new Error('Invalid material data');
            const item = { id: this.newId(), name: nameOf(name), folderId, thumbnail: payload.thumbnail, createdAt: Date.now() };
            await this.storage.write(this.itemPath(item.id), JSON.stringify(payload));
            next.items.push(item);
            // Commit the destination together with the item so failed saves cannot change it.
            next.lastSaveFolderId = folderId;
            return item;
        });
    }
    updateItem(id: string, name: string, folderId: string | null) {
        return this.change(async next => {
            this.requireFolder(next, folderId);
            const item = next.items.find(item => item.id === id);
            if (!item) throw new Error('Material does not exist');
            item.name = nameOf(name);
            item.folderId = folderId;
        });
    }
    async readItem(id: string): Promise<MaterialSnapshot> {
        await this.load();
        if (!this.state.items.some(item => item.id === id)) throw new Error('Material does not exist');
        const content = await this.storage.read(this.itemPath(id));
        if (content === null) throw new Error('Material file is missing');
        const data = JSON.parse(content);
        if (data.version !== 1 || !Array.isArray(data.objects) || data.objects.length === 0) throw new Error('Invalid material data');
        return data;
    }
    async removeItem(id: string) {
        await this.change(async next => {
            if (!next.items.some(item => item.id === id)) throw new Error('Material does not exist');
            next.items = next.items.filter(item => item.id !== id);
        });
        // The committed index is authoritative; an unsuccessful cleanup leaves an unreferenced file.
        try { await this.storage.remove(this.itemPath(id)); }
        catch (error) { console.warn('Material file cleanup failed', error); }
    }
}

export function getMaterialFolderPath(index: MaterialIndex, id: string | null): string {
    const names: string[] = [];
    const visited = new Set<string>();
    while (id !== null && !visited.has(id)) {
        visited.add(id);
        const folder = index.folders.find(folder => folder.id === id);
        if (!folder) break;
        names.unshift(folder.name);
        id = folder.parentId;
    }
    return names.join(' / ');
}

export function searchMaterials(index: MaterialIndex, query: string, folder: string = '*') {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return index.items.filter(item => (folder === '*' || (item.folderId || '') === folder) &&
        terms.every(term => `${item.name} ${getMaterialFolderPath(index, item.folderId)}`.toLocaleLowerCase().includes(term)))
        .sort((a, b) => b.createdAt - a.createdAt);
}

async function readStorageFile(path: string) {
    const response = await fetch('/api/file/getFile', { method: 'POST', body: JSON.stringify({ path }) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Material read failed (${response.status})`);
    const text = await response.text();
    const data = JSON.parse(text);
    if (data.code === 404) return null;
    if (typeof data.code === 'number' && data.code !== 0) throw new Error(data.msg || 'Material read failed');
    return text;
}

export const materialLibrary = new MaterialLibrary({
    read: readStorageFile,
    write: async (path, content) => {
        await putFile(path, false, new File([content], path.split('/').pop()!, { type: 'application/json' }), { throwOnError: true });
    },
    remove: async path => {
        const response = await fetch('/api/file/removeFile', { method: 'POST', body: JSON.stringify({ path }) });
        const data = await response.json();
        if (!response.ok || data.code !== 0) throw new Error(data.msg || 'Material removal failed');
    },
});
