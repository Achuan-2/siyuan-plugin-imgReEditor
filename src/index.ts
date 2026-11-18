import {
    Plugin,
    Dialog,
    Menu,
    openTab,
    showMessage
} from "siyuan";
import "@/index.scss";

import SettingPanel from "./Settings.svelte";
import ImageEditorComponent from './components/ImageEditor.svelte';
import { getDefaultSettings, getCompressionFormat } from "./defaultSettings";
import { setPluginInstance, t } from "./utils/i18n";
import { ScreenshotManager } from "./ScreenshotManager";
import { observeAssetUploads } from './utils/assetUploadObserver';
import { refreshAssetImages } from './utils/assetImageRefresh';
import type { ImageCompressionChoice, CompressionPreviewItem } from './utils/imageCompressionDialog';
import {
    reencodeImageBlob,
    getMimeByFormat,
    readPNGTextChunk,
    insertPNGTextChunk,
    locatePNGtEXt,
    readWebPMetadata,
    insertWebPMetadata,
    type CompressibleImageFormat,
    type ReencodeOptions,
} from "./utils";

export const SETTINGS_FILE = "settings.json";
const EDITOR_METADATA_KEY = 'siyuan-plugin-imgReEditor';
const EDITOR_BACKUP_DIR = 'data/storage/petal/siyuan-plugin-imgReEditor/backup';
const ASSET_COMPRESSION_HISTORY_FILE = 'asset-compression-history.json';
const ASSET_COMPRESSION_HISTORY_VERSION = 1;
const ASSET_COMPRESSION_PROFILE_VERSION = 1;
const ASSET_COMPRESSION_WEBP_PROFILE_VERSION = 3;

interface AssetImageEntry {
    path: string;
    format: CompressibleImageFormat;
}

interface AssetCompressionHistoryEntry {
    fingerprint: string;
    profile: string;
    processedAt: number;
}

interface AssetCompressionHistory {
    version: number;
    entries: Record<string, AssetCompressionHistoryEntry>;
}

interface DocumentCanvasItem {
    path: string;
    blockId: string;
    label: string;
}

interface UploadedImageReference {
    image: HTMLImageElement;
    path: string | null;
    blockID: string;
}

function getFileExtension(fileName: string) {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : '';
}

function getCompressibleImageFormat(fileName: string): CompressibleImageFormat | null {
    const ext = getFileExtension(fileName);
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
    if (ext === 'webp') return 'webp';
    return null;
}

function replaceFileExtension(fileName: string, extension: string) {
    return fileName.includes('.')
        ? fileName.replace(/\.[^.]+$/, `.${extension}`)
        : `${fileName}.${extension}`;
}

function getCompressionOutputFormat(
    settings: any,
    sourceFormat: CompressibleImageFormat
): CompressibleImageFormat {
    const format = getCompressionFormat(settings);
    return format === 'original' ? sourceFormat : format;
}

function getImageMaxLongEdge(settings: any): number {
    const pixels = Number(settings?.imageMaxLongEdge ?? 2000);
    return Number.isFinite(pixels) && pixels >= 1 ? Math.floor(pixels) : 2000;
}

function getFormatCompressionOptions(settings: any, format: CompressibleImageFormat): ReencodeOptions {
    const pngMode = settings?.pngCompressionMode === 'lossy' ? 'lossy' : 'lossless';
    const rawPngQuality = Number(settings?.pngQuality ?? settings?.imageCompressionQuality ?? 92);
    const pngQuality = Math.min(100, Math.max(1, Number.isFinite(rawPngQuality) ? rawPngQuality : 92)) / 100;

    const rawJpegQuality = Number(settings?.jpegQuality ?? settings?.imageCompressionQuality ?? 92);
    const jpegQuality = Math.min(100, Math.max(1, Number.isFinite(rawJpegQuality) ? rawJpegQuality : 92)) / 100;

    const rawWebPQuality = Number(settings?.webpQuality ?? 100);
    const webpQuality = Math.min(100, Math.max(1, Number.isFinite(rawWebPQuality) ? rawWebPQuality : 100)) / 100;

    if (format === 'png') {
        return { pngMode, quality: pngQuality };
    }
    if (format === 'webp') {
        return { quality: webpQuality };
    }
    return { quality: jpegQuality };
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function shouldUseReencodedImage(sourceSize: number, outputSize: number) {
    // 无论是原格式压缩还是转换格式，都只采用确实更小的结果。
    return outputSize > 0 && outputSize < sourceSize;
}

function getAutomaticImageProcessingMessage(
    processedCount: number,
    convertedCount: number,
    originalTotalSize: number,
    outputTotalSize: number
) {
    const action =
        convertedCount === 0
            ? `已自动压缩 ${processedCount} 张上传图片`
            : convertedCount === processedCount
              ? `已自动压缩并转换 ${convertedCount} 张上传图片的格式`
              : `已自动处理 ${processedCount} 张上传图片，其中 ${convertedCount} 张转换了格式`;
    return `${action}：${formatBytes(originalTotalSize)} -> ${formatBytes(outputTotalSize)}`;
}

function getAssetCompressionProfile(settings: any, format: CompressibleImageFormat) {
    const options = getFormatCompressionOptions(settings, format);
    return JSON.stringify({
        version:
            format === 'webp'
                ? ASSET_COMPRESSION_WEBP_PROFILE_VERSION
                : ASSET_COMPRESSION_PROFILE_VERSION,
        format,
        pngMode: format === 'png' ? options.pngMode : undefined,
        quality:
            format === 'png' && options.pngMode === 'lossless' ? undefined : options.quality,
    });
}

async function getBlobFingerprint(blob: Blob) {
    const buffer = await blob.arrayBuffer();
    if (globalThis.crypto?.subtle) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    // Electron environments normally expose Web Crypto. Keep a deterministic fallback
    // so older clients can still remember processed files.
    const bytes = new Uint8Array(buffer);
    let hashA = 0x811c9dc5;
    let hashB = 0x9e3779b9;
    for (const byte of bytes) {
        hashA = Math.imul(hashA ^ byte, 0x01000193) >>> 0;
        hashB = Math.imul(hashB ^ byte, 0x85ebca6b) >>> 0;
    }
    return `fallback-${blob.size}-${hashA.toString(16)}-${hashB.toString(16)}`;
}

type CompressionResult =
    | {
        status: 'compressed';
        originalSize: number;
        savedSize: number;
        originalPath: string;
        savedPath: string;
    }
    | {
        status: 'skipped';
        reason: 'unsupported' | 'empty' | 'not-smaller' | 'write-failed' | 'canceled';
        originalSize?: number;
        compressedSize?: number;
    }
    | { status: 'failed' };

function normalizeAssetPath(rawPath?: string | null) {
    if (!rawPath) return null;

    let path = rawPath.trim();
    if (!path || path.startsWith('data:') || path.startsWith('blob:')) return null;

    const isAbsoluteURL = /^[a-z][a-z\d+.-]*:\/\//i.test(path) || path.startsWith('//');
    if (isAbsoluteURL) {
        try {
            const baseOrigin = window.location.origin;
            const url = new URL(path, baseOrigin);
            if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === baseOrigin) {
                path = url.pathname;
            } else {
                return null;
            }
        } catch (_e) {
            return null;
        }
    } else {
        path = path.split(/[?#]/)[0];
    }

    try {
        const url = new URL(path, window.location.origin);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
            path = url.pathname;
        }
    } catch (_e) {
        // Relative asset paths can be normalized below without URL parsing.
    }

    try {
        path = decodeURIComponent(path);
    } catch (_e) {
        // Keep the original path when it is not URI encoded.
    }

    path = path.replace(/^\/+/, '').replace(/^data\//, '');
    const assetsIndex = path.indexOf('assets/');
    if (assetsIndex >= 0) path = path.slice(assetsIndex);

    return path.startsWith('assets/') ? path : null;
}

export default class PluginSample extends Plugin {
    _openMenuImageHandler: any;
    _clickEditorTitleIconHandler: any;
    _openMenuDocTreeHandler: any;
    settings: any;
    screenshotManager: ScreenshotManager | null = null;
    private topBarElement: HTMLElement | null = null;
    private screenshotCommandRegistered = false;
    private stopObservingAssetUploads: (() => void) | null = null;
    private automaticCompressionQueue: Promise<void> = Promise.resolve();
    private assetCompressionTask: Promise<void> | null = null;
    private assetCompressionController: AbortController | null = null;
    private assetCompressionStatus: HTMLElement | null = null;

    private async resolveDocumentID(blockID?: string | null) {
        if (!blockID) return '';
        try {
            const { getBlockByID } = await import('./api');
            const block = await getBlockByID(blockID) as any;
            return block?.root_id || (block?.type === 'd' ? block.id : '') || '';
        } catch (error) {
            console.warn('Failed to resolve document ID for canvas navigation:', error);
            return '';
        }
    }

    private async isCanvasAsset(path: string) {
        try {
            const { getFileBlob } = await import('./api');
            const blob = await getFileBlob(`data/${path}`);
            if (!blob || blob.size === 0) return false;

            const buffer = new Uint8Array(await blob.arrayBuffer());
            const embedded = locatePNGtEXt(buffer)
                ? readPNGTextChunk(buffer, EDITOR_METADATA_KEY)
                : readWebPMetadata(buffer, EDITOR_METADATA_KEY);
            if (embedded) {
                try {
                    if (JSON.parse(embedded)?.isCanvasMode === true) return true;
                } catch (_error) {
                    // Continue with the backup metadata fallback.
                }
            }

            const fileName = path.split('/').pop();
            if (!fileName) return false;
            try {
                const backup = await getFileBlob(`${EDITOR_BACKUP_DIR}/${fileName}.json`);
                return !!backup && backup.size > 0 && JSON.parse(await backup.text())?.isCanvasMode === true;
            } catch (_error) {
                return false;
            }
        } catch (error) {
            console.warn(`Failed to inspect canvas asset: ${path}`, error);
            return false;
        }
    }

    private async getDocumentCanvasItems(blockID?: string | null): Promise<DocumentCanvasItem[]> {
        const docID = await this.resolveDocumentID(blockID);
        if (!docID) return [];

        try {
            const { getBlockDOM } = await import('./api');
            const blockDOM = await getBlockDOM(docID) as any;
            const html = typeof blockDOM === 'string'
                ? blockDOM
                : blockDOM?.dom || blockDOM?.content || '';
            if (!html) return [];

            const root = document.createElement('div');
            root.innerHTML = html;
            const candidates: DocumentCanvasItem[] = [];
            const seen = new Set<string>();
            root.querySelectorAll('img').forEach((element: Element) => {
                const image = element as HTMLImageElement;
                const path = normalizeAssetPath(
                    image.dataset?.src || image.getAttribute('data-src') || image.getAttribute('src')
                );
                const owner = image.closest('[data-node-id]') as HTMLElement | null;
                const ownerID = owner?.getAttribute('data-node-id') || '';
                const key = `${ownerID}:${path || ''}`;
                if (!path || !ownerID || seen.has(key)) return;
                seen.add(key);
                candidates.push({
                    path,
                    blockId: ownerID,
                    label: path.split('/').pop() || path,
                });
            });

            // Avoid loading every document image into memory at once in image-heavy notes.
            const canvasFlags = new Array<boolean>(candidates.length).fill(false);
            let nextIndex = 0;
            const workers = Array.from(
                { length: Math.min(4, candidates.length) },
                async () => {
                    while (nextIndex < candidates.length) {
                        const index = nextIndex++;
                        canvasFlags[index] = await this.isCanvasAsset(candidates[index].path);
                    }
                }
            );
            await Promise.all(workers);
            return candidates.filter((_candidate, index) => canvasFlags[index]);
        } catch (error) {
            console.warn('Failed to collect document canvases:', error);
            return [];
        }
    }


    async onload() {
        // 插件被启用时会自动调用这个函数
        // 设置i18n插件实例
        setPluginInstance(this);

        // 注册自定义图标：iconScreenshot 与 iconImgReEditor
        this.addIcons(`
    <symbol id="iconScreenshot" viewBox="0 0 1024 1024">
        <rect x="112" y="176" width="800" height="672" rx="48" ry="48" fill="none" stroke="currentColor" stroke-width="64"></rect>
        <path d="M336 352h352v320H336z" fill="currentColor" opacity="0.95"></path>
        <circle cx="512" cy="512" r="56" opacity="0.12"></circle>
    </symbol>

        <symbol id="iconImgReEditor" viewBox="0 0 1024 1024">
        <path d="M430.933333 610.133333l115.2-145.066666 72.533334 98.133333c34.133333-21.333333 68.266667-34.133333 106.666666-34.133333 8.533333 0 21.333333 0 34.133334 4.266666v-298.666666C755.2 200.533333 725.333333 170.666667 691.2 170.666667H234.666667C200.533333 170.666667 170.666667 200.533333 170.666667 234.666667v456.533333c0 34.133333 29.866667 64 64 64h294.4c-4.266667-8.533333-4.266667-21.333333-4.266667-34.133333 0-21.333333 4.266667-46.933333 12.8-64H234.666667L349.866667 512l81.066666 98.133333zM593.066667 793.6V853.333333h55.466666l153.6-153.6-59.733333-59.733333zM849.066667 631.466667L810.666667 597.333333c-8.533333-8.533333-17.066667-8.533333-21.333334 0l-29.866666 29.866667 59.733333 59.733333 29.866667-29.866666c4.266667-8.533333 4.266667-17.066667 0-25.6z" p-id="8019"></path>
        </symbol>
                `);

        // 加载设置
        this.settings = await this.loadSettings();

        this.assetCompressionStatus = document.createElement('span');
        this.assetCompressionStatus.className = 'fn__none';
        this.addStatusBar({ element: this.assetCompressionStatus });

        // 监听图片菜单打开事件, 在右键图片菜单中加入 编辑 菜单项
        this._openMenuImageHandler = this.openMenuImageHandler.bind(this);
        this.eventBus.on('open-menu-image', this._openMenuImageHandler);

        // 监听文档标题图标菜单，加入文档级批量压缩入口
        this._clickEditorTitleIconHandler = this.openEditorTitleIconHandler.bind(this);
        this.eventBus.on('click-editortitleicon', this._clickEditorTitleIconHandler);

        this._openMenuDocTreeHandler = this.openMenuDocTreeHandler.bind(this);
        this.eventBus.on('open-menu-doctree', this._openMenuDocTreeHandler);

        // 注册斜杠菜单
        this.protyleSlash = [{
            filter: ["canvas", "huabu", "画布", "imgreeditor", "画板", "图片"],
            id: "imgreeditor-canvas",
            html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">${t("imageEditor.createCanvas") || '创建画布 (ImgReEditor)'}</span></div>`,
            callback: async (protyle: any, nodeElement: HTMLElement) => {
                const blockID = nodeElement.getAttribute('data-node-id');
                // 创建空白图片并插入，然后打开编辑器
                await this.createBlankImageAndEdit(protyle, blockID);
            },
        }];

        await this.applyScreenshotFeatureSettings();
        this.setupAutomaticImageCompression();
    }

    private isScreenshotEnabled() {
        return this.settings?.enableScreenshot === true;
    }

    private getScreenshotManager() {
        if (!this.screenshotManager) {
            this.screenshotManager = new ScreenshotManager(this);
        }
        return this.screenshotManager;
    }

    private registerScreenshotTopBar() {
        if (this.topBarElement) return;

        const topBarElement = this.addTopBar({
            icon: 'iconImgReEditor',
            title: 'ImgReEditor',
            position: 'right',
            callback: () => {
                let rect = topBarElement.getBoundingClientRect();
                // 使用 Menu API 创建独立菜单实例
                const menu = new Menu('imgreeditor-topbar', () => {
                    // 菜单关闭时的回调（可选）
                });

                const screenshotManager = this.getScreenshotManager();

                menu.addItem({
                    icon: 'iconScreenshot',
                    label: t('screenshot.capture'),
                    click: async () => {
                        const result = await screenshotManager.captureWithSelection();
                        if (result) {
                            this.openImageEditorDialog(result.dataURL, null, false, true, null, result.rect);
                        }
                        menu.close && menu.close();
                    }
                });

                menu.addItem({
                    icon: 'iconHistory',
                    label: t('screenshot.browseHistory'),
                    click: () => {
                        screenshotManager.showHistoryDialog((filePath) => {
                            this.openImageEditorDialog(filePath, null, false, true);
                        });
                        menu.close && menu.close();
                    }
                });

                menu.open({ x: rect.right, y: rect.bottom });
            }
        });
        this.topBarElement = topBarElement;
    }

    private teardownScreenshotFeature() {
        if (this.topBarElement) {
            this.topBarElement.remove();
            this.topBarElement = null;
        }
        if (this.screenshotManager) {
            this.screenshotManager.disposeSelectionWindow();
        }
    }

    async applyScreenshotFeatureSettings() {
        if (!this.isScreenshotEnabled()) {
            this.teardownScreenshotFeature();
            return;
        }

        const screenshotManager = this.getScreenshotManager();
        if (!this.screenshotCommandRegistered) {
            await screenshotManager.registerShortcut();
            this.screenshotCommandRegistered = true;
        }
        this.registerScreenshotTopBar();
    }

    async onLayoutReady() {
        //布局加载完成的时候，会自动调用这个函数

    }

    async onunload() {
        this.assetCompressionController?.abort();
        this.assetCompressionStatus?.remove();
        this.assetCompressionStatus = null;
        // 移除所有已注册的事件监听
        try {
            this.teardownAutomaticImageCompression();
            if (this._openMenuImageHandler) {
                this.eventBus.off('open-menu-image', this._openMenuImageHandler);
                this._openMenuImageHandler = null;
            }
            if (this._clickEditorTitleIconHandler) {
                this.eventBus.off('click-editortitleicon', this._clickEditorTitleIconHandler);
                this._clickEditorTitleIconHandler = null;
            }
            if (this._openMenuDocTreeHandler) {
                this.eventBus.off('open-menu-doctree', this._openMenuDocTreeHandler);
                this._openMenuDocTreeHandler = null;
            }
            if (this.topBarElement) {
                this.topBarElement.remove();
                this.topBarElement = null;
            }
            if (this.screenshotManager) {
                this.screenshotManager.disposeSelectionWindow();
            }
        } catch (e) {
            console.warn('Error while removing event listeners during unload', e);
        }
    }

    async uninstall() {
        await this.onunload();
        // 删除设置文件
        await this.removeData(SETTINGS_FILE);
    }

    /**
     * 打开设置对话框
     */
    // 重写 openSetting 方法
    async openSetting() {
        let dialog = new Dialog({
            title: t("settings.settingsPanel"),
            content: `<div id="SettingPanel" style="height: 100%;"></div>`,
            width: "800px",
            height: "700px",
            destroyCallback: () => {
                pannel.$destroy();
            }
        });

        let pannel = new SettingPanel({
            target: dialog.element.querySelector("#SettingPanel"),
            props: {
                plugin: this
            }
        });
    }

    private addNormalizedAssetPath(paths: Set<string>, rawPath?: string | null) {
        const normalizedPath = normalizeAssetPath(rawPath);
        if (normalizedPath) {
            paths.add(normalizedPath);
        }
    }

    private collectImageAssetPathsFromElement(rootElement: Element, paths: Set<string>) {
        rootElement.querySelectorAll('img, [data-type="img"], [data-src]').forEach((element: Element) => {
            const htmlElement = element as HTMLElement;
            this.addNormalizedAssetPath(paths, htmlElement.getAttribute('data-src'));
            this.addNormalizedAssetPath(paths, htmlElement.getAttribute('src'));
        });
    }

    private collectImageAssetPathsFromHTML(html: string, paths: Set<string>) {
        const documentFragment = new DOMParser().parseFromString(html, 'text/html');
        this.collectImageAssetPathsFromElement(documentFragment.body, paths);
    }

    private collectImageAssetPathsFromMarkdown(markdown: string, paths: Set<string>) {
        const imagePattern = /!\[[^\]]*]\(([^)]+)\)/g;
        let match: RegExpExecArray | null;

        while ((match = imagePattern.exec(markdown)) !== null) {
            let target = match[1].trim();
            if (target.startsWith('<')) {
                const closeIndex = target.indexOf('>');
                if (closeIndex > 0) {
                    target = target.slice(1, closeIndex);
                }
            } else {
                const titleMatch = target.match(/\s+["']/);
                if (titleMatch?.index) {
                    target = target.slice(0, titleMatch.index);
                }
            }
            this.addNormalizedAssetPath(paths, target);
        }
    }

    private async getDocumentImageAssetPaths(docID: string, protyle?: any) {
        const paths = new Set<string>();
        const { getBlockDOM, exportMdContent } = await import('./api');

        try {
            const blockDOM = await getBlockDOM(docID) as any;
            const html = typeof blockDOM === 'string' ? blockDOM : blockDOM?.dom || blockDOM?.content || '';
            if (html) {
                this.collectImageAssetPathsFromHTML(html, paths);
            }
        } catch (error) {
            console.warn('Failed to collect images from document DOM:', error);
        }

        try {
            const exported = await exportMdContent(docID) as any;
            const markdown = typeof exported === 'string' ? exported : exported?.content || '';
            if (markdown) {
                this.collectImageAssetPathsFromMarkdown(markdown, paths);
                this.collectImageAssetPathsFromHTML(markdown, paths);
            }
        } catch (error) {
            console.warn('Failed to collect images from exported markdown:', error);
        }

        if (protyle?.element) {
            this.collectImageAssetPathsFromElement(protyle.element, paths);
        }

        return Array.from(paths);
    }

    private async getDocumentAndDescendantIDs(docID: string): Promise<string[]> {
        const { getBlockByID, request } = await import('./api');
        const root = await getBlockByID(docID);
        if (root?.type !== 'd' || !root.box || !root.path) {
            throw new Error(`Unable to locate document: ${docID}`);
        }

        const documentIDs = new Set([docID]);
        const directories = [root.path];
        for (let index = 0; index < directories.length; index += 1) {
            const result = await request('/api/filetree/listDocsByPath', {
                notebook: root.box,
                path: directories[index],
                maxListCount: 0,
                ignoreMaxListHint: true,
                showHidden: true,
            });
            if (!Array.isArray(result?.files)) {
                throw new Error(`Unable to list child documents: ${directories[index]}`);
            }
            for (const child of result.files) {
                if (!child?.id || !child.path || documentIDs.has(child.id)) continue;
                documentIDs.add(child.id);
                if (child.subFileCount > 0) directories.push(child.path);
            }
        }
        return Array.from(documentIDs);
    }

    private updateImageAssetReferencesWithPathMap(root: ParentNode, pathMap: Map<string, string>) {
        const changedBlocks = new Map<string, HTMLElement>();
        root.querySelectorAll('img, [data-href], a[href]').forEach((element: Element) => {
            const isImage = element.tagName.toLowerCase() === 'img';
            const attributes = isImage ? ['data-src', 'src'] : ['data-href', 'href'];
            const currentURL = element.getAttribute(attributes[0]) || element.getAttribute(attributes[1]);
            const currentPath = normalizeAssetPath(currentURL);
            const newPath = currentPath ? pathMap.get(currentPath) : null;
            if (!newPath) return;

            const newURL = newPath + (currentURL?.match(/[?#].*$/)?.[0] || '');
            for (const attribute of attributes) {
                if (isImage || element.hasAttribute(attribute)) element.setAttribute(attribute, newURL);
            }
            const block = element.closest('[data-node-id]') as HTMLElement | null;
            const blockID = block?.getAttribute('data-node-id');
            if (block && blockID) changedBlocks.set(blockID, block);
        });
        return changedBlocks;
    }

    // Keep resource disposal in SiYuan's explicit unused-asset cleanup. Running
    // its global reference scan after every save races ongoing document edits.
    /** Resolve all pages before writing blocks, since writes change the asset index. */
    private async replaceImageAssetReferencesEverywhere(
        originalPath: string,
        savedPath: string,
        sourceBlock?: HTMLElement,
        isActive: () => boolean = () => true
    ): Promise<number> {
        if (originalPath === savedPath) return 0;
        const { sql } = await import('./api');
        const escape = (value: string) => value.replace(/'/g, "''");
        const fileName = originalPath.split('/').pop()!;
        const names = [...new Set([fileName, encodeURIComponent(fileName)])];
        const condition = names.map(name => `instr(lower(path), lower('${escape(name)}')) > 0`).join(' OR ');
        const blockIDs = new Set<string>();
        let cursor = '';
        while (isActive()) {
            const references = await sql(
                `SELECT id, block_id, path FROM assets WHERE (${condition}) AND id > '${escape(cursor)}' ORDER BY id LIMIT 256`
            );
            if (!Array.isArray(references)) throw new Error('Unable to load image references');
            if (references.length === 0) break;
            for (const reference of references) {
                if (normalizeAssetPath(reference.path) === originalPath && reference.block_id) {
                    blockIDs.add(reference.block_id);
                }
            }
            const nextCursor = references[references.length - 1].id;
            if (typeof nextCursor !== 'string' || nextCursor <= cursor) {
                throw new Error('Unable to paginate image references');
            }
            cursor = nextCursor;
        }

        // Include images inserted before their asset-index transaction completes.
        document.querySelectorAll<HTMLImageElement>('.protyle-wysiwyg img').forEach(image => {
            if (normalizeAssetPath(image.dataset.src || image.getAttribute('src')) !== originalPath) return;
            const id = image.closest('[data-node-id]')?.getAttribute('data-node-id');
            if (id) blockIDs.add(id);
        });
        document.querySelectorAll<HTMLElement>('.protyle-wysiwyg [data-href], .protyle-wysiwyg a[href]').forEach(link => {
            if (normalizeAssetPath(link.getAttribute('data-href') || link.getAttribute('href')) !== originalPath) return;
            const id = link.closest('[data-node-id]')?.getAttribute('data-node-id');
            if (id) blockIDs.add(id);
        });
        const sourceID = sourceBlock?.getAttribute('data-node-id');
        if (sourceID) blockIDs.add(sourceID);

        let replaced = 0;
        for (const blockID of blockIDs) {
            if (!isActive()) break;
            if (await this.replaceImageAssetReferenceInBlock(blockID, originalPath, savedPath, sourceBlock, isActive)) {
                replaced += 1;
            }
        }
        return replaced;
    }

    private async replaceImageAssetReferenceInBlock(
        blockID: string,
        originalPath: string,
        savedPath: string,
        sourceBlock?: HTMLElement,
        isActive: () => boolean = () => true
    ) {
        if (!isActive() || !blockID || originalPath === savedPath) return false;
        // The live DOM may already have been refreshed to savedPath.
        const pathMap = new Map([
            [originalPath, savedPath],
            [savedPath, savedPath],
        ]);
        // Gutter buttons also carry data-node-id; only editor content is a block.
        const liveBlocks = Array.from(document.querySelectorAll<HTMLElement>('.protyle-wysiwyg [data-node-id]'))
            .filter(element => element.getAttribute('data-node-id') === blockID);
        const selectionNode = window.getSelection()?.anchorNode;
        const liveBlock = liveBlocks.find(block => block === sourceBlock) ||
            liveBlocks.find(block => selectionNode && block.contains(selectionNode)) || liveBlocks[0];
        const { getBlockDOM, updateBlock } = await import('./api');

        if (liveBlock) {
            // Preserve the live content until the reference has been persisted.
            // If the image was removed/replaced during compression, leave it alone.
            const clone = liveBlock.cloneNode(true) as HTMLElement;
            const changedBlock = this.updateImageAssetReferencesWithPathMap(clone, pathMap).get(blockID);
            if (!changedBlock) return false;
            const updated = await updateBlock('dom', changedBlock.outerHTML, blockID);
            if (!updated) throw new Error('Unable to save compressed image reference');
            for (const block of liveBlocks) this.updateImageAssetReferencesWithPathMap(block, pathMap);
            return true;
        }

        const blockDOM = await getBlockDOM(blockID) as any;
        if (!isActive()) return false;
        const html =
            typeof blockDOM === 'string' ? blockDOM : blockDOM?.dom || blockDOM?.content || '';
        if (!html) throw new Error('Unable to load image block for WebP reference update');
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const changedBlocks = this.updateImageAssetReferencesWithPathMap(parsed, pathMap);
        const changedBlock = changedBlocks.get(blockID);
        if (!changedBlock) return false;
        const updated = await updateBlock('dom', changedBlock.outerHTML, blockID);
        if (!updated) throw new Error('Unable to save compressed image reference');
        return true;
    }

    private getDocIDFromEditorTitleDetail(detail: any) {
        return detail?.data?.rootID || detail?.data?.id || detail?.protyle?.block?.rootID || detail?.protyle?.block?.id || '';
    }

    private async listCompressibleAssetImages(signal?: AbortSignal): Promise<AssetImageEntry[]> {
        const { readDir } = await import('./api');
        const directories = ['data/assets'];
        const images: AssetImageEntry[] = [];

        while (directories.length > 0) {
            if (signal?.aborted) break;
            const directory = directories.shift()!;
            const entries = await readDir(directory);
            if (!Array.isArray(entries)) {
                throw new Error(`Unable to read assets directory: ${directory}`);
            }

            for (const entry of entries) {
                if (!entry?.name || entry.name === '.' || entry.name === '..') continue;
                const path = `${directory}/${entry.name}`;
                if (entry.isDir) {
                    if (!entry.isSymlink) directories.push(path);
                    continue;
                }
                if (entry.isSymlink) continue;

                const format = getCompressibleImageFormat(entry.name);
                if (format) images.push({ path, format });
            }
        }

        return images.sort((left, right) => left.path.localeCompare(right.path));
    }

    private async loadAssetCompressionHistory(): Promise<AssetCompressionHistory> {
        try {
            const stored = await this.loadData(ASSET_COMPRESSION_HISTORY_FILE);
            if (
                stored?.version === ASSET_COMPRESSION_HISTORY_VERSION &&
                stored.entries &&
                typeof stored.entries === 'object'
            ) {
                return stored as AssetCompressionHistory;
            }
        } catch (error) {
            console.warn('Failed to load asset compression history:', error);
        }

        return {
            version: ASSET_COMPRESSION_HISTORY_VERSION,
            entries: {},
        };
    }

    /** Start a plugin-owned task so closing settings does not stop compression. */
    startAssetImageCompression(): void {
        if (this.assetCompressionTask) {
            showMessage(t('settings.compressAllAssets.alreadyRunning'));
            return;
        }

        const controller = new AbortController();
        this.assetCompressionController = controller;
        const updateStatus = (message: string, title: string = message) => {
            if (!this.assetCompressionStatus || controller.signal.aborted) return;
            this.assetCompressionStatus.textContent = message;
            this.assetCompressionStatus.title = title;
            this.assetCompressionStatus.classList.remove('fn__none');
        };
        updateStatus(t('settings.compressAllAssets.scanning'));
        showMessage(t('settings.compressAllAssets.backgroundStarted'));

        this.assetCompressionTask = (async () => {
            try {
                const { pushMsg, pushErrMsg } = await import('./api');
                const result = await this.compressAllAssetImages(({ current, total, fileName }) => {
                    updateStatus(
                        t('settings.compressAllAssets.progress', {
                            current: String(current), total: String(total),
                        }),
                        t('settings.compressAllAssets.processing', {
                            current: String(current), total: String(total), fileName,
                        })
                    );
                }, controller.signal);
                if (controller.signal.aborted) return;
                if (result.total === 0) {
                    await pushMsg(t('settings.compressAllAssets.empty'));
                    return;
                }
                const savedText = result.compressed > 0
                    ? t('settings.compressAllAssets.savedSpace', {
                        size: formatBytes(Math.max(0, result.originalSize - result.savedSize)),
                    }) : '';
                const summary = t('settings.compressAllAssets.summary', {
                    compressed: String(result.compressed), remembered: String(result.remembered),
                    notSmaller: String(result.notSmaller), failed: String(result.failed),
                    sourceChanged: String(result.sourceChanged), savedText,
                });
                await (result.failed > 0 ? pushErrMsg(summary, 10000) : pushMsg(summary, 10000));
            } catch (error) {
                if (!controller.signal.aborted) {
                    console.error('Background asset compression failed:', error);
                    const { pushErrMsg } = await import('./api');
                    await pushErrMsg(t('common.errorWithDetail', {
                        message: t('settings.compressAllAssets.failed'),
                        error: String(error?.message || error),
                    }), 10000);
                }
            } finally {
                this.assetCompressionStatus?.classList.add('fn__none');
                this.assetCompressionController = null;
                this.assetCompressionTask = null;
            }
        })().catch(error => {
            console.error('Failed to report background asset compression result:', error);
        });
    }

    /**
     * Recursively compress PNG/JPG/WebP files in data/assets in place.
     * Files keep their extensions so document references never need to be rewritten.
     */
    async compressAllAssetImages(
        onProgress?: (progress: { current: number; total: number; fileName: string }) => void,
        signal?: AbortSignal
    ) {
        const { getFileBlob, putFile } = await import('./api');
        const compressionSettings = { ...this.settings };
        const images = await this.listCompressibleAssetImages(signal);
        const history = await this.loadAssetCompressionHistory();
        const currentPaths = new Set(images.map(image => image.path));
        const historyEntries = Object.fromEntries(
            Object.entries(history.entries || {}).filter(([path]) => currentPaths.has(path))
        ) as Record<string, AssetCompressionHistoryEntry>;
        const changedAssetPaths = new Set<string>();
        const stats = {
            total: images.length,
            compressed: 0,
            remembered: 0,
            notSmaller: 0,
            failed: 0,
            sourceChanged: 0,
            originalSize: 0,
            savedSize: 0,
        };
        let historyUpdatesSinceSave = 0;

        const saveHistory = async () => {
            await this.saveData(ASSET_COMPRESSION_HISTORY_FILE, {
                version: ASSET_COMPRESSION_HISTORY_VERSION,
                entries: historyEntries,
            } satisfies AssetCompressionHistory);
            historyUpdatesSinceSave = 0;
        };

        for (let index = 0; index < images.length; index++) {
            // Give note input/rendering a turn between files, including remembered ones.
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            if (signal?.aborted) return stats;
            const image = images[index];
            const fileName = image.path.split('/').pop() || image.path;
            onProgress?.({ current: index + 1, total: images.length, fileName });

            try {
                const sourceBlob = await getFileBlob(image.path);
                if (!sourceBlob || sourceBlob.size === 0) {
                    stats.failed += 1;
                    continue;
                }

                const profile = getAssetCompressionProfile(compressionSettings, image.format);
                const sourceFingerprint = await getBlobFingerprint(sourceBlob);
                const previous = historyEntries[image.path];
                if (
                    previous?.fingerprint === sourceFingerprint &&
                    previous.profile === profile
                ) {
                    stats.remembered += 1;
                    continue;
                }

                const compressedBlob = await this.compressImageBlob(
                    sourceBlob,
                    image.format,
                    image.format,
                    getFormatCompressionOptions(compressionSettings, image.format)
                );

                if (!compressedBlob || compressedBlob.size === 0) {
                    stats.failed += 1;
                    continue;
                }

                if (compressedBlob.size < sourceBlob.size) {
                    const file = new File([compressedBlob], fileName, {
                        type: getMimeByFormat(image.format),
                    });
                    const compressedFingerprint = await getBlobFingerprint(compressedBlob);
                    const currentBlob = await getFileBlob(image.path);
                    if (!currentBlob || (await getBlobFingerprint(currentBlob)) !== sourceFingerprint) {
                        stats.sourceChanged += 1;
                        continue;
                    }
                    if (signal?.aborted) return stats;
                    await putFile(image.path, false, file);

                    const savedBlob = await getFileBlob(image.path);
                    if (
                        !savedBlob ||
                        savedBlob.size === 0 ||
                        (await getBlobFingerprint(savedBlob)) !== compressedFingerprint
                    ) {
                        stats.failed += 1;
                        continue;
                    }

                    historyEntries[image.path] = {
                        fingerprint: compressedFingerprint,
                        profile,
                        processedAt: Date.now(),
                    };
                    stats.compressed += 1;
                    stats.originalSize += sourceBlob.size;
                    stats.savedSize += savedBlob.size;
                    changedAssetPaths.add(image.path.replace(/^data\//, ''));
                } else {
                    historyEntries[image.path] = {
                        fingerprint: sourceFingerprint,
                        profile,
                        processedAt: Date.now(),
                    };
                    stats.notSmaller += 1;
                }

                historyUpdatesSinceSave += 1;
                if (historyUpdatesSinceSave >= 20) await saveHistory();
            } catch (error) {
                stats.failed += 1;
                console.warn(`Failed to compress asset image ${image.path}:`, error);
            }
        }

        if (signal?.aborted) return stats;
        await saveHistory();

        if (changedAssetPaths.size > 0) {
            const imagesByPath = new Map<string, HTMLImageElement[]>();
            document.querySelectorAll('img').forEach((element: Element) => {
                const image = element as HTMLImageElement;
                const assetPath = normalizeAssetPath(
                    image.dataset?.src || image.getAttribute('src')
                );
                if (assetPath && changedAssetPaths.has(assetPath)) {
                    const images = imagesByPath.get(assetPath) || [];
                    images.push(image);
                    imagesByPath.set(assetPath, images);
                }
            });
            for (const [assetPath, images] of imagesByPath) {
                await refreshAssetImages(images, assetPath);
            }
        }

        return stats;
    }

    /** Temporary choices inherit settings and never write back to the global profile. */
    private async showImageCompressionDialog(
        title: string,
        imageURLs: string[],
        onConfirm: (choice: ImageCompressionChoice) => Promise<void>
    ): Promise<void> {
        const { showImageCompressionDialog } = await import('./utils/imageCompressionDialog');
        const { getFileBlob, pushErrMsg } = await import('./api');
        const items: CompressionPreviewItem[] = [...new Set(imageURLs.map(normalizeAssetPath))]
            .filter((path): path is string => !!path && !!getCompressibleImageFormat(path))
            .map(path => ({ path, format: getCompressibleImageFormat(path)! }));
        if (!items.length) {
            await pushErrMsg(t('imageCompression.unsupported'));
            return;
        }
        const settings = { ...this.settings };
        const format = getCompressionFormat(settings);
        showImageCompressionDialog({
            title, items,
            defaultFormat: format === 'original' && items.length === 1 ? items[0].format : format,
            limitLongEdge: settings.limitImageLongEdge === true,
            maxLongEdge: getImageMaxLongEdge(settings),
            defaults: format => ({
                ...getFormatCompressionOptions(settings, format),
                ...(format === 'webp' ? { effort: 'fast' as const } : {}),
            }),
            load: async item => {
                const blob = await getFileBlob(`data/${item.path}`);
                if (!blob?.size) throw new Error(t('imageEditor.emptyImage'));
                return blob;
            },
            encode: async (item, source, choice) =>
                (await this.prepareImageCompression(item.path, choice, source)).compressedBlob,
            confirm: async choice => {
                try { await onConfirm(choice); }
                catch (error) {
                    console.error('Image compression failed:', error);
                    await pushErrMsg(t('imageCompression.failed'));
                }
            },
        });
    }

    private async compressDocumentImageAssets(docID: string, imageURLs: string[], choice: ImageCompressionChoice = {}) {
        const { pushMsg, pushErrMsg } = await import('./api');
        const uniqueURLs = Array.from(new Set(imageURLs
            .map((imageURL) => normalizeAssetPath(imageURL))
            .filter((imageURL): imageURL is string => !!imageURL && !!getCompressibleImageFormat(imageURL))));

        if (uniqueURLs.length === 0) {
            await pushMsg(t('documentImageCompression.noCompressibleImages'));
            return;
        }

        await pushMsg(t('documentImageCompression.started', { count: String(uniqueURLs.length) }));

        const stats = {
            compressed: 0,
            skipped: 0,
            failed: 0,
            writeFailed: 0,
            originalSize: 0,
            savedSize: 0,
        };
        const convertedPaths = new Map<string, string>();

        for (const imageURL of uniqueURLs) {
            const result = await this.compressImageAsset(imageURL, undefined, { ...choice, silent: true });
            if (result.status === 'compressed') {
                stats.compressed += 1;
                stats.originalSize += result.originalSize;
                stats.savedSize += result.savedSize;
                if (result.originalPath !== result.savedPath) {
                    convertedPaths.set(result.originalPath, result.savedPath);
                }
            } else if (result.status === 'failed') {
                stats.failed += 1;
            } else if (result.reason === 'write-failed') {
                stats.writeFailed += 1;
            } else {
                stats.skipped += 1;
            }
        }

        if (convertedPaths.size > 0) {
            try {
                for (const [originalPath, savedPath] of convertedPaths) {
                    await this.replaceImageAssetReferencesEverywhere(originalPath, savedPath);
                }
            } catch (error) {
                console.error('Failed to update global image references for document compression:', docID, error);
                await pushErrMsg(t('documentImageCompression.referenceUpdateFailed'));
                return;
            }
        }

        const failedCount = stats.failed + stats.writeFailed;
        const sizeText = stats.compressed > 0
            ? t('documentImageCompression.sizeChange', {
                originalSize: formatBytes(stats.originalSize),
                savedSize: formatBytes(stats.savedSize),
            })
            : '';

        if (failedCount > 0) {
            await pushErrMsg(
                t('documentImageCompression.summaryWithFailures', {
                    compressed: String(stats.compressed),
                    failed: String(failedCount),
                    skipped: String(stats.skipped),
                    sizeText,
                })
            );
            return;
        }

        const skippedText = stats.skipped > 0
            ? t('documentImageCompression.skipped', { count: String(stats.skipped) })
            : '';
        await pushMsg(t('documentImageCompression.summary', {
            compressed: String(stats.compressed),
            total: String(uniqueURLs.length),
            skippedText,
            sizeText,
        }));
    }

    /** Preview and saving share the exact encoder and metadata preparation. */
    private async prepareImageCompression(imagePath: string, options: ImageCompressionChoice = {}, sourceBlob?: Blob) {
        const { getFileBlob } = await import('./api');
        const fileName = imagePath.split('/').pop() || '';
        const format = getCompressibleImageFormat(fileName);
        if (!format) throw new Error(t('imageCompression.unsupported'));
        const blob = sourceBlob || await getFileBlob(`data/${imagePath}`);
        if (!blob || blob.size === 0) {
            throw new Error(t('imageEditor.emptyImage'));
        }

        const outputFormat = options.outputFormat === 'original' ? format
            : options.outputFormat || getCompressionOutputFormat(this.settings, format);
        let savedFileName =
            outputFormat === format ? fileName : replaceFileExtension(fileName, outputFormat);
        let savedPath = imagePath.replace(/[^/]+$/, savedFileName);
        if (savedPath !== imagePath) {
            const targetName = savedFileName;
            let suffix = 1;
            // Different source formats can share a stem. Never overwrite another
            // converted asset which may already be referenced by other notes.
            while (await getFileBlob(`data/${savedPath}`)) {
                savedFileName = targetName.replace(/\.[^.]+$/, `-${suffix++}.${outputFormat}`);
                savedPath = imagePath.replace(/[^/]+$/, savedFileName);
            }
        }
        const compressionOptions = {
            ...getFormatCompressionOptions(this.settings, outputFormat),
            ...options.formatOptions?.[outputFormat],
            ...(options.quality !== undefined ? { quality: options.quality } : {}),
            ...(options.pngMode !== undefined ? { pngMode: options.pngMode } : {}),
            ...(options.effort !== undefined ? { effort: options.effort } : {}),
        };
        compressionOptions.maxLongEdge = options.maxLongEdge;

        let sidecarText: string | null = null;
        if (savedPath !== imagePath) {
            try {
                const sidecar = await getFileBlob(`${EDITOR_BACKUP_DIR}/${fileName}.json`);
                if (sidecar && sidecar.size > 0) sidecarText = await sidecar.text();
            } catch {
                // Most images do not have editor sidecar data.
            }
        }

        let metadataOverride: string | null = null;
        if (sidecarText && outputFormat !== 'jpeg') {
            try {
                const sidecarData = JSON.parse(sidecarText);
                if (this.settings?.storageMode === 'backup') {
                    const { canvasJSON: _canvasJSON, ...embeddedPointer } = sidecarData;
                    metadataOverride = JSON.stringify({
                        ...embeddedPointer,
                        backupFileName: `${savedFileName}.json`,
                    });
                } else {
                    metadataOverride = JSON.stringify({
                        ...sidecarData,
                        backupFileName: undefined,
                    });
                }
            } catch {
                metadataOverride = sidecarText;
            }
        }

        const compressedBlob = await this.compressImageBlob(
            blob,
            format,
            outputFormat,
            compressionOptions,
            metadataOverride
        );

        return { blob, format, outputFormat, savedFileName, savedPath, sidecarText, compressedBlob };
    }

    private async compressImageAsset(
        imageURL: string,
        imageElement?: HTMLImageElement,
        options: ImageCompressionChoice & { silent?: boolean; isActive?: () => boolean } = {}
    ): Promise<CompressionResult> {
        const imagePath = normalizeAssetPath(imageURL);
        const fileName = imagePath?.split('/').pop() || '';
        const format = imagePath ? getCompressibleImageFormat(fileName) : null;
        const { getFileBlob, putFile, pushMsg, pushErrMsg } = await import('./api');
        const notifyMsg = async (message: string) => {
            if (!options.silent) await pushMsg(message);
        };
        const notifyErr = async (message: string) => {
            if (!options.silent) await pushErrMsg(message);
        };

        if (!format || !imagePath) {
            await notifyErr(t('imageCompression.unsupported'));
            return { status: 'skipped', reason: 'unsupported' };
        }

        try {
            const { blob, outputFormat, savedFileName, savedPath, sidecarText, compressedBlob } =
                await this.prepareImageCompression(imagePath, options);
            const isFormatConversion = outputFormat !== format;
            if (
                !shouldUseReencodedImage(blob.size, compressedBlob.size)
            ) {
                await notifyMsg(
                    t('imageCompression.notSmaller', {
                        originalSize: formatBytes(blob.size),
                        compressedSize: formatBytes(compressedBlob.size),
                    })
                );
                return {
                    status: 'skipped',
                    reason: 'not-smaller',
                    originalSize: blob.size,
                    compressedSize: compressedBlob.size,
                };
            }

            const file = new File([compressedBlob], savedFileName, {
                type: getMimeByFormat(outputFormat),
            });
            if (options.isActive && !options.isActive()) return { status: 'skipped', reason: 'canceled' };
            await putFile(`data/${savedPath}`, false, file);

            if (sidecarText && this.settings?.storageMode === 'backup' && savedPath !== imagePath) {
                try {
                    const sidecarData = JSON.parse(sidecarText);
                    const updatedSidecar = new Blob(
                        [
                            JSON.stringify({
                                ...sidecarData,
                                backupFileName: `${savedFileName}.json`,
                            }),
                        ],
                        { type: 'application/json' }
                    );
                    await putFile(
                        `${EDITOR_BACKUP_DIR}/${savedFileName}.json`,
                        false,
                        updatedSidecar
                    );
                } catch (error) {
                    console.warn('Failed to copy editor backup metadata for converted image', error);
                }
            }

            const saved = await getFileBlob(`data/${savedPath}`);
            const writeVerified = saved && saved.size > 0 && (savedPath !== imagePath ||
                (await getBlobFingerprint(saved)) === (await getBlobFingerprint(compressedBlob)));
            if (!writeVerified) {
                // 原路径写入失败时恢复源文件，不更新页面中的图片。
                if (savedPath === imagePath) await putFile(`data/${imagePath}`, false, blob);
                await notifyErr(t('imageCompression.writeFailed'));
                return { status: 'skipped', reason: 'write-failed' };
            }

            const images = new Set<HTMLImageElement>();
            if (imageElement) images.add(imageElement);
            if (savedPath === imagePath) {
                document.querySelectorAll<HTMLImageElement>('img[data-src]').forEach(img => images.add(img));
            }
            await refreshAssetImages(
                [...images].filter(img => normalizeAssetPath(img.dataset?.src || img.getAttribute('src')) === imagePath),
                savedPath
            );

            await notifyMsg(
                t(isFormatConversion ? 'imageCompression.converted' : 'imageCompression.success', {
                    originalSize: formatBytes(blob.size),
                    savedSize: formatBytes(saved.size),
                    fileName: savedFileName,
                })
            );
            return {
                status: 'compressed',
                originalSize: blob.size,
                savedSize: saved.size,
                originalPath: imagePath,
                savedPath,
            };
        } catch (error) {
            console.error('Compress image failed:', error);
            await notifyErr(t('imageCompression.failed'));
            return { status: 'failed' };
        }
    }

    /** 保留并验证编辑器工程数据；任何失败都向调用方抛出，阻止覆盖源文件。 */
    private async compressImageBlob(
        blob: Blob,
        sourceFormat: CompressibleImageFormat,
        outputFormat: CompressibleImageFormat = sourceFormat,
        options?: ReencodeOptions,
        metadataOverride?: string | null
    ): Promise<Blob> {
        const effectiveOptions =
            options || getFormatCompressionOptions(this.settings, outputFormat);
        let metadata = metadataOverride ?? null;
        if (metadata === null && (sourceFormat === 'png' || sourceFormat === 'webp')) {
            const originalBuffer = new Uint8Array(await blob.arrayBuffer());
            metadata = sourceFormat === 'png'
                ? locatePNGtEXt(originalBuffer)
                    ? readPNGTextChunk(originalBuffer, EDITOR_METADATA_KEY)
                    : null
                : readWebPMetadata(originalBuffer, EDITOR_METADATA_KEY);
        }

        const compressedBlob = await reencodeImageBlob(blob, outputFormat, effectiveOptions);
        if (metadata === null) return compressedBlob;
        if (outputFormat !== 'png' && outputFormat !== 'webp') {
            throw new Error(t('imageCompression.metadataFormatError'));
        }

        const compressedBuffer = new Uint8Array(await compressedBlob.arrayBuffer());
        const newBuffer = outputFormat === 'webp'
            ? insertWebPMetadata(compressedBuffer, EDITOR_METADATA_KEY, metadata)
            : insertPNGTextChunk(compressedBuffer, EDITOR_METADATA_KEY, metadata);
        const preservedMetadata = outputFormat === 'webp'
            ? readWebPMetadata(newBuffer, EDITOR_METADATA_KEY)
            : readPNGTextChunk(newBuffer, EDITOR_METADATA_KEY);
        // Compare the full stored text, including canvasJSON and backup pointers.
        if (preservedMetadata !== metadata) {
            throw new Error('Editor metadata verification failed; keeping the original image');
        }
        return new Blob([newBuffer as any], { type: getMimeByFormat(outputFormat) });
    }

    async openEditorTitleIconHandler({ detail }) {
        const menu = detail?.menu;
        const docID = this.getDocIDFromEditorTitleDetail(detail);
        if (!menu || !docID) return;

        menu.addItem({
            id: 'compress-document-images',
            icon: 'iconImage',
            label: t('documentImageCompression.title'),
            index: 1,
            click: () => this.openDocumentImageCompression(docID, detail.protyle),
        });
    }

    openMenuDocTreeHandler({ detail }) {
        if (!detail?.menu || detail.type !== 'doc') return;
        const elements = Array.from(detail.elements || []) as HTMLElement[];
        if (elements.length > 1 || detail.items?.length > 1) return;
        const element = elements[0];
        const item = detail.items?.[0];
        const docID = item?.id || element?.getAttribute('data-node-id');
        const childCount = item?.subFileCount ?? element?.getAttribute('data-count');
        const toggle = element?.querySelector('.b3-list-item__toggle');
        const arrow = toggle?.querySelector('.b3-list-item__arrow');
        // Register synchronously: SiYuan builds the plugin submenu before awaiting any work.
        const hasChildren = childCount != null
            ? Number(childCount) > 0
            : !!toggle && ![toggle, arrow].some(node =>
                node?.classList.contains('fn__hidden') || node?.classList.contains('fn__none'));
        if (!docID || !hasChildren) return;

        detail.menu.addItem({
            id: 'compress-document-tree-images',
            icon: 'iconImage',
            label: t('documentImageCompression.titleWithChildren'),
            click: () => this.openDocumentImageCompression(docID, undefined, true),
        });
    }

    private async openDocumentImageCompression(docID: string, protyle?: any, includeDescendants = false) {
        const { pushMsg, pushErrMsg } = await import('./api');
        const title = t(includeDescendants
            ? 'documentImageCompression.titleWithChildren'
            : 'documentImageCompression.title');
        const emptyMessage = includeDescendants
            ? 'documentImageCompression.noLocalImagesWithChildren'
            : 'documentImageCompression.noLocalImages';
        const unsupportedMessage = includeDescendants
            ? 'documentImageCompression.noCompressibleImagesWithChildren'
            : 'documentImageCompression.noCompressibleImages';

        try {
            const documentIDs = includeDescendants ? await this.getDocumentAndDescendantIDs(docID) : [docID];
            const paths = new Set<string>();
            // Scan documents in order so large document trees do not load all DOMs at once.
            for (const id of documentIDs) {
                const imageURLs = await this.getDocumentImageAssetPaths(id, id === docID ? protyle : undefined);
                imageURLs.forEach(path => paths.add(path));
            }
            if (paths.size === 0) {
                await pushMsg(t(emptyMessage));
                return;
            }
            const imageURLs = Array.from(paths).filter(path => getCompressibleImageFormat(path));
            if (imageURLs.length === 0) {
                await pushMsg(t(unsupportedMessage));
                return;
            }
            await this.showImageCompressionDialog(title, imageURLs, choice =>
                this.compressDocumentImageAssets(docID, imageURLs, choice)
            );
        } catch (error) {
            console.error('Compress document images failed:', error);
            await pushErrMsg(t('documentImageCompression.scanFailed'));
        }
    }

    async openMenuImageHandler({ detail }) {
        const selectedElement = detail.element as HTMLElement;
        const imageElement = selectedElement.querySelector('img') as HTMLImageElement;
        if (!imageElement) return;
        const imageURL = normalizeAssetPath(imageElement.dataset.src || imageElement.getAttribute('src'));
        if (!imageURL) return;
        const blockElement = selectedElement.closest("div[data-type='NodeParagraph']") as HTMLElement;
        if (!blockElement) return;
        const blockID = blockElement.getAttribute('data-node-id');

        const menu = (window as any).siyuan.menus.menu;
        if (!menu) return;

        menu.addItem({
            id: 'edit-image',
            icon: 'iconImage',
            label: t('imageEditor.menuEditImage'),
            index: 1,
            click: async () => {
                // 检测图片是否包含画布模式标记
                let isCanvasMode = false;
                try {
                    const { getFileBlob } = await import('./api');
                    const { readPNGTextChunk, locatePNGtEXt, readWebPMetadata } = await import(
                        './utils'
                    );

                    const blob = await getFileBlob(`data/${imageURL}`);
                    if (blob) {
                        const buffer = new Uint8Array(await blob.arrayBuffer());
                        const meta = locatePNGtEXt(buffer)
                            ? readPNGTextChunk(buffer, EDITOR_METADATA_KEY)
                            : readWebPMetadata(buffer, EDITOR_METADATA_KEY);
                        if (meta) {
                            try {
                                const editorData = JSON.parse(meta);
                                isCanvasMode = editorData.isCanvasMode === true;
                            } catch (e) {
                                // 元数据解析失败，使用默认模式
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Failed to read image metadata:', e);
                }

                // 打开编辑器对话框
                this.openImageEditorDialog(
                    imageURL,
                    blockID,
                    isCanvasMode,
                    false,
                    async newPath => {
                        if (blockID && newPath !== imageURL) {
                            await this.replaceImageAssetReferenceInBlock(
                                blockID,
                                imageURL,
                                newPath,
                                blockElement
                            );
                        }
                    }
                );
            }
        });
        menu.addItem({
            id: 'compress-image',
            icon: 'iconImage',
            label: t('imageCompression.title'),
            index: 1,
            click: async () => {
                await this.showImageCompressionDialog(
                    t('imageCompression.title'),
                    [imageURL],
                    async (choice) => {
                        const result = await this.compressImageAsset(imageURL, imageElement, choice);
                        if (result.status === 'compressed' && result.originalPath !== result.savedPath) {
                            try {
                                await this.replaceImageAssetReferencesEverywhere(
                                    result.originalPath,
                                    result.savedPath,
                                    blockElement
                                );
                            } catch (error) {
                                console.error('Failed to update converted image references:', error);
                                const { pushErrMsg } = await import('./api');
                                await pushErrMsg(t('imageCompression.referenceUpdateFailed'));
                            }
                        }
                    }
                );
            }
        });
        menu.addItem({
            id: 'copy-image',
            icon: 'iconCopy',
            label: t('imageEditor.menuCopyImage'),
            index: 1,
            click: async () => {
                try {
                    const { getFileBlob, putFile, insertBlock } = await import('./api');

                    // 1. 获取图片 Blob
                    const blob = await getFileBlob(`data/${imageURL}`);
                    if (!blob) {
                        console.error('Failed to get image blob');
                        return;
                    }

                    // 2. 生成新文件名
                    const oldFileName = imageURL.split('/').pop() || '';
                    const lastDotIndex = oldFileName.lastIndexOf('.');
                    const ext = lastDotIndex !== -1 ? oldFileName.substring(lastDotIndex + 1) : 'png';
                    let baseName = lastDotIndex !== -1 ? oldFileName.substring(0, lastDotIndex) : oldFileName;

                    // 去除旧ID
                    // Siyuan ID 格式通常为: content-20210101120000-abcdefg
                    // 尝试移除末尾的 ID (14位时间戳 + 可选的 7位随机字符)
                    baseName = baseName.replace(/-\d{14}(-[a-zA-Z0-9]+)?$/, '');

                    if (!baseName) baseName = 'image';

                    const newID = window.Lute.NewNodeID();
                    const newFileName = `${baseName}-${newID}.${ext}`;
                    const newPath = `assets/${newFileName}`;

                    // 3. 写入新文件
                    const newFile = new File([blob], newFileName, { type: blob.type });
                    await putFile(`data/${newPath}`, false, newFile);

                    // 4. 插入新图片块 (Insert after current block)
                    // 使用 insertBlock with previousID 实现 "插入到...后"
                    // 用户提到使用 appendBlock，但在API层面 insertBlock(previousID) 是实现 "Insert After" 的标准方式
                    // appendBlock 仅接受 parentID，会将内容追加到父节点末尾，这可能不符合 "插入到当前图片块后" 的语境
                    // 故此处使用 insertBlock
                    await insertBlock('markdown', `![](${newPath})`, undefined, blockID);

                } catch (e) {
                    console.error('Copy image failed:', e);
                }
            }
        });
    }

    async openImageEditorDialog(imagePath: string, blockID?: string | null, isCanvasMode: boolean = false, isScreenshotMode: boolean = false, onSaveCallback?: (path: string) => void | Promise<void>, initialRect?: { x: number, y: number, width: number, height: number } | null) {
        // derive filename from path/URL and include it in the dialog title
        const fileName = (typeof imagePath === 'string' && imagePath.length && !imagePath.startsWith('data:'))
            ? imagePath.split('/').pop() || ''
            : '';
        const baseTitle = isScreenshotMode ? (t('screenshot.title') || 'Screenshot') : (isCanvasMode ? (t('imageEditor.createCanvas') || 'Create canvas') : (t('imageEditor.editImage') || 'Edit image'));
        const title = fileName ? `${baseTitle} — ${fileName}` : baseTitle;

        const dialog = new Dialog({
            title: title,
            content: `<div id='ImageEditor' style='height: 100%;'></div>`,
            destroyCallback: () => { /* component destroyed in callback */ },
            width: '80vw',
            height: '80vh'
        });

        // 如果是截图模式，直接设置样式实现全屏效果
        if (isScreenshotMode) {
            const dialogContainer = dialog.element.querySelector('.b3-dialog__container') as HTMLElement;
            if (dialogContainer) {
                dialogContainer.style.width = '100vw';
                dialogContainer.style.height = '100vh';
                dialogContainer.style.maxWidth = 'unset';
                dialogContainer.style.maxHeight = 'unset';
                dialogContainer.style.top = '0';
                dialogContainer.style.left = '0';
            }
        }


        const target = dialog.element.querySelector('#ImageEditor') as HTMLElement;
        const comp = new ImageEditorComponent({
            target,
            props: {
                imagePath,
                blockId: blockID,
                settings: this.settings,
                isCanvasMode,
                isScreenshotMode,
                initialRect,
                canvasItems: isCanvasMode && blockID
                    ? [{ path: imagePath, blockId: blockID, label: fileName || imagePath }]
                    : [],
                onClose: (
                    saved: boolean,
                    newPath?: string,
                    context?: { sourcePath: string; blockId: string | null }
                ) => {
                    // Bypass dirty check on explicit save/cancel
                    (dialog as any)._skipDirtyCheck = true;
                    dialog.destroy();
                    const sourcePath = context?.sourcePath || imagePath;
                    const sourceBlockID = context?.blockId || blockID;
                    if (saved && newPath && sourceBlockID && newPath !== sourcePath) {
                        const updateReference =
                            onSaveCallback &&
                            sourcePath === imagePath &&
                            sourceBlockID === blockID
                            ? () => onSaveCallback(newPath)
                            : async () => {
                                  await this.replaceImageAssetReferenceInBlock(
                                      sourceBlockID,
                                      sourcePath,
                                      newPath
                                  );
                              };
                        void Promise.resolve(updateReference()).catch(error => {
                            console.error('Failed to update saved image reference:', error);
                        });
                    }
                }
            }
        });

        if (isCanvasMode && blockID) {
            void this.getDocumentCanvasItems(blockID).then(items => {
                const hasCurrent = items.some(
                    item => item.blockId === blockID && item.path === imagePath
                );
                comp.$set({
                    canvasItems: hasCurrent
                        ? items
                        : [
                              ...items,
                              { path: imagePath, blockId: blockID, label: fileName || imagePath },
                          ],
                });
            });
        }

        let canvasNavigationBusy = false;
        let openingInTab = false;
        const saveCurrentCanvas = async () => {
            const result = await (comp as any).saveForSwitch();
            if (!result) return false;
            if (result.blockId && result.newPath !== result.sourcePath) {
                await this.replaceImageAssetReferenceInBlock(
                    result.blockId,
                    result.sourcePath,
                    result.newPath
                );
            }
            return true;
        };
        const runCanvasNavigation = (action: () => void | Promise<void>) => {
            if (canvasNavigationBusy || openingInTab) return;
            const run = async () => {
                canvasNavigationBusy = true;
                try {
                    if (await saveCurrentCanvas()) await action();
                } finally {
                    canvasNavigationBusy = false;
                }
            };
            void run();
        };

        comp.$on('switchCanvas', (e) => {
            const item = e.detail?.item as DocumentCanvasItem | undefined;
            if (!item?.path || !item.blockId) return;
            runCanvasNavigation(() => (comp as any).switchCanvas(item));
        });

        comp.$on('createCanvas', (e) => {
            const anchorBlockID = e.detail?.blockId || blockID;
            if (!anchorBlockID) return;
            runCanvasNavigation(async () => {
                try {
                    const item = await this.createBlankCanvasAfter(
                        anchorBlockID,
                        e.detail?.width,
                        e.detail?.height
                    );
                    await (comp as any).switchCanvas(item);
                    const items = await this.getDocumentCanvasItems(item.blockId);
                    (comp as any).reconcileCanvasItems(items);
                } catch (error) {
                    console.error('Failed to create canvas from navigation:', error);
                    const { pushErrMsg } = await import('./api');
                    await pushErrMsg('新建画布失败');
                }
            });
        });

        comp.$on('canvasSaved', (e) => {
            const result = e.detail;
            if (!result?.blockId || !result?.newPath || result.newPath === result.sourcePath) return;
            void this.replaceImageAssetReferenceInBlock(
                result.blockId,
                result.sourcePath,
                result.newPath
            )
                .catch(async error => {
                    console.error('Failed to update saved canvas reference:', error);
                    const { pushErrMsg } = await import('./api');
                    await pushErrMsg('画布已保存，但更新图片块引用失败');
                });
        });

        comp.$on('saveSettings', (e) => {
            this.settings = e.detail;
            this.saveSettings(this.settings);
        });

        comp.$on('openHistory', () => {
            this.getScreenshotManager().showHistoryDialog((filePath) => {
                // When a history item is selected, close the current editor and open the new one
                (dialog as any)._skipDirtyCheck = true;
                dialog.destroy();
                this.openImageEditorDialog(filePath, null, false, true);
            });
        });

        comp.$on('pin', (e) => {
            if (e.detail && e.detail.dataURL) {
                this.getScreenshotManager().openSticker(e.detail.dataURL);
            }
        });

        let pendingTabSave: { sourcePath: string; newPath: string; blockId: string | null } | null = null;
        comp.$on('openInTab', async (e) => {
            if (openingInTab || canvasNavigationBusy) return;
            openingInTab = true;
            try {
                const savedResult = await comp.saveForSwitch();
                if (!savedResult) return;
                const result = pendingTabSave && pendingTabSave.blockId === savedResult.blockId
                    ? { ...savedResult, sourcePath: pendingTabSave.sourcePath }
                    : savedResult;
                const { isCanvasMode: canvasMode, isScreenshotMode: screenshotMode } = e.detail;
                // Saving may convert the asset format; update the note before opening its new path.
                if (!screenshotMode && result.blockId && result.newPath !== result.sourcePath) {
                    pendingTabSave = result;
                    if (onSaveCallback && result.sourcePath === imagePath && result.blockId === blockID) {
                        await onSaveCallback(result.newPath);
                    } else {
                        await this.replaceImageAssetReferenceInBlock(
                            result.blockId,
                            result.sourcePath,
                            result.newPath
                        );
                    }
                    pendingTabSave = null;
                }
                await this.openImageEditorInTab(result.newPath, result.blockId, canvasMode, screenshotMode);
                (dialog as any)._skipDirtyCheck = true;
                dialog.destroy();
            } catch (error) {
                console.error('Failed to switch image editor to tab:', error);
                const { pushErrMsg } = await import('./api');
                await pushErrMsg(t('imageEditor.openInTabFailed'));
            } finally {
                openingInTab = false;
            }
        });
        // Intercept dialog destruction (e.g. clicking "X" or Esc)
        const originalDestroy = dialog.destroy.bind(dialog);
        dialog.destroy = () => {
            if (!(dialog as any)._skipDirtyCheck) {
                void comp.requestClose();
                return;
            }
            try {
                comp.$destroy();
            } catch (e) { }
            originalDestroy();
        };

        comp.$on('saveSettings', (e) => {
            this.settings = e.detail;
            this.saveSettings(this.settings);
        });
    }

    async openImageEditorInTab(imagePath: string, blockID?: string | null, isCanvasMode: boolean = false, isScreenshotMode: boolean = false) {
        const fileName = (typeof imagePath === 'string' && imagePath.length && !imagePath.startsWith('data:'))
            ? imagePath.split('/').pop() || ''
            : '';
        const baseTitle = isScreenshotMode ? (t('screenshot.title') || 'Screenshot') : (isCanvasMode ? (t('imageEditor.createCanvas') || 'Create canvas') : (t('imageEditor.editImage') || 'Edit image'));
        const title = fileName ? `${baseTitle} — ${fileName}` : baseTitle;

        // Create a unique ID for the tab
        const id = Math.random().toString(36).substring(7);

        // Store references for the component
        const plugin = this;

        this.addTab({
            type: id,
            init() {
                (this.element as HTMLElement).style.display = 'flex';
                (this.element as HTMLElement).style.flexDirection = 'column';

                // Create container element
                const container = document.createElement('div');
                container.id = 'ImageEditorTab';
                container.style.height = '100%';
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                this.element.appendChild(container);

                // Mount the ImageEditor component
                const comp = new ImageEditorComponent({
                    target: container,
                    props: {
                        imagePath,
                        blockId: blockID,
                        settings: plugin.settings,
                        isCanvasMode,
                        isScreenshotMode,
                        initialRect: null,
                        canvasItems: isCanvasMode && blockID
                            ? [{ path: imagePath, blockId: blockID, label: fileName || imagePath }]
                            : [],
                        onClose: (
                            saved: boolean,
                            newPath?: string,
                            context?: { sourcePath: string; blockId: string | null }
                        ) => {
                            const sourcePath = context?.sourcePath || imagePath;
                            const sourceBlockID = context?.blockId || blockID;
                            if (
                                saved &&
                                newPath &&
                                sourceBlockID &&
                                newPath !== sourcePath
                            ) {
                                void plugin
                                    .replaceImageAssetReferenceInBlock(
                                        sourceBlockID,
                                        sourcePath,
                                        newPath
                                    )
                                    .catch(error => {
                                        console.error('Failed to update saved image reference:', error);
                                    });
                            }
                            // Close the tab when editor closes
                            const tab = document.querySelector(`[data-id="${plugin.name}${id}"]`);
                            if (tab) {
                                const closeButton = tab.querySelector('.item__close') as HTMLElement;
                                closeButton?.click();
                            }
                        }
                    }
                });

                if (isCanvasMode && blockID) {
                    void plugin.getDocumentCanvasItems(blockID).then(items => {
                        const hasCurrent = items.some(
                            item => item.blockId === blockID && item.path === imagePath
                        );
                        comp.$set({
                            canvasItems: hasCurrent
                                ? items
                                : [
                                      ...items,
                                      {
                                          path: imagePath,
                                          blockId: blockID,
                                          label: fileName || imagePath,
                                      },
                                  ],
                        });
                    });
                }

                let canvasNavigationBusy = false;
                const saveCurrentCanvas = async () => {
                    const result = await (comp as any).saveForSwitch();
                    if (!result) return false;
                    if (result.blockId && result.newPath !== result.sourcePath) {
                        await plugin.replaceImageAssetReferenceInBlock(
                            result.blockId,
                            result.sourcePath,
                            result.newPath
                        );
                    }
                    return true;
                };
                const runCanvasNavigation = (action: () => void | Promise<void>) => {
                    if (canvasNavigationBusy) return;
                    const run = async () => {
                        canvasNavigationBusy = true;
                        try {
                            if (await saveCurrentCanvas()) await action();
                        } finally {
                            canvasNavigationBusy = false;
                        }
                    };
                    void run();
                };

                comp.$on('switchCanvas', (e) => {
                    const item = e.detail?.item as DocumentCanvasItem | undefined;
                    if (!item?.path || !item.blockId) return;
                    runCanvasNavigation(() => (comp as any).switchCanvas(item));
                });

                comp.$on('createCanvas', (e) => {
                    const anchorBlockID = e.detail?.blockId || blockID;
                    if (!anchorBlockID) return;
                    runCanvasNavigation(async () => {
                        try {
                            const item = await plugin.createBlankCanvasAfter(
                                anchorBlockID,
                                e.detail?.width,
                                e.detail?.height
                            );
                            await (comp as any).switchCanvas(item);
                            const items = await plugin.getDocumentCanvasItems(item.blockId);
                            (comp as any).reconcileCanvasItems(items);
                        } catch (error) {
                            console.error('Failed to create canvas from navigation:', error);
                            const { pushErrMsg } = await import('./api');
                            await pushErrMsg('新建画布失败');
                        }
                    });
                });

                comp.$on('canvasSaved', (e) => {
                    const result = e.detail;
                    if (
                        !result?.blockId ||
                        !result?.newPath ||
                        result.newPath === result.sourcePath
                    ) return;
                    void plugin
                        .replaceImageAssetReferenceInBlock(
                            result.blockId,
                            result.sourcePath,
                            result.newPath
                        )
                        .catch(async error => {
                            console.error('Failed to update saved canvas reference:', error);
                            const { pushErrMsg } = await import('./api');
                            await pushErrMsg('画布已保存，但更新图片块引用失败');
                        });
                });

                comp.$on('saveSettings', (e) => {
                    plugin.settings = e.detail;
                    plugin.saveSettings(plugin.settings);
                });

                comp.$on('openHistory', () => {
                    plugin.getScreenshotManager().showHistoryDialog((filePath) => {
                        plugin.openImageEditorInTab(filePath, null, false, true);
                    });
                });

                comp.$on('pin', (e) => {
                    if (e.detail && e.detail.dataURL) {
                        plugin.getScreenshotManager().openSticker(e.detail.dataURL);
                    }
                });

                comp.$on('openInTab', () => {
                    // Already in tab, do nothing
                });
            },
            destroy() {
                // Cleanup when tab is closed
            }
        });

        // Open the tab
        openTab({
            app: this.app,
            custom: {
                icon: 'iconImage',
                title: title,
                id: this.name + id,
            }
        });
    }

    /**
     * 创建空白图片并打开编辑器
     */
    private async createBlankCanvasAfter(
        blockID: string,
        requestedWidth?: number,
        requestedHeight?: number,
        replaceAnchorBlock = false
    ): Promise<DocumentCanvasItem> {
        if (!blockID) throw new Error('Missing anchor block ID');

        // Use the selected canvas size when provided; slash creation falls back to saved defaults.
        const savedCanvas = (this.settings && this.settings.lastToolSettings && this.settings.lastToolSettings.canvas) || {};
        const canvasW = Math.max(1, Math.round(Number(requestedWidth) || Number(savedCanvas.width) || 800));
        const canvasH = Math.max(1, Math.round(Number(requestedHeight) || Number(savedCanvas.height) || 600));
        const bgFill = savedCanvas.fill || '#ffffff';

        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');

        if (bgFill.startsWith('linear-gradient')) {
            const match = bgFill.match(/#(?:[0-9a-fA-F]{3}){1,2}/);
            ctx.fillStyle = match ? match[0] : '#ffffff';
        } else {
            ctx.fillStyle = bgFill;
        }
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(result => {
                if (result) resolve(result);
                else reject(new Error('Failed to create canvas image'));
            }, 'image/png');
        });
        const buffer = new Uint8Array(await blob.arrayBuffer());
        const metaValue = JSON.stringify({
            version: 1,
            isCanvasMode: true,
            originalFileName: '',
            cropData: null,
            originalImageDimensions: { width: canvasW, height: canvasH },
        });
        const newBuffer = insertPNGTextChunk(buffer, EDITOR_METADATA_KEY, metaValue);
        const imageName = `canvas-${window.Lute.NewNodeID()}.png`;
        const imagePath = `assets/${imageName}`;
        const file = new File(
            [new Blob([newBuffer as any], { type: 'image/png' })],
            imageName,
            { type: 'image/png' }
        );

        const { putFile, insertBlock, updateBlock } = await import('./api');
        await putFile(`data/${imagePath}`, false, file);
        if (replaceAnchorBlock) {
            await updateBlock('markdown', `![](${imagePath})`, blockID);
            return { path: imagePath, blockId: blockID, label: imageName };
        }

        const transactions = await insertBlock(
            'markdown',
            `![](${imagePath})`,
            undefined,
            blockID
        ) as any;
        const insertedOperation = (Array.isArray(transactions) ? transactions : [])
            .flatMap((transaction: any) => transaction?.doOperations || [])
            .find((operation: any) => operation?.action === 'insert' && operation?.id);
        let insertedBlockID = insertedOperation?.id || '';

        if (!insertedBlockID) {
            const items = await this.getDocumentCanvasItems(blockID);
            insertedBlockID = items.find(item => item.path === imagePath)?.blockId || '';
        }
        if (!insertedBlockID) {
            throw new Error('Canvas image was saved, but the inserted block could not be resolved');
        }

        return { path: imagePath, blockId: insertedBlockID, label: imageName };
    }

    async createBlankImageAndEdit(_protyle: any, blockID: string) {
        try {
            // Slash commands should replace their own paragraph instead of leaving `/画布` behind.
            const item = await this.createBlankCanvasAfter(
                blockID,
                undefined,
                undefined,
                true
            );
            this.openImageEditorDialog(item.path, item.blockId, true);
        } catch (error) {
            console.error('Failed to create blank image:', error);
            const { pushErrMsg } = await import('./api');
            await pushErrMsg('创建画布失败');
        }
    }
    /**
     * 加载设置
     */
    async loadSettings() {
        const settings = await this.loadData(SETTINGS_FILE);
        const defaultSettings = getDefaultSettings();
        return { ...defaultSettings, ...settings, compressionFormat: getCompressionFormat(settings) };
    }

    /**
     * 保存设置
     */
    async saveSettings(settings: any) {
        await this.saveData(SETTINGS_FILE, settings);
    }

    private setupAutomaticImageCompression() {
        const isActive = () => this.stopObservingAssetUploads === stop &&
            this.settings?.enablePasteImageCompression === true;
        const stop = observeAssetUploads(
            this.eventBus,
            () => this.settings?.enablePasteImageCompression === true,
            (paths, docID, previousImages) => this.queueAutomaticImageCompression(paths, docID, isActive, previousImages),
            () => Array.from(document.querySelectorAll<HTMLImageElement>('.protyle-wysiwyg img'))
                .map(image => ({
                    image,
                    path: normalizeAssetPath(image.dataset.src || image.getAttribute('src')),
                    blockID: image.closest('[data-node-id]')?.getAttribute('data-node-id') || '',
                })),
            normalizeAssetPath
        );
        this.stopObservingAssetUploads = stop;
    }

    private teardownAutomaticImageCompression() {
        this.stopObservingAssetUploads?.();
        this.stopObservingAssetUploads = null;
    }

    private async getAutomaticImageReferenceBlocks(imagePath: string, docID: string): Promise<string[]> {
        const { sql } = await import('./api');
        const escape = (value: string) => value.replace(/'/g, "''");
        const references = await sql(
            `SELECT DISTINCT block_id, path FROM assets WHERE root_id = '${escape(docID)}'`
        );
        if (!Array.isArray(references)) throw new Error('Unable to load uploaded image references');
        // The asset index may retain URL-encoded spaces/Chinese characters.
        return [...new Set<string>(references
            .filter(reference => normalizeAssetPath(reference.path) === imagePath)
            .map(reference => reference.block_id).filter(Boolean))];
    }

    private async waitForAutomaticImageReferences(
        imagePath: string,
        docID: string,
        isActive: () => boolean,
        previousImages: UploadedImageReference[]
    ): Promise<string[]> {
        // Upload completion precedes the editor's insertion transaction. Wait for its
        // persisted reference so short compression jobs cannot miss the pasted image.
        const deadline = Date.now() + 10000;
        const previous = previousImages.filter(reference => reference.path === imagePath);
        const previousBlockIDs = new Set(previous.map(reference => reference.blockID));
        while (isActive() && Date.now() < deadline) {
            const blockIDs = await this.getAutomaticImageReferenceBlocks(imagePath, docID);
            const newImageInExistingBlock = Array.from(document.querySelectorAll<HTMLImageElement>('.protyle-wysiwyg img'))
                .some(image => normalizeAssetPath(image.dataset.src || image.getAttribute('src')) === imagePath &&
                    blockIDs.includes(image.closest('[data-node-id]')?.getAttribute('data-node-id') || '') &&
                    !previous.some(reference => reference.image === image));
            if (blockIDs.some(id => !previousBlockIDs.has(id)) || newImageInExistingBlock) return blockIDs;
            await new Promise(resolve => window.setTimeout(resolve, 250));
        }
        return [];
    }

    private queueAutomaticImageCompression(
        uploadedPaths: string[],
        docID: string,
        isActive: () => boolean,
        previousImages: UploadedImageReference[] = []
    ): Promise<void> {
        // Uploads without a document (for example an image-picker upload) have no
        // pasted block to update. Do not rewrite unrelated references to that asset.
        if (!docID) return Promise.resolve();
        const paths = [...new Set(uploadedPaths.map(path => normalizeAssetPath(path)))]
            .filter((path): path is string => !!path && !!getCompressibleImageFormat(path));
        if (paths.length === 0) return Promise.resolve();

        this.automaticCompressionQueue = this.automaticCompressionQueue.then(async () => {
            let compressedCount = 0;
            let convertedCount = 0;
            let originalTotalSize = 0;
            let compressedTotalSize = 0;
            let failedCount = 0;
            for (const path of paths) {
                if (!isActive()) break;
                try {
                    const references = await this.waitForAutomaticImageReferences(path, docID, isActive, previousImages);
                    if (references.length === 0 || !isActive()) continue;
                    const result = await this.compressImageAsset(path, undefined, {
                        silent: true,
                        isActive,
                        maxLongEdge: this.settings?.limitImageLongEdge === true
                            ? getImageMaxLongEdge(this.settings)
                            : undefined,
                    });
                    if (result.status === 'failed' || (result.status === 'skipped' && result.reason === 'write-failed')) {
                        failedCount += 1;
                        continue;
                    }
                    if (result.status !== 'compressed' || !isActive()) continue;
                    if (result.savedPath !== path) {
                        const replaced = await this.replaceImageAssetReferencesEverywhere(
                            path, result.savedPath, undefined, isActive
                        );
                        if (replaced === 0) {
                            // Keep unreferenced output for SiYuan's explicit cleanup.
                            // Per-image cleanup can race ongoing document transactions.
                            continue;
                        }
                    }
                    compressedCount += 1;
                    if (getCompressibleImageFormat(path) !== getCompressibleImageFormat(result.savedPath)) {
                        convertedCount += 1;
                    }
                    originalTotalSize += result.originalSize;
                    compressedTotalSize += result.savedSize;
                } catch (error) {
                    failedCount += 1;
                    console.warn('Failed to compress pasted image in background:', path, error);
                }
            }
            if (isActive()) {
                const { pushMsg, pushErrMsg } = await import('./api');
                if (compressedCount > 0 && this.settings?.showPasteImageCompressionNotification !== false) {
                    await pushMsg(getAutomaticImageProcessingMessage(
                        compressedCount, convertedCount, originalTotalSize, compressedTotalSize
                    ));
                }
                if (failedCount > 0) {
                    await pushErrMsg(`${failedCount} 张图片后台压缩失败，已保留原图`);
                }
            }
        }).catch(error => {
            console.error('Automatic image compression queue failed:', error);
        });
        return this.automaticCompressionQueue;
    }
}
