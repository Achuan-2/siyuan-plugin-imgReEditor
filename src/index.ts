import {
    Plugin,
    Dialog,
    Menu,
    confirm,
    openTab
} from "siyuan";
import "@/index.scss";

import SettingPanel from "./Settings.svelte";
import ImageEditorComponent from './components/ImageEditor.svelte';
import { getDefaultSettings } from "./defaultSettings";
import { setPluginInstance, t } from "./utils/i18n";
import { ScreenshotManager } from "./ScreenshotManager";
import { reencodeImageBlob, getMimeByFormat, type CompressibleImageFormat } from "./utils";

export const SETTINGS_FILE = "settings.json";
const EDITOR_METADATA_KEY = 'siyuan-plugin-imgReEditor';

function getFileExtension(fileName: string) {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : '';
}

function getCompressibleImageFormat(fileName: string): CompressibleImageFormat | null {
    const ext = getFileExtension(fileName);
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
    return null;
}

function getCompressionQuality(settings: any) {
    const rawQuality = Number(settings?.imageCompressionQuality ?? 92);
    const normalizedQuality = Number.isFinite(rawQuality) ? rawQuality : 92;
    return Math.min(100, Math.max(1, normalizedQuality)) / 100;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

type CompressionResult =
    | { status: 'compressed'; originalSize: number; savedSize: number }
    | {
        status: 'skipped';
        reason: 'unsupported' | 'empty' | 'not-smaller' | 'write-failed';
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
    settings: any;
    screenshotManager: ScreenshotManager | null = null;
    private topBarElement: HTMLElement | null = null;
    private screenshotCommandRegistered = false;


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

        // 监听图片菜单打开事件, 在右键图片菜单中加入 编辑 菜单项
        this._openMenuImageHandler = this.openMenuImageHandler.bind(this);
        this.eventBus.on('open-menu-image', this._openMenuImageHandler);

        // 监听文档标题图标菜单，加入文档级批量压缩入口
        this._clickEditorTitleIconHandler = this.openEditorTitleIconHandler.bind(this);
        this.eventBus.on('click-editortitleicon', this._clickEditorTitleIconHandler);

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
                    label: '截图',
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
                    label: '浏览历史截图',
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
        // 移除所有已注册的事件监听
        try {
            if (this._openMenuImageHandler) {
                this.eventBus.off('open-menu-image', this._openMenuImageHandler);
                this._openMenuImageHandler = null;
            }
            if (this._clickEditorTitleIconHandler) {
                this.eventBus.off('click-editortitleicon', this._clickEditorTitleIconHandler);
                this._clickEditorTitleIconHandler = null;
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

    private getDocIDFromEditorTitleDetail(detail: any) {
        return detail?.data?.rootID || detail?.data?.id || detail?.protyle?.block?.rootID || detail?.protyle?.block?.id || '';
    }

    private async compressDocumentImageAssets(imageURLs: string[]) {
        const { pushMsg, pushErrMsg } = await import('./api');
        const uniqueURLs = Array.from(new Set(imageURLs
            .map((imageURL) => normalizeAssetPath(imageURL))
            .filter((imageURL): imageURL is string => !!imageURL && !!getCompressibleImageFormat(imageURL))));

        if (uniqueURLs.length === 0) {
            await pushMsg('当前文档没有可压缩的 PNG/JPG/JPEG 图片');
            return;
        }

        await pushMsg(`开始压缩 ${uniqueURLs.length} 张文档图片...`);

        const stats = {
            compressed: 0,
            skipped: 0,
            failed: 0,
            writeFailed: 0,
            originalSize: 0,
            savedSize: 0,
        };

        for (const imageURL of uniqueURLs) {
            const result = await this.compressImageAsset(imageURL, undefined, { silent: true });
            if (result.status === 'compressed') {
                stats.compressed += 1;
                stats.originalSize += result.originalSize;
                stats.savedSize += result.savedSize;
            } else if (result.status === 'failed') {
                stats.failed += 1;
            } else if (result.reason === 'write-failed') {
                stats.writeFailed += 1;
            } else {
                stats.skipped += 1;
            }
        }

        const failedCount = stats.failed + stats.writeFailed;
        const sizeText = stats.compressed > 0
            ? `，${formatBytes(stats.originalSize)} -> ${formatBytes(stats.savedSize)}`
            : '';

        if (failedCount > 0) {
            await pushErrMsg(
                `文档图片压缩完成：成功 ${stats.compressed} 张，失败 ${failedCount} 张，跳过 ${stats.skipped} 张${sizeText}`
            );
            return;
        }

        const skippedText = stats.skipped > 0 ? `，跳过 ${stats.skipped} 张` : '';
        await pushMsg(`文档图片压缩完成：成功 ${stats.compressed}/${uniqueURLs.length} 张${skippedText}${sizeText}`);
    }

    private async compressImageAsset(
        imageURL: string,
        imageElement?: HTMLImageElement,
        options: { silent?: boolean } = {}
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
            await notifyErr('暂不支持压缩该图片格式，仅支持 PNG、JPG/JPEG');
            return { status: 'skipped', reason: 'unsupported' };
        }

        try {
            const blob = await getFileBlob(`data/${imagePath}`);
            if (!blob || blob.size === 0) {
                await notifyErr('无法获取图片文件或文件为空');
                return { status: 'skipped', reason: 'empty' };
            }

            const quality = getCompressionQuality(this.settings);
            let compressedBlob = await reencodeImageBlob(blob, format, quality);

            if (format === 'png') {
                try {
                    const { readPNGTextChunk, insertPNGTextChunk, locatePNGtEXt } = await import(
                        './utils'
                    );
                    const originalBuffer = new Uint8Array(await blob.arrayBuffer());
                    const meta = locatePNGtEXt(originalBuffer)
                        ? readPNGTextChunk(originalBuffer, EDITOR_METADATA_KEY)
                        : null;

                    if (meta) {
                        const compressedBuffer = new Uint8Array(await compressedBlob.arrayBuffer());
                        const newBuffer = insertPNGTextChunk(
                            compressedBuffer,
                            EDITOR_METADATA_KEY,
                            meta
                        );
                        compressedBlob = new Blob([newBuffer as any], { type: 'image/png' });
                    }
                } catch (error) {
                    console.warn('Failed to preserve PNG editor metadata during compression', error);
                }
            }

            if (compressedBlob.size >= blob.size) {
                await notifyMsg(
                    `压缩后不会更小，已保留原图（原 ${formatBytes(blob.size)}，压缩后 ${formatBytes(compressedBlob.size)}）`
                );
                return {
                    status: 'skipped',
                    reason: 'not-smaller',
                    originalSize: blob.size,
                    compressedSize: compressedBlob.size,
                };
            }

            const file = new File([compressedBlob], fileName, { type: getMimeByFormat(format) });
            await putFile(`data/${imagePath}`, false, file);

            const saved = await getFileBlob(`data/${imagePath}`);
            if (!saved || saved.size === 0) {
                await notifyErr('压缩后写入图片失败');
                return { status: 'skipped', reason: 'write-failed' };
            }

            const cacheBustURL = `${imagePath}?t=${Date.now()}`;
            const refreshImage = (img: HTMLImageElement) => {
                if (normalizeAssetPath(img.dataset?.src || img.getAttribute('src')) === imagePath) {
                    img.setAttribute('data-src', imagePath);
                    img.src = cacheBustURL;
                }
            };

            if (imageElement) refreshImage(imageElement);
            document.querySelectorAll('img[data-src]').forEach((img: Element) => {
                refreshImage(img as HTMLImageElement);
            });

            await notifyMsg(`压缩完成：${formatBytes(blob.size)} -> ${formatBytes(saved.size)}`);
            return { status: 'compressed', originalSize: blob.size, savedSize: saved.size };
        } catch (error) {
            console.error('Compress image failed:', error);
            await notifyErr('压缩图片失败');
            return { status: 'failed' };
        }
    }

    async openEditorTitleIconHandler({ detail }) {
        const menu = detail?.menu;
        const docID = this.getDocIDFromEditorTitleDetail(detail);
        if (!menu || !docID) return;

        menu.addItem({
            id: 'compress-document-images',
            icon: 'iconImage',
            label: '批量压缩文档图片',
            index: 1,
            click: async () => {
                const { pushMsg, pushErrMsg } = await import('./api');

                try {
                    const imageURLs = await this.getDocumentImageAssetPaths(docID, detail.protyle);
                    const compressibleImageURLs = imageURLs.filter((imageURL) => getCompressibleImageFormat(imageURL));

                    if (imageURLs.length === 0) {
                        await pushMsg('当前文档没有本地图片');
                        return;
                    }

                    if (compressibleImageURLs.length === 0) {
                        await pushMsg('当前文档没有可压缩的 PNG/JPG/JPEG 图片');
                        return;
                    }

                    confirm(
                        '批量压缩文档图片',
                        `将使用当前压缩设置覆盖当前文档中的 ${compressibleImageURLs.length} 张 PNG/JPG/JPEG 图片，并跳过压缩后不变小的图片。继续吗？`,
                        async () => {
                            await this.compressDocumentImageAssets(compressibleImageURLs);
                        }
                    );
                } catch (error) {
                    console.error('Compress document images failed:', error);
                    await pushErrMsg('扫描文档图片失败');
                }
            }
        });
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
            label: 'ImgReEditor 编辑',
            index: 1,
            click: async () => {
                // 检测图片是否包含画布模式标记
                let isCanvasMode = false;
                try {
                    const { getFileBlob } = await import('./api');
                    const { readPNGTextChunk, locatePNGtEXt } = await import('./utils');

                    const blob = await getFileBlob(`data/${imageURL}`);
                    if (blob) {
                        const buffer = new Uint8Array(await blob.arrayBuffer());
                        if (locatePNGtEXt(buffer)) {
                            const meta = readPNGTextChunk(buffer, EDITOR_METADATA_KEY);
                            if (meta) {
                                try {
                                    const editorData = JSON.parse(meta);
                                    isCanvasMode = editorData.isCanvasMode === true;
                                } catch (e) {
                                    // 元数据解析失败，使用默认模式
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Failed to read image metadata:', e);
                }

                // 打开编辑器对话框
                this.openImageEditorDialog(imageURL, blockID, isCanvasMode);
            }
        });
        menu.addItem({
            id: 'compress-image',
            icon: 'iconImage',
            label: '压缩图片',
            index: 1,
            click: async () => {
                confirm(
                    '压缩图片',
                    '将使用当前压缩设置覆盖原图片，并保留原图片格式。继续吗？',
                    async () => {
                        await this.compressImageAsset(imageURL, imageElement);
                    }
                );
            }
        });
        menu.addItem({
            id: 'copy-image',
            icon: 'iconCopy',
            label: '拷贝图片',
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

    async openImageEditorDialog(imagePath: string, blockID?: string | null, isCanvasMode: boolean = false, isScreenshotMode: boolean = false, onSaveCallback?: (path: string) => void, initialRect?: { x: number, y: number, width: number, height: number } | null) {
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
                onClose: (saved: boolean, newPath?: string) => {
                    // Bypass dirty check on explicit save/cancel
                    (dialog as any)._skipDirtyCheck = true;
                    dialog.destroy();
                    if (saved && newPath && onSaveCallback) {
                        onSaveCallback(newPath);
                    }
                }
            }
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

        comp.$on('openInTab', (e) => {
            const { imagePath: imgPath, blockId: blkId, isCanvasMode: canvasMode, isScreenshotMode: screenshotMode } = e.detail;
            // Close the current dialog
            (dialog as any)._skipDirtyCheck = true;
            dialog.destroy();
            // Open in a new tab
            this.openImageEditorInTab(imgPath, blkId, canvasMode, screenshotMode);
        });
        // Intercept dialog destruction (e.g. clicking "X" or Esc)
        const originalDestroy = dialog.destroy.bind(dialog);
        dialog.destroy = () => {
            if (!(dialog as any)._skipDirtyCheck && comp && typeof (comp as any).isDirty === 'function' && (comp as any).isDirty()) {
                confirm(t('imageEditor.confirm'), t('imageEditor.unsavedChanges'), () => {
                    (dialog as any)._skipDirtyCheck = true;
                    try {
                        comp.$destroy();
                    } catch (e) { }
                    originalDestroy();
                });
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
                        onClose: (_saved: boolean, _newPath?: string) => {
                            // Close the tab when editor closes
                            const tab = document.querySelector(`[data-id="${plugin.name}${id}"]`);
                            if (tab) {
                                const closeButton = tab.querySelector('.item__close') as HTMLElement;
                                closeButton?.click();
                            }
                        }
                    }
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
    async createBlankImageAndEdit(protyle: any, blockID: string) {
        try {
            // 动态导入 PNG 元数据工具
            const { insertPNGTextChunk } = await import('./utils');

            // Use saved settings or defaults
            const savedCanvas = (this.settings && this.settings.lastToolSettings && this.settings.lastToolSettings.canvas) || {};
            const canvasW = savedCanvas.width || 800;
            const canvasH = savedCanvas.height || 600;
            const bgFill = savedCanvas.fill || '#ffffff';

            // 创建一个带有背景的PNG图片
            const canvas = document.createElement('canvas');
            canvas.width = canvasW;
            canvas.height = canvasH;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                console.error('Failed to get canvas context');
                return;
            }

            // 背景
            if (bgFill.startsWith('linear-gradient')) {
                // For simplicity, use first color of gradient for the initial blank image background
                const match = bgFill.match(/#(?:[0-9a-fA-F]{3}){1,2}/);
                ctx.fillStyle = match ? match[0] : '#ffffff';
            } else {
                ctx.fillStyle = bgFill;
            }
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // 黑色文字
            ctx.fillStyle = '#666666';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('ImgReEditor Canvas', canvas.width / 2, canvas.height / 2);

            // 转换为Blob
            const blob = await new Promise<Blob>((resolve) => {
                canvas.toBlob((blob) => {
                    resolve(blob!);
                }, 'image/png');
            });

            // 写入画布模式元数据
            const buffer = new Uint8Array(await blob.arrayBuffer());
            const metaObj = {
                version: 1,
                isCanvasMode: true,
                originalFileName: '',
                cropData: null,
                originalImageDimensions: null,
            };
            const metaValue = JSON.stringify(metaObj);
            const newBuffer = insertPNGTextChunk(buffer, EDITOR_METADATA_KEY, metaValue);

            // 生成唯一文件名
            const imageName = `canvas-${window.Lute.NewNodeID()}.png`;

            // 创建新的 Blob 和 File
            const newBlob = new Blob([newBuffer as any], { type: 'image/png' });
            const file = new File([newBlob], imageName, { type: 'image/png' });

            // 使用SiYuan API上传
            const { putFile } = await import('./api');
            await putFile(`data/assets/${imageName}`, false, file);

            // 图片URL
            const imageURL = `assets/${imageName}`;

            // 插入图片到文档
            protyle.insert(`![](${imageURL})`);

            // 打开编辑器对话框（画布模式）
            this.openImageEditorDialog(imageURL, blockID, true);

        } catch (error) {
            console.error('Failed to create blank image:', error);
        }
    }
    /**
     * 加载设置
     */
    async loadSettings() {
        const settings = await this.loadData(SETTINGS_FILE);
        const defaultSettings = getDefaultSettings();
        return { ...defaultSettings, ...settings };
    }

    /**
     * 保存设置
     */
    async saveSettings(settings: any) {
        await this.saveData(SETTINGS_FILE, settings);
    }


}
