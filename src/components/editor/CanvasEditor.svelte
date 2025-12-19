<script lang="ts">
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import {
        Canvas,
        Triangle,
        Line,
        Rect,
        Ellipse,
        FabricImage,
        Group,
        util,
        IText,
        Textbox,
        FabricText as Text,
        Point,
        PencilBrush,
        FabricObject,
        Color,
    } from 'fabric';
    import { EraserBrush } from '@erase2d/fabric';
    import MosaicRect from './MosaicRect';
    import Arrow from './Arrow';
    import NumberMarker from './NumberMarker';
    import CropRect from './CropRect';
    import initControls, { createCropControls } from './initControls';
    import initControlsRotate from './initControlsRotate';

    export let dataURL: string | null = null;
    export let fileName: string | undefined;
    export let blobURL: string | null = null;
    export let isCanvasMode = false;
    // active tool state
    let activeTool: string | null = null;
    let activeToolOptions: any = {};
    // shape drawing state
    let isDrawingShape = false;
    let shapeStart = { x: 0, y: 0 };
    let tempShape: any = null;
    // number marker state
    let currentNumber = 1;

    let container: HTMLCanvasElement;
    let canvas: Canvas | null = null;
    const dispatch = createEventDispatcher();
    // Track if image has been loaded to prevent duplicate loads
    let imageLoaded = false;
    // History (undo/redo)
    let history: any[] = [];
    let historyIndex = -1;
    const MAX_HISTORY = 60;
    const HISTORY_PROPS = [
        'selectable',
        'evented',
        '_isArrow',
        'arrowHead',
        'erasable',
        '_isCropRect',
        'count', // for NumberMarker
        'textColor', // for NumberMarker
        'radius', // for NumberMarker
        '_originalSrc',
        '_cropOffset',
        '_isImageBorder',
        '_appliedMargin',
        '_unborderedSrc',
        '_outerRadius',
        '_borderEnabled',
    ];
    // Flag to prevent recursive history updates during undo/redo
    let isHistoryProcessing = false;

    function getActualImage(bg: any = canvas?.backgroundImage) {
        if (!bg) return null;
        if (bg._isBorderGroup) return bg._mainImage;
        if (bg._unborderedImage) return bg._unborderedImage;
        return bg;
    }

    function restoreObjectSelectionStates() {
        if (!canvas) return;
        try {
            canvas.getObjects().forEach((obj: any) => {
                if (
                    obj._isCropRect ||
                    obj._isImageBorder ||
                    obj._isCanvasBoundary ||
                    (canvas && obj === canvas.backgroundImage)
                ) {
                    obj.selectable = false;
                    obj.evented = false;
                } else {
                    obj.selectable = true;
                    obj.evented = true;
                    // Ensure text objects only scale proportionally and have correct effective font size
                    if (['i-text', 'textbox', 'text'].includes(obj.type)) {
                        obj.set('lockUniScaling', true);
                        if (obj.scaleX !== 1 || obj.scaleY !== 1) {
                            const newFontSize = Math.round(obj.fontSize * obj.scaleX);
                            obj.set({
                                fontSize: newFontSize,
                                scaleX: 1,
                                scaleY: 1,
                            });
                            if (obj.type === 'textbox') {
                                obj.set('width', obj.width * obj.scaleX);
                            }
                        }
                    }
                }
                obj.setCoords();
            });
            if (canvas.backgroundImage) {
                canvas.backgroundImage.setCoords();
            }
        } catch (e) {
            console.warn('CanvasEditor: restoreObjectSelectionStates failed', e);
        }
    }

    // Panning
    let isSpaceDown = false;
    let isDragging = false;
    let lastPosX = 0;
    let lastPosY = 0;

    // Keyboard handlers (declared in outer scope so we can remove listeners on destroy)
    let onDocKeyDown: ((e: KeyboardEvent) => void) | null = null;
    let onDocKeyUp: ((e: KeyboardEvent) => void) | null = null;

    // Helpers for color + opacity handling
    function hexToRgb(hex: string) {
        const h = hex.replace('#', '');
        if (h.length === 3) {
            const r = parseInt(h[0] + h[0], 16);
            const g = parseInt(h[1] + h[1], 16);
            const b = parseInt(h[2] + h[2], 16);
            return { r, g, b };
        }
        if (h.length === 6) {
            const r = parseInt(h.substring(0, 2), 16);
            const g = parseInt(h.substring(2, 4), 16);
            const b = parseInt(h.substring(4, 6), 16);
            return { r, g, b };
        }
        return null;
    }

    function colorWithOpacity(color: string | null | undefined, opacity: number | undefined) {
        if (!color) return null;
        // if opacity is undefined, return color as-is
        if (typeof opacity === 'undefined') return color;
        const c = color.trim();
        if (c.startsWith('rgba')) {
            // replace alpha
            return c.replace(
                /rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/,
                (_m, r, g, b) => `rgba(${r.trim()},${g.trim()},${b.trim()},${opacity})`
            );
        }
        if (c.startsWith('rgb(')) {
            const body = c.slice(4, -1);
            return `rgba(${body},${opacity})`;
        }
        if (c.startsWith('#')) {
            const rgb = hexToRgb(c);
            if (!rgb) return color;
            return `rgba(${rgb.r},${rgb.g},${rgb.b},${opacity})`;
        }
        // unknown format: just return color (no opacity applied)
        return color;
    }

    // history helpers (lifted out so other functions can call)
    function notifyHistoryUpdate() {
        try {
            dispatch('historyUpdate', { index: historyIndex, length: history.length });
        } catch (e) {}
    }

    function pushHistory() {
        try {
            if (!canvas) return;
            // Use the same logic as toJSON to include background metadata
            let json = (canvas as any).toJSON(HISTORY_PROPS);
            if (canvas.backgroundImage && json.backgroundImage) {
                const bg = canvas.backgroundImage as any;
                const actual = getActualImage(bg);
                json.backgroundImage._originalSrc = actual?._originalSrc || bg._originalSrc;
                json.backgroundImage._cropOffset = actual?._cropOffset || bg._cropOffset;
            }

            // If recent changes are rapid modifications, merge them into the last step
            const now = Date.now();
            const MERGE_THRESHOLD = 800; // ms
            if (
                lastActionType === 'modified' &&
                lastPushTime > 0 &&
                now - lastPushTime < MERGE_THRESHOLD &&
                historyIndex === history.length - 1 &&
                historyIndex >= 0
            ) {
                // replace last history snapshot
                history[historyIndex] = json;
            } else {
                // Truncate future history when pushing new state
                if (historyIndex < history.length - 1) {
                    history = history.slice(0, historyIndex + 1);
                }
                history.push(json);
                if (history.length > MAX_HISTORY) {
                    history.shift();
                }
                historyIndex = history.length - 1;
            }
            lastPushTime = now;
            lastActionType = pendingActionType || null;
            notifyHistoryUpdate();
        } catch (e) {
            console.warn('CanvasEditor: pushHistory failed', e);
        }
    }

    // pending action type to inform merging logic
    let pendingActionType: string | null = null;
    let lastActionType: string | null = null;
    let lastPushTime = 0;
    let onDocKeyShortcuts: ((e: KeyboardEvent) => void) | null = null;

    const schedulePushWithType = (type: string) => {
        if (isHistoryProcessing) return; // Skip if we are currently undoing/redoing
        if (cropMode) return; // ignore intermediate steps during cropping
        pendingActionType = type;
        clearTimeout((schedulePushWithType as any)._t);
        (schedulePushWithType as any)._t = setTimeout(() => {
            // call pushHistory; it will consult pendingActionType/lastActionType
            pushHistory();
            pendingActionType = null;
        }, 200);
    };

    // Clipboard for copy/paste
    let clipboard: any[] = [];
    async function copySelectedObjects() {
        try {
            if (!canvas) return;
            const objs = (canvas.getActiveObjects && canvas.getActiveObjects()) || [];
            if (!objs || objs.length === 0) return;

            // Allow copy of various drawable objects
            const allowed = objs.filter((o: any) =>
                [
                    'rect',
                    'ellipse',
                    'circle',
                    'path',
                    'group',
                    'i-text',
                    'textbox',
                    'text',
                    'line',
                    'triangle',
                    'arrow',
                    'number-marker',
                ].includes(o.type)
            );

            if (allowed.length === 0) return;

            // Include custom properties like _isArrow to ensure arrows remain editable after paste
            // Map each object to its serialized version
            clipboard = allowed.map((o: any) =>
                o.toObject([
                    'selectable',
                    'evented',
                    'erasable',
                    '_isArrow',
                    'arrowHead',
                    'count',
                    'textColor',
                    'radius',
                ])
            );

            // Write to system clipboard to mark that we have canvas shapes
            // This allows us to detect if the latest clipboard content is shapes or images
            // Use text/plain with a special marker since custom MIME types are not supported
            try {
                const jsonData = JSON.stringify(clipboard);
                const markedData = '__CANVAS_SHAPES__' + jsonData;
                const blob = new Blob([markedData], { type: 'text/plain' });
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/plain': blob,
                    }),
                ]);
            } catch (err) {
                // If clipboard write fails, silently ignore (internal clipboard still works)
                console.warn('CanvasEditor: failed to write shapes to system clipboard', err);
            }

            try {
                dispatch('copied', { count: allowed.length });
            } catch (e) {}
        } catch (e) {}
    }

    function deleteSelectedShapes() {
        try {
            if (!canvas) return;
            const objs = (canvas.getActiveObjects && canvas.getActiveObjects()) || [];
            if (!objs || objs.length === 0) return;
            // Allow deletion of shapes (rect, ellipse, circle) and other drawable objects
            const allowed = objs.filter((o: any) =>
                [
                    'rect',
                    'ellipse',
                    'circle',
                    'path',
                    'group',
                    'line',
                    'triangle',
                    'arrow',
                    'i-text',
                    'textbox',
                    'text',
                    'number-marker',
                ].includes(o.type)
            );
            if (allowed.length === 0) return;

            // Remove each object from canvas
            allowed.forEach((o: any) => {
                try {
                    canvas.remove(o);
                } catch (e) {}
            });

            // Clear selection
            try {
                canvas.discardActiveObject();
            } catch (e) {}

            canvas.requestRenderAll();
            schedulePushWithType('removed');

            try {
                dispatch('deleted', { count: allowed.length });
            } catch (e) {}
        } catch (e) {}
    }

    async function pasteClipboard() {
        try {
            if (!canvas || !clipboard || clipboard.length === 0) return;
            try {
                const enlivened = await util.enlivenObjects(clipboard);
                if (!enlivened || enlivened.length === 0) return;
                const added: any[] = [];
                enlivened.forEach((o: any, index: number) => {
                    // offset pasted objects slightly
                    o.left = (o.left || 0) + 12;
                    o.top = (o.top || 0) + 12;
                    o.selectable = true;
                    o.evented = true;

                    // Restore custom properties from clipboard data
                    const data = clipboard[index];
                    if (data && data._isArrow) {
                        (o as any)._isArrow = true;
                    }
                    if (data && data.erasable !== undefined) {
                        (o as any).erasable = data.erasable;
                    }

                    canvas.add(o);
                    added.push(o);
                });
                if (added.length) {
                    canvas.discardActiveObject();
                    if (added.length === 1) {
                        canvas.setActiveObject(added[0]);
                    } else {
                        const group = new Group(added, {
                            selectable: true,
                            evented: true,
                            erasable: true,
                        });
                        canvas.add(group);
                        canvas.setActiveObject(group);
                    }
                    canvas.requestRenderAll();
                    schedulePushWithType('added');
                }
            } catch (e) {
                console.warn('CanvasEditor: paste failed', e);
            }
        } catch (e) {}
    }

    // Handle paste from keyboard shortcut (Ctrl+V)
    async function handlePaste() {
        try {
            if (!canvas) return;

            // Check system clipboard to determine what to paste
            try {
                const clipboardData = await navigator.clipboard.read();

                let hasShapes = false;
                let hasImage = false;

                // First pass: check what types are available
                for (const item of clipboardData) {
                    // Check if clipboard contains text with our special marker
                    if (item.types.includes('text/plain')) {
                        try {
                            const textBlob = await item.getType('text/plain');
                            const text = await textBlob.text();
                            if (text.startsWith('__CANVAS_SHAPES__')) {
                                hasShapes = true;
                                break;
                            }
                        } catch (e) {
                            // Ignore text read errors
                        }
                    }

                    for (const type of item.types) {
                        if (type.startsWith('image/')) {
                            hasImage = true;
                            break;
                        }
                    }
                    if (hasImage) break;
                }

                // Prioritize shapes if available (user copied shapes in canvas)
                if (hasShapes) {
                    pasteClipboard();
                    return;
                }

                // Otherwise, paste image if available
                if (hasImage) {
                    for (const item of clipboardData) {
                        for (const type of item.types) {
                            if (type.startsWith('image/')) {
                                const blob = await item.getType(type);
                                const url = URL.createObjectURL(blob);
                                addFabricImageFromURL(url);
                                return;
                            }
                        }
                    }
                }
            } catch (err) {
                // If clipboard API fails, fall back to internal clipboard
                console.warn('CanvasEditor: clipboard read failed, using internal clipboard', err);
                if (clipboard && clipboard.length > 0) {
                    pasteClipboard();
                }
            }
        } catch (err) {
            console.warn('CanvasEditor: handlePaste failed', err);
        }
    }

    onMount(() => {
        canvas = new Canvas(container, {
            selection: true,
            preserveObjectStacking: true,
            renderOnAddRemove: true,
        });

        // Initialize custom controls
        initControls(canvas);
        initControlsRotate(canvas);

        canvas.freeDrawingBrush = new PencilBrush(canvas);

        // basic wheel zoom
        canvas.on('mouse:wheel', (opt: any) => {
            const delta = opt.e.deltaY;
            let zoom = canvas!.getZoom();
            zoom *= 0.999 ** delta;
            zoom = Math.max(0.1, Math.min(20, zoom));

            // zoom to mouse pointer
            const point = new Point(opt.e.offsetX, opt.e.offsetY);
            canvas!.zoomToPoint(point, zoom);
            updateZoomDisplay();

            opt.e.preventDefault();
            opt.e.stopPropagation();
        });

        dispatch('ready');

        // Attach basic history listeners (use typed scheduling for merging)
        canvas.on('object:added', () => schedulePushWithType('added'));
        canvas.on('object:modified', (opt: any) => {
            const target = opt.target;
            if (target && ['i-text', 'textbox', 'text'].includes(target.type)) {
                if (target.scaleX !== 1 || target.scaleY !== 1) {
                    const newFontSize = Math.round(target.fontSize * target.scaleX);
                    // Use set to update properties and reset scale
                    target.set({
                        fontSize: newFontSize,
                        scaleX: 1,
                        scaleY: 1,
                    });
                    // For Textbox, we might need to adjust width as well to maintain the visual layout
                    if (target.type === 'textbox') {
                        target.set('width', target.width * target.scaleX);
                    }
                    target.setCoords();

                    // Update tool options so UI stays in sync
                    if (activeTool === 'text') {
                        activeToolOptions.size = newFontSize;
                    }
                    handleSelectionChangeWithType();
                }
            } else if (target && target.type === 'arrow') {
                if (target.scaleX !== 1 || target.scaleY !== 1) {
                    const arrow = target as any;
                    const visualStrokeWidth = Math.round(arrow.getVisualStrokeWidth());
                    // Reset scaling and update coordinates
                    arrow.set({
                        strokeWidth: visualStrokeWidth,
                    });

                    arrow.setCoords();

                    // Update UI
                    handleSelectionChangeWithType();
                }
            }
            schedulePushWithType('modified');
        });
        canvas.on('object:scaling', (opt: any) => {
            const target = opt.target;
            if (target && target.type === 'arrow') {
                handleSelectionChangeWithType();
            }
        });
        canvas.on('object:removed', (opt: any) => {
            schedulePushWithType('removed');
            try {
                const target = opt && opt.target;
                if (target && (target as any)._isCropRect) {
                    // If the crop rect was deleted, exit crop mode to clean up handlers/state
                    exitCropMode();
                }
            } catch (e) {}
        });

        // Handle path creation (for brush)
        canvas.on('path:created', (opt: any) => {
            if (activeTool === 'brush' && opt.path) {
                // Set erasable property so eraser can remove brush strokes
                opt.path.set('erasable', true);
            }
        });

        // key handlers for panning (space)
        onDocKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !isSpaceDown) {
                isSpaceDown = true;
                if (canvas) canvas.defaultCursor = 'grab';
            }
        };
        onDocKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                isSpaceDown = false;
                isDragging = false;
                if (canvas) canvas.defaultCursor = 'default';
            }
        };
        document.addEventListener('keydown', onDocKeyDown as any);
        document.addEventListener('keyup', onDocKeyUp as any);

        // copy/paste keyboard shortcuts (Ctrl/Cmd + C / V) and Delete key
        // attach handler reference so it can be removed on destroy
        (onDocKeyShortcuts as any) = (e: KeyboardEvent) => {
            // ignore when typing in input or textarea
            const el = e.target as HTMLElement | null;
            if (
                el &&
                (el.tagName === 'INPUT' ||
                    el.tagName === 'TEXTAREA' ||
                    (el as any).isContentEditable)
            )
                return;

            // Handle Delete and Backspace keys
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelectedShapes();
                return;
            }

            // Handle Escape key
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (canvas) {
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                }
                return;
            }

            const ctrl = e.ctrlKey || e.metaKey;
            if (!ctrl) return;
            const key = (e.key || '').toLowerCase();
            if (key === 'c') {
                e.preventDefault();
                e.stopPropagation();
                copySelectedObjects();
            } else if (key === 'v') {
                e.preventDefault();
                e.stopPropagation();
                handlePaste(e);
            } else if (key === 'z') {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
            } else if (key === 'y') {
                e.preventDefault();
                e.stopPropagation();
                redo();
            }
        };
        document.addEventListener('keydown', onDocKeyShortcuts);

        // mouse handlers for panning and tools
        canvas.on('mouse:down', opt => {
            if (isSpaceDown || activeTool === 'hand') {
                const e = opt.e as MouseEvent;
                isDragging = true;
                lastPosX = e.clientX;
                lastPosY = e.clientY;
                if (activeTool === 'hand') {
                    canvas.defaultCursor = 'grabbing';
                }
                canvas.selection = false;
                return;
            }

            const pointer = canvas.getPointer(opt.e);

            // If shape tool active, start drawing on mouse down
            if (activeTool === 'shape') {
                // If user clicked on an existing object, allow selection/move instead of starting a new draw
                let hit = opt.target;
                try {
                    if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                        hit = (canvas as any).findTarget(opt.e);
                    }
                } catch (e) {
                    /* ignore */
                }
                if (hit) {
                    try {
                        canvas.setActiveObject(hit);
                        canvas.requestRenderAll();
                    } catch (e) {}
                    return;
                }
                // If no hit and there is an active object, clear selection so new drawing can start
                try {
                    const current = canvas.getActiveObject && canvas.getActiveObject();
                    if (current) {
                        try {
                            canvas.discardActiveObject();
                            canvas.requestRenderAll();
                        } catch (e) {}
                    }
                } catch (e) {}
                isDrawingShape = true;
                shapeStart = { x: pointer.x, y: pointer.y };
                const shapeType = activeToolOptions.shape || 'rect';
                const computedFill = colorWithOpacity(
                    activeToolOptions.fill,
                    typeof activeToolOptions.fillOpacity !== 'undefined'
                        ? activeToolOptions.fillOpacity
                        : activeToolOptions.fill
                          ? 1
                          : 0
                );
                if (shapeType === 'rect') {
                    tempShape = new Rect({
                        left: pointer.x,
                        top: pointer.y,
                        width: 0,
                        height: 0,
                        fill:
                            typeof computedFill !== 'undefined' && computedFill !== null
                                ? computedFill
                                : null,
                        stroke: activeToolOptions.stroke || '#ff0000',
                        strokeWidth: activeToolOptions.strokeWidth || 2,
                        selectable: false,
                        evented: false,
                        hasBorders: false,
                        hasControls: false,
                        erasable: true,
                        strokeUniform: true, // 控制边框是否随大小放大加粗
                    });
                } else {
                    // use ellipse for circle-like drawing
                    tempShape = new Ellipse({
                        left: pointer.x,
                        top: pointer.y,
                        rx: 0,
                        ry: 0,
                        originX: 'left',
                        originY: 'top',
                        fill:
                            typeof computedFill !== 'undefined' && computedFill !== null
                                ? computedFill
                                : null,
                        stroke: activeToolOptions.stroke || '#ff0000',
                        strokeWidth: activeToolOptions.strokeWidth || 2,
                        selectable: false,
                        evented: false,
                        hasBorders: false,
                        hasControls: false,
                        erasable: true,
                    });
                }
                if (tempShape) {
                    canvas.add(tempShape);
                    canvas.requestRenderAll();
                }
                return;
            }
            // Arrow tool: start drawing using custom Arrow class
            if (activeTool === 'arrow') {
                // if clicked on an existing object, select it instead of starting a new arrow
                let hit = opt.target;
                try {
                    if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                        hit = (canvas as any).findTarget(opt.e);
                    }
                } catch (e) {}
                if (hit) {
                    try {
                        canvas.setActiveObject(hit);
                        canvas.requestRenderAll();
                        return;
                    } catch (e) {}
                }

                arrowStart = { x: pointer.x, y: pointer.y };
                // Create temporary arrow using custom Arrow class
                tempArrow = new Arrow([pointer.x, pointer.y, pointer.x, pointer.y], {
                    stroke: activeToolOptions.stroke || '#ff0000',
                    strokeWidth: activeToolOptions.strokeWidth || 4,
                    arrowHead: activeToolOptions.arrowHead || 'right',
                    headStyle: activeToolOptions.headStyle || 'sharp',
                    lineStyle: activeToolOptions.lineStyle || 'solid',
                    thicknessStyle: activeToolOptions.thicknessStyle || 'uniform',
                    selectable: false,
                    evented: false,
                    erasable: true,
                });
                canvas.add(tempArrow);
                canvas.requestRenderAll();
                return;
            }

            // Number marker tool
            if (activeTool === 'number-marker') {
                // if clicked on an existing object, select it instead
                let hit = opt.target;
                try {
                    if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                        hit = (canvas as any).findTarget(opt.e);
                    }
                } catch (e) {}

                if (hit) {
                    try {
                        canvas.setActiveObject(hit);

                        // If we clicked a number marker, update activeTool currentNumber to match (optional ux)
                        // But strictly user request says "edit background and number".
                        // Selection handler will dispatch props.

                        canvas.requestRenderAll();
                    } catch (e) {}
                    return;
                }

                // Create new NumberMarker
                const fill = activeToolOptions.fill || '#ff0000';
                const radius = activeToolOptions.radius || 15;
                // Use counter then increment
                const mk = new NumberMarker({
                    left: pointer.x,
                    top: pointer.y,
                    originX: 'center',
                    originY: 'center',
                    fill: fill,
                    count: currentNumber,
                    textColor: '#ffffff',
                    selectable: true,
                    evented: true,
                    erasable: true,
                    radius: radius,
                });

                canvas.add(mk);
                canvas.setActiveObject(mk);
                canvas.requestRenderAll();

                currentNumber++;
                schedulePushWithType('added');

                // Immediately update tool settings UI to reflect incremented currentNumber
                // Because the new object is selected, we need to re-dispatch the selection event
                // to update 'nextNumber' in the toolbar.
                handleSelectionChangeWithType();
                return;
            }

            // Mosaic tool: start drawing mosaic rectangle
            if (activeTool === 'mosaic') {
                // if clicked on an existing object, select it instead
                let hit = opt.target;
                try {
                    if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                        hit = (canvas as any).findTarget(opt.e);
                    }
                } catch (e) {}
                if (hit) {
                    try {
                        canvas.setActiveObject(hit);
                        canvas.requestRenderAll();
                        return;
                    } catch (e) {}
                }

                // Start drawing mosaic rectangle
                mosaicStart = { x: pointer.x, y: pointer.y };
                isDrawingMosaic = true;
                tempMosaic = new MosaicRect({
                    left: pointer.x,
                    top: pointer.y,
                    width: 0,
                    height: 0,
                    blockSize: activeToolOptions.blockSize || 15,
                    stroke: 'transparent',
                    strokeWidth: 0,
                    selectable: false,
                    evented: false,
                    erasable: true,
                });
                canvas.add(tempMosaic);
                canvas.requestRenderAll();
                return;
            }

            // Text tool: create or select an editable text object
            if (activeTool === 'text') {
                try {
                    // if clicked on an existing text object, select and enter edit mode instead of creating a new one
                    let hit = opt.target;
                    try {
                        if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                            hit = (canvas as any).findTarget(opt.e);
                        }
                    } catch (e) {
                        /* ignore */
                    }
                    if (hit && ['i-text', 'textbox', 'text'].includes(hit.type)) {
                        try {
                            canvas.setActiveObject(hit);
                            // update activeToolOptions to reflect selected object's properties
                            activeToolOptions.family =
                                (hit as any).fontFamily || activeToolOptions.family;
                            activeToolOptions.size =
                                (hit as any).fontSize || activeToolOptions.size;
                            activeToolOptions.fill =
                                typeof hit.fill !== 'undefined' ? hit.fill : activeToolOptions.fill;
                            activeToolOptions.stroke =
                                typeof hit.stroke !== 'undefined'
                                    ? hit.stroke
                                    : activeToolOptions.stroke;
                            activeToolOptions.strokeWidth =
                                typeof hit.strokeWidth !== 'undefined'
                                    ? hit.strokeWidth
                                    : activeToolOptions.strokeWidth;
                            canvas.requestRenderAll();
                        } catch (e) {
                            console.warn('CanvasEditor: failed to select existing text', e);
                        }
                        return;
                    }

                    // Otherwise create a new text object at pointer
                    const fontFamily =
                        activeToolOptions.family ||
                        activeToolOptions.fontFamily ||
                        'Microsoft Yahei';
                    const fontSize = activeToolOptions.size || activeToolOptions.fontSize || 24;
                    const fill = activeToolOptions.fill || '#000000';
                    const stroke = activeToolOptions.stroke || '#ffffff';
                    const strokeWidth = activeToolOptions.strokeWidth || 0;
                    const fontWeight = activeToolOptions.bold ? 'bold' : 'normal';
                    const fontStyle = activeToolOptions.italic ? 'italic' : 'normal';

                    let itext: any = null;
                    // Try common fabric text classes in order of preference
                    try {
                        itext = new IText('文字', {
                            left: pointer.x,
                            top: pointer.y,
                            fontFamily,
                            fontSize,
                            fill,
                            stroke,
                            strokeWidth,
                            fontWeight,
                            fontStyle,
                            selectable: true,
                            evented: true,
                            erasable: true,
                            lockUniScaling: true,
                        });
                    } catch (e) {
                        console.warn('CanvasEditor: IText creation failed', e);
                        itext = null;
                    }
                    if (!itext) {
                        try {
                            itext = new Textbox('文字', {
                                left: pointer.x,
                                top: pointer.y,
                                fontFamily,
                                fontSize,
                                fill,
                                stroke,
                                strokeWidth,
                                fontWeight,
                                fontStyle,
                                selectable: true,
                                evented: true,
                                erasable: true,
                                lockUniScaling: true,
                            });
                        } catch (e) {
                            console.warn('CanvasEditor: Textbox creation failed', e);
                            itext = null;
                        }
                    }
                    if (!itext) {
                        try {
                            itext = new Text('文字', {
                                left: pointer.x,
                                top: pointer.y,
                                fontFamily,
                                fontSize,
                                fill,
                                stroke,
                                strokeWidth,
                                fontWeight,
                                fontStyle,
                                selectable: true,
                                evented: true,
                                erasable: true,
                                lockUniScaling: true,
                            });
                        } catch (e) {
                            console.error('CanvasEditor: Text creation failed', e);
                            itext = null;
                        }
                    }

                    if (!itext) {
                        try {
                            console.error(
                                'CanvasEditor: failed to create any text object (no available factory)'
                            );
                        } catch (e) {}
                        return;
                    }

                    canvas.add(itext);
                    canvas.setActiveObject(itext);
                    canvas.requestRenderAll();

                    // try to enter editing mode if available (IText/Textbox)
                    try {
                        if (typeof itext.enterEditing === 'function') {
                            itext.enterEditing();
                            itext.selectAll && itext.selectAll();
                        } else if (typeof itext.enterEdit === 'function') {
                            itext.enterEdit();
                        }
                    } catch (e) {
                        console.warn('CanvasEditor: enter editing failed', e);
                    }

                    schedulePushWithType('added');
                } catch (e) {
                    console.error('CanvasEditor: unexpected error while creating text', e);
                }
                return;
            }
        });

        // selection handlers: propagate selection properties
        const handleSelectionChange = () => {
            try {
                const active = canvas?.getActiveObject?.();

                // Ignore canvas boundary rectangle
                if (active && (active as any)._isCanvasBoundary) {
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                    return;
                }

                if (!active) {
                    dispatch('selection', { options: null });
                    return;
                }
                // When shape tool is active, only allow selecting shape objects
                const allowedShapeTypes = ['rect', 'ellipse', 'circle'];
                if (activeTool === 'shape' && !allowedShapeTypes.includes(active.type)) {
                    try {
                        canvas.discardActiveObject();
                        canvas.requestRenderAll();
                    } catch (e) {}
                    dispatch('selection', { options: null });
                    return;
                }

                if (allowedShapeTypes.includes(active.type) || active.type === 'path') {
                    // derive fillOpacity from fill if possible
                    let fp = 1;
                    try {
                        const f = active.fill;
                        if (typeof f === 'string') {
                            const m = f.match(/rgba\([^,]+,[^,]+,[^,]+,([^)]+)\)/);
                            if (m && m[1]) fp = parseFloat(m[1]) || 1;
                            else fp = 1;
                        }
                    } catch (e) {}
                    dispatch('selection', {
                        options: {
                            stroke: active.stroke,
                            strokeWidth: active.strokeWidth,
                            fill: active.fill,
                            fillOpacity: fp,
                        },
                        type: active.type,
                    });
                } else if (['i-text', 'textbox', 'text'].includes(active.type)) {
                    dispatch('selection', {
                        options: {
                            family: (active as any).fontFamily,
                            size: (active as any).fontSize,
                            fill: active.fill,
                        },
                        type: active.type,
                    });
                } else if (active.type === 'number-marker') {
                    // Update currentNumber state to be next to this one?
                    // Or just let user edit properties.
                    // User requirement: "Support modifying background color and number"
                    dispatch('selection', {
                        options: {
                            fill: active.fill,
                            count: (active as any).count,
                        },
                        type: 'number-marker',
                    });
                } else {
                    dispatch('selection', { options: null, type: active.type });
                }
            } catch (e) {}
        };

        canvas.on('selection:created', handleSelectionChange);
        canvas.on('selection:updated', handleSelectionChange);
        canvas.on('selection:cleared', handleSelectionChange);

        // auto switch tool when selecting shapes (emit type info in selection event)
        function handleSelectionChangeWithType() {
            try {
                const active = canvas?.getActiveObject?.();
                // Prevent tool switching when in the middle of a drawing operation
                if (tempArrow && active !== tempArrow) return;
                if (isDrawingMosaic && active !== tempMosaic) return;
                if (isDrawingShape && active !== tempShape) return;

                // Ignore canvas boundary rectangle
                if (active && (active as any)._isCanvasBoundary) {
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                    return;
                }

                if (!active) {
                    dispatch('selection', { options: null, type: null });
                    return;
                }
                const allowedShapeTypes = ['rect', 'ellipse', 'circle'];
                if (allowedShapeTypes.includes(active.type) || active.type === 'path') {
                    // derive fillOpacity from fill if possible
                    let fp = 1;
                    try {
                        const f = active.fill;
                        if (typeof f === 'string') {
                            const m = f.match(/rgba\([^,]+,[^,]+,[^,]+,([^)]+)\)/);
                            if (m && m[1]) fp = parseFloat(m[1]) || 1;
                            else fp = 1;
                        }
                    } catch (e) {}
                    dispatch('selection', {
                        options: {
                            stroke: active.stroke,
                            strokeWidth: active.strokeWidth,
                            fill: active.fill,
                            fillOpacity: fp,
                        },
                        type: active.type,
                    });
                } else if (
                    active.type === 'arrow' ||
                    (active.type === 'line' && (active as any).arrowHead)
                ) {
                    // Custom Arrow class (extends Line with arrowHead property)
                    dispatch('selection', {
                        options: {
                            stroke: active.stroke,
                            strokeWidth: Math.round(
                                typeof (active as any).getVisualStrokeWidth === 'function'
                                    ? (active as any).getVisualStrokeWidth()
                                    : active.strokeWidth || 0
                            ),
                            arrowHead: (active as any).arrowHead,
                            headStyle: (active as any).headStyle,
                            lineStyle: (active as any).lineStyle,
                            thicknessStyle: (active as any).thicknessStyle,
                        },
                        type: 'arrow',
                    });
                } else if (active.type === 'group') {
                    // detect arrow groups (legacy) and forward their style as selection options
                    try {
                        const parts = (active as any).getObjects
                            ? (active as any).getObjects()
                            : [];
                        const line = parts.find((p: any) => p.type === 'line');
                        const triangleParts = parts.filter((p: any) => p.type === 'triangle');
                        if (line && triangleParts.length > 0) {
                            let arrowHead = 'none';
                            if (triangleParts.length === 2) arrowHead = 'both';
                            else if (triangleParts.length === 1) {
                                // determine if it's left or right based on position relative to line direction
                                const tri = triangleParts[0];
                                const dx = line.x2 - line.x1;
                                const dy = line.y2 - line.y1;
                                const hdx = tri.left - line.left;
                                const hdy = tri.top - line.top;
                                const dot = hdx * dx + hdy * dy;
                                arrowHead = dot > 0 ? 'right' : 'left';
                            }
                            dispatch('selection', {
                                options: {
                                    stroke: line.stroke,
                                    strokeWidth: line.strokeWidth,
                                    arrowHead,
                                },
                                type: 'arrow',
                            });
                            return;
                        }
                    } catch (e) {}
                    dispatch('selection', { options: null, type: active.type });
                } else if (['i-text', 'textbox', 'text'].includes(active.type)) {
                    dispatch('selection', {
                        options: {
                            family: (active as any).fontFamily,
                            size: Math.round((active as any).fontSize * (active.scaleX || 1)),
                            fill: active.fill,
                            stroke: active.stroke,
                            strokeWidth: active.strokeWidth,
                            bold: (active as any).fontWeight === 'bold',
                            italic: (active as any).fontStyle === 'italic',
                        },
                        type: active.type,
                    });
                } else if (active.type === 'number-marker') {
                    let fillVal = active.fill;
                    if (typeof fillVal === 'string') {
                        try {
                            fillVal = '#' + new Color(fillVal).toHex();
                        } catch (e) {}
                    }
                    dispatch('selection', {
                        options: {
                            fill: fillVal,
                            count: (active as any).count,
                            radius: (active as any).radius,
                            nextNumber: currentNumber,
                            isSelection: true,
                        },
                        type: 'number-marker',
                    });
                } else if (active.type === 'mosaic-rect') {
                    dispatch('selection', {
                        options: {
                            blockSize: (active as any).blockSize || 15,
                        },
                        type: 'mosaic-rect',
                    });
                }
            } catch (e) {}
        }

        // replace handlers with one that includes type info
        canvas.off && canvas.off('selection:created', handleSelectionChange);
        canvas.off && canvas.off('selection:updated', handleSelectionChange);
        canvas.off && canvas.off('selection:cleared', handleSelectionChange);
        canvas.on('selection:created', handleSelectionChangeWithType);
        canvas.on('selection:updated', handleSelectionChangeWithType);
        canvas.on('selection:cleared', handleSelectionChangeWithType);

        // Real-time font size calculation during scaling
        canvas.on('object:scaling', (opt: any) => {
            const target = opt.target;
            if (target && ['i-text', 'textbox', 'text'].includes(target.type)) {
                // Update size in the tool options for real-time UI feel
                if (activeTool === 'text') {
                    const effectiveSize = Math.round(target.fontSize * target.scaleX);
                    activeToolOptions.size = effectiveSize;
                    // Only dispatch if necessary to avoid flooding
                    dispatch('selection', {
                        options: { ...activeToolOptions, size: effectiveSize },
                        type: target.type,
                    });
                }
            }
        });
        // Enforce fixed crop ratio when resizing crop rect via controls
        canvas.on('object:scaling', (opt: any) => {
            try {
                const obj = opt.target;
                if (!obj) return;
                if (!(obj as any)._isCropRect) return;
                if (!cropRatio) return;

                const ratio = cropRatio.h / cropRatio.w; // height / width
                // current width/height in canvas pixels after scaling
                const curWidth = (obj.width || 0) * (obj.scaleX || 1);
                const desiredHeight = Math.abs(curWidth * ratio);
                const baseHeight = obj.height || 1;
                const newScaleY = desiredHeight / baseHeight;

                // Apply scaleY to enforce ratio
                obj.scaleY = newScaleY;

                // Update coords and re-render
                obj.setCoords && obj.setCoords();
                canvas.requestRenderAll();
            } catch (e) {
                // ignore
            }
        });
        canvas.on('mouse:move', opt => {
            const pointer = canvas.getPointer(opt.e);

            // if we're panning
            if (isDragging) {
                const e = opt.e as MouseEvent;
                const vpt = canvas.viewportTransform;
                if (!vpt) return;
                vpt[4] += e.clientX - lastPosX;
                vpt[5] += e.clientY - lastPosY;
                canvas.requestRenderAll();
                lastPosX = e.clientX;
                lastPosY = e.clientY;
                return;
            }

            // if arrow drawing in progress
            if (tempArrow) {
                const pointer = canvas.getPointer(opt.e);
                let x2 = pointer.x;
                let y2 = pointer.y;

                // If Shift is held, constrain to 45-degree increments
                if ((opt.e as MouseEvent).shiftKey) {
                    const dx = x2 - arrowStart.x;
                    const dy = y2 - arrowStart.y;
                    const angle = Math.atan2(dy, dx);
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    // Round to nearest 45 degrees (π/4 radians)
                    const increment = Math.PI / 4;
                    const snappedAngle = Math.round(angle / increment) * increment;

                    // Calculate new endpoint based on snapped angle
                    x2 = arrowStart.x + distance * Math.cos(snappedAngle);
                    y2 = arrowStart.y + distance * Math.sin(snappedAngle);
                }

                // Update the arrow's endpoint
                tempArrow.set({ x2, y2 });
                tempArrow.setCoords();
                canvas.requestRenderAll();
                return;
            }

            // if mosaic drawing in progress
            if (isDrawingMosaic && tempMosaic) {
                const sx = mosaicStart.x;
                const sy = mosaicStart.y;
                const left = Math.min(sx, pointer.x);
                const top = Math.min(sy, pointer.y);
                const width = Math.abs(pointer.x - sx);
                const height = Math.abs(pointer.y - sy);
                tempMosaic.set({ left, top, width, height });
                tempMosaic.setCoords();
                canvas.requestRenderAll();
                return;
            }

            // if shape drawing in progress, update temp shape
            if (isDrawingShape && tempShape) {
                const sx = shapeStart.x;
                const sy = shapeStart.y;
                const left = Math.min(sx, pointer.x);
                const top = Math.min(sy, pointer.y);
                const width = Math.abs(pointer.x - sx);
                const height = Math.abs(pointer.y - sy);
                if (tempShape.type === 'rect') {
                    tempShape.set({ left, top, width, height });
                } else if (tempShape.type === 'ellipse') {
                    tempShape.set({ left, top, rx: width / 2, ry: height / 2 });
                }
                tempShape.setCoords();
                canvas.requestRenderAll();
                return;
            }
        });
        canvas.on('mouse:up', () => {
            if (isDragging) {
                isDragging = false;
                if (activeTool === 'hand') {
                    canvas.defaultCursor = 'grab';
                }
                canvas.selection = true;
                return;
            }

            // finish arrow
            if (tempArrow) {
                try {
                    // Make arrow selectable and evented
                    tempArrow.set({
                        selectable: true,
                        evented: true,
                    });
                    tempArrow.setCoords();
                    canvas.setActiveObject(tempArrow);
                    canvas.requestRenderAll();
                    schedulePushWithType('added');
                } catch (e) {
                    console.warn('Failed to finalize arrow', e);
                }
                tempArrow = null;
                return;
            }

            // finish mosaic drawing
            if (isDrawingMosaic && tempMosaic) {
                try {
                    const minSize = 10;
                    if (tempMosaic.width < minSize || tempMosaic.height < minSize) {
                        // too small, remove
                        try {
                            canvas.remove(tempMosaic);
                        } catch (e) {}
                        tempMosaic = null;
                        isDrawingMosaic = false;
                        return;
                    }

                    // finalize
                    tempMosaic.set({
                        selectable: true,
                        evented: true,
                        hasControls: true,
                        hasBorders: true,
                    });
                    tempMosaic.setCoords();
                    canvas.setActiveObject(tempMosaic);
                    canvas.requestRenderAll();
                    schedulePushWithType('added');
                } catch (e) {
                    console.warn('Failed to finalize mosaic', e);
                }
                tempMosaic = null;
                isDrawingMosaic = false;
                return;
            }

            // finish shape drawing
            if (isDrawingShape && tempShape) {
                try {
                    const minSize = 6;
                    if (
                        (tempShape.type === 'rect' &&
                            (tempShape.width < minSize || tempShape.height < minSize)) ||
                        (tempShape.type === 'ellipse' &&
                            (tempShape.rx < minSize / 2 || tempShape.ry < minSize / 2))
                    ) {
                        // too small, remove
                        try {
                            canvas.remove(tempShape);
                        } catch (e) {}
                        tempShape = null;
                        isDrawingShape = false;
                        return;
                    }

                    // finalize
                    tempShape.set({
                        selectable: true,
                        evented: true,
                        hasControls: true,
                        hasBorders: true,
                    });
                    tempShape.setCoords();
                    canvas.setActiveObject(tempShape);
                    canvas.requestRenderAll();
                    schedulePushWithType('added');
                } catch (e) {
                    console.warn('Failed to finalize shape', e);
                }
                tempShape = null;
                isDrawingShape = false;
                return;
            }
        });

        // initial push after load
        pushHistory();

        if (dataURL) loadImageFromURL(dataURL, fileName);
        else if (isCanvasMode) loadImageFromURL('', fileName);
    });

    // Reactive statement to load image when dataURL changes (fixes race condition on first load)
    // Only load if image hasn't been loaded yet to prevent clearing canvas on state changes
    $: if (canvas && !imageLoaded) {
        if (dataURL) {
            loadImageFromURL(dataURL, fileName);
        } else if (isCanvasMode) {
            loadImageFromURL('', fileName);
        }
    }

    onDestroy(() => {
        try {
            canvas?.dispose();
        } catch (e) {
            // ignore
        }
        canvas = null;
        // remove document listeners if registered
        try {
            if (onDocKeyDown) document.removeEventListener('keydown', onDocKeyDown as any);
        } catch (e) {}
        try {
            if (onDocKeyUp) document.removeEventListener('keyup', onDocKeyUp as any);
        } catch (e) {}
        try {
            if (onDocKeyShortcuts)
                document.removeEventListener('keydown', onDocKeyShortcuts as any);
        } catch (e) {}
    });

    export function getCanvas() {
        return canvas;
    }

    export function setTool(tool: string | null, options: any = {}) {
        // If we were in crop mode and switching to another tool, exit it properly
        if (cropMode && tool !== 'crop' && tool !== null) {
            exitCropMode();
        }

        activeTool = tool;
        activeToolOptions = options || {};

        if (tool === 'number-marker') {
            if (typeof options.nextNumber !== 'undefined') {
                currentNumber = options.nextNumber;
            } else if (typeof options.count !== 'undefined' && !options.isSelection) {
                currentNumber = options.count;
            }
        }

        // provide sensible defaults for text tool
        if (tool === 'text') {
            activeToolOptions.family =
                activeToolOptions.family || activeToolOptions.fontFamily || 'Microsoft Yahei';
            activeToolOptions.size = activeToolOptions.size || activeToolOptions.fontSize || 24;
            activeToolOptions.fill = activeToolOptions.fill || '#000000';
            activeToolOptions.stroke = activeToolOptions.stroke || '#ffffff';
            activeToolOptions.strokeWidth = activeToolOptions.strokeWidth || 0;
            activeToolOptions.bold = !!activeToolOptions.bold;
            activeToolOptions.italic = !!activeToolOptions.italic;
        }
        if (tool === 'image-border') {
            const opts = {
                fill: options.fill || '#f3f4f6',
                margin: options.margin ?? 40,
                radius: options.radius ?? 12,
                shadowBlur: options.shadowBlur ?? 20,
                shadowColor: options.shadowColor || '#000000',
                shadowOpacity: options.shadowOpacity ?? 0.2,
                ...options,
            };
            activeToolOptions = opts;
            // No await here to keep setTool sync, updateImageBorder handles its own async if needed
            updateImageBorder(opts);
        }
        // update cursor
        if (canvas) {
            if (tool === 'shape') canvas.defaultCursor = 'crosshair';
            else if (tool === 'arrow') canvas.defaultCursor = 'crosshair';
            else if (tool === 'brush') canvas.defaultCursor = 'crosshair';
            else if (tool === 'eraser') canvas.defaultCursor = 'crosshair';
            else if (tool === 'mosaic') canvas.defaultCursor = 'crosshair';
            else if (tool === 'text') canvas.defaultCursor = 'text';
            else if (tool === 'number-marker') canvas.defaultCursor = 'crosshair';
            else if (tool === 'hand') canvas.defaultCursor = 'grab';
            else canvas.defaultCursor = 'default';
        }

        // configure brush mode
        if (canvas) {
            if (tool === 'brush') {
                // Always create a new PencilBrush to ensure clean state when switching from eraser
                canvas.freeDrawingBrush = new PencilBrush(canvas);
                canvas.isDrawingMode = true;
                const brush: any = canvas.freeDrawingBrush;
                if (brush) {
                    brush.width = options.strokeWidth || options.size || 4;
                    brush.color = options.stroke || '#ff0000';
                    try {
                        brush.globalCompositeOperation = 'source-over';
                    } catch (e) {}
                }
            } else if (tool === 'eraser') {
                const eraser = new EraserBrush(canvas);
                eraser.width = options.width || options.strokeWidth || options.size || 10;
                canvas.freeDrawingBrush = eraser;
                canvas.freeDrawingCursor = 'default';
                canvas.isDrawingMode = true;

                eraser.on('end', async (e: any) => {
                    try {
                        e.preventDefault();

                        const targets = e.detail.targets;
                        if (!targets || targets.length === 0) return;

                        // Separate paths from other objects
                        const paths: FabricObject[] = [];
                        const otherObjects: FabricObject[] = [];

                        targets.forEach((target: FabricObject) => {
                            if (target.type === 'path') {
                                paths.push(target);
                            } else {
                                otherObjects.push(target);
                            }
                        });

                        // For paths: use commit to partially erase
                        if (paths.length > 0) {
                            // Commit the erase operation to modify the paths
                            await eraser.commit(e.detail);
                        }

                        // For other objects (shapes, arrows, text): directly remove
                        if (otherObjects.length > 0) {
                            otherObjects.forEach((obj: FabricObject) => {
                                try {
                                    (obj as any).group?.remove(obj) || canvas?.remove(obj);
                                } catch (e) {
                                    console.warn('Error removing object:', e);
                                }
                            });
                        }

                        canvas?.requestRenderAll();
                        schedulePushWithType('modified');
                    } catch (err) {
                        console.error('Error in eraser end handler:', err);
                    }
                });
            } else {
                canvas.isDrawingMode = false;
            }
        }
    }

    // Arrow drawing state
    let tempArrow: any = null;
    let arrowStart = { x: 0, y: 0 };

    // Mosaic drawing state
    let tempMosaic: any = null;
    let mosaicStart = { x: 0, y: 0 };
    let isDrawingMosaic = false;

    // Crop mode state
    let cropMode = false;
    let cropRect: any = null;
    let _cropHandlers: any = null;
    let _cropKeyHandler: ((e: KeyboardEvent) => void) | null = null;
    // crop ratio state: null => free, otherwise {w:number,h:number}
    let cropRatio: { w: number; h: number } | null = null;
    let cropRatioLabel: string = 'none';
    let cropRestoreData: any = null; // To track if we need to undo a restore on cancel

    // Crop helpers (exported)
    export function enterCropMode(restoreCrop?: {
        left: number;
        top: number;
        width: number;
        height: number;
    }) {
        if (!canvas) return;
        if (cropMode && cropRect) return;
        cropMode = true;
        cropRestoreData = null;

        // Ensure no existing cropRect
        if (cropRect) {
            canvas.remove(cropRect);
            cropRect = null;
        }

        // Deselect all objects
        try {
            canvas.discardActiveObject();
        } catch (e) {}

        // Disable selectability for existing objects during crop
        canvas.getObjects().forEach((obj: any) => {
            obj.selectable = false;
            obj.evented = false;
        });

        // If we are re-cropping, restore the full canvas view
        if (restoreCrop && (canvas.backgroundImage as any)?._originalSrc) {
            try {
                const bg = canvas.backgroundImage as any;
                const originalSrc = bg._originalSrc;
                const offset = bg._cropOffset || { x: 0, y: 0 };

                // 1. Reload the original image to reveal full context
                const imgEl = new Image();
                imgEl.src = originalSrc;
                imgEl.onload = () => {
                    if (!canvas) return;
                    const origImg = new FabricImage(imgEl, {
                        selectable: false,
                        evented: false,
                        left: 0,
                        top: 0,
                    });

                    // Keep the metadata
                    (origImg as any)._originalSrc = originalSrc;
                    (origImg as any)._cropOffset = { x: 0, y: 0 }; // Reset offset while viewing original

                    // 2. Shift all objects BACK to their original positions
                    canvas.getObjects().forEach((obj: any) => {
                        if (obj._isCropRect) return;
                        obj.left = (obj.left || 0) + offset.x;
                        obj.top = (obj.top || 0) + offset.y;
                        obj.setCoords();
                    });

                    // 3. Replace background
                    canvas.remove(canvas.backgroundImage as any);
                    canvas.backgroundImage = origImg;

                    // 4. Create and show the crop rectangle at its previous position
                    cropRect = new CropRect({
                        left: offset.x,
                        top: offset.y,
                        width: restoreCrop.width,
                        height: restoreCrop.height,
                        fill: 'rgba(0,0,0,0.25)',
                        stroke: '#00ff00',
                        strokeWidth: 2,
                        strokeDashArray: [5, 5],
                        selectable: true,
                        evented: true,
                        lockRotation: true,
                        hasControls: true,
                        hasBorders: true,
                        transparentCorners: false,
                        cornerColor: 'white',
                        cornerStrokeColor: 'black',
                        cornerSize: 10,
                    });
                    (cropRect as any)._isCropRect = true;

                    // Add custom controls with confirm and delete buttons
                    const cropControls = createCropControls(
                        () => {
                            applyCrop();
                            return true;
                        },
                        () => {
                            if (cropRect && canvas) {
                                canvas.remove(cropRect);
                                cropRect = null;
                                canvas.requestRenderAll();
                            }
                            return true;
                        }
                    );
                    cropRect.setCustomControls(cropControls);

                    canvas.add(cropRect);
                    canvas.setActiveObject(cropRect);

                    fitImageToViewport();
                    canvas.requestRenderAll();
                };

                // Store restore data
                cropRestoreData = {
                    left: offset.x,
                    top: offset.y,
                    finalWidth: restoreCrop.width,
                    finalHeight: restoreCrop.height,
                };
            } catch (e) {
                console.warn('Failed to restore pre-crop view', e);
            }
        }

        let isDrawing = false;
        let startX = 0;
        let startY = 0;

        const onMouseDown = (opt: any) => {
            // If we have an active crop rect and user clicks it, let Fabric handle interaction
            if (cropRect) {
                const target = opt.target;
                if (target === cropRect) return;

                // If in restore mode, do not create new crop rect, only adjust existing
                if (restoreCrop) return;

                // If user clicks outside existing crop rect, remove existing and start new
                if (cropRect.selectable) {
                    canvas.remove(cropRect);
                    cropRect = null;
                }
            }

            if (cropRect) return; // Should allow Fabric to handle drag if exists

            const pointer = canvas.getPointer(opt.e);
            isDrawing = true;
            startX = pointer.x;
            startY = pointer.y;
            cropRect = new CropRect({
                left: startX,
                top: startY,
                width: 0,
                height: 0,
                fill: 'rgba(0,0,0,0.25)',
                stroke: '#00ff00',
                strokeWidth: 2,
                strokeDashArray: [5, 5],
                selectable: false, // Initially false while dragging
                evented: false,
                lockRotation: true,
            });
            (cropRect as any)._isCropRect = true;
            canvas.add(cropRect);
        };

        const onMouseMove = (opt: any) => {
            if (!isDrawing || !cropRect) return;
            const pointer = canvas.getPointer(opt.e);
            let width = pointer.x - startX;
            let height = pointer.y - startY;

            // If a fixed ratio is set, constrain height based on width and ratio
            if (cropRatio) {
                const ratio = cropRatio.h / cropRatio.w; // height / width
                const signH = Math.sign(height) || 1;
                height = Math.abs(width) * ratio * signH;
            }

            if (width < 0) {
                cropRect.set({ left: pointer.x, width: Math.abs(width) });
            } else {
                cropRect.set({ width });
            }
            if (height < 0) {
                cropRect.set({ top: pointer.y, height: Math.abs(height) });
            } else {
                cropRect.set({ height });
            }
            cropRect.setCoords();
            canvas.requestRenderAll();
        };

        const applyCrop = async () => {
            if (!cropRect || !canvas || !canvas.backgroundImage) {
                if (cropRect && canvas) canvas.remove(cropRect);
                return;
            }

            try {
                // 1. Get positions in canvas coordinates
                // We use getBoundingRect to handle any scale/rotation of the crop rect itself
                const boundingRect = cropRect.getBoundingRect();
                const { left, top, width, height } = boundingRect;

                const minSize = 6;
                if (width < minSize || height < minSize) {
                    canvas.remove(cropRect);
                    cropRect = null;
                    return;
                }

                const bg = canvas.backgroundImage as FabricImage;

                // 2. Create a temporary canvas to bake the cropped image
                // This bakes the current transformation (flip, rotate, etc.) into the result
                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = width;
                cropCanvas.height = height;
                const ctx = cropCanvas.getContext('2d');
                if (!ctx) return;

                // Shift context so the crop area is at (0,0) of the temp canvas
                ctx.translate(-left, -top);

                // Temporarily clear any live clipPath or offsets if we are adjusting
                const oldClip = bg.clipPath;

                // Clear clipPath for the bake so we get the full visual content
                // (if we were already clipped, we want to re-clip from the original source)
                bg.set({ clipPath: null });
                bg.render(ctx);
                bg.set({ clipPath: oldClip });

                const dataURL = cropCanvas.toDataURL('image/png');

                // 3. Store metadata for future re-cropping before we replace the image
                const originalSrc = (bg as any)._originalSrc || dataURL; // Initial load sets this
                const prevOffset = (bg as any)._cropOffset || { x: 0, y: 0 };
                const newOffset = {
                    x: prevOffset.x + left,
                    y: prevOffset.y + top,
                };

                // 4. Create the new baked image
                const newImg = new FabricImage(cropCanvas, {
                    left: 0,
                    top: 0,
                    selectable: false,
                    evented: false,
                });

                // Transfer metadata
                (newImg as any)._originalSrc = originalSrc;
                (newImg as any)._cropOffset = newOffset;

                // 5. Shift all other objects to the new local coordinate system
                const shiftX = -left;
                const shiftY = -top;

                canvas.getObjects().forEach((obj: any) => {
                    if (obj === bg || obj === cropRect || obj._isCropRect) return;
                    obj.left = (obj.left || 0) + shiftX;
                    obj.top = (obj.top || 0) + shiftY;
                    obj.setCoords();
                });

                // 6. Cleanup and Switch
                canvas.remove(bg);
                canvas.remove(cropRect);
                canvas.backgroundImage = newImg;

                // Cleanup listeners
                canvas.off('mouse:down', onMouseDown);
                canvas.off('mouse:move', onMouseMove);
                canvas.off('mouse:up', onMouseUp);
                if (_cropKeyHandler) {
                    document.removeEventListener('keydown', _cropKeyHandler as any);
                    _cropKeyHandler = null;
                }
                _cropHandlers = null;

                canvas.discardActiveObject();
                setTool(null);

                cropRestoreData = null;
                cropMode = false;
                cropRect = null;

                canvas.getObjects().forEach((obj: any) => {
                    obj.selectable = true;
                    obj.evented = true;
                });

                canvas.requestRenderAll();
                setTimeout(() => fitImageToViewport(), 50); // Small delay to ensure render

                // Record final crop dimensions to parent
                dispatch('cropApplied', {
                    cropData: { left: newOffset.x, top: newOffset.y, width, height },
                });

                schedulePushWithType('modified');
            } catch (e) {
                console.warn('Failed to apply crop', e);
            }
        };

        const onMouseUp = async () => {
            if (!isDrawing) return;
            isDrawing = false;
            if (!cropRect) return;
            const minSize = 6;
            const width = (cropRect.width || 0) * (cropRect.scaleX || 1);
            const height = (cropRect.height || 0) * (cropRect.scaleY || 1);

            if (width < minSize || height < minSize) {
                try {
                    canvas.remove(cropRect);
                } catch (e) {}
                cropRect = null;
                // If we were drawing a new one and cancelled by making it small,
                // do we exit crop mode? Probably not if we are in "adjust" flow.
                // But for now let's just remove the tiny rect.
                canvas.requestRenderAll();
                return;
            }

            // If NOT in restore/adjust mode, auto-apply immediately on mouse up
            if (!restoreCrop) {
                applyCrop();
                return;
            }

            // Instead of applying immediately, make it editable
            cropRect.set({
                selectable: true,
                evented: true,
                hasControls: true,
                hasBorders: true,
                transparentCorners: false,
                cornerColor: 'white',
                cornerStrokeColor: 'black',
                cornerSize: 10,
                lockRotation: true,
            });

            // Add custom controls with confirm and delete buttons
            const cropControls = createCropControls(
                () => {
                    applyCrop();
                    return true;
                },
                () => {
                    if (cropRect && canvas) {
                        canvas.remove(cropRect);
                        cropRect = null;
                        canvas.requestRenderAll();
                    }
                    return true;
                }
            );
            cropRect.setCustomControls(cropControls);

            cropRect.setCoords();
            canvas.setActiveObject(cropRect);
            canvas.requestRenderAll();

            // Do NOT apply crop here. Wait for Enter.
        };

        // Attach listeners
        canvas.on('mouse:down', onMouseDown);
        canvas.on('mouse:move', onMouseMove);
        canvas.on('mouse:up', onMouseUp);
        _cropHandlers = { onMouseDown, onMouseMove, onMouseUp, applyCrop };

        // keyboard shortcuts for crop
        _cropKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                // finalize
                applyCrop();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (cropRect) {
                    try {
                        canvas.remove(cropRect);
                    } catch (err) {}
                    cropRect = null;
                    canvas.requestRenderAll();
                }
            }
        };
        document.addEventListener('keydown', _cropKeyHandler as any);
    }

    // Set crop ratio helper (label like 'none' or '1:1' or '3:4')
    export function setCropRatio(label: string) {
        cropRatioLabel = label;
        if (!label || label === 'none') {
            cropRatio = null;
            return;
        }
        const parts = label.split(':');
        if (parts.length === 2) {
            const w = parseFloat(parts[0]) || 1;
            const h = parseFloat(parts[1]) || 1;
            cropRatio = { w, h };
        } else {
            cropRatio = null;
        }

        // If there's an existing cropRect, adjust it to the new ratio keeping left/top
        try {
            if (cropRect && cropRatio && canvas) {
                // compute absolute width (considering scale)
                const absW = (cropRect.width || 0) * (cropRect.scaleX || 1);
                const desiredH = Math.abs(absW * (cropRatio.h / cropRatio.w));

                // Preserve left/top origin: reset scales and set explicit width/height
                const left = cropRect.left || 0;
                const top = cropRect.top || 0;

                cropRect.set({
                    left,
                    top,
                    width: Math.max(1, absW),
                    height: Math.max(1, desiredH),
                    scaleX: 1,
                    scaleY: 1,
                });
                cropRect.setCoords && cropRect.setCoords();
                canvas.requestRenderAll();
            }
        } catch (e) {}
    }

    export function exitCropMode() {
        if (!canvas || !cropMode) return;
        // Notify parent that crop mode is finished (cancelled or exited)
        // so it can update the toolbar selection state.
        dispatch('cropCancel');

        // remove handlers
        if (_cropHandlers) {
            try {
                canvas.off('mouse:down', _cropHandlers.onMouseDown);
            } catch (e) {}
            try {
                canvas.off('mouse:move', _cropHandlers.onMouseMove);
            } catch (e) {}
            try {
                canvas.off('mouse:up', _cropHandlers.onMouseUp);
            } catch (e) {}
            _cropHandlers = null;
        }

        // If we exit forcefully without Enter/Escape (e.g. switching tool), we generally assume cancel?
        // Or if there is a rect, should we apply it?
        // Usually switching tools implies cancelling the current modal operation.
        // So we should perform the "Escape" logic (revert restore).

        try {
            if (cropRect) {
                canvas.remove(cropRect);
            }
        } catch (e) {}
        cropRect = null;

        cropRestoreData = null;
        fitImageToViewport();
        cropMode = false;
        try {
            document.removeEventListener('keydown', _cropKeyHandler as any);
        } catch (e) {}
        _cropKeyHandler = null;

        // Ensure the crop tool is deselected in the UI when exiting crop mode
        try {
            setTool(null);
        } catch (e) {}
        dispatch('cropApplied', null);
        canvas.getObjects().forEach((obj: any) => {
            obj.selectable = true;
            obj.evented = true;
        });
        canvas.requestRenderAll();
    }

    // If there's a pending crop rectangle, apply it (used by host before save)
    export function applyPendingCrop() {
        try {
            if (_cropHandlers && typeof _cropHandlers.applyCrop === 'function') {
                _cropHandlers.applyCrop();
            }
        } catch (e) {}
    }

    export async function loadImageFromURL(url: string, name?: string) {
        if (!canvas) return;
        if (!url && isCanvasMode) {
            // Initialize default blank canvas size
            const imgW = 800;
            const imgH = 600;
            canvas.setDimensions({ width: imgW, height: imgH });

            // Set a neutral background color for canvas mode
            canvas.backgroundColor = '#ffffff';

            // Add a boundary rectangle to show canvas bounds
            const boundaryRect = new Rect({
                left: 0,
                top: 0,
                width: imgW,
                height: imgH,
                fill: 'transparent',
                stroke: '#e0e0e0',
                strokeWidth: 2,
                strokeDashArray: [10, 5],
                selectable: false,
                evented: false,
                hoverCursor: 'default',
                excludeFromExport: true,
            });
            (boundaryRect as any)._isCanvasBoundary = true;
            canvas.add(boundaryRect);

            canvas.requestRenderAll();

            imageLoaded = true;
            try {
                pushInitialHistory();
            } catch (e) {}
            return;
        }
        return new Promise<void>((resolve, reject) => {
            try {
                // Use HTMLImageElement to get reliable success/error events (better for data URLs and local blobs)
                const imgEl = new Image();
                imgEl.crossOrigin = 'anonymous';
                imgEl.onload = () => {
                    try {
                        // reset canvas
                        canvas!.clear();
                        const imgW = (imgEl as any).width || 800;
                        const imgH = (imgEl as any).height || 600;

                        // Get the workspace container size
                        const workspace = container.closest('.canvas-editor');
                        const cw = workspace ? workspace.clientWidth : imgW;
                        const ch = workspace ? workspace.clientHeight : imgH;

                        // Set canvas to workspace size (avoids scrollbars)
                        canvas!.setWidth(cw);
                        canvas!.setHeight(ch);

                        const fImg = new FabricImage(imgEl, { selectable: false });
                        fImg.set({ left: 0, top: 0, selectable: false });

                        // Initialize metadata for cropping
                        (fImg as any)._originalSrc = url;
                        (fImg as any)._cropOffset = { x: 0, y: 0 };

                        (canvas as any).backgroundImage = fImg;

                        canvas!.requestRenderAll();

                        dispatch('loaded', { width: imgEl.width, height: imgEl.height, name });
                        imageLoaded = true;
                        // after background image is set, push initial history snapshot
                        try {
                            pushInitialHistory();
                        } catch (e) {}
                        resolve();
                    } catch (e) {
                        console.error(
                            'CanvasEditor: failed to create fabric image from element',
                            e
                        );
                        dispatch('loadError', { message: 'fabric image creation failed' });
                        reject(e);
                    }
                };
                imgEl.onerror = err => {
                    console.error('CanvasEditor: image element failed to load', err, url);
                    // Try fallback: if blobURL provided, try that next
                    if (blobURL && blobURL !== url) {
                        console.warn('CanvasEditor: trying fallback blobURL');
                        imgEl.onerror = null;
                        imgEl.src = blobURL;
                        return;
                    }
                    dispatch('loadError', { message: 'image failed to load', url });
                    reject(new Error('image failed to load'));
                };
                imgEl.src = url;
            } catch (e) {
                console.error('CanvasEditor: unexpected error in loadImageFromURL', e);
                dispatch('loadError', { message: 'unexpected error', error: e });
                reject(e);
            }
        });
    }

    let zoomDisplay = '100%';
    function updateZoomDisplay() {
        if (!canvas) return;
        zoomDisplay = Math.round(canvas.getZoom() * 100) + '%';
    }

    const handleZoom = (delta: number) => {
        if (!canvas) return;
        let zoom = canvas.getZoom();
        zoom *= 1.2 ** delta;
        zoom = Math.max(0.1, Math.min(20, zoom));
        const center = new Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
        canvas.zoomToPoint(center, zoom);
        updateZoomDisplay();
        canvas.requestRenderAll();
    };

    const handleZoom1to1 = () => {
        if (!canvas || !canvas.backgroundImage) return;
        const bg = canvas.backgroundImage;
        const imgW = (bg.width || 0) * (bg.scaleX || 1);
        const imgH = (bg.height || 0) * (bg.scaleY || 1);
        const cw = canvas.getWidth();
        const ch = canvas.getHeight();
        const tx = (cw - imgW) / 2;
        const ty = (ch - imgH) / 2;
        canvas.setViewportTransform([1, 0, 0, 1, tx, ty]);
        updateZoomDisplay();
        canvas.requestRenderAll();
    };

    export function fitImageToViewport() {
        if (!canvas) return;

        const workspace = container.closest('.canvas-editor');
        if (!workspace) return;

        const cw = workspace.clientWidth;
        const ch = workspace.clientHeight;
        const w = canvas.getWidth();
        const h = canvas.getHeight();

        // For canvas mode, always use custom size mode to show the full canvas with boundaries
        // Check if canvas dimensions match workspace (Uncropped / Artboard mode)
        // or if we have a custom size (Cropped / True Resolution mode / Canvas mode)
        const isCustomSize = isCanvasMode || Math.abs(w - cw) > 2 || Math.abs(h - ch) > 2;

        if (isCustomSize) {
            // Custom Size Mode: Use CSS scaling
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            const scale = Math.min(cw / w, ch / h, 1) * 0.98;
            const finalCssW = w * scale;
            const finalCssH = h * scale;
            canvas.setDimensions({ width: finalCssW, height: finalCssH }, { cssOnly: true });

            const containerEl = canvas.getElement().parentNode as HTMLElement;
            if (containerEl && containerEl.classList.contains('canvas-container')) {
                containerEl.style.margin = '0 auto';
                if (finalCssH < ch) {
                    containerEl.style.marginTop = `${(ch - finalCssH) / 2}px`;
                } else {
                    containerEl.style.marginTop = '0px';
                }
            }
            updateZoomDisplay();
            canvas.requestRenderAll();
        } else {
            // Artboard Mode: Zoom the content to fit
            canvas.setDimensions({ width: cw, height: ch });
            canvas.setDimensions({ width: cw, height: ch }, { cssOnly: true });

            const containerEl = canvas.getElement().parentNode as HTMLElement;
            if (containerEl && containerEl.classList.contains('canvas-container')) {
                containerEl.style.margin = '0';
                containerEl.style.marginTop = '0';
            }

            const bg = canvas.backgroundImage;
            if (bg) {
                // Get the actual bounding box of the background image (handles flip and rotate)
                let boundingRect = bg.getBoundingRect();

                const imgW = boundingRect.width;
                const imgH = boundingRect.height;
                const imgCenterX = boundingRect.left + imgW / 2;
                const imgCenterY = boundingRect.top + imgH / 2;

                if (imgW > 0 && imgH > 0) {
                    const scale = Math.min(cw / imgW, ch / imgH, 1) * 0.98;
                    const tx = cw / 2 - imgCenterX * scale;
                    const ty = ch / 2 - imgCenterY * scale;

                    canvas.setViewportTransform([scale, 0, 0, scale, tx, ty]);
                }
            }
            updateZoomDisplay();
            canvas.requestRenderAll();
        }
    }

    async function updateImageBorder(options: any) {
        if (!canvas || !canvas.backgroundImage) return;

        const bg = canvas.backgroundImage as any;

        // 1. Identify/Prepare mainImage (the one without the current border)
        let mainImage: any = bg._unborderedImage;

        // If we don't have the unbordered image in memory (e.g. just loaded or first time)
        if (!mainImage) {
            if (bg._isBorderGroup) {
                mainImage = bg._mainImage;
            } else if (bg._unborderedSrc) {
                // Load from source
                const enlivened = await util.enlivenObjects([
                    {
                        type: 'image',
                        src: bg._unborderedSrc,
                    },
                ]);
                if (enlivened && enlivened[0]) {
                    mainImage = enlivened[0];
                }
            } else if (bg._appliedMargin === undefined) {
                // Current background is the unbordered one
                mainImage = bg;
            }
        }

        if (!mainImage) return;

        const enabled = options.enabled !== false;
        const margin = enabled ? Number(options.margin ?? 40) : 0;
        const radius = Number(options.radius ?? 0);
        const outerRadius = Number(options.outerRadius ?? 0);
        const fill = options.fill ?? '#f3f4f6';
        const shadowBlur = Number(options.shadowBlur ?? 20);
        const shadowColor = options.shadowColor ?? '#000000';
        const shadowOpacity = Number(options.shadowOpacity ?? 0.2);

        if (!enabled) {
            // When disabled, directly use the unbordered image without any border effects
            canvas.backgroundImage = mainImage;
            canvas.requestRenderAll();
            schedulePushWithType('modified');
            return;
        }

        // 2. Create baked image on temp canvas
        // We use the bounding rect of the main image because it might be already cropped or transformed
        const br = mainImage.getBoundingRect();
        const sw = Math.round(br.width);
        const sh = Math.round(br.height);
        const tw = sw + margin * 2;
        const th = sh + margin * 2;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = tw;
        tempCanvas.height = th;
        const ctx = tempCanvas.getContext('2d');
        if (!ctx) return;

        // Draw background
        if (outerRadius > 0) {
            ctx.save();
            ctx.beginPath();
            if ((ctx as any).roundRect) {
                (ctx as any).roundRect(0, 0, tw, th, outerRadius);
            } else {
                ctx.rect(0, 0, tw, th);
            }
            ctx.clip();
            ctx.fillStyle = fill;
            ctx.fillRect(0, 0, tw, th);
            ctx.restore();
        } else {
            ctx.fillStyle = fill;
            ctx.fillRect(0, 0, tw, th);
        }

        // Draw image content with shadow and rounding
        ctx.save();
        ctx.translate(margin, margin);

        // 1. Draw the shadow by filling a rounded rect before clipping
        if (shadowOpacity > 0 && shadowBlur > 0) {
            ctx.save();
            ctx.shadowColor = colorWithOpacity(shadowColor, shadowOpacity) || 'rgba(0,0,0,0.2)';
            ctx.shadowBlur = shadowBlur;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.fillStyle = fill; // Use background color to avoid color bleeding if image has slight transparency

            ctx.beginPath();
            if (radius > 0 && (ctx as any).roundRect) {
                (ctx as any).roundRect(0, 0, sw, sh, radius);
            } else {
                ctx.rect(0, 0, sw, sh);
            }
            ctx.fill();
            ctx.restore();
        }

        // 2. Clip for rounded corners if needed
        if (radius > 0) {
            ctx.beginPath();
            if ((ctx as any).roundRect) {
                (ctx as any).roundRect(0, 0, sw, sh, radius);
            } else {
                ctx.rect(0, 0, sw, sh);
            }
            ctx.clip();
        }

        // 3. Draw the image content
        ctx.translate(-br.left, -br.top);
        mainImage.render(ctx);
        ctx.restore();

        // 3. Update Canvas
        const oldMargin = bg._appliedMargin || 0;
        // If the current background was never baked (no _appliedMargin),
        // its "content" starts at its own bounding rect.
        // If it WAS baked, its content started at oldMargin.
        const globalShiftX = margin - (bg._appliedMargin !== undefined ? oldMargin : br.left);
        const globalShiftY = margin - (bg._appliedMargin !== undefined ? oldMargin : br.top);

        // Shift objects to follow the content
        if (globalShiftX !== 0 || globalShiftY !== 0) {
            canvas.getObjects().forEach((obj: any) => {
                if (obj === bg || obj._isCropRect || obj._isImageBorder) return;
                obj.left = (obj.left || 0) + globalShiftX;
                obj.top = (obj.top || 0) + globalShiftY;
                obj.setCoords();
            });
        }

        const newImg = new FabricImage(tempCanvas, {
            left: 0,
            top: 0,
            selectable: false,
            evented: false,
        });

        // Transfer/Set metadata
        (newImg as any)._originalSrc = mainImage._originalSrc || bg._originalSrc;
        (newImg as any)._cropOffset = mainImage._cropOffset || bg._cropOffset;
        (newImg as any)._unborderedImage = mainImage;
        (newImg as any)._appliedMargin = margin;
        (newImg as any)._unborderedSrc = mainImage.toDataURL
            ? mainImage.toDataURL()
            : mainImage.src;
        (newImg as any)._outerRadius = outerRadius;
        (newImg as any)._borderEnabled = enabled;

        if (!enabled) {
            newImg.set({
                left: br.left,
                top: br.top,
                scaleX: mainImage.scaleX,
                scaleY: mainImage.scaleY,
                angle: mainImage.angle,
                flipX: mainImage.flipX,
                flipY: mainImage.flipY,
            });
            (newImg as any)._appliedMargin = undefined;
        }

        canvas.backgroundImage = newImg;
        canvas.requestRenderAll();

        schedulePushWithType('modified');
    }

    function pushInitialHistory() {
        try {
            if (!canvas) return;
            history = [];
            historyIndex = -1;
            const json = (canvas as any).toJSON(HISTORY_PROPS);
            if (canvas.backgroundImage && json.backgroundImage) {
                const bg = canvas.backgroundImage as any;
                const actual = getActualImage(bg);
                json.backgroundImage._originalSrc = actual?._originalSrc || bg._originalSrc;
                json.backgroundImage._cropOffset = actual?._cropOffset || bg._cropOffset;
            }
            history.push(json);
            historyIndex = 0;
            notifyHistoryUpdate();
        } catch (e) {}
    }

    function createArrowGroup(
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        options: any
    ) {
        const dx = endX - startX;
        const dy = endY - startY;
        const angleRad = Math.atan2(dy, dx);
        const angleDeg = (angleRad * 180) / Math.PI;
        const headH = Math.max(8, (options.strokeWidth || 4) * 2.6);
        const headOffset = headH / 2;

        // Shorten line for arrow heads
        const lineEndX = endX - Math.cos(angleRad) * headOffset;
        const lineEndY = endY - Math.sin(angleRad) * headOffset;
        const lineStartX =
            startX +
            (options.arrowHead === 'left' || options.arrowHead === 'both'
                ? Math.cos(angleRad) * headOffset
                : 0);
        const lineStartY =
            startY +
            (options.arrowHead === 'left' || options.arrowHead === 'both'
                ? Math.sin(angleRad) * headOffset
                : 0);

        const line = new Line([lineStartX, lineStartY, lineEndX, lineEndY], {
            stroke: options.stroke || '#ff0000',
            strokeWidth: options.strokeWidth || 4,
            selectable: false,
            evented: false,
        });

        const fabricAngle = angleDeg + 90;

        const headRight =
            options.arrowHead === 'right' || options.arrowHead === 'both'
                ? new Triangle({
                      left: endX,
                      top: endY,
                      originX: 'center',
                      originY: 'center',
                      width: Math.max(8, (options.strokeWidth || 4) * 2.2),
                      height: headH,
                      angle: fabricAngle,
                      fill: options.stroke || '#ff0000',
                      selectable: false,
                      evented: false,
                  })
                : undefined;

        const headLeft =
            options.arrowHead === 'left' || options.arrowHead === 'both'
                ? new Triangle({
                      left: startX,
                      top: startY,
                      originX: 'center',
                      originY: 'center',
                      width: Math.max(8, (options.strokeWidth || 4) * 2.2),
                      height: headH,
                      angle: fabricAngle + 180,
                      fill: options.stroke || '#ff0000',
                      selectable: false,
                      evented: false,
                  })
                : undefined;

        const parts: any[] = [line];
        if (headLeft) parts.push(headLeft);
        if (headRight) parts.push(headRight);

        const group = new Group(parts, {
            selectable: true,
            evented: true,
        });
        (group as any)._isArrow = true;
        return group;
    }

    export async function undo() {
        if (isHistoryProcessing) return;
        try {
            if (!canvas) return;
            if (historyIndex <= 0) return;

            // Exit crop mode if active before undoing
            if (cropMode) exitCropMode();

            isHistoryProcessing = true;
            historyIndex--;
            const json = history[historyIndex];
            await canvas.loadFromJSON(json);

            // Manually restore metadata to the background image
            if (canvas.backgroundImage && json.backgroundImage) {
                const bg = canvas.backgroundImage as any;
                const actual = getActualImage(bg);
                if (actual) {
                    actual._originalSrc = json.backgroundImage._originalSrc;
                    actual._cropOffset = json.backgroundImage._cropOffset;
                    actual._appliedMargin = json.backgroundImage._appliedMargin;
                    actual._unborderedSrc = json.backgroundImage._unborderedSrc;
                    actual._outerRadius = json.backgroundImage._outerRadius;
                    actual._borderEnabled = json.backgroundImage._borderEnabled;
                }
                bg._originalSrc = json.backgroundImage._originalSrc;
                bg._cropOffset = json.backgroundImage._cropOffset;
                bg._appliedMargin = json.backgroundImage._appliedMargin;
                bg._unborderedSrc = json.backgroundImage._unborderedSrc;
                bg._outerRadius = json.backgroundImage._outerRadius;
                bg._borderEnabled = json.backgroundImage._borderEnabled;
            }

            restoreObjectSelectionStates();
            canvas.renderAll();
            fitImageToViewport();
            notifyHistoryUpdate();
        } catch (e) {
            console.warn('CanvasEditor: undo failed', e);
        } finally {
            isHistoryProcessing = false;
        }
    }

    export async function redo() {
        if (isHistoryProcessing) return;
        try {
            if (!canvas) return;
            if (historyIndex >= history.length - 1) return;

            // Exit crop mode if active before redoing
            if (cropMode) exitCropMode();

            isHistoryProcessing = true;
            historyIndex++;
            const json = history[historyIndex];
            await canvas.loadFromJSON(json);

            // Manually restore metadata to the background image
            if (canvas.backgroundImage && json.backgroundImage) {
                const bg = canvas.backgroundImage as any;
                const actual = getActualImage(bg);
                if (actual) {
                    actual._originalSrc = json.backgroundImage._originalSrc;
                    actual._cropOffset = json.backgroundImage._cropOffset;
                    actual._appliedMargin = json.backgroundImage._appliedMargin;
                    actual._unborderedSrc = json.backgroundImage._unborderedSrc;
                }
                bg._originalSrc = json.backgroundImage._originalSrc;
                bg._cropOffset = json.backgroundImage._cropOffset;
                bg._appliedMargin = json.backgroundImage._appliedMargin;
                bg._unborderedSrc = json.backgroundImage._unborderedSrc;
            }

            restoreObjectSelectionStates();
            canvas.renderAll();
            fitImageToViewport();
            notifyHistoryUpdate();
        } catch (e) {
            console.warn('CanvasEditor: redo failed', e);
        } finally {
            isHistoryProcessing = false;
        }
    }

    export function getCropData() {
        if (!canvas || !canvas.backgroundImage) return null;
        const bg = canvas.backgroundImage as any;
        const actual = getActualImage(bg);
        const offset = actual?._cropOffset || bg._cropOffset;
        // If there's no offset, or offset is at origin (0,0), the image is not cropped
        // _originalSrc existing doesn't mean cropped - it's set on initial load too
        if (!offset || (offset.x === 0 && offset.y === 0)) return null;

        // If offset is 0,0 and current dimensions match uncropped, we might consider it not cropped.
        // But for simplicity, we return the data if it exists.
        return {
            left: offset.x,
            top: offset.y,
            width: (bg.width || 0) * (bg.scaleX || 1),
            height: (bg.height || 0) * (bg.scaleY || 1),
        };
    }

    export function getToolOptions() {
        if (activeTool === 'number-marker') {
            return {
                ...(activeToolOptions || {}),
                radius: activeToolOptions?.radius || 15, // default
                count: currentNumber,
                nextNumber: currentNumber, // If selection active, this value might be overridden by updated logic below to show global next
                isSelection: false,
            };
        }
        return activeToolOptions || {};
    }

    export function applyToolOptionsToSelection(options: any) {
        try {
            if (!canvas) return;
            const objs = canvas.getActiveObjects ? canvas.getActiveObjects() : [];
            if (!objs || objs.length === 0) return;
            objs.forEach((o: any) => {
                try {
                    // Update mosaic rect blockSize
                    if (o.type === 'mosaic-rect') {
                        if (typeof options.blockSize !== 'undefined') {
                            o.set('blockSize', options.blockSize);
                            o.dirty = true;
                        }
                    }

                    // allow editing arrow groups as a single object
                    if (o.type === 'group') {
                        if (!(o as any)._isArrow) return; // not an arrow
                        const parts = typeof o.getObjects === 'function' ? o.getObjects() : [];
                        const ln: any = parts.find((p: any) => p.type === 'line');
                        if (!ln) return;
                        const triangleParts = parts.filter((p: any) => p.type === 'triangle');

                        // Extract current options
                        const currentStroke = ln.stroke;
                        const currentStrokeWidth = ln.strokeWidth;

                        // Determine left and right heads
                        const ldx = ln.x2 - ln.x1;
                        const ldy = ln.y2 - ln.y1;
                        const llen = Math.hypot(ldx, ldy) || 0.01;
                        const ux = ldx / llen;
                        const uy = ldy / llen;

                        let leftHead: any = null;
                        let rightHead: any = null;
                        triangleParts.forEach((h: any) => {
                            const hdx = h.left - (ln.left + (ln.x1 + ln.x2) / 2);
                            const hdy = h.top - (ln.top + (ln.y1 + ln.y2) / 2);
                            const dot = hdx * ldx + hdy * ldy;
                            if (dot > 0) rightHead = h;
                            else leftHead = h;
                        });

                        const currentArrowHead =
                            leftHead && rightHead
                                ? 'both'
                                : rightHead
                                  ? 'right'
                                  : leftHead
                                    ? 'left'
                                    : 'none';

                        // Check if only color change
                        const onlyColorChange =
                            typeof options.stroke !== 'undefined' &&
                            Object.keys(options).length === 1;

                        if (onlyColorChange) {
                            // Update color only
                            ln.set('stroke', options.stroke);
                            triangleParts.forEach((h: any) => h.set('fill', options.stroke));
                        } else {
                            // Recreate the arrow
                            // Calculate tip positions
                            const oldHeadOffset = Math.max(8, currentStrokeWidth * 2.6) / 2;

                            const curRelX1 = ln.left + ln.x1;
                            const curRelY1 = ln.top + ln.y1;
                            const curRelX2 = ln.left + ln.x2;
                            const curRelY2 = ln.top + ln.y2;

                            const tipStartX = curRelX1 - (leftHead ? ux * oldHeadOffset : 0);
                            const tipStartY = curRelY1 - (leftHead ? uy * oldHeadOffset : 0);
                            const tipEndX = curRelX2 + (rightHead ? ux * oldHeadOffset : 0);
                            const tipEndY = curRelY2 + (rightHead ? uy * oldHeadOffset : 0);

                            // Get group center to position new group
                            const groupCenter = o.getCenterPoint();

                            // Remove old group
                            canvas.remove(o);

                            // Create new options
                            const newOptions = {
                                stroke:
                                    options.stroke !== undefined ? options.stroke : currentStroke,
                                strokeWidth:
                                    options.strokeWidth !== undefined
                                        ? options.strokeWidth
                                        : currentStrokeWidth,
                                arrowHead:
                                    options.arrowHead !== undefined
                                        ? options.arrowHead
                                        : currentArrowHead,
                            };

                            // Create new group
                            const newGroup = createArrowGroup(
                                tipStartX,
                                tipStartY,
                                tipEndX,
                                tipEndY,
                                newOptions
                            );

                            // Position the new group at the same center
                            const newCenter = newGroup.getCenterPoint();
                            newGroup.set({
                                left: groupCenter.x - (newCenter.x - newGroup.left),
                                top: groupCenter.y - (newCenter.y - newGroup.top),
                            });

                            canvas.add(newGroup);
                            canvas.setActiveObject(newGroup);
                        }

                        return; // handled
                    }

                    // text objects
                    if (['i-text', 'textbox', 'text'].includes(o.type)) {
                        if (typeof options.family !== 'undefined')
                            o.set('fontFamily', options.family);
                        if (typeof options.size !== 'undefined') o.set('fontSize', +options.size);
                        if (typeof options.fill !== 'undefined') o.set('fill', options.fill);
                        if (typeof options.stroke !== 'undefined') o.set('stroke', options.stroke);
                        if (typeof options.strokeWidth !== 'undefined')
                            o.set('strokeWidth', options.strokeWidth);
                        if (typeof options.bold !== 'undefined')
                            o.set('fontWeight', options.bold ? 'bold' : 'normal');
                        if (typeof options.italic !== 'undefined')
                            o.set('fontStyle', options.italic ? 'italic' : 'normal');
                        o.setCoords && o.setCoords();
                    } else {
                        // shapes and other objects
                        if (typeof options.stroke !== 'undefined') o.set('stroke', options.stroke);
                        if (typeof options.strokeWidth !== 'undefined')
                            o.set('strokeWidth', options.strokeWidth);
                        if (typeof options.fill !== 'undefined') {
                            const newFill = options.fill
                                ? colorWithOpacity(options.fill, options.fillOpacity)
                                : null;
                            o.set('fill', newFill);
                        }
                        // Handle custom Arrow class (extends Line but has arrowHead)
                        if (typeof options.arrowHead !== 'undefined' && 'arrowHead' in o) {
                            o.set('arrowHead', options.arrowHead);
                            // Custom property change doesn't automatically trigger cache invalidation
                            o.dirty = true;
                        }
                        if (typeof options.headStyle !== 'undefined' && 'headStyle' in o) {
                            o.set('headStyle', options.headStyle);
                            o.dirty = true;
                        }
                        if (typeof options.lineStyle !== 'undefined' && 'lineStyle' in o) {
                            o.set('lineStyle', options.lineStyle);
                            o.dirty = true;
                        }
                        if (
                            typeof options.thicknessStyle !== 'undefined' &&
                            'thicknessStyle' in o
                        ) {
                            o.set('thicknessStyle', options.thicknessStyle);
                            o.dirty = true;
                        }
                        // Handle custom NumberMarker class
                        if (o.type === 'number-marker') {
                            if (typeof options.count !== 'undefined') {
                                o.set('count', options.count);
                                o.dirty = true;
                            }
                            if (typeof options.radius !== 'undefined') {
                                o.set('radius', options.radius);
                                o.set('width', options.radius * 2);
                                o.set('height', options.radius * 2);
                                o.dirty = true;
                            }
                        }
                        o.setCoords && o.setCoords();
                    }
                    // Update image border settings if the tool is active
                    if (activeTool === 'image-border') {
                        updateImageBorder(options);
                    }
                } catch (e) {}
            });
            canvas.requestRenderAll();
            // push to history (treat as modification)
            schedulePushWithType('modified');
        } catch (e) {}
    }

    export function toDataURL(
        options: { format?: string; quality?: number } = { format: 'png', quality: 1 }
    ) {
        if (!canvas) return null;

        if (!isCanvasMode && !canvas.backgroundImage) return null;

        const bg = canvas.backgroundImage;

        // Since we now use destructive cropping (baking),
        // the backgroundImage on the canvas always represents the exact visible area.
        // The complicated clipPath logic is no longer needed.

        // Standard export logic follows:

        // 1. Save current state
        const currentVPT = canvas.viewportTransform ? ([...canvas.viewportTransform] as any) : null;
        const currentW = canvas.getWidth();
        const currentH = canvas.getHeight();

        try {
            // 1. Reset scale to 1:1 to measure natural size
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            canvas.renderAll(); // Ensure coords are updated

            let imgW, imgH, tx, ty;

            if (isCanvasMode && !bg) {
                // Export entire canvas area
                imgW = canvas.getWidth();
                imgH = canvas.getHeight();
                tx = 0;
                ty = 0;
            } else {
                // 2. Measure background at 100% scale
                let exportRect = bg.getBoundingRect();

                imgW = exportRect.width;
                imgH = exportRect.height;

                // 4. Align image/border to top-left (0,0) of the export canvas
                tx = -exportRect.left;
                ty = -exportRect.top;
            }

            // 3. Resize canvas to fit full image
            canvas.setDimensions({ width: imgW, height: imgH });

            canvas.setViewportTransform([1, 0, 0, 1, tx, ty]);

            // Temporarily hide boundary rectangle for export
            const boundaryRect = canvas.getObjects().find((o: any) => o._isCanvasBoundary);
            const boundaryWasVisible = boundaryRect?.visible;
            if (boundaryRect) {
                boundaryRect.set('visible', false);
            }

            canvas.renderAll();

            // 5. Export
            const result = canvas.toDataURL({
                format: options.format as any,
                quality: options.quality,
                multiplier: 1,
                enableRetinaScaling: false,
            });

            // Restore boundary visibility
            if (boundaryRect && boundaryWasVisible) {
                boundaryRect.set('visible', true);
            }

            return result;
        } finally {
            // Restore state
            canvas.setDimensions({ width: currentW, height: currentH });
            if (currentVPT) (canvas as any).setViewportTransform(currentVPT);
            canvas.renderAll();
        }
    }

    export function toJSON() {
        if (!canvas) return null;
        // Standard toJSON includes HISTORY_PROPS for top-level objects.
        // We also want to ensure custom metadata on backgroundImage is included.
        const json = (canvas as any).toJSON(HISTORY_PROPS);

        console.log(
            'CanvasEditor: toJSON called, objects count:',
            canvas.getObjects().length,
            'canvas size:',
            canvas.getWidth(),
            'x',
            canvas.getHeight(),
            'isCanvasMode:',
            isCanvasMode
        );

        // For canvas mode, add canvas dimensions and remove backgroundImage to avoid blob URL issues
        if (isCanvasMode) {
            json.width = canvas.getWidth();
            json.height = canvas.getHeight();
            if (json.backgroundImage) {
                console.log('CanvasEditor: Removing backgroundImage for canvas mode');
                delete json.backgroundImage;
            }
        } else if (canvas.backgroundImage && json.backgroundImage) {
            const bg = canvas.backgroundImage as any;
            const actual = getActualImage(bg);
            json.backgroundImage._originalSrc = actual?._originalSrc || bg._originalSrc;
            json.backgroundImage._cropOffset = actual?._cropOffset || bg._cropOffset;
            json.backgroundImage._appliedMargin = bg._appliedMargin;
            json.backgroundImage._unborderedSrc = bg._unborderedSrc;
            json.backgroundImage._outerRadius = bg._outerRadius;
            json.backgroundImage._borderEnabled = bg._borderEnabled;
        }
        return json;
    }

    export async function fromJSON(json: any) {
        if (!canvas) return;

        // Prevent history updates whilst loading JSON
        isHistoryProcessing = true;

        try {
            console.log('CanvasEditor: fromJSON called', json);

            await canvas.loadFromJSON(json);

            // Restore canvas dimensions if they were saved (loadFromJSON should handle this, but ensure it)
            if (json.width && json.height) {
                console.log(
                    'CanvasEditor: Restoring canvas dimensions:',
                    json.width,
                    'x',
                    json.height
                );
                canvas.setDimensions({ width: json.width, height: json.height });
            } else {
                console.log(
                    'CanvasEditor: No dimensions in JSON, current size:',
                    canvas.getWidth(),
                    'x',
                    canvas.getHeight()
                );
            }

            // For canvas mode, add boundary rectangle
            if (isCanvasMode) {
                const w = canvas.getWidth();
                const h = canvas.getHeight();

                // Remove any existing boundary
                const existingBoundary = canvas.getObjects().find((o: any) => o._isCanvasBoundary);
                if (existingBoundary) {
                    canvas.remove(existingBoundary);
                }

                // Add new boundary rectangle
                const boundaryRect = new Rect({
                    left: 0,
                    top: 0,
                    width: w,
                    height: h,
                    fill: 'transparent',
                    stroke: '#e0e0e0',
                    strokeWidth: 2,
                    strokeDashArray: [10, 5],
                    selectable: false,
                    evented: false,
                    hoverCursor: 'default',
                    excludeFromExport: true,
                });
                (boundaryRect as any)._isCanvasBoundary = true;
                canvas.add(boundaryRect);
                canvas.sendObjectToBack(boundaryRect);
            }

            // Manually restore metadata to the background image
            if (canvas.backgroundImage && json.backgroundImage) {
                const bg = canvas.backgroundImage as any;
                const actual = getActualImage(bg);
                if (actual) {
                    actual._originalSrc = json.backgroundImage._originalSrc;
                    actual._cropOffset = json.backgroundImage._cropOffset;
                    actual._appliedMargin = json.backgroundImage._appliedMargin;
                    actual._unborderedSrc = json.backgroundImage._unborderedSrc;
                }
                bg._originalSrc = json.backgroundImage._originalSrc;
                bg._cropOffset = json.backgroundImage._cropOffset;
                bg._appliedMargin = json.backgroundImage._appliedMargin;
                bg._unborderedSrc = json.backgroundImage._unborderedSrc;
            }

            // After loading, ensure all objects (except background) are selectable and evented
            restoreObjectSelectionStates();

            canvas!.renderAll();

            console.log(
                'CanvasEditor: fromJSON completed, objects count:',
                canvas.getObjects().length
            );

            // Automatically fit to viewport after loading JSON
            setTimeout(() => {
                fitImageToViewport();
            }, 100);

            // Reset history to treat this state as initial
            pushInitialHistory();
        } catch (e) {
            console.error('CanvasEditor: fromJSON failed:', e);
            setTimeout(() => {
                fitImageToViewport();
            }, 100);
        } finally {
            isHistoryProcessing = false;
        }
    }

    // Image transforms: flip and rotate (exposed to host)
    export function flipHorizontal() {
        try {
            if (!canvas || !canvas.backgroundImage) return;
            const bg = canvas.backgroundImage;
            const imgW = (bg.width || 0) * (bg.scaleX || 1);

            // Flip background
            bg.set('flipX', !bg.flipX);
            bg.setCoords();

            // Flip all drawable objects relative to image width
            try {
                const objs = canvas.getObjects ? canvas.getObjects() : [];
                objs.forEach((o: any) => {
                    try {
                        if (o._isCropRect || o === bg) return;
                        const c = o.getCenterPoint();
                        const newCenterX = imgW - c.x;
                        o.setPositionByOrigin(new Point(newCenterX, c.y), 'center', 'center');
                        o.set('flipX', !o.flipX);
                        o.setCoords();
                    } catch (e) {}
                });
                canvas.requestRenderAll();
                schedulePushWithType('modified');
                fitImageToViewport();
                try {
                    dispatch('flipped', { dir: 'horizontal' });
                } catch (e) {}
            } catch (e) {}
        } catch (e) {}
    }

    export function flipVertical() {
        try {
            if (!canvas || !canvas.backgroundImage) return;
            const bg = canvas.backgroundImage;
            const imgH = (bg.height || 0) * (bg.scaleY || 1);

            // Flip background
            bg.set('flipY', !bg.flipY);
            bg.setCoords();

            // Flip all drawable objects relative to image height
            try {
                const objs = canvas.getObjects ? canvas.getObjects() : [];
                objs.forEach((o: any) => {
                    try {
                        if (o._isCropRect || o === bg) return;
                        const c = o.getCenterPoint();
                        const newCenterY = imgH - c.y;
                        o.setPositionByOrigin(new Point(c.x, newCenterY), 'center', 'center');
                        o.set('flipY', !o.flipY);
                        o.setCoords();
                    } catch (e) {}
                });
                canvas.requestRenderAll();
                schedulePushWithType('modified');
                fitImageToViewport();
                try {
                    dispatch('flipped', { dir: 'vertical' });
                } catch (e) {}
            } catch (e) {}
        } catch (e) {}
    }

    // Rotate 90 degrees non-destructively
    export async function rotate90(clockwise: boolean = true) {
        try {
            if (!canvas || !canvas.backgroundImage) return;
            const bg = canvas.backgroundImage;

            // Get center point of current background
            const center = bg.getCenterPoint();
            const angleDelta = clockwise ? 90 : -90;

            // 1. Rotate background
            bg.angle = (bg.angle + angleDelta) % 360;
            bg.setCoords();

            // 2. Rotate all drawable objects relative to the same center
            const objs = canvas.getObjects().filter(o => o !== bg && !(o as any)._isCropRect);
            objs.forEach((o: any) => {
                // Coordinate rotation: (x', y') around (cx, cy)
                const p = o.getCenterPoint();
                const dx = p.x - center.x;
                const dy = p.y - center.y;

                let newX, newY;
                if (clockwise) {
                    newX = center.x - dy;
                    newY = center.y + dx;
                } else {
                    newX = center.x + dy;
                    newY = center.y - dx;
                }

                o.setPositionByOrigin(new Point(newX, newY), 'center', 'center');
                o.angle = (o.angle + angleDelta) % 360;
                o.setCoords();
            });

            // 3. Auto fit to show the new orientation
            fitImageToViewport();

            canvas.requestRenderAll();
            schedulePushWithType('modified');
            try {
                dispatch('rotated', { clockwise });
            } catch (e) {}
        } catch (e) {
            console.warn('rotate failed', e);
        }
    }

    // Resize canvas (for canvas mode)
    export function resizeCanvas(width: number, height: number) {
        if (!canvas || !isCanvasMode) return;

        try {
            // Update canvas dimensions
            canvas.setDimensions({ width, height });

            // Update boundary rectangle
            const boundaryRect = canvas.getObjects().find((o: any) => o._isCanvasBoundary);
            if (boundaryRect) {
                boundaryRect.set({ width, height });
                boundaryRect.setCoords();
            }

            // Fit to viewport
            fitImageToViewport();
            canvas.requestRenderAll();
            schedulePushWithType('modified');
        } catch (e) {
            console.error('CanvasEditor: resizeCanvas failed:', e);
        }
    }

    // Help to add a fabric image from a URL/File
    function addFabricImageFromURL(url: string) {
        if (!canvas) return;
        const imgEl = new Image();
        imgEl.onload = () => {
            const fImg = new FabricImage(imgEl, {
                left: 100,
                top: 100,
                selectable: true,
                evented: true,
            });
            // Scale down if too large
            const maxW = canvas!.width! * 0.8;
            const maxH = canvas!.height! * 0.8;
            if (fImg.width! > maxW || fImg.height! > maxH) {
                const scale = Math.min(maxW / fImg.width!, maxH / fImg.height!);
                fImg.scale(scale);
            }

            canvas!.add(fImg);
            canvas!.setActiveObject(fImg);
            canvas!.requestRenderAll();
            schedulePushWithType('added');
        };
        imgEl.src = url;
    }

    // Global paste handler for images and objects
    async function onWindowPaste(e: ClipboardEvent) {
        if (!canvas) return;

        // Stop propagation to prevent Siyuan from receiving the paste event
        e.stopPropagation();
        e.preventDefault();

        // Check if we are in an input or textarea
        const el = e.target as HTMLElement | null;
        if (
            el &&
            (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as any).isContentEditable)
        ) {
            return;
        }

        const items = e.clipboardData?.items;
        if (!items) {
            // If no system clipboard items (or just text/objects), try our internal clipboard
            pasteClipboard();
            return;
        }

        let hasImage = false;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (!blob) continue;
                const url = URL.createObjectURL(blob);
                addFabricImageFromURL(url);
                // We don't revoke immediately because image.onload is async
                // URL.revokeObjectURL(url); // Should be called inside onload if we really care, but blobs are fine for a bit
                hasImage = true;
            }
        }

        if (!hasImage) {
            // If no images found in system clipboard, try internal fabric clipboard
            pasteClipboard();
        }
    }

    // API to upload image
    export function uploadImage() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e: any) => {
            const file = e.target.files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = f => {
                    const data = f.target?.result as string;
                    addFabricImageFromURL(data);
                };
                reader.readAsDataURL(file);
            }
        };
        input.click();
    }

    onMount(() => {
        window.addEventListener('paste', onWindowPaste);
    });

    onDestroy(() => {
        window.removeEventListener('paste', onWindowPaste);
        if (onDocKeyDown) document.removeEventListener('keydown', onDocKeyDown as any);
        if (onDocKeyUp) document.removeEventListener('keyup', onDocKeyUp as any);
        if (onDocKeyShortcuts) document.removeEventListener('keydown', onDocKeyShortcuts);
    });
</script>

<div class="canvas-editor">
    <canvas bind:this={container}></canvas>

    <div class="zoom-controls">
        <div class="zoom-info">{zoomDisplay}</div>
        <button on:click={() => handleZoom(1)} title="放大">+</button>
        <button on:click={() => handleZoom1to1()} title="1:1">1:1</button>
        <button on:click={() => fitImageToViewport()} title="最佳适配">Fit</button>
        <button on:click={() => handleZoom(-1)} title="缩小">-</button>
    </div>
</div>

<style>
    .canvas-editor {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        /* 棋盘格背景配置 */
        --checker-size: 20px; /* 格子大小 */
        --checker-color-1: var(--b3-theme-background); /* 颜色1 */
        --checker-color-2: rgba(from var(--b3-theme-background-light) r g b / 0.1); /* 颜色2 */

        background-image: conic-gradient(
            var(--checker-color-2) 25%,
            var(--checker-color-1) 0 50%,
            var(--checker-color-2) 0 75%,
            var(--checker-color-1) 0
        );
        background-size: var(--checker-size) var(--checker-size);
    }
    canvas {
        display: block;
    }

    .zoom-controls {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        z-index: 100;
        background: rgba(var(--b3-theme-surface-rgb), 0.85);
        backdrop-filter: blur(4px);
        padding: 4px;
        border-radius: 6px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        border: 1px solid var(--b3-theme-surface-lighter);
        user-select: none;
    }

    .zoom-info {
        font-size: 10px;
        text-align: center;
        padding: 2px 0;
        font-family: monospace;
        color: var(--b3-theme-on-surface);
        opacity: 0.8;
    }
    .zoom-controls button {
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--b3-theme-surface-lighter);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        font-size: 13px;
        font-weight: bold;
        border-radius: 4px;
        padding: 0;
        transition: all 0.2s;
    }
    .zoom-controls button:hover {
        background: var(--b3-theme-primary-lightest);
        color: var(--b3-theme-primary);
        border-color: var(--b3-theme-primary-lighter);
    }
    .zoom-controls button:active {
        transform: scale(0.95);
    }
</style>
