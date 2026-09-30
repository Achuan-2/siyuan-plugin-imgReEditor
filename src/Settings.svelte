<script lang="ts">
    import { onMount } from 'svelte';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { t } from './utils/i18n';
    import { getDefaultSettings } from './defaultSettings';
    import { pushMsg, pushErrMsg, readDir, removeFile } from './api';
    import { confirm, Constants, Dialog } from 'siyuan';
    import LoadingDialog from './components/LoadingDialog.svelte';
    export let plugin;
    export const useShell = async (cmd: 'showItemInFolder' | 'openPath', filePath: string) => {
        try {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send(Constants.SIYUAN_CMD, {
                cmd,
                filePath: filePath,
            });
        } catch (error) {
            await pushErrMsg(t('settings.openFolderUnsupported'));
        }
    };

    function formatBytes(bytes: number) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    // 使用动态默认设置
    let settings = { ...getDefaultSettings() };

    interface ISettingGroup {
        id: string;
        name: string;
        items: ISettingItem[];
        //  Type："checkbox" | "select" | "textinput" | "textarea" | "number" | "slider" | "button" | "hint" | "custom";
    }

    let groups: ISettingGroup[] = [
        {
            id: 'compression',
            name: t('settings.settingsGroup.compression'),
            items: [
                {
                    key: 'enableImageCompression',
                    value: settings.enableImageCompression,
                    type: 'checkbox',
                    title: t('settings.enableImageCompression.title'),
                    description:
                        t('settings.enableImageCompression.description'),
                },
                {
                    key: 'convertToWebP',
                    value: settings.convertToWebP,
                    type: 'checkbox',
                    title: t('settings.convertToWebP.title'),
                    description:
                        t('settings.convertToWebP.description'),
                },
                {
                    key: 'webpQuality',
                    value: settings.webpQuality ?? 100,
                    type: 'slider',
                    title: t('settings.webpQuality.title'),
                    description:
                        t('settings.webpQuality.description'),
                    slider: {
                        min: 10,
                        max: 100,
                        step: 1,
                    },
                },
                {
                    key: 'pngCompressionMode',
                    value: settings.pngCompressionMode || 'lossless',
                    type: 'select',
                    title: t('settings.pngCompressionMode.title'),
                    description:
                        t('settings.pngCompressionMode.description'),
                    options: {
                        lossless: t('settings.pngCompressionMode.options.lossless'),
                        lossy: t('settings.pngCompressionMode.options.lossy'),
                    },
                },
                {
                    key: 'pngQuality',
                    value: settings.pngQuality ?? 92,
                    type: 'slider',
                    title: t('settings.pngQuality.title'),
                    description:
                        t('settings.pngQuality.description'),
                    slider: {
                        min: 10,
                        max: 100,
                        step: 1,
                    },
                },
                {
                    key: 'jpegQuality',
                    value: settings.jpegQuality ?? 92,
                    type: 'slider',
                    title: t('settings.jpegQuality.title'),
                    description:
                        t('settings.jpegQuality.description'),
                    slider: {
                        min: 10,
                        max: 100,
                        step: 1,
                    },
                },
                {
                    key: 'enablePasteImageCompression',
                    value: settings.enablePasteImageCompression,
                    type: 'checkbox',
                    title: t('settings.enablePasteImageCompression.title'),
                    description:
                        t('settings.enablePasteImageCompression.description'),
                },
                {
                    key: 'showPasteImageCompressionNotification',
                    value: settings.showPasteImageCompressionNotification,
                    type: 'checkbox',
                    title: t('settings.showPasteImageCompressionNotification.title'),
                    description:
                        t('settings.showPasteImageCompressionNotification.description'),
                },
                {
                    key: 'compressAllAssets',
                    value: '',
                    type: 'button',
                    title: t('settings.compressAllAssets.title'),
                    description:
                        t('settings.compressAllAssets.description'),
                    button: {
                        label: t('settings.compressAllAssets.label'),
                        callback: async () => {
                            confirm(
                                t('settings.compressAllAssets.title'),
                                t('settings.compressAllAssets.confirmMessage'),
                                async () => {
                                    let loadingDialog: any = null;
                                    let loadingComponent: any = null;
                                    try {
                                        loadingDialog = new Dialog({
                                            title: t('settings.compressAllAssets.dialogTitle'),
                                            content: `<div id="loadingDialogContent"></div>`,
                                            width: '360px',
                                            height: '170px',
                                            disableClose: true,
                                        });
                                        loadingComponent = new LoadingDialog({
                                            target: loadingDialog.element.querySelector(
                                                '#loadingDialogContent'
                                            ),
                                            props: { message: t('settings.compressAllAssets.scanning') },
                                        });

                                        if (
                                            typeof plugin.compressAllAssetImages !== 'function'
                                        ) {
                                            throw new Error(t('settings.compressAllAssets.unsupported'));
                                        }

                                        const result = await plugin.compressAllAssetImages(
                                            ({ current, total, fileName }) => {
                                                loadingComponent?.$set({
                                                    message: t('settings.compressAllAssets.processing', {
                                                        current: String(current),
                                                        total: String(total),
                                                        fileName,
                                                    }),
                                                });
                                            }
                                        );

                                        if (result.total === 0) {
                                            await pushMsg(
                                                t('settings.compressAllAssets.empty')
                                            );
                                            return;
                                        }

                                        const savedBytes = Math.max(
                                            0,
                                            result.originalSize - result.savedSize
                                        );
                                        const savedText =
                                            result.compressed > 0
                                                ? t('settings.compressAllAssets.savedSpace', { size: formatBytes(savedBytes) })
                                                : '';
                                        const summary =
                                            t('settings.compressAllAssets.summary', {
                                                compressed: String(result.compressed),
                                                remembered: String(result.remembered),
                                                notSmaller: String(result.notSmaller),
                                                failed: String(result.failed),
                                                savedText,
                                            });

                                        if (result.failed > 0) {
                                            await pushErrMsg(summary, 10000);
                                        } else {
                                            await pushMsg(summary, 10000);
                                        }
                                    } catch (err) {
                                        console.error('Compress all assets failed:', err);
                                        await pushErrMsg(
                                            t('common.errorWithDetail', {
                                                message: t('settings.compressAllAssets.failed'),
                                                error: String(err?.message || err),
                                            }),
                                            10000
                                        );
                                    } finally {
                                        loadingComponent?.$destroy();
                                        loadingDialog?.destroy();
                                    }
                                },
                                () => {}
                            );
                        },
                    },
                },
            ],
        },
        {
            id: 'screenshot',
            name: t('settings.settingsGroup.screenshot'),
            items: [
                {
                    key: 'enableScreenshot',
                    value: settings.enableScreenshot,
                    type: 'checkbox',
                    title: t('settings.enableScreenshot.title'),
                    description: t('settings.enableScreenshot.description'),
                },
                {
                    key: 'screenshotLimit',
                    value: settings.screenshotLimit,
                    type: 'number',
                    title: t('settings.screenshotLimit.title'),
                    description: t('settings.screenshotLimit.description'),
                },
            ],
        },
        {
            id: 'storage',
            name: t('settings.settingsGroup.storage'),
            items: [
                {
                    key: 'storageMode',
                    value: settings.storageMode,
                    type: 'select',
                    title: t('settings.storageMode.title'),
                    description: t('settings.storageMode.description'),
                    options: {
                        embed: t('settings.storageMode.options.embed'),
                        backup: t('settings.storageMode.options.backup'),
                    },
                },
                {
                    key: 'openDataFolder',
                    value: '',
                    type: 'button',
                    title: t('settings.openDataFolder.title'),
                    description: '',
                    button: {
                        label: t('settings.openDataFolder.label'),
                        callback: async () => {
                            const path =
                                window.siyuan.config.system.dataDir +
                                '/storage/petal/siyuan-plugin-imgReEditor';
                            await useShell('openPath', path);
                        },
                    },
                },
                {
                    key: 'tidyBackup',
                    value: '',
                    type: 'button',
                    title: t('settings.tidyBackup.title'),
                    description:
                        t('settings.tidyBackup.description'),
                    button: {
                        label: t('settings.tidyBackup.label'),
                        callback: async () => {
                            confirm(
                                t('settings.tidyBackup.title'),
                                t('settings.tidyBackup.confirmMessage'),
                                async () => {
                                    let loadingDialog: any;
                                    loadingDialog = new Dialog({
                                        title: t('settings.tidyBackup.dialogTitle'),
                                        content: `<div id="loadingDialogContent"></div>`,
                                        width: '300px',
                                        height: '150px',
                                        disableClose: true,
                                    });
                                    new LoadingDialog({
                                        target: loadingDialog.element.querySelector(
                                            '#loadingDialogContent'
                                        ),
                                        props: { message: t('settings.tidyBackup.progress') },
                                    });
                                    try {
                                        const backupDir =
                                            'data/storage/petal/siyuan-plugin-imgReEditor/backup';
                                        const assetsDir = 'data/assets';

                                        const entries: any = await readDir(backupDir);
                                        if (
                                            !entries ||
                                            !Array.isArray(entries) ||
                                            entries.length === 0
                                        ) {
                                            await pushMsg(t('settings.backupEmpty'));
                                            return;
                                        }

                                        const assetsEntries: any = await readDir(assetsDir);
                                        const assetBasenames = new Set();
                                        if (assetsEntries && Array.isArray(assetsEntries)) {
                                            for (const a of assetsEntries) {
                                                try {
                                                    const fname =
                                                        a.name ||
                                                        (a.path ? a.path.split('/').pop() : '');
                                                    if (!fname) continue;
                                                    const parts = fname.split('.');
                                                    const base =
                                                        parts.slice(0, -1).join('.') || fname;
                                                    assetBasenames.add(base);
                                                } catch (err) {
                                                    console.warn('parse asset name failed', err);
                                                }
                                            }
                                        }

                                        let removedCount = 0;
                                        for (const e of entries) {
                                            try {
                                                const filePath =
                                                    e.path ||
                                                    (e.name ? `${backupDir}/${e.name}` : null);
                                                if (!filePath) continue;
                                                if (e.isDir || e.isdir || e.type === 'dir')
                                                    continue;
                                                const fname = e.name || filePath.split('/').pop();
                                                if (!fname) continue;
                                                const nameWithoutJson = fname.replace(
                                                    /\.json$/i,
                                                    ''
                                                );
                                                const baseName = nameWithoutJson.replace(
                                                    /\.[^.]+$/i,
                                                    ''
                                                );
                                                if (!assetBasenames.has(baseName)) {
                                                    await removeFile(filePath);
                                                    removedCount++;
                                                }
                                            } catch (err) {
                                                console.warn('remove file failed', err);
                                            }
                                        }

                                        await pushMsg(
                                            t('settings.tidyBackup.success', { count: String(removedCount) })
                                        );
                                        loadingDialog.destroy();
                                    } catch (err) {
                                        console.error(err);
                                        await pushErrMsg(
                                            t('common.errorWithDetail', {
                                                message: t('settings.tidyBackup.failed'),
                                                error: String(err?.message || err),
                                            })
                                        );
                                        loadingDialog.destroy();
                                    }
                                },
                                () => {}
                            );
                        },
                    },
                },
            ],
        },
        {
            id: 'reset',
            name: t('settings.settingsGroup.reset'),
            items: [
                {
                    key: 'reset',
                    value: '',
                    type: 'button',
                    title: t('settings.reset.title'),
                    description:
                        t('settings.reset.description'),
                    button: {
                        label: t('settings.reset.label'),
                        callback: async () => {
                            confirm(
                                t('settings.reset.title'),
                                t('settings.reset.confirmMessage'),
                                async () => {
                                    // 确认回调
                                    settings = { ...getDefaultSettings() };
                                    updateGroupItems();
                                    await saveSettings();
                                    await pushMsg(t('settings.reset.message'));
                                },
                                () => {}
                            );
                        },
                    },
                },
                {
                    key: 'clearBackup',
                    value: '',
                    type: 'button',
                    title: t('settings.clearBackup.title'),
                    description:
                        t('settings.clearBackup.description'),
                    button: {
                        label: t('settings.clearBackup.label'),
                        callback: async () => {
                            confirm(
                                t('settings.clearBackup.title'),
                                t('settings.clearBackup.confirmMessage'),
                                async () => {
                                    try {
                                        const dir =
                                            'data/storage/petal/siyuan-plugin-imgReEditor/backup';
                                        const entries: any = await readDir(dir);
                                        if (
                                            !entries ||
                                            !Array.isArray(entries) ||
                                            entries.length === 0
                                        ) {
                                            await pushMsg(t('settings.backupEmpty'));
                                            return;
                                        }
                                        for (const e of entries) {
                                            try {
                                                const filePath =
                                                    e.path || (e.name ? `${dir}/${e.name}` : null);
                                                if (!filePath) continue;
                                                // skip directories if indicated
                                                if (e.isDir || e.isdir || e.type === 'dir')
                                                    continue;
                                                await removeFile(filePath);
                                            } catch (err) {
                                                console.warn('remove file failed', err);
                                            }
                                        }
                                        await pushMsg(t('settings.clearBackup.success'));
                                    } catch (err) {
                                        console.error(err);
                                        await pushErrMsg(
                                            t('common.errorWithDetail', {
                                                message: t('settings.clearBackup.failed'),
                                                error: String(err?.message || err),
                                            })
                                        );
                                    }
                                },
                                () => {}
                            );
                        },
                    },
                },
            ],
        },
    ];

    let focusGroup = groups[0].id;

    function handleGroupKeydown(event: KeyboardEvent, index: number) {
        let nextIndex = index;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            nextIndex = (index + 1) % groups.length;
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            nextIndex = (index - 1 + groups.length) % groups.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = groups.length - 1;
        } else {
            return;
        }
        event.preventDefault();
        focusGroup = groups[nextIndex].id;
        const tabs = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        tabs?.[nextIndex]?.focus();
    }

    interface ChangeEvent {
        group: string;
        key: string;
        value: any;
    }

    const onChanged = async ({ detail }: CustomEvent<ChangeEvent>) => {
        const setting = settings[detail.key];
        if (setting !== undefined) {
            settings[detail.key] = detail.value;
            await saveSettings();
            if (
                detail.key === 'enableScreenshot' &&
                typeof plugin.applyScreenshotFeatureSettings === 'function'
            ) {
                await plugin.applyScreenshotFeatureSettings();
            }
        }
    };

    async function saveSettings() {
        plugin.settings = { ...settings };
        await plugin.saveSettings(plugin.settings);
    }

    onMount(async () => {
        await runload();
    });

    async function runload() {
        const loadedSettings = await plugin.loadSettings();
        settings = { ...loadedSettings };
        updateGroupItems();
    }

    function updateGroupItems() {
        groups = groups.map(group => ({
            ...group,
            items: group.items.map(item => ({
                ...item,
                value: settings[item.key] ?? item.value,
            })),
        }));
    }

    $: currentGroup = groups.find(group => group.id === focusGroup);
</script>

<div class="fn__flex-1 fn__flex config__panel">
    <div class="settings-navigation" role="tablist" aria-label={t('settings.settingsPanel')} aria-orientation="vertical">
        {#each groups as group, index (group.id)}
            <button
                type="button"
                role="tab"
                id={'imgreeditor-settings-tab-' + group.id}
                aria-controls="imgreeditor-settings-panel"
                aria-selected={group.id === focusGroup}
                tabindex={group.id === focusGroup ? 0 : -1}
                class:active={group.id === focusGroup}
                class="settings-tab"
                on:click={() => {
                    focusGroup = group.id;
                }}
                on:keydown={event => handleGroupKeydown(event, index)}
            >
                {group.name}
            </button>
        {/each}
    </div>
    <div class="config__tab-wrap" id="imgreeditor-settings-panel" role="tabpanel" aria-labelledby={'imgreeditor-settings-tab-' + focusGroup} tabindex="0">
        <h2>{currentGroup?.name || ''}</h2>
        <SettingPanel
            group={currentGroup?.name || ''}
            settingItems={currentGroup?.items || []}
            display={true}
            on:changed={onChanged}
        />
    </div>
</div>

<style lang="scss">
    .config__panel {
        height: 100%;
        display: flex;
        flex-direction: row;
        overflow: hidden;
        min-width: 0;
        color: var(--b3-theme-on-background);
        background: var(--b3-theme-background);
        container-type: inline-size;
    }
    .settings-navigation {
        flex: 0 0 148px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 8px;
        overflow: auto;
        border-right: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
    }
    .settings-tab {
        border: 0;
        border-radius: 6px;
        padding: 10px 12px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        line-height: 1.5;
        overflow-wrap: anywhere;
        cursor: pointer;
    }
    .settings-tab:hover {
        background: var(--b3-list-hover);
    }
    .settings-tab.active {
        color: var(--b3-theme-primary);
        background: var(--b3-theme-primary-lightest);
        font-weight: 600;
    }
    .settings-tab:focus-visible {
        outline: 2px solid var(--b3-theme-primary);
        outline-offset: -2px;
    }
    .config__tab-wrap {
        flex: 1;
        min-width: 0;
        height: 100%;
        box-sizing: border-box;
        overflow: auto;
        padding: 20px 24px;
    }
    .config__tab-wrap h2 {
        margin: 0 0 20px;
        font-size: 18px;
        line-height: 1.5;
    }
    .config__tab-wrap :global(.item-wrap) {
        align-items: flex-start;
        gap: 16px;
        padding: 0 0 20px;
        margin-bottom: 20px;
    }
    .config__tab-wrap :global(.item-wrap > .fn__flex-1) {
        min-width: 0;
    }
    .config__tab-wrap :global(.fn__space) {
        display: none;
    }
    .config__tab-wrap :global(.b3-label__text) {
        margin-top: 6px;
        line-height: 1.6;
        overflow-wrap: anywhere;
    }
    .config__tab-wrap :global(.fn__size200) {
        width: 200px;
        max-width: 100%;
    }
    .config__tab-wrap :global(.b3-button) {
        height: auto;
        min-height: 32px;
        white-space: normal;
        line-height: 1.5;
    }
    @container (max-width: 640px) {
        .settings-navigation {
            flex-basis: 112px;
            padding: 8px 4px;
        }
        .config__tab-wrap {
            padding: 16px;
        }
        .config__tab-wrap :global(.item-wrap) {
            flex-wrap: wrap;
            gap: 10px;
        }
        .config__tab-wrap :global(.item-wrap > .fn__flex-1) {
            flex-basis: 100%;
        }
    }
</style>
