<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import ImageEditor from 'tui-image-editor';
    import 'tui-image-editor/dist/tui-image-editor.css';
    import 'tui-color-picker/dist/tui-color-picker.css';
    import { getFileBlob, putFile } from '../api';
    import { readPNGTextChunk, insertPNGTextChunk, locatePNGtEXt } from '../utils';
    import { pushMsg, pushErrMsg } from '../api';

    export let imagePath: string;
    export let blockId: string | null = null;
    export let onClose: (saved: boolean) => void;

    let editorEl: HTMLDivElement;
    let imageEditor: any;
    let imageBlob: Blob | null = null;
    let editorReady = false;
    let saving = false;
    let originalFileName = '';
    let originalExt = '';
    let needConvertToPNG = false;
    let lastPublicURL = '';
    let lastBlobURL = '';
    const STORAGE_BACKUP_DIR = 'data/storage/petal/siyuan-plugin-image-editor';

    async function blobToDataURL(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function ensureDirExists(path: string) {
        try {
            // create a directory by calling putFile with isDir=true
            await putFile(path, true, new Blob([]));
        } catch (e) {
            // ignore errors
        }
    }

    // verifyImage helper removed; using direct TUI load with fallback validation

    async function loadImage() {
        if (!imagePath) return;
        // Prepare path for getFileBlob or direct fetch: 'assets/xxx' -> backend 'data/assets/xxx'
        let blob: Blob | null = null;
        if (
            typeof imagePath === 'string' &&
            (imagePath.startsWith('http://') ||
                imagePath.startsWith('https://') ||
                imagePath.startsWith('//'))
        ) {
            // remote full URL, use fetch directly
            const resp = await fetch(imagePath, { cache: 'reload' });
            if (resp.ok) blob = await resp.blob();
        } else {
            let getFilePath = imagePath;
            if (typeof imagePath === 'string' && imagePath.startsWith('assets/')) {
                getFilePath = `data/${imagePath}`;
            }
            blob = await getFileBlob(getFilePath);
        }
        if (!blob || blob.size === 0) {
            pushErrMsg('无法获取图片文件或文件为空');
            return;
        }

        imageBlob = blob;
        // extract filename/ext
        originalFileName = imagePath.split('/').pop() || 'image.png';
        const lastDot = originalFileName.lastIndexOf('.');
        originalExt = lastDot >= 0 ? originalFileName.slice(lastDot + 1).toLowerCase() : 'png';
        needConvertToPNG = originalExt === 'jpg' || originalExt === 'jpeg';

        const buffer = new Uint8Array(await blob.arrayBuffer());
        let editorData = null;
        // use locatePNGtEXt to verify PNG and read with readPNGTextChunk
        if (locatePNGtEXt(buffer)) {
            const meta = readPNGTextChunk(buffer, 'siyuan-image-editor');
            if (meta) {
                try {
                    editorData = JSON.parse(meta);
                } catch (e) {
                    console.warn('invalid metadata');
                }
            }
        }

        // If we have a backup original, use it as base image for editing (so annotations are applied on top of original)
        const backupPathFromMeta = editorData?.originalBackupPath;
        let baseAssetPath = imagePath;
        let backupBlobUrl: string | null = null;
        if (backupPathFromMeta) {
            // If backup is stored in plugin storage, load as data URL
            if (backupPathFromMeta.startsWith('data/storage/petal/')) {
                try {
                    const b = await getFileBlob(backupPathFromMeta);
                    if (b) {
                        backupBlobUrl = await blobToDataURL(b);
                        baseAssetPath = backupBlobUrl;
                    }
                } catch (e) {
                    console.warn('Failed to load backup blob from storage', e);
                }
            } else {
                baseAssetPath = backupPathFromMeta;
            }
        }
        // Build a public URL for the image so TUI can load it directly. If baseAssetPath is already a full URL, use it.
        let publicURL = baseAssetPath;
        if (
            !publicURL.startsWith('http') &&
            !publicURL.startsWith('data:') &&
            !publicURL.startsWith('blob:')
        ) {
            // ensure no leading slash
            // If dataset contains data/assets/ -> public path is assets/xxx
            if (publicURL.startsWith('data/')) publicURL = `${publicURL.replace(/^data\//, '')}`;
            else {
                const pth = publicURL.replace(/^\//, '');
                publicURL = pth;
            }
        }
        // Destroy prior instance
        try {
            imageEditor?.destroy?.();
        } catch (e) {}
        // Init image editor
        imageEditor = new ImageEditor(editorEl, {
            includeUI: {
                loadImage: { path: publicURL, name: originalFileName },
                theme: {},
            },
            cssMaxWidth: 700,
            cssMaxHeight: 500,
        });
        // After init we explicitly load image so we can then restore state
        editorReady = false;
        lastPublicURL = publicURL;
        if (backupBlobUrl) lastBlobURL = backupBlobUrl;
        // removed verifyAndLoad (not used)

        // Prefer to load backup blob if available (backupBlobUrl)
        imageEditor
            .loadImageFromURL(backupBlobUrl ?? publicURL, originalFileName)
            .then(() => {
                try {
                    const canvas =
                        imageEditor.getCanvas?.() ?? imageEditor._graphics?.getCanvas?.() ?? null;
                    if (editorData && editorData.canvasJSON) {
                        canvas.loadFromJSON(editorData.canvasJSON);
                        canvas.discardActiveObject();
                        canvas.renderAll();
                    }
                    editorReady = true;
                } catch (e) {
                    console.warn('failed to restore editor state', e);
                    editorReady = true;
                }
            })
            .catch(async (err: any) => {
                console.warn('Failed to load image from public URL, fallback to data URL', err);
                // Wait a bit to make sure image editor's command queue is free
                await new Promise(resolve => setTimeout(resolve, 80));
                const dataURL = await blobToDataURL(blob);
                console.log('Created data URL for blob size:', blob.size, 'blob type:', blob.type);
                lastBlobURL = dataURL;
                try {
                    await imageEditor.loadImageFromURL(dataURL, originalFileName);
                    const canvas =
                        imageEditor.getCanvas?.() ?? imageEditor._graphics?.getCanvas?.() ?? null;
                    if (editorData && editorData.canvasJSON) {
                        canvas.loadFromJSON(editorData.canvasJSON);
                        canvas.discardActiveObject();
                        canvas.renderAll();
                    }
                    editorReady = true;
                } catch (e) {
                    console.error('Fallback load failed', e);
                    editorReady = true;
                }
            });
    }

    function getCanvasSafe() {
        try {
            if (!imageEditor) return null;
            if (typeof imageEditor.getCanvas === 'function') return imageEditor.getCanvas();
            if (imageEditor._graphics && typeof imageEditor._graphics.getCanvas === 'function')
                return imageEditor._graphics.getCanvas();
            if (imageEditor.getInstance && typeof imageEditor.getInstance === 'function') {
                const inst = imageEditor.getInstance();
                if (inst && typeof inst.getCanvas === 'function') return inst.getCanvas();
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async function handleSave() {
        if (!imageEditor || !imageBlob) return;
        if (!editorReady) {
            pushErrMsg('编辑器尚未准备好，请稍后重试');
            return;
        }
        if (saving) return;
        saving = true;
        try {
            const canvas = getCanvasSafe();
            const canvasJSON = canvas?.toJSON?.() ?? null;
            // export image as PNG dataurl
            const dataURL =
                typeof imageEditor.toDataURL === 'function' ? await imageEditor.toDataURL() : null;
            if (!dataURL) {
                pushErrMsg('无法导出图片');
                return;
            }
            // Convert dataURL to blob
            const blob = dataURLToBlob(dataURL);

            // Determine backup names and write metadata into PNG
            const baseName = originalFileName.replace(/\.[^.]+$/, '');
            const origBackupName = `${baseName}-original.${originalExt}`;
            const origBackupPath = `${STORAGE_BACKUP_DIR}/${origBackupName}`;

            const buffer = new Uint8Array(await blob.arrayBuffer());
            const metaValue = JSON.stringify({
                version: 1,
                originalFileName,
                originalBlockId: blockId,
                originalBackupPath: origBackupPath,
                canvasJSON,
            });
            const newBuffer = insertPNGTextChunk(buffer, 'siyuan-image-editor', metaValue);
            // Convert Uint8Array to ArrayBuffer for Blob constructor
            const newBlob = new Blob([newBuffer as any], { type: 'image/png' });

            // Save to Siyuan using same path - replace
            // If original ext was jpg/jpeg, we still use PNG and update name suffix
            const saveName = needConvertToPNG
                ? originalFileName.replace(/\.[^.]+$/, '.png')
                : originalFileName;
            // prepare original backup names already determined above

            // Save original backup if not exists
            // ensure storage directory exists first
            await ensureDirExists(STORAGE_BACKUP_DIR);
            // ensure data/assets exists (for saved asset) as well
            try {
                let existing = null;
                try {
                    existing = await getFileBlob(origBackupPath);
                } catch (e) {
                    // file doesn't exist
                }
                if (!existing) {
                    console.log('Saving backup to', origBackupPath);
                    // create original file from fetched imageBlob
                    const origFile = new File([imageBlob], origBackupName, {
                        type: imageBlob.type,
                    });
                    await putFile(origBackupPath, false, origFile);
                    console.log('Backup saved');
                    // verify backup exists
                    const checkBackup = await getFileBlob(origBackupPath);
                    console.log('Check backup size:', checkBackup?.size);
                    if (!checkBackup || checkBackup.size === 0) {
                        console.warn('backup file not found after put');
                        pushErrMsg('创建备份文件失败');
                    }
                }
            } catch (e) {
                console.warn('Error creating backup', e);
            }
            // create File and upload
            const file = new File([newBlob], saveName, { type: 'image/png' });
            await putFile(`data/assets/${saveName}`, false, file);
            // verify saved asset exists in data/assets
            const checkSaved = await getFileBlob(`data/assets/${saveName}`);
            if (!checkSaved || checkSaved.size === 0) {
                console.warn('saved asset not found after put');
                pushErrMsg('保存到 assets 失败');
            }
            pushMsg('图片已保存');
            // After save, update DOM images referencing the old dataset
            try {
                // Update img elements where dataset.src equal to current imagePath
                const newDataset = `assets/${saveName}`;
                document
                    .querySelectorAll(`img[data-src="${imagePath}"]`)
                    .forEach((imageElement: any) => {
                        imageElement.setAttribute('data-src', newDataset);
                        imageElement.src = newDataset;
                    });
                // update local imagePath so subsequent saves reuse updated path
                imagePath = `assets/${saveName}`;
            } catch (e) {
                console.warn('DOM update failed', e);
            }
            onClose?.(true);
        } catch (e) {
            console.error(e);
            pushErrMsg('保存失败');
        } finally {
            saving = false;
        }
    }

    function dataURLToBlob(dataURL: string): Blob {
        const arr = dataURL.split(',');
        const mime = arr[0].match(/:(.*?);/)![1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }

    onMount(() => {
        loadImage();
    });

    onDestroy(() => {
        try {
            imageEditor?.destroy();
        } catch (e) {
            // ignore
        }
        try {
            if (lastBlobURL && lastBlobURL.startsWith('blob:')) URL.revokeObjectURL(lastBlobURL);
        } catch (e) {}
    });
</script>

<div class="editor-container">
    <div bind:this={editorEl} style="width:100%;height:calc(100% - 44px);"></div>
    <div class="editor-actions">
        <button class="btn" on:click={() => onClose?.(false)}>取消</button>
        <button class="btn btn-primary" on:click={handleSave} disabled={!editorReady || saving}>
            {saving ? '保存中...' : '保存'}
        </button>
        <button
            class="btn"
            on:click={() => {
                console.log('publicURL:', lastPublicURL);
                console.log('blobURL:', lastBlobURL);
                pushMsg(`publicURL: ${lastPublicURL}\nblobURL: ${lastBlobURL}`);
            }}
        >
            调试 URL
        </button>
    </div>
</div>

<style>
    .editor-container {
        width: 100%;
        height: 100%;
    }
    .editor-actions {
        display: flex;
        gap: 8px;
        padding: 8px 10px;
        justify-content: flex-end;
    }
</style>
