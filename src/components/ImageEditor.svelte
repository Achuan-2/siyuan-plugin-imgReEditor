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
    
    // Custom crop state
    let cropMode = false;
    let cropRect: fabric.Rect | null = null;
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
                    // Restore metadata variables first
                    if (editorData && editorData.cropData) {
                        cropData = editorData.cropData;
                        isCropped = true;
                    }
                    
                    // Restore original image dimensions if available
                    if (editorData && editorData.originalImageDimensions) {
                        originalImageDimensions = editorData.originalImageDimensions;
                    }

                    if (editorData && editorData.canvasJSON) {
                        canvas.loadFromJSON(editorData.canvasJSON, () => {
                            // If cropped, we must resize the canvas to match the crop dimensions
                            if (isCropped && cropData) {
                                console.log('Loading cropped image with cropData:', cropData);
                                console.log('Canvas size before resize:', canvas.getWidth(), 'x', canvas.getHeight());
                                
                                canvas.setWidth(cropData.width);
                                canvas.setHeight(cropData.height);
                                
                                console.log('Canvas size after resize:', canvas.getWidth(), 'x', canvas.getHeight());
                                
                                // CRITICAL FIX: The background image was loaded at (0,0) by loadImageFromURL
                                // We need to shift it to show the cropped region
                                // The background should be at negative offset to show the crop area
                                if (canvas.backgroundImage) {
                                    const bg = canvas.backgroundImage;
                                    console.log('Background image position BEFORE adjustment:', {
                                        left: bg.left,
                                        top: bg.top,
                                        width: bg.width,
                                        height: bg.height
                                    });
                                    
                                    // Set background position to negative crop offset
                                    // This makes the visible canvas area show the cropped region
                                    bg.left = -cropData.left;
                                    bg.top = -cropData.top;
                                    bg.setCoords();
                                    
                                    console.log('Background image position AFTER adjustment:', {
                                        left: bg.left,
                                        top: bg.top
                                    });
                                }
                            }

                            // After loading JSON and potential resize, ensure wrapper size matches
                            const canvasContainer = editorEl.querySelector('.lower-canvas')?.parentElement;
                            if (canvasContainer) {
                                const canvasWrapper = canvasContainer.querySelector('.canvas-container') as HTMLElement;
                                if (canvasWrapper) {
                                    canvasWrapper.style.width = `${canvas.getWidth()}px`;
                                    canvasWrapper.style.height = `${canvas.getHeight()}px`;
                                }
                            }
                            canvas.requestRenderAll();
                        });
                        canvas.discardActiveObject();
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
                cropData: isCropped ? cropData : null,
                originalImageDimensions: originalImageDimensions.width > 0 ? originalImageDimensions : null,
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

    function updateZoom(zoom: number) {
        const canvas = getCanvasSafe();
        if (!canvas) return;
        
        // Set the new zoom level
        canvas.setZoom(zoom);
        
        // Update canvas dimensions to match zoom
        const canvasWidth = canvas.getWidth();
        const canvasHeight = canvas.getHeight();
            
        // Set the viewport transform to ensure proper rendering
        canvas.setViewportTransform([zoom, 0, 0, zoom, 0, 0]);
        
        // Update canvas wrapper size to accommodate zoomed content
        const canvasContainer = editorEl.querySelector('.lower-canvas')?.parentElement;
        if (canvasContainer) {
            const canvasWrapper = canvasContainer.querySelector('.canvas-container') as HTMLElement;
            if (canvasWrapper) {
                canvasWrapper.style.width = `${canvasWidth * zoom}px`;
                canvasWrapper.style.height = `${canvasHeight * zoom}px`;
            }
        }
        
        // Add zoom indicator
        let zoomIndicator = editorEl.querySelector('.zoom-indicator') as HTMLElement;
        if (!zoomIndicator) {
            zoomIndicator = document.createElement('div');
            zoomIndicator.className = 'zoom-indicator';
            editorEl.appendChild(zoomIndicator);
        }
        zoomIndicator.textContent = `${Math.round(zoom * 100)}%`;
        zoomIndicator.style.display = 'block';
        
        // Hide indicator after 1.5 seconds
        clearTimeout((zoomIndicator as any)._hideTimer);
        (zoomIndicator as any)._hideTimer = setTimeout(() => {
            zoomIndicator.style.display = 'none';
        }, 1500);
        
        canvas.renderAll();
    }

    function resetZoom() {
        updateZoom(1.0);
    }

    function enterCropMode(forceDraw = false) {
        if (!imageEditor) return;
        const canvas = getCanvasSafe();
        if (!canvas) return;
        
        // Stop any active drawing mode in TUI
        try {
            imageEditor.stopDrawingMode();
        } catch (e) {
            console.warn('Failed to stop drawing mode:', e);
        }
        
        cropMode = true;
        
        // Deselect all objects
        canvas.discardActiveObject();
        
        // Get current canvas dimensions (which might be the cropped size)
        let canvasWidth = canvas.getWidth();
        let canvasHeight = canvas.getHeight();
        
        // Store original image dimensions if not already stored
        if (originalImageDimensions.width === 0) {
            originalImageDimensions = { width: canvasWidth, height: canvasHeight };
        }
        
        // If this image is currently in a cropped state, we need to restore the full view
        if (isCropped && cropData) {
            // Restore original canvas size
            canvas.setWidth(originalImageDimensions.width);
            canvas.setHeight(originalImageDimensions.height);
            
            // Adjust all objects' positions back to original coordinates
            const objects = canvas.getObjects(); 
            objects.forEach((obj: any) => {
                // Skip if obj is somehow the crop rect (shouldn't happen here but safe guard)
                if(obj._isCropRect) return;
                
                obj.left = (obj.left || 0) + cropData.left;
                obj.top = (obj.top || 0) + cropData.top;
                obj.setCoords();
            });
            
            // Fix: Also move background image if it exists
            if (canvas.backgroundImage) {
                const bg = canvas.backgroundImage;
                bg.left = (bg.left || 0) + cropData.left;
                bg.top = (bg.top || 0) + cropData.top;
                bg.setCoords();
            }
            
            // Update wrapper size to match restored canvas
            const canvasContainer = editorEl.querySelector('.lower-canvas')?.parentElement;
            if (canvasContainer) {
                const canvasWrapper = canvasContainer.querySelector('.canvas-container') as HTMLElement;
                if (canvasWrapper) {
                    canvasWrapper.style.width = `${originalImageDimensions.width}px`;
                    canvasWrapper.style.height = `${originalImageDimensions.height}px`;
                }
            }
            
            canvasWidth = originalImageDimensions.width;
            canvasHeight = originalImageDimensions.height;
        }
        
        // Disable selection of existing objects during crop mode
        const objects = canvas.getObjects();
        objects.forEach((obj: any) => {
            obj.selectable = false;
            obj.evented = false;
        });
        
        // If image has been cropped before, show the previous crop rectangle
        if (cropData && !forceDraw) {
            // Create crop rectangle with previous crop area
            cropRect = new (window as any).fabric.Rect({
                type: 'custom-crop-rect', // Avoid TUI shape detection
                left: cropData.left,
                top: cropData.top,
                width: cropData.width,
                height: cropData.height,
                fill: 'rgba(0, 0, 0, 0.3)',
                stroke: '#00ff00',
                strokeWidth: 2,
                strokeDashArray: [5, 5],
                selectable: true,
                evented: true,
                hasControls: true,
                hasBorders: true,
                lockRotation: true,
                cornerColor: '#00ff00',
                cornerSize: 10,
                transparentCorners: false,
            });
            (cropRect as any)._isCropRect = true;
            canvas.add(cropRect);
            canvas.setActiveObject(cropRect);
            canvas.requestRenderAll();
            
            pushMsg('调整裁剪区域，按 Enter 确认，按 Esc 取消，按 Delete 删除并重新绘制');
            return; // Don't set up drawing mode
        }
        
        // For new images without previous crop, enable drawing mode
        let isDrawing = false;
        let startX = 0;
        let startY = 0;
        
        const onMouseDown = (e: any) => {
            if (cropRect) return; // Already have a crop rectangle
            
            const pointer = canvas.getPointer(e.e);
            isDrawing = true;
            startX = pointer.x;
            startY = pointer.y;
            
            // Create initial crop rectangle
            cropRect = new (window as any).fabric.Rect({
                type: 'custom-crop-rect', // Avoid TUI shape detection
                left: startX,
                top: startY,
                width: 0,
                height: 0,
                fill: 'rgba(0, 0, 0, 0.3)',
                stroke: '#00ff00',
                strokeWidth: 2,
                strokeDashArray: [5, 5],
                selectable: false,
                evented: false,
                lockRotation: true,
            });
            (cropRect as any)._isCropRect = true;
            canvas.add(cropRect);
        };
        
        const onMouseMove = (e: any) => {
            if (!isDrawing || !cropRect) return;
            
            const pointer = canvas.getPointer(e.e);
            const width = pointer.x - startX;
            const height = pointer.y - startY;
            
            // Handle negative dimensions (dragging in reverse direction)
            if (width < 0) {
                cropRect.set({ left: pointer.x });
                cropRect.set({ width: Math.abs(width) });
            } else {
                cropRect.set({ width: width });
            }
            
            if (height < 0) {
                cropRect.set({ top: pointer.y });
                cropRect.set({ height: Math.abs(height) });
            } else {
                cropRect.set({ height: height });
            }
            
            canvas.requestRenderAll();
        };
        
        const onMouseUp = (e: any) => {
            if (!isDrawing) return;
            isDrawing = false;
            
            if (cropRect) {
                // If the rectangle is too small, remove it but let user try again
                const minSize = 10;
                if ((cropRect.width || 0) < minSize || (cropRect.height || 0) < minSize) {
                    canvas.remove(cropRect);
                    cropRect = null;
                    pushMsg('裁剪区域太小，请重新绘制');
                    return;
                } 
                
                // Auto Apply Crop on Mouse Up
                exitCropMode(true);
                
                // Update UI button state directly since we exited programmatically
                const cropBtn = editorEl.querySelector('.custom-crop-btn');
                if (cropBtn) cropBtn.classList.remove('crop-active');
            }
        };
        
        // Attach event listeners
        canvas.on('mouse:down', onMouseDown);
        canvas.on('mouse:move', onMouseMove);
        canvas.on('mouse:up', onMouseUp);
        
        // Store event handlers for cleanup
        (canvas as any)._cropModeHandlers = {
            onMouseDown,
            onMouseMove,
            onMouseUp
        };
        
        canvas.requestRenderAll();
        
        // Show crop instructions
        pushMsg('拖动鼠标绘制裁剪区域，松开鼠标自动裁剪');
    }

    function exitCropMode(apply: boolean = false) {
        const canvas = getCanvasSafe();
        if (!canvas) {
            cropMode = false;
            return;
        }
        
        // Clean up event listeners if they exist
        if ((canvas as any)._cropModeHandlers) {
            const handlers = (canvas as any)._cropModeHandlers;
            canvas.off('mouse:down', handlers.onMouseDown);
            canvas.off('mouse:move', handlers.onMouseMove);
            canvas.off('mouse:up', handlers.onMouseUp);
            delete (canvas as any)._cropModeHandlers;
        }
        
        // Restore selectability of all objects
        const objects = canvas.getObjects();
        objects.forEach((obj: any) => {
            if (!obj._isCropRect) {
                obj.selectable = true;
                obj.evented = true;
            }
        });
        
        if (apply && cropRect) {
            applyCrop();
        } else {
            if (cropRect) {
                // Remove the crop rectangle
                canvas.remove(cropRect);
            }
            
            // If we were in a cropped state before (and didn't apply a new one), 
            // we need to restore the PREVIOUS crop view (re-crop effectively)
            if (isCropped && cropData) {
                // Restore cropped canvas size
                canvas.setWidth(cropData.width);
                canvas.setHeight(cropData.height);

                // Adjust all objects' positions back to cropped coordinates (shift negative)
                const objects = canvas.getObjects();
                objects.forEach((obj: any) => {
                    obj.left = (obj.left || 0) - cropData.left;
                    obj.top = (obj.top || 0) - cropData.top;
                    obj.setCoords();
                });
                
                // Fix: Also move background image back
                if (canvas.backgroundImage) {
                    const bg = canvas.backgroundImage;
                    bg.left = (bg.left || 0) - cropData.left;
                    bg.top = (bg.top || 0) - cropData.top;
                    bg.setCoords();
                }

                // Update wrapper size
                const canvasContainer = editorEl.querySelector('.lower-canvas')?.parentElement;
                if (canvasContainer) {
                    const canvasWrapper = canvasContainer.querySelector('.canvas-container') as HTMLElement;
                    if (canvasWrapper) {
                        canvasWrapper.style.width = `${cropData.width}px`;
                        canvasWrapper.style.height = `${cropData.height}px`;
                    }
                }
            } else {
                // Not cropped previously, just stay at full size
                 // Update wrapper size just in case
                const canvasContainer = editorEl.querySelector('.lower-canvas')?.parentElement;
                if (canvasContainer) {
                    const canvasWrapper = canvasContainer.querySelector('.canvas-container') as HTMLElement;
                    if (canvasWrapper) {
                        canvasWrapper.style.width = `${originalImageDimensions.width}px`;
                        canvasWrapper.style.height = `${originalImageDimensions.height}px`;
                    }
                }
            }
            
            canvas.requestRenderAll();
        }
        
        cropRect = null;
        cropMode = false;
    }

    function applyCrop() {
        const canvas = getCanvasSafe();
        if (!canvas || !cropRect) return;
        
        // Get crop rectangle bounds
        const left = Math.max(0, cropRect.left || 0);
        const top = Math.max(0, cropRect.top || 0);
        const width = Math.min(cropRect.width * (cropRect.scaleX || 1), canvas.getWidth());
        const height = Math.min(cropRect.height * (cropRect.scaleY || 1), canvas.getHeight());
        
        // Remove the crop rectangle FIRST so it is not included in checking
        canvas.remove(cropRect);
        
        // Store crop data for next time
        cropData = { left, top, width, height };
        isCropped = true;
        
        // Adjust all objects' positions relative to crop area
        const objects = canvas.getObjects();
        objects.forEach((obj: any) => {
            obj.left = (obj.left || 0) - left;
            obj.top = (obj.top || 0) - top;
            obj.setCoords();
        });
        
        // Fix: Adjust background image
        if (canvas.backgroundImage) {
            const bg = canvas.backgroundImage;
            bg.left = (bg.left || 0) - left;
            bg.top = (bg.top || 0) - top;
            bg.setCoords();
        }
        
        // Set new canvas dimensions
        canvas.setWidth(width);
        canvas.setHeight(height);
        
        // Fix: Update wrapper size to prevent stretching
        const canvasContainer = editorEl.querySelector('.lower-canvas')?.parentElement;
        if (canvasContainer) {
            const canvasWrapper = canvasContainer.querySelector('.canvas-container') as HTMLElement;
            if (canvasWrapper) {
                canvasWrapper.style.width = `${width}px`;
                canvasWrapper.style.height = `${height}px`;
            }
        }
        
        // Reset viewport to ensure 1:1 view of the new crop
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.requestRenderAll();
        
        // If zoom indicator exists, update it or reset
        updateZoom(1.0);
        
        pushMsg('裁剪已应用');
    }

    function setupCropButton() {
        setTimeout(() => {
            // Find and hide the original crop button
            const originalCropBtn = editorEl.querySelector('.tie-btn-crop');
            if (originalCropBtn) {
                (originalCropBtn as HTMLElement).style.display = 'none';
            }
            
            // Create custom crop button
            const menu = editorEl.querySelector('.tui-image-editor-menu');
            if (!menu) return;
            
            const customCropBtn = document.createElement('li');
            customCropBtn.className = 'tui-image-editor-item normal custom-crop-btn';
            customCropBtn.setAttribute('tooltip', '裁剪');
            customCropBtn.innerHTML = `
                <svg class="svg_ic-menu">
                    <use xlink:href="#ic-crop" class="normal use-default"></use>
                    <use xlink:href="#ic-crop" class="active use-default"></use>
                </svg>
            `;
            customCropBtn.style.cursor = 'pointer';
            
            customCropBtn.addEventListener('click', () => {
                if (cropMode) {
                    // If already in crop mode, exit without applying
                    exitCropMode(false);
                    customCropBtn.classList.remove('crop-active');
                } else {
                    // Enter crop mode
                    enterCropMode();
                    customCropBtn.classList.add('crop-active');
                }
            });
            
            // Insert after the first menu item (or at the beginning)
            const firstItem = menu.querySelector('.tui-image-editor-item');
            if (firstItem) {
                menu.insertBefore(customCropBtn, firstItem);
            } else {
                menu.appendChild(customCropBtn);
            }
        }, 300);
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
            
            // Add keyboard shortcut: ESC to hide submenu or exit crop mode
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (cropMode) {
                        // Exit crop mode without applying
                        exitCropMode(false);
                        // Remove active class from crop button
                        const cropBtn = editorEl.querySelector('.custom-crop-btn');
                        if (cropBtn) cropBtn.classList.remove('crop-active');
                    } else {
                        // Hide submenus
                        const submenus = editorEl.querySelectorAll('.tui-image-editor-submenu');
                        submenus.forEach((submenu: HTMLElement) => {
                            submenu.style.display = 'none';
                        });
                        currentActiveMenu = null;
                    }
                } else if (e.key === 'Enter') {
                    if (cropMode) {
                        // Apply crop
                        exitCropMode(true);
                        // Remove active class from crop button
                        const cropBtn = editorEl.querySelector('.custom-crop-btn');
                        if (cropBtn) cropBtn.classList.remove('crop-active');
                    }
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    if (cropMode && cropRect) {
                        // Remove current crop rectangle to allow redrawing
                        const canvas = getCanvasSafe();
                        if (canvas) {
                            canvas.remove(cropRect);
                            cropRect = null;
                            
                            // Re-enable drawing mode
                            enterCropMode(true);
                            pushMsg('裁剪框已删除，请重新绘制');
                        }
                    }
                }
            }, true); // Use capture to ensure we handle keys before TUI
            
            // Add reset zoom button to the top toolbar
            const helpMenu = editorEl.querySelector('.tui-image-editor-help-menu.top');
            const zoomInBtn = editorEl.querySelector('.tie-btn-zoomIn');
            if (helpMenu && zoomInBtn) {
                // Create reset zoom button
                const resetZoomBtn = document.createElement('li');
                resetZoomBtn.className = 'tie-btn-zoom-reset tui-image-editor-item help enabled';
                resetZoomBtn.setAttribute('tooltip-content', 'Reset Zoom');
                resetZoomBtn.innerHTML = `
                    <svg class="svg_ic-menu" style="width: 24px; height: 24px;">
                        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
                              font-size="12" font-weight="bold" fill="#808080">
                            1:1
                        </text>
                    </svg>
                `;
                resetZoomBtn.style.cursor = 'pointer';
                
                // Add click handler
                resetZoomBtn.addEventListener('click', () => {
                    resetZoom();
                });
                
                // Insert after zoom-in button
                zoomInBtn.parentNode?.insertBefore(resetZoomBtn, zoomInBtn.nextSibling);
            }

            
            // Add mouse wheel zoom functionality
            const canvasContainer = editorEl.querySelector('.lower-canvas')?.parentElement;
            if (canvasContainer) {
                // Enable scrolling for zoomed canvas
                canvasContainer.style.overflow = 'auto';
                canvasContainer.style.position = 'relative';
                
                canvasContainer.addEventListener('wheel', (e: WheelEvent) => {
                    e.preventDefault();
                    
                    const canvas = getCanvasSafe();
                    if (!canvas) return;
                    
                    // Get current zoom level
                    let zoom = canvas.getZoom();
                    
                    // Calculate zoom delta (negative deltaY means zoom in)
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    zoom = Math.min(Math.max(0.1, zoom + delta), 5); // Limit zoom between 0.1x and 5x
                    
                    updateZoom(zoom);
                }, { passive: false });
            }
        }, 300);
    }

    onMount(() => {
        loadImage();
        // Setup toolbar toggle after a delay to ensure UI is ready
        setTimeout(() => {
            setupToolbarToggle();
            setupCropButton();
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
    
    /* Hide the filter button and crop button */
    :global(.tui-image-editor-menu .tie-btn-filter),
    :global(.tui-image-editor-menu .tie-btn-crop){
        display: none !important;
    }
    :global(.tui-image-editor-header-logo){
        display: none !important;
    }
    
    /* Custom crop button active state */
    :global(.tui-image-editor-item.crop-active) {
        background-color: rgba(0, 255, 0, 0.1) !important;
        border: 1px solid #00ff00 !important;
    }
    
    /* Reset zoom button styles */
    :global(.tie-btn-zoom-reset) {
        transition: background-color 0.2s ease;
    }
    
    :global(.tie-btn-zoom-reset:hover) {
        background-color: rgba(0, 0, 0, 0.05) !important;
    }
    
    :global(.tie-btn-zoom-reset svg text) {
        user-select: none;
    }
    
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
    
    :global(.zoom-indicator[style*="display: none"]) {
        opacity: 0;
    }
</style>
