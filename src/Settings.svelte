<script lang="ts">
    import { onMount } from 'svelte';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { t } from './utils/i18n';
    import { getDefaultSettings } from './defaultSettings';
    import { pushMsg, pushErrMsg, readDir, removeFile } from './api';
    import { confirm, Constants } from 'siyuan';
    export let plugin;
    export const useShell = async (cmd: 'showItemInFolder' | 'openPath', filePath: string) => {
            try {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send(Constants.SIYUAN_CMD, {
                    cmd,
                    filePath: filePath,
                });
            } catch (error) {
                await pushErrMsg('当前客户端不支持打开插件数据文件夹');
            }
        };
    // 使用动态默认设置
    let settings = { ...getDefaultSettings() };

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
        //  Type："checkbox" | "select" | "textinput" | "textarea" | "number" | "slider" | "button" | "hint" | "custom";
    }

    let groups: ISettingGroup[] = [
        {
            name: '保存设置',
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
                    key: 'screenshotLimit',
                    value: settings.screenshotLimit,
                    type: 'number',
                    title: t('settings.screenshotLimit.title'),
                    description: t('settings.screenshotLimit.description'),
                },
                {
                    key: 'openDataFolder',
                    value: '',
                    type: 'button',
                    title: '打开插件数据文件夹',
                    description: '',
                    button: {
                        label: '打开文件夹',
                        callback: async () => {
                            const path =
                                window.siyuan.config.system.dataDir +
                                '/storage/petal/siyuan-plugin-imgReEditor';
                            await useShell('openPath', path);
                        },
                    },
                },
                {
                    key: 'clearBackup',
                    value: '',
                    type: 'button',
                    title: '清空 backup 文件夹',
                    description:
                        '清空 data/storage/petal/siyuan-plugin-imgReEditor/backup 下的所有文件（不可恢复，删除后无法再二次编辑backup模式下编辑保存的图片）',
                    button: {
                        label: '清空 backup',
                        callback: async () => {
                            confirm(
                                '清空 backup 文件夹',
                                '确认要清空 backup 文件夹吗？此操作不可恢复。',
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
                                            await pushMsg('backup 文件夹已为空');
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
                                        await pushMsg('已清空 backup 文件夹');
                                    } catch (err) {
                                        console.error(err);
                                        await pushErrMsg(
                                            '清空 backup 失败: ' +
                                                (err && err.message ? err.message : err)
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
        {
            name: t('settings.settingsGroup.reset') || 'Reset Settings',
            items: [
                {
                    key: 'reset',
                    value: '',
                    type: 'button',
                    title: t('settings.reset.title') || 'Reset Settings',
                    description:
                        t('settings.reset.description') || 'Reset all settings to default values',
                    button: {
                        label: t('settings.reset.label') || 'Reset',
                        callback: async () => {
                            confirm(
                                t('settings.reset.title') || 'Reset Settings',
                                t('settings.reset.confirmMessage') ||
                                    'Are you sure you want to reset all settings to default values? This action cannot be undone.',
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
            ],
        },
    ];

    let focusGroup = groups[0].name;

    interface ChangeEvent {
        group: string;
        key: string;
        value: any;
    }

    const onChanged = ({ detail }: CustomEvent<ChangeEvent>) => {
        const setting = settings[detail.key];
        if (setting !== undefined) {
            settings[detail.key] = detail.value;
            saveSettings();
        }
    };

    async function saveSettings() {
        await plugin.saveSettings(settings);
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

    $: currentGroup = groups.find(group => group.name === focusGroup);
</script>

<div class="fn__flex-1 fn__flex config__panel">
    <ul class="b3-tab-bar b3-list b3-list--background">
        {#each groups as group}
            <li
                data-name="editor"
                class:b3-list-item--focus={group.name === focusGroup}
                class="b3-list-item"
                on:click={() => {
                    focusGroup = group.name;
                }}
                on:keydown={() => {}}
            >
                <span class="b3-list-item__text">{group.name}</span>
            </li>
        {/each}
    </ul>
    <div class="config__tab-wrap">
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
    }
    .config__panel > .b3-tab-bar {
        width: 170px;
    }

    .config__tab-wrap {
        flex: 1;
        height: 100%;
        overflow: auto;
        padding: 2px;
    }
</style>
