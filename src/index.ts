import {
    Plugin,
    Dialog,
    Menu,
    confirm
} from "siyuan";
import "@/index.scss";

import SettingPanel from "./Settings.svelte";
import ImageEditorComponent from './components/ImageEditor.svelte';
import { getDefaultSettings } from "./defaultSettings";
import { setPluginInstance, t } from "./utils/i18n";
import { ScreenshotManager } from "./ScreenshotManager";

export const SETTINGS_FILE = "settings.json";



export default class PluginSample extends Plugin {
    _openMenuImageHandler: any;
    settings: any;
    screenshotManager: ScreenshotManager;
    private topBarElement: HTMLElement;


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

        // 初始化截图管理器
        this.screenshotManager = new ScreenshotManager(this);
        await this.screenshotManager.registerShortcut();

        // 注册顶栏按钮（使用 Menu 类创建下拉菜单）
        const topBarElement = this.addTopBar({
            icon: 'iconImgReEditor',
            title: 'ImgReEditor',
            position: 'right',
            callback: (event) => {
                let rect = topBarElement.getBoundingClientRect();
                // 使用 Menu API 创建独立菜单实例
                const menu = new Menu('imgreeditor-topbar', () => {
                    // 菜单关闭时的回调（可选）
                });

                menu.addItem({
                    icon: 'iconScreenshot',
                    label: '截图',
                    click: async () => {
                        const result = await this.screenshotManager.captureWithSelection();
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
                        this.screenshotManager.showHistoryDialog((filePath) => {
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
            if (this.topBarElement) {
                this.topBarElement.remove();
                this.topBarElement = null;
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

    async openMenuImageHandler({ detail }) {
        const selectedElement = detail.element as HTMLElement;
        const imageElement = selectedElement.querySelector('img') as HTMLImageElement;
        if (!imageElement) return;
        const imageURL = imageElement.dataset.src;
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
                            const meta = readPNGTextChunk(buffer, 'siyuan-plugin-imgReEditor');
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
            width: '1000px',
            height: '700px'
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
            this.screenshotManager.showHistoryDialog((filePath) => {
                // When a history item is selected, close the current editor and open the new one
                (dialog as any)._skipDirtyCheck = true;
                dialog.destroy();
                this.openImageEditorDialog(filePath, null, false, true);
            });
        });

        comp.$on('pin', (e) => {
            if (e.detail && e.detail.dataURL) {
                this.screenshotManager.openSticker(e.detail.dataURL);
            }
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

    /**
     * 创建空白图片并打开编辑器
     */
    async createBlankImageAndEdit(protyle: any, blockID: string) {
        try {
            // 动态导入 PNG 元数据工具
            const { insertPNGTextChunk } = await import('./utils');

            // 创建一个带有灰色背景和文字的PNG图片
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 600;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                console.error('Failed to get canvas context');
                return;
            }

            // 灰色背景
            ctx.fillStyle = '#f0f0f0';
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
            const newBuffer = insertPNGTextChunk(buffer, 'siyuan-plugin-imgReEditor', metaValue);

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
