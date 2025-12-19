import {
    Plugin,
    Dialog,
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

    openMenuImageHandler({ detail }) {
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
            label: 'ImgReEditor编辑',
            index: 1,
            click: () => {
                // open dialog
                this.openImageEditorDialog(imageURL, blockID);
            }
        });
    }

    async openImageEditorDialog(imagePath: string, blockID?: string | null) {
        // derive filename from path/URL and include it in the dialog title
        const fileName = (typeof imagePath === 'string' && imagePath.length)
            ? imagePath.split('/').pop() || ''
            : '';
        const baseTitle = t('imageEditor.editImage') || 'Edit image';
        const title = fileName ? `${baseTitle} — ${fileName}` : baseTitle;

        const dialog = new Dialog({
            title: title,
            content: `<div id='ImageEditor' style='height: 90%;'></div>`,
            destroyCallback: () => { /* component destroyed in callback */ },
            width: '1000px',
            height: '700px'
        });
        const target = dialog.element.querySelector('#ImageEditor') as HTMLElement;
        const comp = new ImageEditorComponent({ target, props: { imagePath, blockId: blockID, settings: this.settings, onClose: (_saved: boolean) => { dialog.destroy(); comp.$destroy(); } } });
        comp.$on('saveSettings', (e) => {
            this.settings = e.detail;
            this.saveSettings(this.settings);
        });
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
