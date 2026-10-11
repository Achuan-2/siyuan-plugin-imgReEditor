<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { t } from '../../utils/i18n';
    import { materialLibrary, getMaterialFolderPath, searchMaterials } from './materialLibrary';
    import type { MaterialIndex, MaterialItem, MaterialSnapshot } from './materialLibrary';
    import { importMaterialImages } from './materialImageImport';

    export let onInsert: (snapshot: MaterialSnapshot) => Promise<void>;
    let index: MaterialIndex = { version: 1, folders: [], items: [] };
    let unsubscribe: (() => void) | undefined;
    let loaded = false;
    let busy = false;
    let disposed = false;
    let uploadInput: HTMLInputElement;
    let uploadProgress: { completed: number; total: number } | null = null;
    let uploadMessage = '';
    let error = '';
    let search = '';
    let folder = '*';
    let showFolderForm = false;
    let folderEditingId: string | null = null;
    let folderName = '';
    let folderParent = '';
    let editingItem: MaterialItem | null = null;
    let editName = '';
    let editFolder = '';

    $: folders = index.folders.map(item => ({ ...item, path: getMaterialFolderPath(index, item.id) }))
        .sort((a, b) => a.path.localeCompare(b.path));
    $: items = searchMaterials(index, search, folder);
    $: currentFolder = index.folders.find(item => item.id === folder);
    $: if (loaded && folder !== '*' && folder !== '' && !index.folders.some(item => item.id === folder)) folder = '*';

    async function run(action: () => Promise<void>) {
        if (busy) return;
        busy = true;
        error = '';
        try { await action(); }
        catch (cause) {
            console.error('Material library operation failed', cause);
            if (!disposed) error = t('materials.operationFailed', { error: cause instanceof Error ? cause.message : String(cause) });
        } finally { if (!disposed) busy = false; }
    }
    function load() { return run(async () => { await materialLibrary.load(); loaded = true; }); }
    onMount(() => {
        unsubscribe = materialLibrary.subscribe(value => index = value);
        void load();
    });
    onDestroy(() => { disposed = true; unsubscribe?.(); });

    function uploadImages(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const files = Array.from(input.files || []);
        input.value = ''; // Allow selecting the same file again after a failed import.
        if (!loaded || busy || !files.length) return;
        const destination = folder === '*' ? null : folder || null;
        uploadMessage = '';
        return run(async () => {
            try {
                const result = await importMaterialImages(files, destination, materialLibrary, (completed, total) => {
                    if (!disposed) uploadProgress = { completed, total };
                });
                if (disposed) return;
                uploadMessage = t('materials.uploadComplete', { count: String(result.imported) });
                if (result.imported) search = '';
                if (result.failures.length) error = t('materials.uploadFailed', {
                    count: String(result.failures.length),
                    files: result.failures.map(item => `${item.name}: ${item.error}`).join('\n'),
                });
            } finally { if (!disposed) uploadProgress = null; }
        });
    }

    function openFolderForm(rename = false) {
        folderEditingId = rename && currentFolder ? currentFolder.id : null;
        folderName = rename && currentFolder ? currentFolder.name : '';
        folderParent = folder === '*' ? '' : folder;
        showFolderForm = true;
    }
    function saveFolderForm() {
        return run(async () => {
            if (folderEditingId) await materialLibrary.renameFolder(folderEditingId, folderName);
            else {
                folder = (await materialLibrary.addFolder(folderName, folderParent || null)).id;
            }
            showFolderForm = false;
        });
    }
    function editItem(item: MaterialItem) {
        editingItem = item;
        editName = item.name;
        editFolder = item.folderId || '';
    }
    function saveItemEdit() {
        if (!editingItem) return;
        const id = editingItem.id;
        return run(async () => {
            await materialLibrary.updateItem(id, editName, editFolder || null);
            editingItem = null;
        });
    }
    function insert(item: MaterialItem) {
        return run(async () => { await onInsert(await materialLibrary.readItem(item.id)); });
    }
</script>

<div class="materials">
    {#if error}
        <div class="error" role="alert">{error}</div>
        {#if !loaded}<button type="button" disabled={busy} on:click={load}>{t('materials.retry')}</button>{/if}
    {/if}
    {#if !loaded && !error}<div class="hint">{t('materials.loading')}</div>{/if}
    {#if loaded}
        <input type="search" bind:value={search} aria-label={t('materials.search')} placeholder={t('materials.search')} />
        <select bind:value={folder} aria-label={t('materials.folder')} disabled={busy}>
            <option value="*">{t('materials.all')}</option>
            <option value="">{t('materials.unfiled')}</option>
            {#each folders as item (item.id)}<option value={item.id}>{item.path}</option>{/each}
        </select>
        <div class="actions">
            <button type="button" disabled={busy} on:click={() => uploadInput.click()}>{t('materials.uploadImages')}</button>
            <button type="button" disabled={busy} on:click={() => openFolderForm()}>{t('materials.newFolder')}</button>
            {#if currentFolder}
                <button type="button" disabled={busy} on:click={() => openFolderForm(true)}>{t('materials.renameFolder')}</button>
                <button type="button" disabled={busy} title={t('materials.deleteFolderHint')}
                    on:click={() => run(async () => { await materialLibrary.removeFolder(folder); folder = '*'; })}>{t('materials.deleteFolder')}</button>
            {/if}
        </div>
        <input class="upload-input" bind:this={uploadInput} type="file" accept="image/*" multiple
            aria-label={t('materials.uploadImages')} on:change={uploadImages} disabled={busy} />
        {#if uploadProgress}
            <div class="upload-status" role="status">
                <div class="hint">{t('materials.uploadProgress', { completed: String(uploadProgress.completed), total: String(uploadProgress.total) })}</div>
                <progress value={uploadProgress.completed} max={uploadProgress.total} aria-label={t('materials.uploadImages')}></progress>
            </div>
        {:else if uploadMessage}<div class="hint" role="status">{uploadMessage}</div>{/if}
        {#if showFolderForm}
            <form class="material-form" on:submit|preventDefault={saveFolderForm}>
                <input bind:value={folderName} maxlength="100" required aria-label={t('materials.folderName')} placeholder={t('materials.folderName')} disabled={busy} />
                {#if !folderEditingId}
                    <select bind:value={folderParent} aria-label={t('materials.parentFolder')} disabled={busy}>
                        <option value="">{t('materials.rootFolder')}</option>
                        {#each folders as item (item.id)}<option value={item.id}>{item.path}</option>{/each}
                    </select>
                {/if}
                <div class="actions">
                    <button type="submit" disabled={busy || !folderName.trim()}>{t('materials.save')}</button>
                    <button type="button" disabled={busy} on:click={() => showFolderForm = false}>{t('materials.cancel')}</button>
                </div>
            </form>
        {/if}
        {#if editingItem}
            <form class="material-form" on:submit|preventDefault={saveItemEdit}>
                <input bind:value={editName} maxlength="100" required aria-label={t('materials.name')} disabled={busy} />
                <select bind:value={editFolder} aria-label={t('materials.folder')} disabled={busy}>
                    <option value="">{t('materials.unfiled')}</option>
                    {#each folders as item (item.id)}<option value={item.id}>{item.path}</option>{/each}
                </select>
                <div class="actions">
                    <button type="submit" disabled={busy || !editName.trim()}>{t('materials.save')}</button>
                    <button type="button" disabled={busy} on:click={() => editingItem = null}>{t('materials.cancel')}</button>
                </div>
            </form>
        {/if}
        <div class="hint">{t('materials.count', { count: String(items.length) })}</div>
        {#if !items.length}<div class="hint">{search ? t('materials.noResults') : t('materials.empty')}</div>{/if}
        <div class="material-grid">
            {#each items as item (item.id)}
                <div class="material-card">
                    <button class="material-preview" type="button" disabled={busy} title={t('materials.insert')} on:click={() => insert(item)}>
                        {#if item.thumbnail}<img src={item.thumbnail} alt={item.name} />{:else}<span>{item.name}</span>{/if}
                    </button>
                    <div class="material-name" title={item.name}>{item.name}</div>
                    <div class="material-folder" title={getMaterialFolderPath(index, item.folderId)}>{getMaterialFolderPath(index, item.folderId) || t('materials.unfiled')}</div>
                    <div class="actions">
                        <button type="button" disabled={busy} on:click={() => editItem(item)}>{t('materials.manage')}</button>
                        <button type="button" disabled={busy} on:click={() => run(async () => { await materialLibrary.removeItem(item.id); })}>{t('materials.delete')}</button>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    input, select { display: block; width: 100%; box-sizing: border-box; margin-bottom: 8px; padding: 5px 6px;
        border: 1px solid var(--b3-border-color, #ddd); border-radius: 4px;
        color: var(--b3-theme-on-surface, #333); background: var(--b3-theme-surface, #fff); }
    button { padding: 4px 6px; border: 1px solid var(--b3-border-color, #ddd); border-radius: 4px;
        color: var(--b3-theme-on-surface, #333); background: var(--b3-theme-surface, #fff); font-size: 12px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    .upload-input { display: none; }
    .upload-status { margin-bottom: 8px; }
    .upload-status .hint { margin-bottom: 4px; }
    progress { display: block; width: 100%; }
    .actions { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
    .material-form { padding: 8px; margin-bottom: 10px; border: 1px solid var(--b3-border-color, #ddd); border-radius: 5px; }
    .hint, .material-folder { color: var(--b3-theme-on-surface-light, #888); font-size: 12px; margin-bottom: 8px; }
    .error { color: var(--b3-theme-error, #d23f31); font-size: 12px; overflow-wrap: anywhere; white-space: pre-line; margin-bottom: 8px; }
    .material-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .material-card { min-width: 0; padding: 6px; border: 1px solid var(--b3-border-color, #ddd); border-radius: 5px; }
    .material-preview { width: 100%; height: 84px; display: flex; justify-content: center; align-items: center; background: transparent; border: none; padding: 0; }
    .material-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .material-name { font-size: 12px; margin: 5px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .material-folder { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
    .material-card .actions { margin-bottom: 0; }
</style>
