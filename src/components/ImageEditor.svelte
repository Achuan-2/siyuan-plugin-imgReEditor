<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import CanvasEditor from './editor/CanvasEditor.svelte';
    import Toolbar from './editor/Toolbar.svelte';
    import ToolSettings from './editor/ToolSettings.svelte';
    // TUI Image Editor removed; only Fabric (CanvasEditor) is used now
    import { getFileBlob, putFile } from '../api';
    import { readPNGTextChunk, insertPNGTextChunk, locatePNGtEXt } from '../utils';
    import { pushMsg, pushErrMsg } from '../api';

    export let imagePath: string;
    export let blockId: string | null = null;
    export let settings: any;
    export let onClose: (saved: boolean) => void;

    let imageBlob: Blob | null = null;
    let editorReady = false;
    let saving = false;
    let originalFileName = '';
    let originalExt = '';
    let needConvertToPNG = false;
    let lastBlobURL = '';
    let hasExistingMetadata = false; // Track if image already has editor metadata
    // Fabric mode (new editor)
    let canvasEditorRef: any = null;
    let editorEl: HTMLElement | null = null;
    let activeTool: string | null = null;
    // mark blockId as intentionally present for external callers to pass
    void blockId;
    let savedEditorData: any = null;
    // history UI state
    let undoAvailable = false;
    let redoAvailable = false;
    let undoCount = 0;
    let redoCount = 0;
    // tool settings state
    let toolSettings: any = {};
    let showToolPopup: boolean = false;
    let activeShape: string | null = null;
    let tmpBlobUrl: string | null = null;
    let canvasLoadError: string | null = null;
    // pending crop request if canvas not ready yet
    let pendingCropRequested: boolean = false;
    const STORAGE_BACKUP_DIR = 'data/storage/petal/siyuan-plugin-imgReEditor/backup';

    // Custom crop state (CanvasEditor handles crop lifecycle; ImageEditor stores metadata)
    let originalImageDimensions = { width: 0, height: 0 };
    let cropData: { left: number; top: number; width: number; height: number } | null = null;
    let isCropped = false;

    async function blobToDataURL(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // ensureDirExists removed (not used)

    // verifyImage helper removed; using direct TUI load with fallback validation

    async function loadImage() {
        try {
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
                const meta = readPNGTextChunk(buffer, 'siyuan-plugin-imgReEditor');
                if (meta) {
                    try {
                        editorData = JSON.parse(meta);
                        hasExistingMetadata = true; // Image has been edited before
                    } catch (e) {
                        console.warn('invalid metadata');
                    }
                }
            }

            // In backup mode try to load the separate JSON file stored in backup folder
            // (useful when canvasJSON is stored separately from the PNG)
            if (settings.storageMode === 'backup' && hasExistingMetadata) {
                try {
                    const jsonPath = `${STORAGE_BACKUP_DIR}/${originalFileName}.json`;
                    const jb = await getFileBlob(jsonPath);
                    if (jb && jb.size > 0) {
                        const text = await jb.text();
                        try {
                            const saved = JSON.parse(text);
                            // Merge saved canvas/crop data into editorData for restore
                            if (!editorData) editorData = {};
                            if (saved.canvasJSON) editorData.canvasJSON = saved.canvasJSON;
                            if (saved.cropData) editorData.cropData = saved.cropData;
                            if (saved.originalImageDimensions)
                                editorData.originalImageDimensions = saved.originalImageDimensions;
                            hasExistingMetadata = true;
                        } catch (e) {
                            console.warn('invalid json in backup json file', e);
                        }
                    }
                } catch (e) {
                    // ignore if backup json doesn't exist
                }
            }

            if (!hasExistingMetadata) {
            } else {
                // Store editorData for restoration after canvas is ready
                savedEditorData = editorData;
            }

            // Destroy prior TUI instance (no-op for Fabric-only flow)

            // Convert blob to data URL for loading (always use current image blob)
            const dataURL = await blobToDataURL(blob);
            lastBlobURL = dataURL;

            // prepare blob fallback URL
            try {
                if (imageBlob) {
                    if (lastBlobURL && lastBlobURL.startsWith('data:')) {
                        try {
                            // create a blob URL for fallback
                            const obj = URL.createObjectURL(imageBlob);
                            tmpBlobUrl = obj;
                        } catch (e) {}
                    }
                }
            } catch (e) {}

            return;
        } catch (e) {
            console.error('Error loading image:', e);
            pushErrMsg('加载图片失败: ' + (e.message || '未知错误'));
        }
    }

    async function handleSave() {
        if (!imageBlob) return;
        if (!editorReady) {
            pushErrMsg('编辑器尚未准备好，请稍后重试');
            return;
        }
        if (saving) return;
        saving = true;
        try {
            // If there is an active or unconfirmed crop rectangle, apply it before saving
            // For Fabric mode, delegate to CanvasEditor; fallback to legacy handlers
            try {
                if (canvasEditorRef && typeof canvasEditorRef.applyPendingCrop === 'function') {
                    canvasEditorRef.applyPendingCrop();
                    await new Promise(resolve => setTimeout(resolve, 50));
                } else {
                    // No pending-crop API available; assume no crop pending
                }
            } catch (e) {
                console.warn('Failed to apply pending crop before save', e);
            }

            const canvasJSON = canvasEditorRef?.toJSON?.() ?? null;

            // export image as PNG dataurl
            let dataURL: string | null = null;
            if (canvasEditorRef && typeof canvasEditorRef.toDataURL === 'function') {
                dataURL = await canvasEditorRef.toDataURL();
            } else {
                // No legacy TUI exporter available
                dataURL = null;
            }
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

            // Base the saved PNG on the edited image bytes (so edits are preserved)
            const buffer = new Uint8Array(await blob.arrayBuffer());
            const metaObj: any = {
                version: 1,
                originalFileName,
                cropData: isCropped ? cropData : null,
                originalImageDimensions:
                    settings.storageMode === 'backup'
                        ? null
                        : originalImageDimensions.width > 0
                          ? originalImageDimensions
                          : null,
            };
            // Do not embed canvasJSON into PNG metadata when using backup mode
            if (settings.storageMode !== 'backup') {
                metaObj.canvasJSON = canvasJSON;
            }
            const metaValue = JSON.stringify(metaObj);
            const newBuffer = insertPNGTextChunk(buffer, 'siyuan-plugin-imgReEditor', metaValue);
            // Convert Uint8Array to ArrayBuffer for Blob constructor
            const newBlob = new Blob([newBuffer as any], { type: 'image/png' });

            // Save to Siyuan using same path - replace
            // If original ext was jpg/jpeg, we still use PNG and update name suffix
            const saveName = needConvertToPNG
                ? originalFileName.replace(/\.[^.]+$/, '.png')
                : originalFileName;
            // prepare original backup names already determined above

            // (Backup mode no longer stores the original image file.)
            // In backup mode, store canvasJSON/cropData as a separate JSON file
            if (settings.storageMode === 'backup') {
                try {
                    const backupJsonPath = `${origBackupPath}.json`;
                    const jsonObj = {
                        version: 1,
                        canvasJSON,
                        cropData: isCropped ? cropData : null,
                        originalImageDimensions:
                            originalImageDimensions.width > 0 ? originalImageDimensions : null,
                        originalFileName,
                    };
                    const jsonBlob = new Blob([JSON.stringify(jsonObj)], {
                        type: 'application/json',
                    });
                    await putFile(backupJsonPath, false, jsonBlob);
                } catch (e) {
                    console.error('Failed saving backup json', e);
                    // Don't block the main save if json fails
                }
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

    // enterCropModeWhenReady removed — CanvasEditor now manages crop mode and ImageEditor will delegate via direct calls or on:ready handler.

    // enterCropMode removed: CanvasEditor manages crop interactions now and emits 'cropApplied' to notify ImageEditor.

    // exitCropMode removed: CanvasEditor handles exiting crop mode and will emit events for ImageEditor to respond to.

    // applyCrop removed — CanvasEditor now applies crop and emits 'cropApplied' event.

    // setupCropButton removed — toolbar DOM is managed by Svelte components and CanvasEditor now.

    // setupToolbarToggle removed — toolbar DOM manipulation and legacy TUI shortcuts are no longer necessary; CanvasEditor and Toolbar components handle interactions.

    onMount(() => {
        // Default to Fabric mode if not explicitly set
        try {
            if (!settings) settings = {};
        } catch (e) {}

        loadImage();
        // No TUI setup needed; CanvasEditor handles toolbar & crop interactions for Fabric mode
        // Reference blockId to silence unused-export warning
        if (blockId) {
            /* blockId passed by caller, reserved for integration. */
        }
        // Reference editorEl to silence unused variable warning (useful for DOM access)
        if (editorEl) {
            /* editorEl bound to container div */
        }
    });

    onDestroy(() => {
        try {
            if (lastBlobURL && lastBlobURL.startsWith('blob:')) URL.revokeObjectURL(lastBlobURL);
        } catch (e) {}
        try {
            if (tmpBlobUrl && tmpBlobUrl.startsWith('blob:')) {
                URL.revokeObjectURL(tmpBlobUrl);
                tmpBlobUrl = null;
            }
        } catch (e) {}
    });
</script>

<div class="editor-container">
    {#if canvasLoadError}
        <div class="editor-error-overlay">
            <div class="editor-error-box">
                <div class="title">图片加载失败</div>
                <div class="msg">{canvasLoadError}</div>
                <div class="msg" style="margin-top:8px;color:#333;font-size:12px">
                    Path: {imagePath}
                </div>
                <div style="margin-top:8px;display:flex;gap:8px;">
                    <button
                        class="btn"
                        on:click={() => {
                            canvasLoadError = null;
                            loadImage();
                        }}
                    >
                        重试
                    </button>
                    <button class="btn" on:click={() => onClose?.(false)}>关闭</button>
                </div>
            </div>
        </div>
    {/if}
    <Toolbar
        active={activeTool}
        {activeShape}
        canUndo={undoAvailable}
        canRedo={redoAvailable}
        {undoCount}
        {redoCount}
        on:tool={e => {
            const t = e.detail.tool;
            activeTool = t;
            // show popup for tools that have a submenu
            const hasSubmenu = [
                'shape',
                'arrow',
                'brush',
                'eraser',
                'text',
                'transform',
                'number-marker',
                'crop',
            ].includes(t);
            showToolPopup = hasSubmenu;
            if (canvasEditorRef && typeof canvasEditorRef.setTool === 'function') {
                if (t === 'shape') {
                    const shapeType =
                        e.detail.shape || (toolSettings && toolSettings.shape) || 'rect';
                    activeShape = shapeType;
                    canvasEditorRef.setTool('shape', { shape: shapeType });
                    toolSettings = canvasEditorRef.getToolOptions();
                } else if (t === 'crop') {
                    // Delegate crop mode to CanvasEditor
                    canvasEditorRef.setTool(null);
                    pendingCropRequested = true;
                    try {
                        if (
                            canvasEditorRef &&
                            typeof canvasEditorRef.enterCropMode === 'function'
                        ) {
                            if (isCropped && cropData) {
                                canvasEditorRef.enterCropMode(cropData, originalImageDimensions);
                            } else {
                                canvasEditorRef.enterCropMode();
                            }
                            pendingCropRequested = false;
                            // initialize tool settings for crop submenu
                            toolSettings = { ...(toolSettings || {}), cropRatioLabel: 'none' };
                        }
                    } catch (err) {
                        console.warn('enterCropMode failed', err);
                        try {
                            pushErrMsg('进入裁剪模式失败');
                        } catch (e) {}
                    }
                } else if (t === 'transform') {
                    // open transform submenu
                    canvasEditorRef.setTool('transform');
                    toolSettings = canvasEditorRef.getToolOptions();
                } else {
                    canvasEditorRef.setTool(t);
                    toolSettings = canvasEditorRef.getToolOptions();
                }
            }
        }}
        on:undo={async () => {
            if (canvasEditorRef && typeof canvasEditorRef.undo === 'function') {
                await canvasEditorRef.undo();
                const currentCrop = canvasEditorRef.getCropData();
                cropData = currentCrop;
                isCropped = !!currentCrop;
            }
        }}
        on:redo={async () => {
            if (canvasEditorRef && typeof canvasEditorRef.redo === 'function') {
                await canvasEditorRef.redo();
                const currentCrop = canvasEditorRef.getCropData();
                cropData = currentCrop;
                isCropped = !!currentCrop;
            }
        }}
        on:flip={e => {
            try {
                const dir = e.detail && e.detail.dir;
                if (!canvasEditorRef) return;
                if (dir === 'horizontal')
                    canvasEditorRef.flipHorizontal && canvasEditorRef.flipHorizontal();
                else if (dir === 'vertical')
                    canvasEditorRef.flipVertical && canvasEditorRef.flipVertical();
            } catch (err) {
                console.warn('flip handler failed', err);
            }
        }}
        on:rotate={e => {
            try {
                const dir = e.detail && e.detail.dir;
                if (!canvasEditorRef) return;
                if (dir === 'cw') canvasEditorRef.rotate90 && canvasEditorRef.rotate90(true);
                else if (dir === 'ccw') canvasEditorRef.rotate90 && canvasEditorRef.rotate90(false);
            } catch (err) {
                console.warn('rotate handler failed', err);
            }
        }}
        on:save={() => handleSave()}
        on:cancel={() => onClose?.(false)}
    />

    <div class="editor-main">
        <div class="canvas-wrap">
            <CanvasEditor
                bind:this={canvasEditorRef}
                dataURL={lastBlobURL}
                blobURL={tmpBlobUrl}
                fileName={originalFileName}
                on:ready={() => {
                    editorReady = true;
                    // If user requested crop before canvas was ready, try now
                    try {
                        if (
                            pendingCropRequested &&
                            canvasEditorRef &&
                            typeof canvasEditorRef.enterCropMode === 'function'
                        ) {
                            canvasEditorRef.enterCropMode();
                            pendingCropRequested = false;
                        }
                    } catch (e) {}
                }}
                on:loaded={e => {
                    // Store original image dimensions from the loaded event
                    if (e.detail && e.detail.width && e.detail.height) {
                        if (originalImageDimensions.width === 0) {
                            originalImageDimensions = {
                                width: e.detail.width,
                                height: e.detail.height,
                            };
                        }
                    }

                    if (savedEditorData && savedEditorData.canvasJSON && canvasEditorRef) {
                        try {
                            canvasEditorRef.fromJSON(savedEditorData.canvasJSON);
                            if (savedEditorData.cropData) {
                                cropData = savedEditorData.cropData;
                                isCropped = true;
                            }
                            if (savedEditorData.originalImageDimensions) {
                                originalImageDimensions = savedEditorData.originalImageDimensions;
                            }
                        } catch (e) {
                            console.warn('Failed to restore canvas JSON to CanvasEditor', e);
                        }
                    } else {
                        // For new images without saved data, fit to viewport now
                        if (
                            canvasEditorRef &&
                            typeof canvasEditorRef.fitImageToViewport === 'function'
                        ) {
                            try {
                                canvasEditorRef.fitImageToViewport();
                            } catch (e) {
                                console.warn('Failed to fit new image to viewport', e);
                            }
                        }
                    }

                    // If user requested crop before canvas was ready, try now
                    try {
                        if (
                            pendingCropRequested &&
                            canvasEditorRef &&
                            typeof canvasEditorRef.enterCropMode === 'function'
                        ) {
                            canvasEditorRef.enterCropMode();
                            pendingCropRequested = false;
                        }
                    } catch (e) {}
                }}
                on:loadError={e => {
                    try {
                        const msg = e.detail?.message || '加载失败';
                        const url = e.detail?.url || '';
                        canvasLoadError = msg + (url ? ` (${url})` : '');
                        pushErrMsg(`加载图片失败: ${msg}`);
                        console.error('CanvasEditor loadError', e.detail);
                    } catch (err) {
                        pushErrMsg('加载图片失败');
                    }
                }}
                on:cropApplied={e => {
                    try {
                        cropData = e.detail?.cropData || null;
                        isCropped = !!cropData;
                        // Deactivate crop tool button after crop
                        activeTool = null;
                    } catch (err) {
                        console.warn('cropApplied handler failed', err);
                    }
                }}
                on:cropCancel={() => {
                    activeTool = null;
                }}
                on:selection={e => {
                    try {
                        const type = e.detail?.type;
                        if (e.detail && e.detail.options) {
                            toolSettings = e.detail.options;
                            if (type === 'rect' || type === 'ellipse' || type === 'circle') {
                                activeTool = 'shape';
                                activeShape =
                                    type === 'ellipse' || type === 'circle' ? 'circle' : 'rect';
                                showToolPopup = true;
                                try {
                                    if (
                                        canvasEditorRef &&
                                        typeof canvasEditorRef.setTool === 'function'
                                    )
                                        canvasEditorRef.setTool('shape', { shape: activeShape });
                                } catch (err) {}
                            } else if (type === 'i-text' || type === 'textbox' || type === 'text') {
                                // auto-open text settings when a text object is selected
                                activeTool = 'text';
                                showToolPopup = true;
                                toolSettings = e.detail.options || {};
                                try {
                                    if (
                                        canvasEditorRef &&
                                        typeof canvasEditorRef.setTool === 'function'
                                    )
                                        canvasEditorRef.setTool('text', toolSettings);
                                } catch (err) {}
                            } else if (type === 'arrow') {
                                // auto-open arrow settings when an arrow is selected
                                activeTool = 'arrow';
                                showToolPopup = true;
                                toolSettings = e.detail.options || {};
                                try {
                                    if (
                                        canvasEditorRef &&
                                        typeof canvasEditorRef.setTool === 'function'
                                    )
                                        canvasEditorRef.setTool('arrow', toolSettings);
                                } catch (err) {}
                            } else if (type === 'number-marker') {
                                // auto-open number settings when a number marker is selected
                                activeTool = 'number-marker';
                                showToolPopup = true;
                                toolSettings = e.detail.options || {};
                                // keep it as number-marker to show specific edit UI
                            } else {
                                /* don't auto-open for other types */
                            }
                        } else {
                            // Selection cleared, restore default tool options (e.g. for number-marker next count)
                            if (
                                activeTool &&
                                canvasEditorRef &&
                                typeof canvasEditorRef.getToolOptions === 'function'
                            ) {
                                toolSettings = canvasEditorRef.getToolOptions();
                            }
                        }
                    } catch (e) {}
                }}
                on:historyUpdate={e => {
                    const idx = e.detail.index || 0;
                    const len = e.detail.length || 0;
                    undoAvailable = idx > 0;
                    redoAvailable = idx < len - 1;
                    undoCount = idx;
                    redoCount = Math.max(0, len - 1 - idx);
                }}
            />
        </div>

        {#if activeTool && showToolPopup}
            <div class="tool-popup" role="dialog" aria-label="Tool submenu">
                <div class="tool-popup-header">
                    <div class="title">
                        {activeTool === 'shape'
                            ? activeShape === 'rect'
                                ? '矩形设置'
                                : activeShape === 'circle' || activeShape === 'ellipse'
                                  ? '椭圆设置'
                                  : '形状设置'
                            : activeTool === 'arrow'
                              ? '箭头设置'
                              : activeTool === 'brush'
                                ? '画笔设置'
                                : activeTool === 'eraser'
                                  ? '橡皮设置'
                                  : activeTool === 'number-marker'
                                    ? '序号设置'
                                    : activeTool}
                    </div>
                    <button
                        class="close"
                        on:click={() => {
                            showToolPopup = false;
                        }}
                    >
                        ×
                    </button>
                </div>
                <div class="tool-popup-body">
                    <ToolSettings
                        tool={activeTool}
                        settings={toolSettings}
                        on:change={e => {
                            toolSettings = e.detail;
                            if (toolSettings && toolSettings.shape)
                                activeShape = toolSettings.shape;
                            try {
                                canvasEditorRef.setTool(activeTool, toolSettings);
                                canvasEditorRef.applyToolOptionsToSelection(toolSettings);
                            } catch (err) {}
                        }}
                        on:action={e => {
                            try {
                                const a = e.detail || {};
                                if (!canvasEditorRef) return;
                                if (a.action === 'flip') {
                                    if (a.dir === 'horizontal') canvasEditorRef.flipHorizontal();
                                    else if (a.dir === 'vertical') canvasEditorRef.flipVertical();
                                } else if (a.action === 'rotate') {
                                    if (a.dir === 'cw')
                                        canvasEditorRef.rotate90 && canvasEditorRef.rotate90(true);
                                    else if (a.dir === 'ccw')
                                        canvasEditorRef.rotate90 && canvasEditorRef.rotate90(false);
                                } else if (a.action === 'setCropRatio') {
                                    const label = a.label || 'none';
                                    try {
                                        if (
                                            canvasEditorRef &&
                                            typeof canvasEditorRef.setCropRatio === 'function'
                                        ) {
                                            canvasEditorRef.setCropRatio(label);
                                        }
                                    } catch (err) {}
                                    toolSettings = {
                                        ...(toolSettings || {}),
                                        cropRatioLabel: label,
                                    };
                                } else if (a.action === 'applyCrop') {
                                    try {
                                        if (
                                            canvasEditorRef &&
                                            typeof canvasEditorRef.applyPendingCrop === 'function'
                                        ) {
                                            canvasEditorRef.applyPendingCrop();
                                        }
                                    } catch (err) {}
                                }
                                // keep popup open so user can perform multiple transforms
                            } catch (err) {
                                console.warn('action handler failed', err);
                            }
                        }}
                    />
                </div>
            </div>
        {/if}
    </div>
</div>

<style>
    .editor-container {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden; /* prevent scrollbars when toolbar is overlaid */
    }

    .editor-main {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: stretch;
    }
    .canvas-wrap {
        flex: 1 1 auto;
        min-width: 0; /* allow shrinking to prevent overflow/scrollbars */
        height: 100%;
        overflow: hidden; /* no internal scrollbars, use Fabric panning/zooming */
    }

    .tool-popup {
        position: absolute;
        top: 44px; /* below the toolbar */
        left: 12px;
        z-index: 70;
        min-width: 260px;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 6px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
    }
    .tool-popup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.04);
    }
    .tool-popup .title {
        font-weight: 600;
        font-size: 13px;
    }
    .tool-popup .close {
        background: transparent;
        border: 0;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
    }
    .tool-popup-body {
        padding: 8px;
    }

    .editor-error-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.4);
        z-index: 3000;
    }
    .editor-error-box {
        background: white;
        padding: 16px;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        width: 400px;
    }
    .editor-error-box .title {
        font-weight: bold;
        margin-bottom: 8px;
    }
    .editor-error-box .msg {
        color: #666;
        white-space: pre-wrap;
    }

    /* Legacy TUI Image Editor styles removed; CanvasEditor/Toolbar manage layout and controls now. */

    /* Zoom indicator styles */
    :global(.zoom-indicator) {
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.75);
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: bold;
        z-index: 2000;
        pointer-events: none;
        transition: opacity 0.3s ease;
    }

    :global(.zoom-indicator[style*='display: none']) {
        opacity: 0;
    }
</style>
