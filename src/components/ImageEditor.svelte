<script lang="ts">
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();
    import { confirm } from 'siyuan';
    import { t } from '../utils/i18n';
    import CanvasEditor from './editor/CanvasEditor.svelte';
    import Toolbar from './editor/Toolbar.svelte';
    import ToolSettings from './editor/ToolSettings.svelte';
    // TUI Image Editor removed; only Fabric (CanvasEditor) is used now
    import { getFileBlob, putFile, readDir, removeFile } from '../api';
    import { readPNGTextChunk, insertPNGTextChunk, locatePNGtEXt } from '../utils';
    import { pushMsg, pushErrMsg } from '../api';

    export let imagePath: string;
    export let blockId: string | null = null;
    export let settings: any;
    export let isCanvasMode: boolean = false;
    export let isScreenshotMode: boolean = false;
    export let initialRect: { x: number; y: number; width: number; height: number } | null = null;
    export let onClose: (saved: boolean, newPath?: string) => void;

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
    let selectCanvasSizeMode = false;
    // For screenshot mode: keep a stable asset name so repeated copy/save reuses same file
    let screenshotAssetName: string | null = null;
    let screenshotHistoryPath: string | null = null;
    // Draggable tool-popup state
    let popupPos = { x: 12, y: 44 }; // default position (will be updated on first open)
    let isDraggingPopup = false;
    let dragOffset = { x: 0, y: 0 };
    let popupPositioned = false; // track if popup has been positioned (dragged or first open)
    let editorContainerEl: HTMLElement | null = null;
    let canvasLoadError: string | null = null;
    // pending crop request if canvas not ready yet
    let pendingCropRequested: boolean = false;
    const STORAGE_BACKUP_DIR = 'data/storage/petal/siyuan-plugin-imgReEditor/backup';
    const SCREENSHOT_HISTORY_DIR =
        'data/storage/petal/siyuan-plugin-imgReEditor/screenshot_history';
    let lastSavedHistoryIndex: number = -1;

    // Custom crop state (CanvasEditor handles crop lifecycle; ImageEditor stores metadata)
    let originalImageDimensions = { width: 0, height: 0 };
    let cropData: { left: number; top: number; width: number; height: number } | null = null;
    let isCropped = false;

    export function isDirty() {
        if (!canvasEditorRef || typeof canvasEditorRef.getHistoryIndex !== 'function') return false;

        const currentIndex = canvasEditorRef.getHistoryIndex();

        if (isScreenshotMode) {
            // Already saved/copied? Check if there are NEW changes since then.
            if (lastSavedHistoryIndex !== -1) {
                return currentIndex > lastSavedHistoryIndex;
            }
            // Not saved yet? Standard dirty check.
            return currentIndex > 0;
        }

        return currentIndex > 0;
    }

    async function handleCancel() {
        if (isDirty()) {
            return new Promise<void>(resolve => {
                confirm(t('imageEditor.confirm'), t('imageEditor.unsavedChanges'), () => {
                    onClose?.(false);
                    resolve();
                });
            });
        } else {
            onClose?.(false);
        }
    }

    async function getEditedImageData() {
        if (!canvasEditorRef) return null;

        try {
            const canvasJSON = canvasEditorRef.toJSON ? await canvasEditorRef.toJSON() : null;
            const dataURL = await canvasEditorRef.toDataURL();
            if (!dataURL) return null;

            const blob = dataURLToBlob(dataURL);
            const buffer = new Uint8Array(await blob.arrayBuffer());
            const metaObj: any = {
                version: 1,
                isCanvasMode,
                originalFileName,
                cropData: isCropped ? cropData : null,
                canvasJSON,
            };
            const metaValue = JSON.stringify(metaObj);
            const newBuffer = insertPNGTextChunk(buffer, 'siyuan-plugin-imgReEditor', metaValue);
            const newBlob = new Blob([newBuffer as any], { type: 'image/png' });
            return { blob: newBlob, dataURL };
        } catch (e) {
            console.error('Failed to get edited image data', e);
            return null;
        }
    }

    async function saveToHistory() {
        // Export current canvas as PNG and save to screenshot history according to storageMode
        if (!canvasEditorRef || typeof canvasEditorRef.toDataURL !== 'function') return null;

        const canvasJSON = canvasEditorRef.toJSON ? await canvasEditorRef.toJSON() : null;
        const dataURL = await canvasEditorRef.toDataURL();
        if (!dataURL) return null;

        // Determine filename (reuse existing when possible)
        let filename: string;
        if (screenshotHistoryPath) {
            filename = screenshotHistoryPath.split('/').pop() || `screenshot-${Date.now()}.png`;
        } else if (screenshotAssetName) {
            filename = screenshotAssetName;
        } else {
            const timestamp = Date.now();
            filename = `screenshot-${timestamp}.png`;
        }
        const path = `${SCREENSHOT_HISTORY_DIR}/${filename}`;

        // Convert dataURL to blob and insert metadata depending on mode
        const rawBlob = dataURLToBlob(dataURL);
        const buffer = new Uint8Array(await rawBlob.arrayBuffer());

        const metaObj: any = {
            version: 1,
            isCanvasMode,
            originalFileName: filename,
            cropData: isCropped ? cropData : null,
            originalImageDimensions:
                settings.storageMode === 'backup'
                    ? null
                    : originalImageDimensions.width > 0
                      ? originalImageDimensions
                      : null,
        };

        if (settings.storageMode !== 'backup') {
            metaObj.canvasJSON = canvasJSON;
        }

        // In backup mode, include the expected backup filename in PNG metadata
        if (settings.storageMode === 'backup') {
            metaObj.backupFileName = `${filename}.json`;
        }

        const metaValue = JSON.stringify(metaObj);
        const newBuffer = insertPNGTextChunk(buffer, 'siyuan-plugin-imgReEditor', metaValue);
        const newBlob = new Blob([newBuffer as any], { type: 'image/png' });

        // Save image to history
        const file = new File([newBlob], filename, { type: 'image/png' });
        await putFile(path, false, file);

        // If backup mode, write separate JSON backup to backup dir
        if (settings.storageMode === 'backup') {
            try {
                const backupName = `${filename}.json`;
                const backupPath = `${STORAGE_BACKUP_DIR}/${backupName}`;
                const jsonObj: any = {
                    version: 1,
                    canvasJSON,
                    cropData: isCropped ? cropData : null,
                    originalImageDimensions:
                        originalImageDimensions.width > 0 ? originalImageDimensions : null,
                    originalFileName: filename,
                    backupFileName: backupName,
                };
                const jsonBlob = new Blob([JSON.stringify(jsonObj)], { type: 'application/json' });
                await putFile(backupPath, false, jsonBlob);
            } catch (e) {
                console.warn('Failed to write screenshot backup json', e);
            }
        }

        // remember history path and asset name
        screenshotHistoryPath = path;
        screenshotAssetName = filename;
        if (canvasEditorRef && typeof canvasEditorRef.getHistoryIndex === 'function') {
            lastSavedHistoryIndex = canvasEditorRef.getHistoryIndex();
        }

        // Cleanup old screenshots
        cleanupScreenshotHistory();

        return { path, blob: newBlob, dataURL };
    }

    async function cleanupScreenshotHistory() {
        const limit = settings.screenshotLimit || 200;
        try {
            const files = await readDir(SCREENSHOT_HISTORY_DIR);
            if (files && files.length > limit) {
                // Sort by updated time (oldest first)
                files.sort((a, b) => (a.updated || 0) - (b.updated || 0));
                const toDeleteCount = files.length - limit;
                const toDelete = files.slice(0, toDeleteCount);

                for (const file of toDelete) {
                    try {
                        const filePath = `${SCREENSHOT_HISTORY_DIR}/${file.name}`;
                        await removeFile(filePath);
                        // Also remove backup json if it exists
                        await removeFile(`${STORAGE_BACKUP_DIR}/${file.name}.json`);
                    } catch (e) {
                        // Ignore errors for individual file deletion (e.g. backup json not existing)
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to cleanup screenshot history', e);
        }
    }

    async function handleCopyFile() {
        const history = await saveToHistory();
        if (!history) return;

        try {
            const { clipboard } = window.require('electron');
            const path =
                window.siyuan.config.system.dataDir + '/' + history.path.replace('data/', '');

            // On Windows, we can use 'file-paths'
            // But standard Electron way to "copy a file" is tricky.
            // Some versions of SiYuan or Electron might support writing file paths.
            // For now, let's at least copy the image to clipboard as well.
            clipboard.writeBuffer(
                'FileNameW',
                Buffer.concat([Buffer.from(path, 'ucs-2'), Buffer.from([0, 0])])
            );
            console.log('Copied screenshot to clipboard, file path:', path);

            pushMsg('文件已保存到历史并复制到剪贴板');
        } catch (e) {
            console.error('Failed to copy file', e);
            pushErrMsg('复制失败');
        }
    }

    async function handleSaveAs() {
        const history = await saveToHistory();
        if (!history) return;

        try {
            const { remote } = window.require('electron');
            const dialog = remote ? remote.dialog : null;

            if (dialog) {
                // Use existing screenshot name if available so Save dialog defaults match history
                const defaultName =
                    screenshotAssetName ||
                    (screenshotHistoryPath ? screenshotHistoryPath.split('/').pop() : null) ||
                    `screenshot-${Date.now()}.png`;
                const { filePath } = await dialog.showSaveDialog({
                    defaultPath: defaultName,
                    filters: [{ name: 'Images', extensions: ['png'] }],
                });

                if (filePath) {
                    const fs = window.require('fs');
                    fs.writeFileSync(filePath, Buffer.from(await history.blob.arrayBuffer()));
                    // Persist chosen filename so subsequent saves/copies reuse it
                    try {
                        const pathMod = window.require('path');
                        const base = pathMod.basename(filePath);
                        screenshotAssetName = base;
                        screenshotHistoryPath = `${SCREENSHOT_HISTORY_DIR}/${base}`;
                    } catch (e) {}
                    pushMsg('另存为成功');
                }
            } else {
                // Fallback for browser or if remote is not available
                // Use the Blob (which includes embedded metadata) rather than the raw dataURL
                const a = document.createElement('a');
                const blobUrl = URL.createObjectURL(history.blob);
                a.href = blobUrl;
                const name = screenshotAssetName || `screenshot-${Date.now()}.png`;
                a.download = name;
                // persist name for this session
                screenshotAssetName = name;
                screenshotHistoryPath = `${SCREENSHOT_HISTORY_DIR}/${name}`;
                a.click();
                // release blob URL after a short delay
                setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            }
        } catch (e) {
            console.error('Save as failed', e);
            // pushErrMsg('另存为失败');
            // Try download fallback using the embedded-blob so metadata is preserved
            try {
                const a = document.createElement('a');
                const blobUrl = URL.createObjectURL(history.blob);
                a.href = blobUrl;
                const name = screenshotAssetName || `screenshot-${Date.now()}.png`;
                a.download = name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
            } catch (ex) {
                // As a last resort, fallback to dataURL (may lose metadata)
                const a = document.createElement('a');
                a.href = history.dataURL;
                a.download = `screenshot-${Date.now()}.png`;
                a.click();
            }
        }
    }

    async function handlePin() {
        let result: any = null;
        if (isScreenshotMode) {
            result = await saveToHistory();
        } else {
            result = await getEditedImageData();
        }

        if (!result) return;

        dispatch('pin', { dataURL: result.dataURL });
        onClose?.(false);
    }

    async function handleHistory() {
        // Open history dialog
        dispatch('openHistory');
    }

    function saveToolSettings(tool: string | null, options: any) {
        if (!tool || !options) return;
        if (!settings) settings = {};
        if (!settings.lastToolSettings) settings.lastToolSettings = {};

        // Determine the persistence key
        let key = tool;
        if (tool === 'shape') {
            const shapeType = options.shape || activeShape || 'rect';
            key = `shape-${shapeType}`;
        }

        // Avoid saving certain transient or UI-only properties if they exist
        const toSave = { ...options };
        if (tool === 'number-marker') {
            delete toSave.isSelection;
            delete toSave.count;
            delete toSave.nextNumber;
        }

        settings.lastToolSettings[key] = toSave;
        dispatch('saveSettings', settings);
    }

    // Reactive statement to restore canvasJSON when savedEditorData becomes available
    $: if (
        editorReady &&
        isCanvasMode &&
        savedEditorData &&
        savedEditorData.canvasJSON &&
        canvasEditorRef
    ) {
        try {
            canvasEditorRef.fromJSON(savedEditorData.canvasJSON);
            if (savedEditorData.cropData) {
                cropData = savedEditorData.cropData;
                isCropped = true;
            }
            if (savedEditorData.originalImageDimensions) {
                originalImageDimensions = savedEditorData.originalImageDimensions;
            }
            // Clear savedEditorData to prevent re-triggering
            savedEditorData = null;
        } catch (e) {
            console.warn('Failed to restore canvas JSON reactively', e);
        }
    }

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
            if (!imagePath) {
                if (isCanvasMode) {
                    editorReady = true;
                    return;
                }
                return;
            }

            if (imagePath.startsWith('data:')) {
                lastBlobURL = imagePath;
                imageBlob = dataURLToBlob(imagePath);
                originalFileName = `screenshot-${Date.now()}.png`;
                originalExt = 'png';
                editorReady = true;
                return;
            }

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
                if (isCanvasMode) {
                    // If canvas mode, maybe we just didn't have an imagePath yet
                    editorReady = true;
                    return;
                }
                pushErrMsg('无法获取图片文件或文件为空');
                return;
            }

            imageBlob = blob;
            // extract filename/ext
            originalFileName = imagePath.split('/').pop() || 'image.png';

            // If in screenshot mode and path matches history directory, track it to ensure we update instead of create
            if (isScreenshotMode && imagePath && imagePath.startsWith(SCREENSHOT_HISTORY_DIR)) {
                screenshotHistoryPath = imagePath;
                screenshotAssetName = originalFileName;
            }

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
            // Try the embedded metadata's backupFileName first (if present), then fall back
            // to a JSON file named after the current image (`originalFileName`.json).
            if (settings.storageMode === 'backup') {
                try {
                    const expectedBackupName = `${originalFileName}.json`;
                    const candidates: string[] = [];
                    if (editorData && editorData.backupFileName)
                        candidates.push(editorData.backupFileName);
                    candidates.push(expectedBackupName);

                    let loadedText: string | null = null;
                    let loadedFrom: string | null = null;
                    for (const bn of candidates) {
                        try {
                            const jsonPath = `${STORAGE_BACKUP_DIR}/${bn}`;
                            const jb = await getFileBlob(jsonPath);
                            if (jb && jb.size > 0) {
                                loadedText = await jb.text();
                                loadedFrom = bn;
                                break;
                            }
                        } catch (e) {
                            // try next candidate
                        }
                    }

                    if (loadedText) {
                        try {
                            const saved = JSON.parse(loadedText);
                            if (!editorData) editorData = {};
                            if (saved.canvasJSON) editorData.canvasJSON = saved.canvasJSON;
                            if (saved.cropData) editorData.cropData = saved.cropData;
                            if (saved.originalImageDimensions)
                                editorData.originalImageDimensions = saved.originalImageDimensions;
                            hasExistingMetadata = true;

                            // If we loaded from a backup filename that doesn't match the expected one,
                            // also write a copy to the expected path so backup filename always matches image name.
                            if (loadedFrom && loadedFrom !== expectedBackupName) {
                                try {
                                    const syncPath = `${STORAGE_BACKUP_DIR}/${expectedBackupName}`;
                                    const jsonObj = {
                                        ...saved,
                                        backupFileName: expectedBackupName,
                                    };
                                    const jsonBlob = new Blob([JSON.stringify(jsonObj)], {
                                        type: 'application/json',
                                    });
                                    await putFile(syncPath, false, jsonBlob);
                                } catch (e) {
                                    console.warn('Failed to sync backup json to expected name', e);
                                }
                            }
                        } catch (e) {
                            console.warn('invalid json in backup json file', e);
                        }
                    }
                } catch (e) {
                    // ignore if backup json doesn't exist or other issues
                }
            }

            if (!hasExistingMetadata) {
            } else {
                // Store editorData for restoration after canvas is ready
                savedEditorData = editorData;

                // If metadata contains isCanvasMode flag, update the component's mode
                if (editorData && editorData.isCanvasMode === true) {
                    isCanvasMode = true;
                }
            }

            // Destroy prior TUI instance (no-op for Fabric-only flow)

            // For canvas mode with saved content, we need to load the image as background
            // and then restore the canvas JSON on top of it
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
        if (!isCanvasMode && !imageBlob && !isScreenshotMode) return;
        if (!editorReady) {
            pushErrMsg('编辑器尚未准备好，请稍后重试');
            return;
        }
        if (saving) return;
        saving = true;
        try {
            if (isScreenshotMode) {
                const result = await saveToHistory();
                if (result) {
                    pushMsg('图片已保存到历史');
                    // Mark as not dirty/saved if possible
                    if (
                        canvasEditorRef &&
                        typeof (canvasEditorRef as any).resetDirty === 'function'
                    ) {
                        (canvasEditorRef as any).resetDirty();
                    }
                }
                return;
            }
            // ... original logic continues for standard mode
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

            const canvasJSON = canvasEditorRef?.toJSON ? await canvasEditorRef.toJSON() : null;

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
            let saveName = '';
            if (!imagePath && isCanvasMode) {
                // generate a new name for the canvas
                const now = new Date();
                const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
                saveName = `canvas-${timestamp}.png`;
                originalFileName = saveName;
            } else {
                saveName = needConvertToPNG
                    ? originalFileName.replace(/\.[^.]+$/, '.png')
                    : originalFileName;
            }

            // Base the saved PNG on the edited image bytes (so edits are preserved)
            const buffer = new Uint8Array(await blob.arrayBuffer());
            const metaObj: any = {
                version: 1,
                isCanvasMode,
                originalFileName,
                cropData: isCropped ? cropData : null,
                originalImageDimensions:
                    settings.storageMode === 'backup'
                        ? null
                        : originalImageDimensions.width > 0
                          ? originalImageDimensions
                          : null,
            };

            // When using backup mode, include the backup json filename in the PNG metadata
            if (settings.storageMode === 'backup') {
                // backup filename should be image filename + .json
                metaObj.backupFileName = `${saveName}.json`;
            }

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
            // saveName already determined above
            // prepare original backup names already determined above

            // (Backup mode no longer stores the original image file.)
            // In backup mode, store canvasJSON/cropData as a separate JSON file
            if (settings.storageMode === 'backup') {
                try {
                    // Save JSON file in backup folder with .json extension
                    const backupJsonName = `${saveName}.json`;
                    const backupJsonPath = `${STORAGE_BACKUP_DIR}/${backupJsonName}`;
                    const jsonObj = {
                        version: 1,
                        canvasJSON,
                        cropData: isCropped ? cropData : null,
                        originalImageDimensions:
                            originalImageDimensions.width > 0 ? originalImageDimensions : null,
                        originalFileName,
                        backupFileName: backupJsonName,
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
                await fetch(newDataset, { cache: 'reload' });
                document
                    .querySelectorAll(`img[data-src="${imagePath}"]`)
                    .forEach((imageElement: any) => {
                        imageElement.setAttribute('data-src', newDataset);
                        imageElement.src = newDataset;
                    });
                // update local imagePath so subsequent saves reuse updated path
                imagePath = newDataset;
            } catch (e) {
                console.warn('DOM update failed', e);
            }

            // Close the editor after successful save
            // If user wants to continue editing, they can reopen the editor
            // which will properly load the saved image with all metadata
            onClose?.(true, `assets/${saveName}`);
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

    // Drag handlers for tool-popup
    function onPopupDragStart(e: MouseEvent) {
        if ((e.target as HTMLElement).closest('.close')) return; // ignore close button
        isDraggingPopup = true;
        dragOffset = {
            x: e.clientX - popupPos.x,
            y: e.clientY - popupPos.y,
        };
        e.preventDefault();
    }

    function onPopupDragMove(e: MouseEvent) {
        if (!isDraggingPopup) return;
        popupPos = {
            x: e.clientX - dragOffset.x,
            y: e.clientY - dragOffset.y,
        };
    }

    function onPopupDragEnd() {
        isDraggingPopup = false;
    }

    // Calculate initial popup position based on editor container's viewport position
    function updatePopupPosition() {
        if (editorContainerEl) {
            const rect = editorContainerEl.getBoundingClientRect();
            popupPos = {
                x: rect.left + 12,
                y: rect.top + 44, // below the toolbar
            };
        }
    }
</script>

<div class="editor-container" bind:this={editorContainerEl}>
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
        {isCanvasMode}
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
                'mosaic',
                'text',
                'transform',
                'number-marker',
                'crop',
                'image-border',
                'align',
                'canvas',
            ].includes(t);
            showToolPopup = hasSubmenu;
            // Only update popup position on first open (before user drags it)
            if (hasSubmenu && !popupPositioned) {
                updatePopupPosition();
                popupPositioned = true;
            }
            if (canvasEditorRef && typeof canvasEditorRef.setTool === 'function') {
                if (t === 'shape') {
                    const shapeType = e.detail.shape || 'rect';
                    activeShape = shapeType;
                    const key = `shape-${shapeType}`;
                    // Get last used settings for THIS specific shape type
                    const savedOptions =
                        (settings.lastToolSettings && settings.lastToolSettings[key]) || {};
                    const options = { ...savedOptions, shape: shapeType };
                    canvasEditorRef.setTool('shape', options);
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
                } else if (t === 'canvas') {
                    canvasEditorRef.setTool('canvas');
                    activeTool = 'canvas';
                    toolSettings = canvasEditorRef.getToolOptions();
                } else {
                    // Get last used settings for this tool
                    const savedOptions =
                        (settings.lastToolSettings && settings.lastToolSettings[t]) || {};
                    canvasEditorRef.setTool(t, savedOptions);
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
        {isScreenshotMode}
        on:copy-file={() => handleCopyFile()}
        on:save-as={() => handleSaveAs()}
        on:pin={() => handlePin()}
        on:history={() => handleHistory()}
        on:save={() => handleSave()}
        on:cancel={() => handleCancel()}
    />

    <div class="editor-main">
        <div class="canvas-wrap">
            <CanvasEditor
                bind:this={canvasEditorRef}
                dataURL={isCanvasMode && savedEditorData && savedEditorData.canvasJSON
                    ? ''
                    : lastBlobURL}
                blobURL={tmpBlobUrl}
                fileName={originalFileName}
                {isCanvasMode}
                {initialRect}
                on:ready={() => {
                    editorReady = true;

                    // For canvas mode with saved JSON, restore it now
                    if (
                        isCanvasMode &&
                        savedEditorData &&
                        savedEditorData.canvasJSON &&
                        canvasEditorRef
                    ) {
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
                            console.warn('Failed to restore canvas JSON in on:ready', e);
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
                            // For canvas mode with saved JSON, restore from JSON instead of using background
                            // This prevents showing the exported image as background
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
                on:canvasResized={e => {
                    try {
                        const w = e.detail?.width;
                        const h = e.detail?.height;
                        if (typeof w === 'number' && typeof h === 'number') {
                            // Update toolSettings so UI reflects new canvas size
                            const nw = Math.round(w);
                            const nh = Math.round(h);
                            toolSettings = {
                                ...(toolSettings || {}),
                                width: nw,
                                height: nh,
                            };
                            // Re-apply after a short delay to avoid being overwritten by selection handlers
                            setTimeout(() => {
                                try {
                                    toolSettings = {
                                        ...(toolSettings || {}),
                                        width: nw,
                                        height: nh,
                                    };
                                } catch (e) {}
                            }, 80);
                        }
                    } catch (err) {}
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
                on:toolChange={e => {
                    activeTool = e.detail.tool;
                }}
                on:selection={e => {
                    try {
                        const type = e.detail?.type;
                        if (e.detail && e.detail.options) {
                            // Update toolSettings to reflect selected object's properties
                            toolSettings = e.detail.options;

                            // Auto-activate corresponding tool ONLY if current tool is NOT 'select' or 'align'
                            // Treat 'align' like 'select' so selecting objects while align tool is active
                            // does not switch to shape/text/arrow tools and supports multi-select (Ctrl)
                            const shouldAutoActivate =
                                activeTool !== 'select' && activeTool !== 'align';

                            if (type === 'rect' || type === 'ellipse' || type === 'circle') {
                                const shapeType =
                                    type === 'ellipse' || type === 'circle' ? 'circle' : 'rect';

                                if (shouldAutoActivate) {
                                    // Auto-activate shape tool
                                    activeTool = 'shape';
                                    activeShape = shapeType;
                                    showToolPopup = true;
                                    if (!popupPositioned) {
                                        updatePopupPosition();
                                        popupPositioned = true;
                                    }
                                    try {
                                        if (
                                            canvasEditorRef &&
                                            typeof canvasEditorRef.setTool === 'function'
                                        )
                                            canvasEditorRef.setTool('shape', {
                                                shape: shapeType,
                                                ...e.detail.options,
                                            });
                                    } catch (err) {}
                                }

                                // Save settings if shape tool is active (either already active or just activated)
                                if (activeTool === 'shape') {
                                    activeShape = shapeType;
                                    saveToolSettings('shape', {
                                        ...e.detail.options,
                                        shape: shapeType,
                                    });
                                }
                            } else if (type === 'i-text' || type === 'textbox' || type === 'text') {
                                if (shouldAutoActivate) {
                                    // Auto-activate text tool
                                    activeTool = 'text';
                                    showToolPopup = true;
                                    if (!popupPositioned) {
                                        updatePopupPosition();
                                        popupPositioned = true;
                                    }
                                    try {
                                        if (
                                            canvasEditorRef &&
                                            typeof canvasEditorRef.setTool === 'function'
                                        )
                                            canvasEditorRef.setTool('text', e.detail.options);
                                    } catch (err) {}
                                }

                                // Save settings if text tool is active
                                if (activeTool === 'text') {
                                    saveToolSettings('text', e.detail.options);
                                }
                            } else if (type === 'arrow') {
                                if (shouldAutoActivate) {
                                    // Auto-activate arrow tool
                                    activeTool = 'arrow';
                                    showToolPopup = true;
                                    if (!popupPositioned) {
                                        updatePopupPosition();
                                        popupPositioned = true;
                                    }
                                    try {
                                        if (
                                            canvasEditorRef &&
                                            typeof canvasEditorRef.setTool === 'function'
                                        )
                                            canvasEditorRef.setTool('arrow', e.detail.options);
                                    } catch (err) {}
                                }

                                // Save settings if arrow tool is active
                                if (activeTool === 'arrow') {
                                    saveToolSettings('arrow', e.detail.options);
                                }
                            } else if (type === 'number-marker') {
                                if (shouldAutoActivate) {
                                    // Auto-activate number-marker tool
                                    activeTool = 'number-marker';
                                    showToolPopup = true;
                                    if (!popupPositioned) {
                                        updatePopupPosition();
                                        popupPositioned = true;
                                    }
                                }

                                // Save settings if number-marker tool is active
                                if (activeTool === 'number-marker') {
                                    saveToolSettings('number-marker', e.detail.options);
                                }
                            } else if (type === 'mosaic-rect') {
                                if (shouldAutoActivate) {
                                    // Auto-activate mosaic tool
                                    activeTool = 'mosaic';
                                    showToolPopup = true;
                                    if (!popupPositioned) {
                                        updatePopupPosition();
                                        popupPositioned = true;
                                    }
                                    try {
                                        if (
                                            canvasEditorRef &&
                                            typeof canvasEditorRef.setTool === 'function'
                                        )
                                            canvasEditorRef.setTool('mosaic', e.detail.options);
                                    } catch (err) {}
                                }

                                // Save settings if mosaic tool is active
                                if (activeTool === 'mosaic') {
                                    saveToolSettings('mosaic', e.detail.options);
                                }
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
                on:selectCanvasSizeModeChanged={e => {
                    selectCanvasSizeMode = e.detail;
                }}
            />
        </div>

        {#if activeTool && showToolPopup}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="tool-popup"
                role="dialog"
                aria-label="Tool submenu"
                style="left: {popupPos.x}px; top: {popupPos.y}px;"
                on:mousemove={onPopupDragMove}
                on:mouseup={onPopupDragEnd}
                on:mouseleave={onPopupDragEnd}
            >
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div class="tool-popup-header" on:mousedown={onPopupDragStart}>
                    <div class="title">
                        {#if activeTool === 'shape'}
                            {activeShape === 'rect'
                                ? '矩形设置'
                                : activeShape === 'circle' || activeShape === 'ellipse'
                                  ? '椭圆设置'
                                  : '形状设置'}
                        {:else if activeTool === 'arrow'}
                            箭头设置
                        {:else if activeTool === 'brush'}
                            画笔设置
                        {:else if activeTool === 'eraser'}
                            橡皮设置
                        {:else if activeTool === 'number-marker'}
                            序号设置
                        {:else if activeTool === 'text'}
                            文本设置
                        {:else if activeTool === 'transform'}
                            变换设置
                        {:else if activeTool === 'crop'}
                            裁剪设置
                        {:else if activeTool === 'mosaic'}
                            马赛克设置
                        {:else if activeTool === 'image-border'}
                            图片边框
                        {:else}
                            {activeTool}
                        {/if}
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
                        recentColors={settings.recentColors || {}}
                        {selectCanvasSizeMode}
                        on:action={e => {
                            const { action } = e.detail;
                            try {
                                if (action === 'setCropRatio') {
                                    canvasEditorRef.setCropRatio &&
                                        canvasEditorRef.setCropRatio(e.detail.label || 'none');
                                    toolSettings = {
                                        ...toolSettings,
                                        cropRatioLabel: e.detail.label,
                                    };
                                } else if (action === 'applyCrop') {
                                    canvasEditorRef.applyPendingCrop &&
                                        canvasEditorRef.applyPendingCrop();
                                } else if (action === 'flip') {
                                    const dir = e.detail.dir;
                                    if (dir === 'horizontal') canvasEditorRef.flipHorizontal();
                                    else if (dir === 'vertical') canvasEditorRef.flipVertical();
                                } else if (action === 'rotate') {
                                    const dir = e.detail.dir;
                                    if (dir === 'cw') canvasEditorRef.rotate90(true);
                                    else if (dir === 'ccw') canvasEditorRef.rotate90(false);
                                } else if (action === 'align') {
                                    const type = e.detail.type;
                                    const forceCanvas = !!e.detail.forceCanvas;
                                    try {
                                        if (
                                            canvasEditorRef &&
                                            typeof canvasEditorRef.alignObjects === 'function'
                                        ) {
                                            canvasEditorRef.alignObjects(type, forceCanvas);
                                        }
                                    } catch (err) {
                                        console.warn('align action failed', err);
                                    }
                                } else if (action === 'distribute') {
                                    const type = e.detail.type;
                                    try {
                                        if (
                                            canvasEditorRef &&
                                            typeof canvasEditorRef.distributeObjects === 'function'
                                        ) {
                                            canvasEditorRef.distributeObjects(type);
                                        }
                                    } catch (err) {
                                        console.warn('distribute action failed', err);
                                    }
                                } else if (action === 'resizeCanvas') {
                                    canvasEditorRef.resizeCanvas &&
                                        canvasEditorRef.resizeCanvas(
                                            e.detail.width,
                                            e.detail.height
                                        );
                                } else if (action === 'selectCanvasSize') {
                                    try {
                                        const currentMode =
                                            canvasEditorRef &&
                                            typeof canvasEditorRef.getSelectCanvasSizeMode ===
                                                'function'
                                                ? canvasEditorRef.getSelectCanvasSizeMode()
                                                : selectCanvasSizeMode;
                                        if (currentMode) {
                                            canvasEditorRef.exitSelectCanvasSizeMode &&
                                                canvasEditorRef.exitSelectCanvasSizeMode();
                                        } else {
                                            canvasEditorRef.enterSelectCanvasSizeMode &&
                                                canvasEditorRef.enterSelectCanvasSizeMode();
                                        }
                                    } catch (err) {
                                        console.warn('selectCanvasSize toggle failed', err);
                                    }
                                } else if (action === 'uploadImage') {
                                    canvasEditorRef.uploadImage && canvasEditorRef.uploadImage();
                                }
                            } catch (err) {
                                console.warn('Action failed', err);
                            }
                        }}
                        on:change={e => {
                            const partial = e.detail;
                            toolSettings = { ...toolSettings, ...partial };
                            if (toolSettings && toolSettings.shape)
                                activeShape = toolSettings.shape;
                            try {
                                canvasEditorRef.setTool(activeTool, toolSettings);
                                canvasEditorRef.applyToolOptionsToSelection(
                                    activeTool === 'image-border' ? toolSettings : partial
                                );
                            } catch (err) {}
                            // Persist settings for the active tool
                            saveToolSettings(activeTool, toolSettings);
                        }}
                        on:recentUpdate={e => {
                            const { colorKey, colors } = e.detail;
                            if (!settings.recentColors) settings.recentColors = {};
                            settings.recentColors[colorKey] = colors;
                            // Notify parent to save settings if needed,
                            // though in Siyuan we usually save when settings change or on close.
                            // We can dispatch an event that index.ts listens to.
                            dispatch('saveSettings', settings);
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
        position: fixed;
        z-index: 9999;
        min-width: 260px;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 6px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
        user-select: none;
    }
    .tool-popup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.04);
        cursor: grab;
    }
    .tool-popup-header:active {
        cursor: grabbing;
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
