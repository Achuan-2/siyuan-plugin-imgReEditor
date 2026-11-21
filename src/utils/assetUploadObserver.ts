import type { EventBus, IProtyle } from 'siyuan';

interface AssetUploadResult {
    status: 'success' | 'partial' | 'failed' | 'canceled';
    succFiles?: Array<{ path: string }>;
    succMap?: Record<string, string>;
}

export type BeforeUploadAssetInput =
    | { kind: 'files'; files: File[] }
    | { kind: 'local-files'; files: Array<{ path: string; size?: number | null; isDir?: boolean }> };

export type BeforeUploadAssetDecision =
    | { action: 'cancel' }
    | { action: 'replace'; input: BeforeUploadAssetInput };

export interface BeforeUploadAssetsDetail {
    protyle?: IProtyle & { lite?: boolean };
    target: string;
    input?: BeforeUploadAssetInput;
    allowedInputKinds?: Array<BeforeUploadAssetInput['kind']>;
    signal: AbortSignal;
    respondWith?(value: BeforeUploadAssetDecision | PromiseLike<BeforeUploadAssetDecision>): void;
    onComplete(callback: (result: AssetUploadResult) => void): void;
}

export interface ObserveAssetUploadsOptions {
    onBeforeLiteUpload?: (
        input: BeforeUploadAssetInput,
        detail: BeforeUploadAssetsDetail
    ) => Promise<BeforeUploadAssetDecision> | null;
}

// The installed SDK predates this host event. Declare only the fields we consume.
declare module 'siyuan' {
    interface IEventBusMap {
        'before-upload-assets': BeforeUploadAssetsDetail;
    }
}

type UploadedAssetsHandler<T> = (paths: string[], documentID: string, context: T) => Promise<void>;

/** Observe host completion callbacks without holding up uploads or insertion. */
export function observeAssetUploads<T>(
    eventBus: EventBus,
    enabled: () => boolean,
    onUploaded: UploadedAssetsHandler<T>,
    captureContext: () => T,
    normalizePath: (path: string | null) => string | null,
    options?: ObserveAssetUploadsOptions
): () => void {
    let active = true;
    const pendingPastes = new Map<() => void, { editor: HTMLElement; uploadedPaths: Set<string> }>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const claimedImages = new WeakMap<HTMLImageElement, number>();
    let pasteGeneration = 0;
    const isActive = () => active && enabled();
    const getLocalImagePath = (image: HTMLImageElement) =>
        normalizePath(image.dataset.src || image.getAttribute('src'));
    const notify = (paths: string[], documentID: string, context: T) => {
        if (!isActive() || !documentID || paths.length === 0) return;
        // Completion can precede the parent paste transaction. Let the editor
        // proceed; the compression queue waits for persisted image references.
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (isActive()) void onUploaded([...new Set(paths)], documentID, context)
                .catch(error => console.error('Background image compression failed:', error));
        }, 0);
        timers.add(timer);
    };

    const beforeUpload = ({ detail }: CustomEvent<BeforeUploadAssetsDetail>) => {
        if (!isActive() || detail.target !== 'editor') return;
        const documentID = detail.protyle?.block?.rootID || '';
        if (!documentID) {
            if (
                detail.protyle?.lite === true &&
                detail.input &&
                typeof detail.respondWith === 'function' &&
                options?.onBeforeLiteUpload
            ) {
                const decision = options.onBeforeLiteUpload(detail.input, detail);
                if (decision) {
                    detail.respondWith(decision);
                }
            }
            return;
        }
        const context = captureContext();
        // Register synchronously. No respondWith or async listener: originals
        // should upload immediately, with compression performed in the background.
        detail.onComplete(result => {
            if (!isActive() || detail.signal.aborted ||
                !['success', 'partial'].includes(result.status)) return;
            const paths = (Array.isArray(result.succFiles)
                ? result.succFiles.map(file => file.path)
                : Object.values(result.succMap || {}))
                .filter(path => typeof path === 'string');
            // Mixed HTML can upload local/embedded files before localizing remote
            // images. Those paths already have a completion callback of their own.
            for (const pending of pendingPastes.values()) {
                if (pending.editor === detail.protyle?.wysiwyg?.element) {
                    paths.forEach(path => {
                        const normalized = normalizePath(path);
                        if (normalized) pending.uploadedPaths.add(normalized);
                    });
                }
            }
            notify(paths, documentID, context);
        });
    };

    const paste = ({ detail }: CustomEvent<{
        protyle: IProtyle; textHTML: string; siyuanHTML: string; files?: { length: number };
    }>) => {
        if (!isActive() || detail.siyuanHTML || !detail.textHTML) return;
        // SiYuan sends single clipboard image Files (including image tables)
        // through the normal upload route instead of HTML conversion.
        const textHTML = detail.textHTML.trim();
        if (detail.files?.length === 1 &&
            (textHTML.startsWith('<img') || (textHTML.startsWith('<table') && textHTML.includes('<img')))) return;
        const html = new DOMParser().parseFromString(textHTML, 'text/html');
        const remoteImages = Array.from(html.querySelectorAll<HTMLImageElement>('img'))
            .filter(image => /^(https?:)?\/\//i.test(image.getAttribute('src') || '') && !getLocalImagePath(image));
        const editor = detail.protyle?.wysiwyg?.element;
        const documentID = detail.protyle?.block?.rootID || '';
        if (!remoteImages.length || !editor || !documentID) return;
        const generation = ++pasteGeneration;
        const context = captureContext();
        const previous = new Map(Array.from(editor.querySelectorAll<HTMLImageElement>('img'))
            .map(image => [image, getLocalImagePath(image)]));
        const previousCounts = new Map<string, number>();
        for (const path of previous.values()) {
            if (path) previousCounts.set(path, (previousCounts.get(path) || 0) + 1);
        }
        const seen = new Set<HTMLImageElement>();
        const uploadedPaths = new Set<string>();
        const stop = () => {
            observer.disconnect();
            clearTimeout(timeout);
            pendingPastes.delete(stop);
        };
        const observer = new MutationObserver(() => {
            if (!isActive() || !editor.isConnected || detail.protyle.block.rootID !== documentID) {
                stop();
                return;
            }
            const paths: string[] = [];
            const images = Array.from(editor.querySelectorAll<HTMLImageElement>('img'));
            const counts = new Map<string, number>();
            for (const image of images) {
                const path = getLocalImagePath(image);
                if (path) counts.set(path, (counts.get(path) || 0) + 1);
            }
            for (const image of images) {
                const path = getLocalImagePath(image);
                if (!path || previous.get(image) === path || seen.has(image) || uploadedPaths.has(path)) continue;
                // Editor transactions may recreate existing DOM nodes. A new
                // element alone does not mean an extra image was pasted.
                if ((counts.get(path) || 0) <= (previousCounts.get(path) || 0)) continue;
                // Overlapping paste windows must not submit the same image twice.
                if ((claimedImages.get(image) || 0) >= generation) continue;
                claimedImages.set(image, pasteGeneration);
                seen.add(image);
                paths.push(path);
            }
            if (paths.length) notify(paths, documentID, context);
            if (seen.size >= remoteImages.length) stop();
        });
        // Watch only this paste's editor while conversion may still be pending.
        // Covers both direct local insertion and later remote -> assets src changes.
        const timeout = setTimeout(stop, 120_000);
        pendingPastes.set(stop, { editor, uploadedPaths });
        observer.observe(editor, {
            subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-src'],
        });
    };

    const destroyEditor = ({ detail }: CustomEvent<{ protyle: IProtyle }>) => {
        for (const [stop, pending] of pendingPastes) {
            if (pending.editor === detail.protyle.wysiwyg?.element) stop();
        }
    };

    eventBus.on('before-upload-assets', beforeUpload);
    eventBus.on('paste', paste);
    eventBus.on('destroy-protyle', destroyEditor);
    return () => {
        active = false;
        eventBus.off('before-upload-assets', beforeUpload);
        eventBus.off('paste', paste);
        eventBus.off('destroy-protyle', destroyEditor);
        pendingPastes.forEach((_pending, stop) => stop());
        timers.forEach(timer => clearTimeout(timer));
        timers.clear();
    };
}
