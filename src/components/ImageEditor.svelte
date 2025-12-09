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
    let lastBlobURL = '';
    let hasExistingMetadata = false; // Track if image already has editor metadata
    const STORAGE_BACKUP_DIR = 'data/storage/petal/siyuan-plugin-image-editor/backup';

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
                    hasExistingMetadata = true; // Image has been edited before
                    console.log('Found existing metadata, this image has been edited before');
                } catch (e) {
                    console.warn('invalid metadata');
                }
            }
        }
        
        if (!hasExistingMetadata) {
            console.log('No metadata found, this is a new image to edit');
        }

        // If we have a backup original, use it as base image for editing (so annotations are applied on top of original)
        const backupPathFromMeta = editorData?.originalBackupPath;
        let backupBlobUrl: string | null = null;
        if (backupPathFromMeta) {
            // If backup is stored in plugin storage, load as data URL
            if (backupPathFromMeta.startsWith('data/storage/petal/')) {
                try {
                    const b = await getFileBlob(backupPathFromMeta);
                    if (b) {
                        backupBlobUrl = await blobToDataURL(b);
                    }
                } catch (e) {
                    console.warn('Failed to load backup blob from storage', e);
                }
            }
        }
        // Destroy prior instance
        try {
            imageEditor?.destroy?.();
        } catch (e) {}
        
        // Convert blob to data URL for loading
        const dataURL = backupBlobUrl ?? await blobToDataURL(blob);
        lastBlobURL = dataURL;
        
        // Prepare options object first (before initializing editor)
        // Don't use loadImage in options, we'll load it manually after init
        const editorOptions = {
            includeUI: {
                theme: {},
            },
            cssMaxWidth: 700,
            cssMaxHeight: 500,
        };
        
        // Init image editor with pre-configured options
        imageEditor = new ImageEditor(editorEl, editorOptions);
        
        // After init we explicitly load image so we can then restore state
        editorReady = false;

        // Wait a bit for editor to fully initialize before loading image
        await new Promise(resolve => setTimeout(resolve, 100));

        // Load image using data URL
        imageEditor
            .loadImageFromURL(dataURL, originalFileName)
            .then(() => {
                try {
                    const canvas =
                        imageEditor.getCanvas?.() ?? imageEditor._graphics?.getCanvas?.() ?? null;
                    if (editorData && editorData.canvasJSON) {
                        canvas.loadFromJSON(editorData.canvasJSON);
                        canvas.discardActiveObject();
                        canvas.renderAll();
                    }
                    // Re-activate UI menu to prevent modeChange errors
                    // This is a known fix for TUI Image Editor UI state issues
                    if (imageEditor.ui && typeof imageEditor.ui.activeMenuEvent === 'function') {
                        imageEditor.ui.activeMenuEvent();
                    }
                    editorReady = true;
                } catch (e) {
                    console.warn('failed to restore editor state', e);
                    editorReady = true;
                }
            })
            .catch((err: any) => {
                console.error('Failed to load image from data URL', err);
                editorReady = true;
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
            // Use original filename without -original suffix
            const origBackupName = originalFileName;
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

            // Save original backup if this is the first time editing (no metadata)
            // Only save backup if the image doesn't have existing metadata
            if (!hasExistingMetadata) {
                console.log('First time editing this image, saving original backup');
                console.log('Ensuring backup directory exists:', STORAGE_BACKUP_DIR);
                await ensureDirExists(STORAGE_BACKUP_DIR);
                
                try {
                    console.log('Saving original image backup to:', origBackupPath);
                    console.log('Original image blob size:', imageBlob.size, 'type:', imageBlob.type);
                    
                    // Create original file from the initial imageBlob (before any edits)
                    const origFile = new File([imageBlob], origBackupName, {
                        type: imageBlob.type || 'image/png',
                    });
                    
                    console.log('Created backup file:', origFile.name, 'size:', origFile.size);
                    
                    // Save the backup
                    const putResult = await putFile(origBackupPath, false, origFile);
                    console.log('putFile result:', putResult);
                    
                    // Wait a bit for file system to sync
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    console.log('✓ Original image backup saved successfully');
                    pushMsg(`原始图片已备份`);
                } catch (e) {
                    console.error('Error creating backup:', e);
                    pushErrMsg(`备份失败: ${e.message || e}`);
                }
            } else {
                console.log('Image already has metadata, skipping backup (backup should already exist)');
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
            
            // Close the editor after successful save
            // If user wants to continue editing, they can reopen the editor
            // which will properly load the saved image with all metadata
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

    function setupToolbarToggle() {
        if (!imageEditor || !imageEditor.ui) return;
        
        let currentActiveMenu: string | null = null;
        let lastClickTime = 0;
        const DOUBLE_CLICK_THRESHOLD = 300; // ms
        
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
            // Get all menu buttons
            const menuButtons = editorEl.querySelectorAll('.tui-image-editor-menu > .tui-image-editor-item');
            
            menuButtons.forEach((btn: HTMLElement) => {
                // Add click listener with capture to intercept before TUI's handlers
                btn.addEventListener('click', (e) => {
                    const now = Date.now();
                    
                    // Find which menu this button represents
                    const menuName = btn.getAttribute('tooltip') || btn.textContent?.trim() || '';
                    
                    // Check if this is a quick double-click on the same button
                    if (currentActiveMenu === menuName && (now - lastClickTime) < DOUBLE_CLICK_THRESHOLD) {
                        // Hide the submenu
                        setTimeout(() => {
                            const submenus = editorEl.querySelectorAll('.tui-image-editor-submenu');
                            submenus.forEach((submenu: HTMLElement) => {
                                if (submenu.style.display !== 'none') {
                                    submenu.style.display = 'none';
                                }
                            });
                            currentActiveMenu = null;
                        }, 50);
                    } else {
                        currentActiveMenu = menuName;
                        lastClickTime = now;
                    }
                }, true); // Use capture phase
            });
            
            // Add keyboard shortcut: ESC to hide submenu
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const submenus = editorEl.querySelectorAll('.tui-image-editor-submenu');
                    submenus.forEach((submenu: HTMLElement) => {
                        submenu.style.display = 'none';
                    });
                    currentActiveMenu = null;
                }
            });
            
            // Add mouse wheel zoom functionality
            const canvasContainer = editorEl.querySelector('.lower-canvas')?.parentElement;
            if (canvasContainer) {
                canvasContainer.addEventListener('wheel', (e: WheelEvent) => {
                    e.preventDefault();
                    
                    const canvas = getCanvasSafe();
                    if (!canvas) return;
                    
                    // Get current zoom level
                    let zoom = canvas.getZoom();
                    
                    // Calculate zoom delta (negative deltaY means zoom in)
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    zoom = Math.min(Math.max(0.1, zoom + delta), 5); // Limit zoom between 0.1x and 5x
                    
                    // Get mouse position relative to canvas
                    const point = new (window as any).fabric.Point(e.offsetX, e.offsetY);
                    
                    // Zoom to point
                    canvas.zoomToPoint(point, zoom);
                    canvas.renderAll();
                }, { passive: false });
            }
        }, 300);
    }

    onMount(() => {
        loadImage();
        // Setup toolbar toggle after a delay to ensure UI is ready
        setTimeout(() => {
            setupToolbarToggle();
        }, 500);
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
    
    /* Improve TUI Image Editor toolbar positioning */
    :global(.tui-image-editor-container) {
        position: relative;
    }
    
    /* Position submenu at bottom-right corner within the editor container */
    :global(.tui-image-editor-submenu) {
        position: absolute !important;
        left: auto !important;
        right: 20px !important;
        bottom: 60px !important;
        top: auto !important;
        max-height: 400px;
        max-width: 300px;
        overflow-y: auto;
        overflow-x: hidden;
        background: rgba(255, 255, 255, 0.98) !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2) !important;
        border-radius: 6px;
        z-index: 1000;
        height: inherit !important;
    }
    
    
    /* Make the main menu bar more compact */
    :global(.tui-image-editor-menu) {
        background: rgba(255, 255, 255, 0.95) !important;
    }
    
    /* Add visual feedback for active menu items */
    :global(.tui-image-editor-menu-item.active) {
        background-color: rgba(0, 123, 255, 0.1) !important;
    }
    
    /* Improve submenu item visibility */
    :global(.tui-image-editor-submenu > div) {
        padding: 8px 12px;
    }
    
    /* Hide the filter button */
    :global(.tui-image-editor-menu .tie-btn-filter){
        display: none !important;
    }
    :global(.tui-image-editor-header-logo){
        display: none !important;
    }
</style>
