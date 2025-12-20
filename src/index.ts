import {
    Plugin,
    Dialog,
    confirm
} from "siyuan";

import "@/index.scss";

import SettingPanel from "./Settings.svelte";
import ImageEditorComponent from './components/ImageEditor.svelte';
import { getDefaultSettings } from "./defaultSettings";
import { setPluginInstance, t } from "./utils/i18n";

export const SETTINGS_FILE = "settings.json";



export default class PluginSample extends Plugin {
    _openMenuImageHandler: any;
    settings: any;


    async onload() {
        // 插件被启用时会自动调用这个函数
        // 设置i18n插件实例
        setPluginInstance(this);

        // 加载设置
        this.settings = await this.loadSettings();

        // 监听图片菜单打开事件, 在右键图片菜单中加入 编辑 菜单项
        this._openMenuImageHandler = this.openMenuImageHandler.bind(this);
        this.eventBus.on('open-menu-image', this._openMenuImageHandler);

        // 注册斜杠菜单
        this.protyleSlash = [{
            filter: ["canvas", "huabu", "画布", "imgreeditor", "画板","图片"],
            id: "imgreeditor-canvas",
            html: `<div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconImage"></use></svg><span class="b3-list-item__text">${t("imageEditor.createCanvas") || '创建画布 (ImgReEditor)'}</span></div>`,
            callback: async (protyle: any, nodeElement: HTMLElement) => {
                const blockID = nodeElement.getAttribute('data-node-id');
                // 创建空白图片并插入，然后打开编辑器
                await this.createBlankImageAndEdit(protyle, blockID);
            },
        }];
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
    }

    async openImageEditorDialog(imagePath: string, blockID?: string | null, isCanvasMode: boolean = false, onSaveCallback?: (path: string) => void) {
        // derive filename from path/URL and include it in the dialog title
        const fileName = (typeof imagePath === 'string' && imagePath.length)
            ? imagePath.split('/').pop() || ''
            : '';
        const baseTitle = isCanvasMode ? (t('imageEditor.createCanvas') || 'Create canvas') : (t('imageEditor.editImage') || 'Edit image');
        const title = fileName ? `${baseTitle} — ${fileName}` : baseTitle;

        const dialog = new Dialog({
            title: title,
            content: `<div id='ImageEditor' style='height: 90%;'></div>`,
            destroyCallback: () => { /* component destroyed in callback */ },
            width: '1000px',
            height: '700px'
        });
        const target = dialog.element.querySelector('#ImageEditor') as HTMLElement;
        const comp = new ImageEditorComponent({
            target,
            props: {
                imagePath,
                blockId: blockID,
                settings: this.settings,
                isCanvasMode,
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
