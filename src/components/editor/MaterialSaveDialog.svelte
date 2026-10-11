<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import { t } from '../../utils/i18n';
    import { materialLibrary, getMaterialFolderPath } from './materialLibrary';
    import type { MaterialIndex, MaterialSnapshot } from './materialLibrary';

    export let snapshot: MaterialSnapshot;
    export let suggestedName = '';
    export let onClose: () => void;
    let index: MaterialIndex = { version: 1, folders: [], items: [] };
    let materialName = suggestedName || t('materials.defaultName');
    let folder = '';
    let nameInput: HTMLInputElement;
    let loaded = false;
    let busy = false;
    let error = '';
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let showFolderForm = false;
    let folderName = '';

    $: folders = index.folders.map(item => ({ ...item, path: getMaterialFolderPath(index, item.id) }))
        .sort((a, b) => a.path.localeCompare(b.path));
    $: if (loaded && folder && !index.folders.some(item => item.id === folder)) folder = '';

    async function run(action: () => Promise<void>) {
        if (busy || disposed) return;
        busy = true;
        error = '';
        try { await action(); }
        catch (cause) {
            console.error('Material save failed', cause);
            if (!disposed) error = t('materials.operationFailed', {
                error: cause instanceof Error ? cause.message : String(cause),
            });
        } finally { if (!disposed) busy = false; }
    }

    function load() {
        return run(async () => {
            await materialLibrary.load();
            if (disposed) return;
            folder = materialLibrary.getLastSaveFolderId() || '';
            loaded = true;
            await tick();
            nameInput?.focus();
            nameInput?.select();
        });
    }
    onMount(() => {
        unsubscribe = materialLibrary.subscribe(value => index = value);
        void load();
    });
    onDestroy(() => { disposed = true; unsubscribe?.(); });

    function save() {
        if (!loaded || !materialName.trim()) return;
        return run(async () => {
            await materialLibrary.addItem(materialName, folder || null, snapshot);
            if (!disposed) onClose();
        });
    }
    function createFolder() {
        if (!loaded || !folderName.trim()) return;
        return run(async () => {
            const created = await materialLibrary.addFolder(folderName, folder || null);
            if (disposed) return;
            folder = created.id;
            folderName = '';
            showFolderForm = false;
        });
    }
</script>

<form class="material-save" on:submit|preventDefault={save}
    on:keydown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    }} on:keyup|stopPropagation>
    {#if snapshot.thumbnail}
        <div class="preview"><img src={snapshot.thumbnail} alt={materialName} /></div>
    {/if}
    {#if error}<div class="error" role="alert">{error}</div>{/if}
    {#if !loaded}
        <div class="hint">{t('materials.loading')}</div>
        {#if error}<button type="button" disabled={busy} on:click={load}>{t('materials.retry')}</button>{/if}
    {/if}
    <label for="material-save-name">{t('materials.name')}</label>
    <input id="material-save-name" bind:this={nameInput} bind:value={materialName}
        maxlength="100" required disabled={!loaded || busy} />
    <label for="material-save-folder">{t('materials.folder')}</label>
    <div class="folder-picker">
        <select id="material-save-folder" bind:value={folder} disabled={!loaded || busy}>
            <option value="">{t('materials.unfiled')}</option>
            {#each folders as item (item.id)}<option value={item.id}>{item.path}</option>{/each}
        </select>
        <button type="button" disabled={!loaded || busy} on:click={() => showFolderForm = !showFolderForm}>{t('materials.newFolder')}</button>
    </div>
    {#if showFolderForm}
        <div class="new-folder">
            <input bind:value={folderName} maxlength="100" aria-label={t('materials.folderName')}
                placeholder={t('materials.folderName')} disabled={busy}
                on:keydown={event => { if (event.key === 'Enter') { event.preventDefault(); void createFolder(); } }} />
            <div class="hint">{t('materials.parentFolder')}: {getMaterialFolderPath(index, folder || null) || t('materials.rootFolder')}</div>
            <button type="button" disabled={busy || !folderName.trim()} on:click={createFolder}>{t('materials.save')}</button>
        </div>
    {/if}
    <div class="actions">
        <button type="button" disabled={busy} on:click={onClose}>{t('materials.cancel')}</button>
        <button type="submit" class="primary" disabled={!loaded || busy || !materialName.trim()}>{t('materials.save')}</button>
    </div>
</form>

<style>
    .material-save { width: 100%; min-width: 0; box-sizing: border-box; padding: 16px; color: var(--b3-theme-on-background); }
    label { display: block; font-size: 13px; margin-bottom: 6px; }
    input, select { width: 100%; box-sizing: border-box; padding: 6px 8px; margin-bottom: 12px;
        border: 1px solid var(--b3-border-color); border-radius: 4px;
        color: var(--b3-theme-on-surface); background: var(--b3-theme-surface); }
    button { padding: 6px 10px; border: 1px solid var(--b3-border-color); border-radius: 4px;
        color: var(--b3-theme-on-surface); background: var(--b3-theme-surface); cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    .primary { color: var(--b3-theme-on-primary); background: var(--b3-theme-primary); border-color: var(--b3-theme-primary); }
    .preview { display: flex; justify-content: center; margin-bottom: 16px; }
    .preview img { max-width: 100%; max-height: 140px; object-fit: contain; }
    .folder-picker { display: flex; align-items: flex-start; gap: 8px; }
    .folder-picker select { flex: 1; min-width: 0; }
    .folder-picker button { flex-shrink: 0; }
    .new-folder { padding: 10px; margin-bottom: 12px; border: 1px solid var(--b3-border-color); border-radius: 4px; }
    .new-folder input { margin-bottom: 6px; }
    .hint { font-size: 12px; margin-bottom: 8px; color: var(--b3-theme-on-surface-light); }
    .error { color: var(--b3-theme-error); margin-bottom: 12px; overflow-wrap: anywhere; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
