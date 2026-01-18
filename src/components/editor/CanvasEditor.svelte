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
        Gradient,
        ActiveSelection,
    } from 'fabric';
    import { EraserBrush } from '@erase2d/fabric';
    import MosaicRect from './custom/MosaicRect';
    import MagnifierRect from './custom/MagnifierRect';
    import MagnifierSourceRect from './custom/MagnifierSourceRect';
    import MagnifierConnectionLine from './custom/MagnifierConnectionLine';
    import Arrow from './custom/Arrow';
    import NumberMarker from './custom/NumberMarker';
    import CropRect from './custom/CropRect';
    import SelectCanvasSizeRect from './custom/SelectCanvasSizeRect';
    import CanvasBackgroundRect from './custom/CanvasBackgroundRect';
    import initControls, {
        createCropControls,
        createSelectCanvasSizeControls,
    } from './custom/initControls';
    import initControlsRotate from './custom/initControlsRotate';
    import { pushErrMsg } from '../../api';
    import { generateId } from '../../utils/uuid';

    export let dataURL: string | null = null;
    export let fileName: string | undefined;
    export let blobURL: string | null = null;
    export let isCanvasMode = false;
    export let initialRect: { x: number; y: number; width: number; height: number } | null = null;
    export let settings: any = {};

    // active tool state
    let activeTool: string | null = null;
    let activeToolOptions: any = {};
    // image crop state
    let isImageCropping = false;
    let targetImageToCrop: any = null;
    let imageCropBackup: any = null;
    // shape drawing state
    let isDrawingShape = false;
    let shapeStart = { x: 0, y: 0 };
    let tempShape: any = null;
    // number marker state
    let currentNumber = 1;
    // magnifier state
    let tempMagnifier: any = null;
    let magnifierStart = { x: 0, y: 0 };
    let isDrawingMagnifier = false;
    // crop/resize states
    // context menu state
    let contextMenu: HTMLDivElement | null = null;
    let contextMenuTarget: any = null;

    export function isDirty() {
        return historyIndex > 0;
    }

    export function getHistoryIndex() {
        return historyIndex;
    }

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
        'fontSize', // for NumberMarker
        '_originalSrc',
        '_cropOffset',
        '_isImageBorder',
        '_appliedMargin',
        '_unborderedSrc',
        '_outerRadius',
        '_borderEnabled',
        '_borderFill',
        '_borderRadius',
        '_borderShadowBlur',
        '_borderShadowColor',
        '_borderShadowOpacity',
        '_isCanvasBackground',
        'lockMovementX',
        'lockMovementY',
        'lockRotation',
        'lockScalingX',
        'lockScalingY',
        'hasControls',
    ];
    // Flag to prevent recursive history updates during undo/redo
    let isHistoryProcessing = false;

    function getActualImage(bg: any = canvas?.backgroundImage) {
        if (!bg) return null;
        if (bg._isBorderGroup) return bg._mainImage;
        if (bg._unborderedImage) return bg._unborderedImage;
        return bg;
    }

    function updateCurrentNumberFromCanvas() {
        if (!canvas) return;
        let maxNum = 0;
        canvas.getObjects().forEach((obj: any) => {
            if (obj.type === 'number-marker' && typeof (obj as any).count === 'number') {
                maxNum = Math.max(maxNum, (obj as any).count);
            }
        });
        currentNumber = maxNum + 1;
    }

    function restoreObjectSelectionStates() {
        if (!canvas) return;
        try {
            canvas.getObjects().forEach((obj: any) => {
                if (
                    obj._isCropRect ||
                    obj._isImageBorder ||
                    obj._isCanvasBackground ||
                    obj.type === 'magnifier-connection-line' ||
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
        if (typeof color !== 'string') return color; // Return as-is if not a string (e.g. Gradient object)
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

    function applyFill(ctx: CanvasRenderingContext2D, fill: any, tw: number, th: number) {
        if (typeof fill === 'string' && fill.startsWith('linear-gradient')) {
            // Very basic parser for linear-gradient(135deg, #color1 0%, #color2 100%)
            const match = fill.match(
                /linear-gradient\((\d+)deg,\s*(#[a-fA-F0-9]{3,6})\s+0%,\s*(#[a-fA-F0-9]{3,6})\s+100%\)/i
            );
            if (match) {
                const angle = parseInt(match[1]);
                const c1 = match[2];
                const c2 = match[3];

                // Convert angle to radians and adjust to CSS standard (0deg = top, 90deg = right)
                // CSS linear-gradient angle starts from top (0deg) and goes clockwise.
                // Canvas createLinearGradient uses (x1, y1) -> (x2, y2).
                const angleRad = ((angle - 90) * Math.PI) / 180;

                // Calculate size to ensure gradient covers the entire area
                const length =
                    Math.abs(tw * Math.cos(angleRad)) + Math.abs(th * Math.sin(angleRad));
                const halfLen = length / 2;
                const midX = tw / 2;
                const midY = th / 2;

                const x1 = midX - Math.cos(angleRad) * halfLen;
                const y1 = midY - Math.sin(angleRad) * halfLen;
                const x2 = midX + Math.cos(angleRad) * halfLen;
                const y2 = midY + Math.sin(angleRad) * halfLen;

                const grad = ctx.createLinearGradient(x1, y1, x2, y2);
                grad.addColorStop(0, c1);
                grad.addColorStop(1, c2);
                ctx.fillStyle = grad;
                return;
            }
        }
        ctx.fillStyle = fill;
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
            // Ensure canvas-mode project dimensions and background fill are saved in history
            if (isCanvasMode) {
                const boundary = canvas.getObjects().find((o: any) => o._isCanvasBackground);
                if (boundary) {
                    json.width = boundary.width;
                    json.height = boundary.height;
                    json.bgFill = boundary.fill;
                } else {
                    json.width = canvas.getWidth();
                    json.height = canvas.getHeight();
                    json.bgFill = json.bgFill || 'transparent';
                }
                if (json.backgroundImage) delete json.backgroundImage;
            }
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
                    'image',
                    'mosaic-rect',
                    'magnifier-rect',
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
                    'fontSize',
                    '_originalSrc',
                    '_cropOffset',
                    'blockSize',
                    'magnification',
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
                    'image',
                    'mosaic-rect',
                    'magnifier-rect',
                    'magnifier-source-rect',
                ].includes(o.type)
            );
            if (allowed.length === 0) return;

            // Remove each object from canvas
            allowed.forEach((o: any) => {
                // Cascading delete for magnifier components
                if (o.type === 'magnifier-rect' && o.sourceId) {
                    const linkedSource = canvas
                        .getObjects()
                        .find((obj: any) => obj.id === o.sourceId);
                    if (linkedSource) canvas.remove(linkedSource);
                    const lines = canvas
                        .getObjects()
                        .filter(
                            (obj: any) =>
                                obj.type === 'magnifier-connection-line' && obj.viewId === o.id
                        );
                    lines.forEach((l: any) => canvas.remove(l));
                } else if (o.type === 'magnifier-source-rect' && o.viewId) {
                    const linkedView = canvas.getObjects().find((obj: any) => obj.id === o.viewId);
                    if (linkedView) canvas.remove(linkedView);
                    const lines = canvas
                        .getObjects()
                        .filter(
                            (obj: any) =>
                                obj.type === 'magnifier-connection-line' && obj.sourceId === o.id
                        );
                    lines.forEach((l: any) => canvas.remove(l));
                }

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
                    if (data && data._originalSrc) {
                        (o as any)._originalSrc = data._originalSrc;
                    }
                    if (data && data._cropOffset) {
                        (o as any)._cropOffset = data._cropOffset;
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

    const onPaste = (e: ClipboardEvent) => {
        // If editing text, allow default paste
        const active = canvas?.getActiveObject();
        if (
            active &&
            ['i-text', 'textbox', 'text'].includes(active.type) &&
            (active as any).isEditing
        ) {
            return;
        }

        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        // check for custom shapes
        const text = clipboardData.getData('text/plain');
        if (text && text.startsWith('__CANVAS_SHAPES__')) {
            // rely on internal clipboard state for shapes
            if (clipboard && clipboard.length > 0) {
                e.preventDefault();
                pasteClipboard();
                return;
            }
        }

        // check for files (from explorer)
        const files = clipboardData.files;
        if (files && files.length > 0) {
            let processed = false;
            for (let i = 0; i < files.length; i++) {
                if (files[i].type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = e => {
                        const result = e.target?.result as string;
                        if (result) addFabricImageFromURL(result);
                    };
                    reader.readAsDataURL(files[i]);
                    processed = true;
                }
            }
            if (processed) {
                e.preventDefault();
                return;
            }
        }

        // check for items (screenshots)
        const items = clipboardData.items;
        if (items && items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                    const blob = items[i].getAsFile();
                    if (blob) {
                        const reader = new FileReader();
                        reader.onload = e => {
                            const result = e.target?.result as string;
                            if (result) addFabricImageFromURL(result);
                        };
                        reader.readAsDataURL(blob);
                        e.preventDefault();
                        return;
                    }
                }
            }
        }
    };

    onMount(() => {
        canvas = new Canvas(container, {
            selectionColor: 'rgba(207, 233, 249,0.1)',
            selectionBorderColor: 'rgba(81, 185, 249,0.5)',
            selection: true,
            preserveObjectStacking: true,
            renderOnAddRemove: true,
            selectionKey: 'ctrlKey',
            backgroundColor: 'transparent',
            fireRightClick: true,
            stopContextMenu: true,
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

        const updateMagnifierConnectionLine = (target: any) => {
            if (!canvas) return;
            // find relevant lines
            const lines = canvas
                .getObjects()
                .filter((o: any) => o.type === 'magnifier-connection-line');
            lines.forEach((line: any) => {
                let shouldUpdate = false;
                if (target.type === 'magnifier-rect' && line.viewId === target.id)
                    shouldUpdate = true;
                else if (target.type === 'magnifier-source-rect' && line.sourceId === target.id)
                    shouldUpdate = true;

                if (shouldUpdate) {
                    const viewObj = canvas.getObjects().find((o: any) => o.id === line.viewId);
                    const sourceObj = canvas.getObjects().find((o: any) => o.id === line.sourceId);
                    if (!viewObj || !sourceObj) return;

                    const sCenter = sourceObj.getCenterPoint();
                    const vCenter = viewObj.getCenterPoint();

                    // Calculate intersection on ViewObj
                    const angleRad = (viewObj.angle || 0) * (Math.PI / 180);
                    const vWidth = viewObj.getScaledWidth();
                    const vHeight = viewObj.getScaledHeight();

                    // Convert source center to local view space
                    const dx = sCenter.x - vCenter.x;
                    const dy = sCenter.y - vCenter.y;
                    const localX = dx * Math.cos(-angleRad) - dy * Math.sin(-angleRad);
                    const localY = dx * Math.sin(-angleRad) + dy * Math.cos(-angleRad);

                    const absLocalX = Math.abs(localX);
                    const absLocalY = Math.abs(localY);
                    const w2 = vWidth / 2;
                    const h2 = vHeight / 2;

                    let intersectX = 0,
                        intersectY = 0;
                    // Prevent updating if source is extremely close to center (avoid jitter)
                    if (absLocalX > 1 || absLocalY > 1) {
                        // Project to border
                        // We want P on boundary such that P is on segment V->S (or S->V).
                        // Ray from V to S passes through P.
                        // P = V + t * (S - V).
                        // In local coords: P_local = t * (localX, localY).
                        // We need P_local to be on boundary.
                        // |x| = w2 or |y| = h2.
                        // t * |localX| = w2 => t = w2 / |localX|
                        // t * |localY| = h2 => t = h2 / |localY|
                        // We take smallest t to hit the first boundary.
                        const scaleX = w2 / (absLocalX || 0.0001);
                        const scaleY = h2 / (absLocalY || 0.0001);
                        const scale = Math.min(scaleX, scaleY);

                        // If scale > 1, S is strictly inside.
                        // If we want line to end at edge regardless, we use limit of 1?
                        // "End point is edge". If S is inside, line should go from S to edge (away)?
                        // Current logic: P is on boundary.
                        // If S inside, P is further away. Line S->P. This is valid.
                        // If S outside, P is closer. Line S->P. This is valid.

                        intersectX = localX * scale;
                        intersectY = localY * scale;
                    }

                    const finalX =
                        vCenter.x +
                        (intersectX * Math.cos(angleRad) - intersectY * Math.sin(angleRad));
                    const finalY =
                        vCenter.y +
                        (intersectX * Math.sin(angleRad) + intersectY * Math.cos(angleRad));

                    line.set({ x1: sCenter.x, y1: sCenter.y, x2: finalX, y2: finalY });
                    line.setCoords();
                }
            });
        };

        // Handle right click for context menu
        canvas.on('mouse:down', (opt: any) => {
            const e = opt.e as MouseEvent;
            const button =
                opt.button || (e.button === 2 ? 3 : e.button === 0 ? 1 : e.button === 1 ? 2 : 0);

            // Close context menu on left click
            if (button === 1 || e.button === 0) {
                hideContextMenu();
                return;
            }

            // Handle right click (button === 3 or e.button === 2)
            if (button === 3 || e.button === 2) {
                const target = opt.target;
                // If single editable target under cursor
                if (target && isEditableObject(target)) {
                    e.preventDefault();
                    e.stopPropagation();
                    showContextMenu(e, target);
                    return false;
                }

                // If no single target but there's an active multi-selection, show menu for selection
                try {
                    const activeObj =
                        canvas && (canvas.getActiveObject ? canvas.getActiveObject() : null);
                    const activeObjs =
                        canvas && (canvas.getActiveObjects ? canvas.getActiveObjects() : []);
                    if (activeObj && activeObjs && activeObjs.length > 1) {
                        e.preventDefault();
                        e.stopPropagation();
                        showContextMenu(e, activeObj);
                        return false;
                    }
                } catch (e) {}
            }
        });

        // Attach basic history listeners (use typed scheduling for merging)
        canvas.on('object:added', (opt: any) => {
            if (opt.target && (opt.target as any)._isCanvasBackground) return;
            schedulePushWithType('added');
        });
        canvas.on('object:modified', (opt: any) => {
            const target = opt.target;
            if (target && (target as any)._isCanvasBackground) return;
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
            } else if (target && target.type === 'number-marker') {
                if (target.scaleX !== 1 || target.scaleY !== 1) {
                    const marker = target as any;
                    const newFontSize = marker.getEffectiveFontSize();
                    const newRadius = newFontSize * 0.8;
                    marker.set({
                        fontSize: newFontSize,
                        width: newRadius * 2,
                        height: newRadius * 2,
                        scaleX: 1,
                        scaleY: 1,
                    });
                    marker.dirty = true;
                    marker.setCoords();

                    // Update tool options so UI stays in sync
                    if (activeTool === 'number-marker') {
                        activeToolOptions.fontSize = newFontSize;
                    }
                    handleSelectionChangeWithType();
                }
            }
            schedulePushWithType('modified');
        });
        canvas.on('object:scaling', (opt: any) => {
            const target = opt.target;
            if (target && (target.type === 'arrow' || target.type === 'image')) {
                handleSelectionChangeWithType();
            }
        });
        canvas.on('object:removed', (opt: any) => {
            const target = opt && opt.target;
            if (target && (target as any)._isCanvasBackground) return;
            schedulePushWithType('removed');
            if (target && target.type === 'number-marker') {
                updateCurrentNumberFromCanvas();
            }
            try {
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
            // Switch cursor to default when holding Ctrl (selection mode shortcut)
            if ((e.key === 'Control' || e.key === 'Meta') && canvas) {
                if (
                    activeTool === 'shape' ||
                    activeTool === 'arrow' ||
                    activeTool === 'number-marker' ||
                    activeTool === 'mosaic' ||
                    activeTool === 'text'
                ) {
                    canvas.defaultCursor = 'default';
                }
            }
        };
        onDocKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                isSpaceDown = false;
                isDragging = false;
                if (canvas) canvas.defaultCursor = 'default';
            }
            // Restore tool cursor when releasing Ctrl
            if ((e.key === 'Control' || e.key === 'Meta') && canvas) {
                if (
                    activeTool === 'shape' ||
                    activeTool === 'arrow' ||
                    activeTool === 'number-marker' ||
                    activeTool === 'mosaic' ||
                    activeTool === 'magnifier'
                ) {
                    canvas.defaultCursor = 'crosshair';
                } else if (activeTool === 'text') {
                    canvas.defaultCursor = 'text';
                }
            }
        };
        document.addEventListener('keydown', onDocKeyDown as any);
        document.addEventListener('keyup', onDocKeyUp as any);

        // copy/paste keyboard shortcuts (Ctrl/Cmd + C / V) and Delete key
        // attach handler reference so it can be removed on destroy
        (onDocKeyShortcuts as any) = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;

            // Handle text editing exit with Escape or Ctrl+Enter
            // This is placed before the input/textarea check as Fabric's host textarea will be focused
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                const active = canvas?.getActiveObject();
                if (
                    active &&
                    ['i-text', 'textbox', 'text'].includes(active.type) &&
                    (active as any).isEditing
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    (active as any).exitEditing();
                    setTool(null);
                    canvas?.requestRenderAll();
                    return;
                }
            }

            // ignore when typing in input or textarea
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
        window.addEventListener('paste', onPaste);

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
                // Quick selection mode: if Ctrl is held, allow standard selection (including multi-select)
                if (opt.e.ctrlKey || opt.e.metaKey) return;

                // If user clicked on an existing object, allow selection/move instead of starting a new draw
                let hit = opt.target;
                try {
                    if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                        hit = (canvas as any).findTarget(opt.e);
                    }
                } catch (e) {
                    /* ignore */
                }
                // Only allow selection if the hit object is a shape type (rect, ellipse, circle)
                const allowedShapeTypes = ['rect', 'ellipse', 'circle'];
                if (hit && allowedShapeTypes.includes(hit.type)) {
                    try {
                        canvas.setActiveObject(hit);
                        canvas.requestRenderAll();
                    } catch (e) {}
                    return;
                }
                // If hit a non-matching object, clear selection and prevent default interaction
                // This prevents moving images or other objects when drawing shapes
                if (hit) {
                    try {
                        canvas.discardActiveObject();
                        canvas.requestRenderAll();
                    } catch (e) {}
                }
                // Clear any active object to ensure new drawing can start
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
                // Quick selection mode: if Ctrl is held, allow standard selection
                if (opt.e.ctrlKey || opt.e.metaKey) return;

                // Only allow selecting arrows, not other shapes
                let hit = opt.target;
                try {
                    if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                        hit = (canvas as any).findTarget(opt.e);
                    }
                } catch (e) {}
                // Only allow selection if the hit object is an arrow
                if (
                    hit &&
                    (hit.type === 'arrow' || (hit.type === 'line' && (hit as any).arrowHead))
                ) {
                    try {
                        canvas.setActiveObject(hit);
                        canvas.requestRenderAll();
                        return;
                    } catch (e) {}
                }
                // If hit a non-arrow object (including images), clear selection and prevent default interaction
                // This prevents moving images or other objects when drawing arrows
                if (hit) {
                    try {
                        canvas.discardActiveObject();
                        canvas.requestRenderAll();
                    } catch (e) {}
                }
                // Clear any active object to ensure new drawing can start
                try {
                    const current = canvas.getActiveObject && canvas.getActiveObject();
                    if (current) {
                        try {
                            canvas.discardActiveObject();
                            canvas.requestRenderAll();
                        } catch (e) {}
                    }
                } catch (e) {}

                arrowStart = { x: pointer.x, y: pointer.y };
                // Create temporary arrow using custom Arrow class
                tempArrow = new Arrow([pointer.x, pointer.y, pointer.x, pointer.y], {
                    stroke: activeToolOptions.stroke || '#ff0000',
                    strokeWidth: activeToolOptions.strokeWidth || 4,
                    arrowHead: activeToolOptions.arrowHead || 'right',
                    headStyle: activeToolOptions.headStyle || 'sharp',
                    anchorStyle: activeToolOptions.anchorStyle || 'curved',
                    lineStyle: activeToolOptions.lineStyle || 'solid',
                    thicknessStyle: activeToolOptions.thicknessStyle || 'uniform',
                    useCustomSelection: true,
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
                if (opt.e.ctrlKey || opt.e.metaKey) return;
                // Only allow selecting number markers, not other shapes
                let hit = opt.target;
                try {
                    if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                        hit = (canvas as any).findTarget(opt.e);
                    }
                } catch (e) {}

                // Only allow selection if the hit object is a number marker
                if (hit && hit.type === 'number-marker') {
                    try {
                        canvas.setActiveObject(hit);

                        // If we clicked a number marker, update activeTool currentNumber to match (optional ux)
                        // But strictly user request says "edit background and number".
                        // Selection handler will dispatch props.

                        canvas.requestRenderAll();
                    } catch (e) {}
                    return;
                }
                // If hit a non-marker object, clear selection to prevent moving it
                if (hit) {
                    try {
                        canvas.discardActiveObject();
                        canvas.requestRenderAll();
                    } catch (e) {}
                }

                // Create new NumberMarker
                const fill = activeToolOptions.fill || '#ff0000';
                const fontSize = activeToolOptions.fontSize || 20;
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
                    fontSize: fontSize,
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
                if (opt.e.ctrlKey || opt.e.metaKey) return;
                // Only allow selecting mosaic rectangles, not other shapes
                let hit = opt.target;
                try {
                    if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                        hit = (canvas as any).findTarget(opt.e);
                    }
                } catch (e) {}
                // Only allow selection if the hit object is a mosaic-rect
                if (hit && hit.type === 'mosaic-rect') {
                    try {
                        canvas.setActiveObject(hit);
                        canvas.requestRenderAll();
                        return;
                    } catch (e) {}
                }
                // If hit a non-mosaic object, clear selection to prevent moving it
                if (hit) {
                    try {
                        canvas.discardActiveObject();
                        canvas.requestRenderAll();
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
                return;
            }

            // Magnifier tool: start drawing magnifier rectangle
            if (activeTool === 'magnifier') {
                if (opt.e.ctrlKey || opt.e.metaKey) return;
                // Only allow selecting magnifier rectangles, not other shapes
                let hit = opt.target;
                try {
                    if (!hit && canvas && typeof (canvas as any).findTarget === 'function') {
                        hit = (canvas as any).findTarget(opt.e);
                    }
                } catch (e) {}
                // Only allow selection if the hit object is a magnifier-rect or magnifier-source-rect
                if (
                    hit &&
                    (hit.type === 'magnifier-rect' || hit.type === 'magnifier-source-rect')
                ) {
                    // Let Fabric handle selection and dragging
                    return;
                }
                // If hit a non-magnifier object, clear selection to prevent moving it
                if (hit) {
                    try {
                        canvas.discardActiveObject();
                        canvas.requestRenderAll();
                    } catch (e) {}
                }

                // Start drawing magnifier rectangle
                magnifierStart = { x: pointer.x, y: pointer.y };
                isDrawingMagnifier = true;
                // Use saved tool settings for colors and stroke widths
                const sourceStroke = activeToolOptions.sourceStroke || '#00ccff';
                const sourceStrokeWidth = activeToolOptions.sourceStrokeWidth || 1;
                const magnifierShape = activeToolOptions.magnifierShape || 'rect';

                tempMagnifier = new MagnifierSourceRect({
                    left: pointer.x,
                    top: pointer.y,
                    width: 0,
                    height: 0,
                    stroke: sourceStroke,
                    strokeWidth: sourceStrokeWidth,
                    magnifierShape: magnifierShape,
                    selectable: false,
                    evented: false,
                    erasable: true,
                });
                canvas.add(tempMagnifier);
                canvas.requestRenderAll();
                return;
            }

            // Text tool: create or select an editable text object
            if (activeTool === 'text') {
                if (opt.e.ctrlKey || opt.e.metaKey) {
                    // Holding Ctrl: if we click an already editing object, exit editing so we can drag it
                    let hit = opt.target;
                    if (hit && (hit as any).isEditing) {
                        (hit as any).exitEditing();
                        canvas.requestRenderAll();
                    }
                    return;
                }
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
                if (active && (active as any)._isCanvasBackground) {
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
                    let fillVal = active.fill;
                    if (typeof fillVal === 'string' && fillVal.startsWith('rgba')) {
                        try {
                            fillVal = '#' + new Color(fillVal).toHex();
                        } catch (e) {}
                    }
                    dispatch('selection', {
                        options: {
                            stroke: active.stroke,
                            strokeWidth: active.strokeWidth,
                            fill: fillVal,
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
                    let fillVal = active.fill;
                    if (typeof fillVal === 'string' && fillVal.startsWith('rgba')) {
                        try {
                            fillVal = '#' + new Color(fillVal).toHex();
                        } catch (e) {}
                    }
                    dispatch('selection', {
                        options: {
                            fill: fillVal,
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
                if (isDrawingMagnifier && active !== tempMagnifier) return;
                if (isDrawingShape && active !== tempShape) return;

                // Ignore canvas boundary rectangle
                if (active && (active as any)._isCanvasBackground) {
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                    return;
                }

                if (!active) {
                    dispatch('selection', { options: null, type: null });
                    return;
                }

                if (active.type === 'activeSelection') {
                    dispatch('selection', {
                        options: {
                            isSelection: false,
                            isMixedSelection: true, // Treat all multi-selection as mixed for simplicity in UI
                            selectionType: null,
                        },
                        type: 'activeSelection',
                    });
                    return;
                }

                let targetType = active.type;
                let representativeObject = active;

                const allowedShapeTypes = ['rect', 'ellipse', 'circle'];
                if (allowedShapeTypes.includes(targetType) || targetType === 'path') {
                    // derive fillOpacity from fill if possible
                    let fp = 1;
                    try {
                        const f = representativeObject.fill;
                        if (typeof f === 'string') {
                            const m = f.match(/rgba\([^,]+,[^,]+,[^,]+,([^)]+)\)/);
                            if (m && m[1]) fp = parseFloat(m[1]) || 1;
                            else fp = 1;
                        }
                    } catch (e) {}
                    let fillVal = representativeObject.fill;
                    if (typeof fillVal === 'string' && fillVal.startsWith('rgba')) {
                        try {
                            fillVal = '#' + new Color(fillVal).toHex();
                        } catch (e) {}
                    }
                    dispatch('selection', {
                        options: {
                            stroke: representativeObject.stroke,
                            strokeWidth: representativeObject.strokeWidth,
                            fill: fillVal,
                            fillOpacity: fp,
                            isSelection: true,
                            selectionType: targetType,
                        },
                        type: targetType,
                    });
                } else if (
                    targetType === 'arrow' ||
                    (targetType === 'line' && (representativeObject as any).arrowHead)
                ) {
                    // Custom Arrow class (extends Line with arrowHead property)
                    dispatch('selection', {
                        options: {
                            stroke: representativeObject.stroke,
                            strokeWidth: Math.round(
                                typeof (representativeObject as any).getVisualStrokeWidth ===
                                    'function'
                                    ? (representativeObject as any).getVisualStrokeWidth()
                                    : representativeObject.strokeWidth || 0
                            ),
                            arrowHead: (representativeObject as any).arrowHead,
                            headStyle: (representativeObject as any).headStyle,
                            anchorStyle: (representativeObject as any).anchorStyle,
                            lineStyle: (representativeObject as any).lineStyle,
                            thicknessStyle: (representativeObject as any).thicknessStyle,
                            isSelection: true,
                            selectionType: 'arrow',
                        },
                        type: 'arrow',
                    });
                } else if (targetType === 'group') {
                    // detect arrow groups (legacy) and forward their style as selection options
                    try {
                        const parts = (representativeObject as any).getObjects
                            ? (representativeObject as any).getObjects()
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
                                    isSelection: true,
                                    selectionType: 'arrow',
                                },
                                type: 'arrow',
                            });
                            return;
                        }
                    } catch (e) {}
                    dispatch('selection', {
                        options: {
                            isSelection: false,
                            isMixedSelection: true,
                            selectionType: null,
                        },
                        type: 'group',
                    });
                } else if (['i-text', 'textbox', 'text'].includes(targetType)) {
                    let fillVal = representativeObject.fill;
                    if (typeof fillVal === 'string' && fillVal.startsWith('rgba')) {
                        try {
                            fillVal = '#' + new Color(fillVal).toHex();
                        } catch (e) {}
                    }
                    dispatch('selection', {
                        options: {
                            family: (representativeObject as any).fontFamily,
                            size: Math.round(
                                (representativeObject as any).fontSize *
                                    (representativeObject.scaleX || 1)
                            ),
                            fill: fillVal,
                            stroke: representativeObject.stroke,
                            strokeWidth: representativeObject.strokeWidth,
                            bold: (representativeObject as any).fontWeight === 'bold',
                            italic: (representativeObject as any).fontStyle === 'italic',
                            isSelection: true,
                            selectionType: 'text',
                        },
                        type: targetType,
                    });
                } else if (targetType === 'number-marker') {
                    let fillVal = representativeObject.fill;
                    if (typeof fillVal === 'string') {
                        try {
                            fillVal = '#' + new Color(fillVal).toHex();
                        } catch (e) {}
                    }
                    dispatch('selection', {
                        options: {
                            fill: fillVal,
                            count: (representativeObject as any).count,
                            fontSize: (representativeObject as any).fontSize,
                            nextNumber: currentNumber,
                            isSelection: true,
                            selectionType: 'number-marker',
                        },
                        type: 'number-marker',
                    });
                } else if (targetType === 'mosaic-rect') {
                    dispatch('selection', {
                        options: {
                            blockSize: (representativeObject as any).blockSize || 15,
                            isSelection: true,
                            selectionType: 'mosaic',
                        },
                        type: 'mosaic-rect',
                    });
                } else if (targetType === 'magnifier-rect') {
                    // Fetch source properties
                    let sourceStroke = '#00ccff';
                    let sourceStrokeWidth = 1;
                    if ((representativeObject as any).sourceId && canvas) {
                        const sourceObj = canvas
                            .getObjects()
                            .find((o: any) => o.id === (representativeObject as any).sourceId);
                        if (sourceObj) {
                            sourceStroke = (sourceObj.stroke as string) || '#00ccff';
                            sourceStrokeWidth = sourceObj.strokeWidth || 1;
                        }
                    }

                    // Fetch connection properties
                    let connectionStroke = '#00ccff';
                    let connectionStrokeWidth = 1;
                    if (canvas) {
                        const line = canvas
                            .getObjects()
                            .find(
                                (o: any) =>
                                    o.type === 'magnifier-connection-line' &&
                                    o.viewId === representativeObject.id
                            );
                        if (line) {
                            connectionStroke = (line.stroke as string) || '#00ccff';
                            connectionStrokeWidth = line.strokeWidth || 1;
                        }
                    }

                    dispatch('selection', {
                        options: {
                            magnification: (representativeObject as any).magnification || 2,
                            stroke: representativeObject.stroke,
                            strokeWidth: representativeObject.strokeWidth,
                            sourceStroke,
                            sourceStrokeWidth,
                            connectionStroke,
                            connectionStrokeWidth,
                            isSelection: true,
                            selectionType: 'magnifier',
                            magnifierShape: (representativeObject as any).magnifierShape || 'rect',
                        },
                        type: 'magnifier-rect',
                    });
                } else if (targetType === 'magnifier-source-rect') {
                    // When source rect is selected, show settings from the linked view rect PLUS its own
                    let options: any = {
                        isSelection: true,
                        selectionType: 'magnifier',
                        sourceStroke: representativeObject.stroke,
                        sourceStrokeWidth: representativeObject.strokeWidth,
                        magnifierShape: (representativeObject as any).magnifierShape || 'rect',
                    };

                    // Fetch connection properties
                    if (canvas) {
                        const line = canvas
                            .getObjects()
                            .find(
                                (o: any) =>
                                    o.type === 'magnifier-connection-line' &&
                                    o.sourceId === representativeObject.id
                            );
                        if (line) {
                            options.connectionStroke = (line.stroke as string) || '#00ccff';
                            options.connectionStrokeWidth = line.strokeWidth || 1;
                        }
                    }

                    if ((representativeObject as any).viewId && canvas) {
                        const viewObj = canvas
                            .getObjects()
                            .find((o: any) => o.id === (representativeObject as any).viewId);
                        if (viewObj) {
                            options.magnification = (viewObj as any).magnification || 2;
                            options.stroke = viewObj.stroke;
                            options.strokeWidth = viewObj.strokeWidth;
                        }
                    }
                    dispatch('selection', {
                        options: options,
                        type: 'magnifier-rect', // Treat as magnifier-rect for settings UI
                    });
                } else if (targetType === 'image') {
                    dispatch('selection', {
                        options: {
                            width: Math.round(representativeObject.getScaledWidth()),
                            height: Math.round(representativeObject.getScaledHeight()),
                            lockAspectRatio: (representativeObject as any).lockUniScaling !== false,
                            isSelection: true,
                            selectionType: 'image',
                        },
                        type: 'image',
                    });
                } else {
                    dispatch('selection', {
                        // For unknown types or unhandled activeSelection/groups, do NOT enable selection settings
                        options: { isSelection: false, selectionType: null },
                        type: targetType,
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
            } else if (target && target.type === 'number-marker') {
                // Update fontSize in the tool options for real-time UI feel
                if (activeTool === 'number-marker') {
                    const effectiveSize = (target as any).getEffectiveFontSize();
                    activeToolOptions.fontSize = effectiveSize;
                    // Only dispatch if necessary to avoid flooding
                    dispatch('selection', {
                        options: { ...activeToolOptions, fontSize: effectiveSize },
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

            // Sync magnifier source/view scaling
            const obj = opt.target;
            if (obj && obj.type === 'magnifier-rect' && obj.sourceId) {
                // View scaled -> Update dimensions to maintain source aspect ratio
                const sourceObj = canvas.getObjects().find((o: any) => o.id === obj.sourceId);
                if (sourceObj) {
                    const sourceW = sourceObj.getScaledWidth();
                    const sourceH = sourceObj.getScaledHeight();

                    if (sourceW > 1 && sourceH > 1) {
                        // Get current scaled dimensions
                        const viewW = obj.getScaledWidth();
                        const viewH = obj.getScaledHeight();

                        // Calculate new magnification based on average of width and height ratios
                        // This handles both rect and circle shapes correctly
                        const magW = viewW / sourceW;
                        const magH = viewH / sourceH;
                        const newMag = (magW + magH) / 2;
                        const finalMag = parseFloat(newMag.toFixed(2));

                        // Calculate new dimensions maintaining source aspect ratio
                        const newViewW = sourceW * finalMag;
                        const newViewH = sourceH * finalMag;

                        const center = obj.getCenterPoint();

                        // Update view rect with new dimensions and reset scale
                        obj.set({
                            width: newViewW,
                            height: newViewH,
                            scaleX: 1,
                            scaleY: 1,
                            magnification: finalMag,
                        });

                        obj.setPositionByOrigin(center, 'center', 'center');
                        obj.setCoords();
                        obj.dirty = true;

                        // Update settings UI dynamically
                        dispatch('selection', {
                            options: {
                                ...activeToolOptions,
                                magnification: finalMag,
                                stroke: obj.stroke,
                                strokeWidth: obj.strokeWidth,
                            },
                            type: 'magnifier-rect',
                        });

                        canvas.requestRenderAll();
                    }
                }
            } else if (obj && obj.type === 'magnifier-source-rect' && obj.viewId) {
                // Source Resized -> Update View dimensions to match Source AR * Magnification
                const viewObj = canvas.getObjects().find((o: any) => o.id === obj.viewId);
                if (viewObj) {
                    const mag = viewObj.magnification || 2;
                    // Get new source dimensions
                    const sourceW = obj.getScaledWidth();
                    const sourceH = obj.getScaledHeight();

                    const newViewW = sourceW * mag;
                    const newViewH = sourceH * mag;

                    const center = viewObj.getCenterPoint();

                    // Update View Rect
                    viewObj.set({
                        width: newViewW,
                        height: newViewH,
                        scaleX: 1,
                        scaleY: 1,
                    });

                    viewObj.setPositionByOrigin(center, 'center', 'center');
                    viewObj.setCoords();
                    viewObj.dirty = true;
                    // Force render to ensure view rect updates in real-time
                    canvas.requestRenderAll();
                }
            }

            // Sync connection line on scaling
            if (obj && (obj.type === 'magnifier-rect' || obj.type === 'magnifier-source-rect')) {
                updateMagnifierConnectionLine(obj);
            }
        });

        // Add object:moving listener for Magnifier Source updates
        // Add object:moving listener for Magnifier updates
        canvas.on('object:moving', (opt: any) => {
            const target = opt.target;
            if (
                target &&
                (target.type === 'magnifier-source-rect' || target.type === 'magnifier-rect')
            ) {
                // Sync connection line on moving
                updateMagnifierConnectionLine(target);
                canvas.requestRenderAll();
            }
        });

        // Sync rotation
        canvas.on('object:rotating', (opt: any) => {
            const target = opt.target;
            if (target && target.type === 'magnifier-source-rect' && target.viewId) {
                const viewObj = canvas.getObjects().find((o: any) => o.id === target.viewId);
                if (viewObj) {
                    viewObj.set('angle', target.angle);
                    viewObj.setCoords();
                    updateMagnifierConnectionLine(target);
                    canvas.requestRenderAll();
                }
            } else if (target && target.type === 'magnifier-rect' && target.sourceId) {
                const sourceObj = canvas.getObjects().find((o: any) => o.id === target.sourceId);
                if (sourceObj) {
                    sourceObj.set('angle', target.angle);
                    sourceObj.setCoords();
                    updateMagnifierConnectionLine(target);
                    canvas.requestRenderAll();
                }
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
                tempArrow.setEndpoints(arrowStart.x, arrowStart.y, x2, y2);
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

            // if magnifier drawing in progress
            if (isDrawingMagnifier && tempMagnifier) {
                const sx = magnifierStart.x;
                const sy = magnifierStart.y;
                const left = Math.min(sx, pointer.x);
                const top = Math.min(sy, pointer.y);
                const width = Math.abs(pointer.x - sx);
                const height = Math.abs(pointer.y - sy);
                tempMagnifier.set({ left, top, width, height });
                // We don't cache MagnifierRect, it re-renders on move/resize, setCoords updates bounding box
                tempMagnifier.setCoords();
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
                return;
            }

            // finish magnifier drawing
            if (isDrawingMagnifier && tempMagnifier) {
                try {
                    const minSize = 10;
                    if (tempMagnifier.width < minSize || tempMagnifier.height < minSize) {
                        try {
                            canvas.remove(tempMagnifier);
                        } catch (e) {}
                        tempMagnifier = null;
                        isDrawingMagnifier = false;
                        return;
                    }

                    // finalize
                    const sourceId = generateId();
                    const viewId = generateId();
                    const mag = activeToolOptions.magnification || 2;
                    const shape = activeToolOptions.magnifierShape || 'rect';

                    // Finalize Source Rect (tempMagnifier is now source)
                    tempMagnifier.set({
                        id: sourceId,
                        viewId: viewId,
                        magnifierShape: shape,
                        selectable: true,
                        evented: true,
                    });
                    tempMagnifier.setCoords();

                    // Create View Rect
                    // Place it to the right of source
                    const viewLeft = tempMagnifier.left + tempMagnifier.width + 20;
                    const viewTop = tempMagnifier.top;

                    // Use saved tool settings for magnifier view colors
                    const viewStroke = activeToolOptions.stroke || '#000000';
                    const viewStrokeWidth = activeToolOptions.strokeWidth || 2;

                    const viewRect = new MagnifierRect({
                        id: viewId,
                        sourceId: sourceId,
                        left: viewLeft,
                        top: viewTop,
                        width: tempMagnifier.width * mag,
                        height: tempMagnifier.height * mag,
                        magnification: mag,
                        magnifierShape: shape,
                        stroke: viewStroke,
                        strokeWidth: viewStrokeWidth,
                        selectable: true,
                        evented: true,
                    });

                    canvas.add(viewRect);

                    // Add connection line
                    const sCenter = tempMagnifier.getCenterPoint();
                    const vCenter = viewRect.getCenterPoint();

                    // Use saved tool settings for connection line
                    const connectionStroke = activeToolOptions.connectionStroke || '#00ccff';
                    const connectionStrokeWidth = activeToolOptions.connectionStrokeWidth || 1;

                    const line = new MagnifierConnectionLine(
                        [sCenter.x, sCenter.y, vCenter.x, vCenter.y],
                        {
                            sourceId: sourceId,
                            viewId: viewId,
                            stroke: connectionStroke,
                            strokeWidth: connectionStrokeWidth,
                        }
                    );

                    canvas.add(line);
                    try {
                        (canvas as any).sendToBack(line);
                    } catch (e) {}

                    // Update layout
                    updateMagnifierConnectionLine(viewRect);

                    canvas.setActiveObject(viewRect);

                    // Manually dispatch selection to ensure UI gets correct initial settings
                    // This bypasses potential timing issues in the generic selection handler
                    dispatch('selection', {
                        options: {
                            magnification: mag,
                            stroke: viewStroke,
                            strokeWidth: viewStrokeWidth,
                            // Get source properties from the source object we just finalized
                            sourceStroke: tempMagnifier.stroke,
                            sourceStrokeWidth: tempMagnifier.strokeWidth,
                            // Get connection properties from local variables
                            connectionStroke: connectionStroke,
                            connectionStrokeWidth: connectionStrokeWidth,
                            isSelection: true,
                            selectionType: 'magnifier',
                            magnifierShape: shape,
                        },
                        type: 'magnifier-rect',
                    });

                    canvas.requestRenderAll();
                    schedulePushWithType('added');

                    tempMagnifier = null;
                    isDrawingMagnifier = false;
                    return;
                } catch (e) {
                    console.warn('Error inside magnifier mouse:up', e);
                }
                tempMagnifier = null;
                isDrawingMagnifier = false;
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
        try {
            hideContextMenu();
        } catch (e) {}
        try {
            window.removeEventListener('paste', onPaste);
        } catch (e) {}
    });

    export function getCanvas() {
        return canvas;
    }

    export function getSelectCanvasSizeMode() {
        return selectCanvasSizeMode;
    }

    export function setTool(tool: string | null, options: any = {}) {
        // If we were in crop mode and switching to another tool, exit it properly
        if (cropMode && tool !== 'crop' && tool !== null) {
            exitCropMode();
        }
        // If we were in select canvas size mode and switching to another tool, exit it properly
        if (selectCanvasSizeMode && tool !== 'canvas' && tool !== null) {
            exitSelectCanvasSizeMode();
        }

        // If updating the same tool (especially magnifier), merge options to prevent data loss form partial updates or incomplete selection options
        if (activeTool === tool && tool === 'magnifier') {
            activeToolOptions = { ...activeToolOptions, ...(options || {}) };
        } else {
            activeToolOptions = options || {};
        }

        activeTool = tool;
        dispatch('toolChange', { tool });

        if (tool === 'number-marker') {
            if (typeof options.nextNumber !== 'undefined') {
                currentNumber = options.nextNumber;
            } else if (typeof options.count !== 'undefined' && !options.isSelection) {
                currentNumber = options.count;
            }
        }
        if (tool === 'image') {
            // image tool: default cursor and ensure selection mode
            if (canvas) canvas.defaultCursor = 'default';
        }
        if (tool === 'canvas') {
            if (options.fill) {
                setCanvasBackground(options.fill);
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
        // provide sensible defaults for magnifier tool
        if (tool === 'magnifier') {
            activeToolOptions.magnification = activeToolOptions.magnification ?? 2;
            activeToolOptions.magnifierShape = activeToolOptions.magnifierShape || 'rect';
            activeToolOptions.stroke = activeToolOptions.stroke || '#000000';
            activeToolOptions.strokeWidth = activeToolOptions.strokeWidth ?? 2;
            activeToolOptions.sourceStroke = activeToolOptions.sourceStroke || '#00ccff';
            activeToolOptions.sourceStrokeWidth = activeToolOptions.sourceStrokeWidth ?? 1;
            activeToolOptions.connectionStroke = activeToolOptions.connectionStroke || '#00ccff';
            activeToolOptions.connectionStrokeWidth = activeToolOptions.connectionStrokeWidth ?? 1;
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
            else if (tool === 'magnifier') canvas.defaultCursor = 'crosshair';
            else if (tool === 'text') canvas.defaultCursor = 'text';
            else if (tool === 'number-marker') canvas.defaultCursor = 'crosshair';
            else if (tool === 'hand') canvas.defaultCursor = 'grab';
            else canvas.defaultCursor = 'default';
        }

        // Manage object interactivity based on active tool
        // When using drawing tools, only allow selecting objects of the same type
        if (canvas) {
            // Define tool to type mapping
            const toolTypeMap: { [key: string]: string[] } = {
                shape: ['rect', 'circle', 'ellipse', 'triangle'],
                arrow: ['arrow'],
                mosaic: ['mosaic-rect'],
                magnifier: ['magnifier-rect', 'magnifier-source-rect'],
                'number-marker': ['number-marker'],
                text: ['i-text', 'textbox', 'text'],
            };

            const drawingTools = ['shape', 'arrow', 'mosaic', 'magnifier', 'number-marker', 'text'];
            const isDrawingTool = drawingTools.includes(tool || '');

            canvas.getObjects().forEach((obj: any) => {
                // Skip special objects
                if (obj._isCanvasBackground || obj._isCropRect) return;

                // For drawing tools, only allow selecting objects of the same type
                if (isDrawingTool && tool) {
                    const allowedTypes = toolTypeMap[tool] || [];
                    const isAllowedType = allowedTypes.includes(obj.type);

                    obj.selectable = isAllowedType;
                    obj.evented = isAllowedType;
                } else {
                    // For non-drawing tools (select, hand, brush, eraser, etc.), allow all objects
                    obj.selectable = true;
                    obj.evented = true;
                }
            });

            canvas.requestRenderAll();
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

    // Select canvas size mode state
    let selectCanvasSizeMode = false;
    let selectCanvasSizeRect: any = null;
    let _selectCanvasSizeKeyHandler: ((e: KeyboardEvent) => void) | null = null;

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
                        fill: 'transparent',
                        stroke: null,
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
                            exitCropMode();
                            return true;
                        }
                    );
                    cropRect.setCustomControls(cropControls);

                    canvas.add(cropRect);
                    canvas.setActiveObject(cropRect);

                    fitImageToViewport();
                    canvas.requestRenderAll();
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
                fill: 'transparent',
                stroke: null,
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
                canvas.requestRenderAll();
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
                    exitCropMode();
                    return true;
                }
            );
            cropRect.setCustomControls(cropControls);

            cropRect.setCoords();
            canvas.setActiveObject(cropRect);
            canvas.requestRenderAll();
        };

        // Attach listeners
        canvas.on('mouse:down', onMouseDown);
        canvas.on('mouse:move', onMouseMove);
        canvas.on('mouse:up', onMouseUp);
        _cropHandlers = { onMouseDown, onMouseMove, onMouseUp, applyCrop };

        // keyboard shortcuts for crop
        _cropKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                applyCrop();
            } else if (e.key === 'Escape') {
                exitCropMode();
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

        // Cleanup listeners
        if (_cropHandlers) {
            canvas.off('mouse:down', _cropHandlers.onMouseDown);
            canvas.off('mouse:move', _cropHandlers.onMouseMove);
            canvas.off('mouse:up', _cropHandlers.onMouseUp);
            _cropHandlers = null;
        }
        if (_cropKeyHandler) {
            document.removeEventListener('keydown', _cropKeyHandler as any);
            _cropKeyHandler = null;
        }

        if (cropRect) {
            canvas.remove(cropRect);
            cropRect = null;
        }
        cropMode = false;
        restoreObjectSelectionStates();
        canvas.requestRenderAll();
    }

    export async function enterImageCropMode() {
        if (!canvas) return;
        const active = canvas.getActiveObject() as any;
        if (!active || active.type !== 'image') return;

        targetImageToCrop = active;
        isImageCropping = true;

        // Ensure metadata exists
        if (!active._originalSrc) {
            // Use current element source as original if not set
            // In v6, fImg._element.src might be a blob or dataURL
            active._originalSrc = active._element?.src;
            active._cropOffset = { x: 0, y: 0 };
        }

        const originalSrc = active._originalSrc;
        const cropOffset = active._cropOffset || { x: 0, y: 0 };

        // Get current visual bounds of the image (before we modify it)
        const currentBounds = active.getBoundingRect();

        // Backup current state for cancellation/application
        imageCropBackup = {
            left: active.left,
            top: active.top,
            width: active.width,
            height: active.height,
            scaleX: active.scaleX,
            scaleY: active.scaleY,
            angle: active.angle,
            originX: active.originX,
            originY: active.originY,
            element: active._element,
            cropOffset: { ...cropOffset },
        };

        // Load the original full image
        const imgEl = new Image();
        imgEl.onload = () => {
            if (!canvas || !targetImageToCrop) return;

            // Calculate the scale factors from the current cropped image
            const currentScaleX = imageCropBackup.scaleX;
            const currentScaleY = imageCropBackup.scaleY;

            // The original image's top-left corner position (at angle 0)
            // We need to account for the crop offset to find where the original image would be
            // Current image position represents: original position + cropOffset * scale
            // So: original position = current position - cropOffset * scale

            // First, we need to handle the origin. Convert current position to top-left origin
            let currentLeft = imageCropBackup.left;
            let currentTop = imageCropBackup.top;

            // If origin is center, convert to top-left
            if (imageCropBackup.originX === 'center') {
                currentLeft -= (imageCropBackup.width * currentScaleX) / 2;
            }
            if (imageCropBackup.originY === 'center') {
                currentTop -= (imageCropBackup.height * currentScaleY) / 2;
            }

            // Now calculate where the original full image's top-left would be
            const origLeft = currentLeft - cropOffset.x * currentScaleX;
            const origTop = currentTop - cropOffset.y * currentScaleY;

            // Set the image to show the full original at angle 0, with top-left origin
            targetImageToCrop.set({
                angle: 0,
                left: origLeft,
                top: origTop,
                originX: 'left',
                originY: 'top',
                width: imgEl.naturalWidth,
                height: imgEl.naturalHeight,
                scaleX: currentScaleX,
                scaleY: currentScaleY,
            });
            targetImageToCrop.setElement(imgEl);
            targetImageToCrop.setCoords();

            // Create CropRect at the current visible area
            // The visible area is at: original position + cropOffset * scale
            const visualLeft = origLeft + cropOffset.x * currentScaleX;
            const visualTop = origTop + cropOffset.y * currentScaleY;
            const visualWidth = imageCropBackup.width * currentScaleX;
            const visualHeight = imageCropBackup.height * currentScaleY;

            if (cropRect) canvas.remove(cropRect);
            cropRect = new CropRect({
                left: visualLeft,
                top: visualTop,
                width: visualWidth,
                height: visualHeight,
                fill: 'transparent',
                stroke: '#00ccff',
                strokeWidth: 2,
                strokeDashArray: [5, 5],
                selectable: true,
                evented: true,
                lockRotation: true,
                hasControls: true,
                hasBorders: true,
                scaleX: 1,
                scaleY: 1,
            });

            const cropControls = createCropControls(
                () => {
                    applyImageCrop();
                    return true;
                },
                () => {
                    exitImageCropMode();
                    return true;
                }
            );
            cropRect.setCustomControls(cropControls);

            // Keyboard handler for crop
            _cropKeyHandler = (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyImageCrop();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    exitImageCropMode();
                }
            };
            document.addEventListener('keydown', _cropKeyHandler as any);

            // Disable other objects during crop
            canvas.getObjects().forEach((obj: any) => {
                if (obj !== cropRect && obj !== targetImageToCrop) {
                    obj.selectable = false;
                    obj.evented = false;
                }
            });

            canvas.add(cropRect);
            canvas.setActiveObject(cropRect);
            canvas.requestRenderAll();
        };
        imgEl.onerror = () => {
            isImageCropping = false;
            targetImageToCrop = null;
            pushErrMsg('加载原图失败');
        };
        imgEl.src = originalSrc;
    }

    async function applyImageCrop() {
        if (!canvas || !cropRect || !targetImageToCrop || !imageCropBackup) return;

        try {
            // Get crop rect in screen/canvas coordinates
            const boundingRect = cropRect.getBoundingRect();
            const { left, top, width, height } = boundingRect;

            if (width < 5 || height < 5) {
                exitImageCropMode();
                return;
            }

            // Since targetImageToCrop is currently the full original at angle 0
            const currentScaleX = targetImageToCrop.scaleX || 1;
            const currentScaleY = targetImageToCrop.scaleY || 1;

            // 1. Calculate the crop rectangle in ORIGINAL image coordinates
            // targetImageToCrop is positioned such that its top-left correlates to the original image origin (0,0)
            const cropX = (left - targetImageToCrop.left) / currentScaleX;
            const cropY = (top - targetImageToCrop.top) / currentScaleY;
            const cropW = width / currentScaleX;
            const cropH = height / currentScaleY;

            // 2. Create baked image with ORIGINAL density (preserving resolution)
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = Math.max(1, Math.round(cropW));
            cropCanvas.height = Math.max(1, Math.round(cropH));
            const ctx = cropCanvas.getContext('2d');
            if (!ctx) return;

            // Draw correctly from the source element
            const srcElement = targetImageToCrop.getElement();
            if (srcElement) {
                ctx.drawImage(
                    srcElement,
                    cropX,
                    cropY,
                    cropW,
                    cropH,
                    0,
                    0,
                    cropCanvas.width,
                    cropCanvas.height
                );
            } else {
                // Fallback if element unavailable
                ctx.translate(-cropX * currentScaleX, -cropY * currentScaleY);
                targetImageToCrop.render(ctx);
            }

            const originalSrc = (targetImageToCrop as any)._originalSrc;

            // 3. Create the new baked FabricImage
            const newImg = new FabricImage(cropCanvas, {
                selectable: true,
                evented: true,
            });

            // Set metadata
            (newImg as any)._originalSrc = originalSrc;
            (newImg as any)._cropOffset = { x: cropX, y: cropY };

            // 4. Restore rotation and position
            // The position calculation needs to place the new image (which has size cropW * currentScaleX)
            // exactly at the visual position 'left', 'top'.

            // Calculate the position based on the original origin from backup
            let newLeft = left;
            let newTop = top;

            // Adjust for origin
            if (imageCropBackup.originX === 'center') {
                newLeft = left + width / 2;
            }
            if (imageCropBackup.originY === 'center') {
                newTop = top + height / 2;
            }

            // If there was rotation, we need to rotate the position around the original pivot
            if (imageCropBackup.angle !== 0) {
                // The pivot point is the center of the original full image
                const origL = targetImageToCrop.left;
                const origT = targetImageToCrop.top;
                const origW = targetImageToCrop.width * currentScaleX;
                const origH = targetImageToCrop.height * currentScaleY;
                const pivot = { x: origL + origW / 2, y: origT + origH / 2 };

                const angleRad = (imageCropBackup.angle * Math.PI) / 180;
                const rotatedPos = util.rotatePoint(
                    new Point(newLeft, newTop),
                    new Point(pivot.x, pivot.y),
                    angleRad
                );

                newLeft = rotatedPos.x;
                newTop = rotatedPos.y;
            }

            newImg.set({
                originX: imageCropBackup.originX || 'left',
                originY: imageCropBackup.originY || 'top',
                left: newLeft,
                top: newTop,
                angle: imageCropBackup.angle,
                scaleX: currentScaleX, // Restore the scale!
                scaleY: currentScaleY,
            });
            newImg.setCoords();

            canvas.add(newImg);
            canvas.remove(targetImageToCrop);
            canvas.remove(cropRect);

            // Notify parent and cleanup
            isImageCropping = false;
            targetImageToCrop = null;
            imageCropBackup = null;
            cropRect = null;

            if (_cropKeyHandler) {
                document.removeEventListener('keydown', _cropKeyHandler as any);
                _cropKeyHandler = null;
            }

            restoreObjectSelectionStates();
            canvas.setActiveObject(newImg);
            canvas.requestRenderAll();
            schedulePushWithType('modified');
        } catch (e) {
            console.warn('applyImageCrop failed', e);
        }
    }

    export function exitImageCropMode() {
        if (!canvas) return;

        // If we have a backup and we're not finishing normally (applying), restore it
        if (targetImageToCrop && imageCropBackup) {
            targetImageToCrop.set({
                left: imageCropBackup.left,
                top: imageCropBackup.top,
                width: imageCropBackup.width,
                height: imageCropBackup.height,
                scaleX: imageCropBackup.scaleX,
                scaleY: imageCropBackup.scaleY,
                angle: imageCropBackup.angle,
                originX: imageCropBackup.originX,
                originY: imageCropBackup.originY,
            });
            targetImageToCrop.setElement(imageCropBackup.element);
            targetImageToCrop.setCoords();
        }

        if (cropRect) {
            canvas.remove(cropRect);
            cropRect = null;
        }

        if (_cropKeyHandler) {
            document.removeEventListener('keydown', _cropKeyHandler as any);
            _cropKeyHandler = null;
        }

        isImageCropping = false;
        targetImageToCrop = null;
        imageCropBackup = null;

        restoreObjectSelectionStates();
        canvas.requestRenderAll();
    }

    // Select canvas size mode
    export function enterSelectCanvasSizeMode() {
        if (!canvas || !isCanvasMode) return;
        if (selectCanvasSizeMode && selectCanvasSizeRect) return;
        selectCanvasSizeMode = true;
        dispatch('selectCanvasSizeModeChanged', true);

        // Ensure no existing rect
        if (selectCanvasSizeRect) {
            canvas.remove(selectCanvasSizeRect);
            selectCanvasSizeRect = null;
        }

        // Deselect all objects
        try {
            canvas.discardActiveObject();
        } catch (e) {}

        // Disable selectability for existing objects during selection
        canvas.getObjects().forEach((obj: any) => {
            obj.selectable = false;
            obj.evented = false;
        });

        // Create rectangle with current boundary size
        const boundary = canvas.getObjects().find((o: any) => o._isCanvasBackground);
        const canvasWidth = boundary ? boundary.width : 800;
        const canvasHeight = boundary ? boundary.height : 600;
        const canvasLeft = boundary ? boundary.left : 0;
        const canvasTop = boundary ? boundary.top : 0;

        selectCanvasSizeRect = new SelectCanvasSizeRect({
            left: canvasLeft,
            top: canvasTop,
            width: canvasWidth,
            height: canvasHeight,
            fill: 'transparent',
            stroke: '#007bff',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
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
        canvas.add(selectCanvasSizeRect);

        // Add custom controls with confirm and cancel buttons
        const selectCanvasSizeControls = createSelectCanvasSizeControls(
            () => {
                applySelection();
                return true;
            },
            () => {
                exitSelectCanvasSizeMode();
                return true;
            }
        );
        selectCanvasSizeRect.setCustomControls(selectCanvasSizeControls);

        canvas.setActiveObject(selectCanvasSizeRect);

        // Keyboard shortcuts for select canvas size
        _selectCanvasSizeKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applySelection();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                exitSelectCanvasSizeMode();
            }
        };
        document.addEventListener('keydown', _selectCanvasSizeKeyHandler as any);

        canvas.requestRenderAll();
    }

    export function exitSelectCanvasSizeMode() {
        if (!canvas || !selectCanvasSizeMode) return;

        try {
            if (selectCanvasSizeRect) {
                canvas.remove(selectCanvasSizeRect);
            }
        } catch (e) {}
        selectCanvasSizeRect = null;

        selectCanvasSizeMode = false;
        dispatch('selectCanvasSizeModeChanged', false);
        try {
            document.removeEventListener('keydown', _selectCanvasSizeKeyHandler as any);
        } catch (e) {}
        _selectCanvasSizeKeyHandler = null;

        restoreObjectSelectionStates();
        canvas.requestRenderAll();
    }

    function applySelection() {
        if (!selectCanvasSizeRect || !canvas) {
            if (selectCanvasSizeRect && canvas) canvas.remove(selectCanvasSizeRect);
            return;
        }

        // Use bounding rect to take into account object scaling and transforms
        const bounding = selectCanvasSizeRect.getBoundingRect();
        const rectLeft = Math.round(bounding.left || 0);
        const rectTop = Math.round(bounding.top || 0);
        const width = Math.max(0, Math.round(bounding.width || 0));
        const height = Math.max(0, Math.round(bounding.height || 0));

        const minSize = 50;
        console.log('SelectCanvas.applySelection', {
            rectLeft,
            rectTop,
            width,
            height,
            canvasW: canvas.getWidth(),
            canvasH: canvas.getHeight(),
            bg: canvas.backgroundImage
                ? {
                      bw: (canvas.backgroundImage as any).width,
                      bh: (canvas.backgroundImage as any).height,
                      scaleX: (canvas.backgroundImage as any).scaleX,
                      scaleY: (canvas.backgroundImage as any).scaleY,
                  }
                : null,
        });
        if (width < minSize || height < minSize) {
            try {
                canvas.remove(selectCanvasSizeRect);
            } catch (e) {}
            selectCanvasSizeRect = null;
            canvas.requestRenderAll();
            return;
        }

        // Shift all objects to be relative to the new canvas origin.
        // Use bounding rect left/top which are in canvas coordinates.
        canvas.getObjects().forEach((obj: any) => {
            if (!obj) return;
            if (obj === selectCanvasSizeRect || obj._isCanvasBackground) return; // Skip the selection rect and boundary

            // If the object has an origin different than 'left,top' (rare here), we still adjust left/top
            obj.left = (obj.left || 0) - rectLeft;
            obj.top = (obj.top || 0) - rectTop;
            obj.setCoords();
        });

        // Also shift background image if present
        if (canvas.backgroundImage) {
            canvas.backgroundImage.left = (canvas.backgroundImage.left || 0) - rectLeft;
            canvas.backgroundImage.top = (canvas.backgroundImage.top || 0) - rectTop;
            canvas.backgroundImage.setCoords();
        }

        // Resize canvas to selected size (logical pixels)
        resizeCanvas(width, height);

        canvas.getObjects().forEach((obj: any) => {
            if (obj === selectCanvasSizeRect) {
                canvas.remove(obj);
            }
        });
        selectCanvasSizeRect = null;
        selectCanvasSizeMode = false;
        dispatch('selectCanvasSizeModeChanged', false);
        try {
            document.removeEventListener('keydown', _selectCanvasSizeKeyHandler as any);
        } catch (e) {}
        _selectCanvasSizeKeyHandler = null;

        restoreObjectSelectionStates();
        canvas.requestRenderAll();
        schedulePushWithType('modified');
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
        currentNumber = 1;
        if (!url && isCanvasMode) {
            // Use saved settings or defaults
            const savedCanvas =
                (settings && settings.lastToolSettings && settings.lastToolSettings.canvas) || {};
            const imgW = savedCanvas.width || 800;
            const imgH = savedCanvas.height || 600;
            const bgFill = savedCanvas.fill || '#ffffff';

            // Get the workspace container size
            const workspace = container.closest('.canvas-editor');
            const cw = workspace ? workspace.clientWidth : imgW;
            const ch = workspace ? workspace.clientHeight : imgH;

            // Set canvas to workspace size (avoids scrollbars and allows panning)
            canvas.setDimensions({ width: cw, height: ch });

            // Set a neutral background for editor visibility (not for export)
            canvas.backgroundColor = 'transparent';

            // Add a boundary rectangle to show canvas bounds (project size)
            const boundaryRect = new CanvasBackgroundRect({
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
            canvas.add(boundaryRect);

            // Set initial background rectangle for export
            setCanvasBackground(bgFill);

            canvas.requestRenderAll();
            setTimeout(() => {
                fitImageToViewport();
                dispatch('loaded', { width: imgW, height: imgH, name: name || 'canvas' });
            }, 50);

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

                        // Set as background image by default (will be replaced if initialRect is applied)
                        (canvas as any).backgroundImage = fImg;

                        // If initialRect is provided (e.g. from screenshot selection), apply it immediately
                        if (initialRect && initialRect.width > 0 && initialRect.height > 0) {
                            try {
                                const { x: left, y: top, width, height } = initialRect;
                                const cropCanvas = document.createElement('canvas');
                                cropCanvas.width = width;
                                cropCanvas.height = height;
                                const ctx = cropCanvas.getContext('2d');
                                if (ctx) {
                                    ctx.translate(-left, -top);
                                    fImg.render(ctx);

                                    const newImg = new FabricImage(cropCanvas, {
                                        left: 0,
                                        top: 0,
                                        selectable: false,
                                        evented: false,
                                    });

                                    (newImg as any)._originalSrc = url;
                                    (newImg as any)._cropOffset = { x: left, y: top };
                                    (canvas as any).backgroundImage = newImg;

                                    // Reset initialRect after applying to avoid re-applying on subsequent loads if any
                                    initialRect = null;

                                    dispatch('cropApplied', {
                                        cropData: { left, top, width, height },
                                    });
                                }
                            } catch (err) {
                                console.warn('CanvasEditor: failed to apply initialRect crop', err);
                            }
                        }

                        canvas!.requestRenderAll();
                        setTimeout(() => fitImageToViewport(), 100);

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

        // Use a small timeout or requestAnimationFrame to ensure DOM is updated
        const cw = workspace.clientWidth;
        const ch = workspace.clientHeight;

        if (cw <= 0 || ch <= 0) {
            // If workspace is not yet sized, retry in a moment
            setTimeout(() => fitImageToViewport(), 100);
            return;
        }

        // Sync logical dimensions and CSS dimensions to the actual workspace size.
        // This is CRITICAL to prevent stretching when the sidebar changes global workspace size.
        canvas.setDimensions({ width: cw, height: ch });

        const containerEl = canvas.getElement().parentNode as HTMLElement;
        if (containerEl && containerEl.classList.contains('canvas-container')) {
            containerEl.style.margin = '0';
            containerEl.style.marginTop = '0';
        }

        const bg = canvas.backgroundImage;
        // Robust boundary finding
        const boundary = isCanvasMode
            ? canvas.getObjects().find((o: any) => (o as any)._isCanvasBackground)
            : null;

        if (bg || boundary) {
            // Use logical dimensions for centering to avoid issues with current transform
            let imgW, imgH, imgCenterX, imgCenterY;

            if (bg) {
                imgW = (bg.width || 0) * (bg.scaleX || 1);
                imgH = (bg.height || 0) * (bg.scaleY || 1);
                imgCenterX = (bg.left || 0) + imgW / 2;
                imgCenterY = (bg.top || 0) + imgH / 2;
            } else {
                imgW = (boundary as any).width * ((boundary as any).scaleX || 1);
                imgH = (boundary as any).height * ((boundary as any).scaleY || 1);
                imgCenterX = (boundary as any).left + imgW / 2;
                imgCenterY = (boundary as any).top + imgH / 2;
            }

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
            applyFill(ctx, fill, tw, th);
            ctx.fillRect(0, 0, tw, th);
            ctx.restore();
        } else {
            applyFill(ctx, fill, tw, th);
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
            applyFill(ctx, fill, sw, sh); // Use background color to avoid color bleeding if image has slight transparency

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
        (newImg as any)._borderFill = fill;
        (newImg as any)._borderRadius = radius;
        (newImg as any)._borderShadowBlur = shadowBlur;
        (newImg as any)._borderShadowColor = shadowColor;
        (newImg as any)._borderShadowOpacity = shadowOpacity;

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
            // Ensure initial history stores canvas-mode project size and bg fill
            if (isCanvasMode) {
                const boundary = canvas.getObjects().find((o: any) => o._isCanvasBackground);
                if (boundary) {
                    json.width = boundary.width;
                    json.height = boundary.height;
                    json.bgFill = boundary.fill;
                } else {
                    json.width = canvas.getWidth();
                    json.height = canvas.getHeight();
                }
                if (json.backgroundImage) delete json.backgroundImage;
            }
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
            if (isImageCropping) exitImageCropMode(); // Exit image crop mode too

            isHistoryProcessing = true;

            // Save current canvas dimensions for canvas mode
            const currentWidth = canvas.getWidth();
            const currentHeight = canvas.getHeight();

            historyIndex--;
            const json = history[historyIndex];

            // For canvas mode, apply the saved project size first and remove existing boundary
            if (isCanvasMode) {
                const w = json?.width || currentWidth;
                const h = json?.height || currentHeight;
                // Apply logical project dimensions so loaded objects keep correct positions
                canvas.setDimensions({ width: w, height: h });

                // Remove any existing boundary before loading JSON to avoid duplicates
                const existingBoundaryPre = canvas
                    .getObjects()
                    .find((o: any) => o._isCanvasBackground);
                if (existingBoundaryPre) canvas.remove(existingBoundaryPre);
            }

            await canvas.loadFromJSON(json);

            // For canvas mode, ensure boundary exists and has correct size/fill
            if (isCanvasMode) {
                const w = json?.width || currentWidth;
                const h = json?.height || currentHeight;
                const bgFill = (json && json.bgFill) || 'transparent';

                // If JSON included a boundary, update it; otherwise create one
                const existingBoundary = canvas
                    .getObjects()
                    .find((o: any) => o._isCanvasBackground);
                if (existingBoundary) {
                    try {
                        existingBoundary.set({
                            left: 0,
                            top: 0,
                            width: w,
                            height: h,
                            fill: bgFill,
                        });
                        existingBoundary.setCoords && existingBoundary.setCoords();
                        canvas.sendObjectToBack(existingBoundary);
                    } catch (e) {}
                } else {
                    const boundaryRect = new CanvasBackgroundRect({
                        left: 0,
                        top: 0,
                        width: w,
                        height: h,
                        fill: bgFill,
                        stroke: '#e0e0e0',
                        strokeWidth: 2,
                        strokeDashArray: [10, 5],
                        selectable: false,
                        evented: false,
                        hoverCursor: 'default',
                        excludeFromExport: true,
                    });
                    canvas.add(boundaryRect);
                    canvas.sendObjectToBack(boundaryRect);
                }
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
                    actual._outerRadius = json.backgroundImage._outerRadius;
                    actual._borderEnabled = json.backgroundImage._borderEnabled;
                    actual._borderFill = json.backgroundImage._borderFill;
                    actual._borderRadius = json.backgroundImage._borderRadius;
                    actual._borderShadowBlur = json.backgroundImage._borderShadowBlur;
                    actual._borderShadowColor = json.backgroundImage._borderShadowColor;
                    actual._borderShadowOpacity = json.backgroundImage._borderShadowOpacity;
                }
                bg._originalSrc = json.backgroundImage._originalSrc;
                bg._cropOffset = json.backgroundImage._cropOffset;
                bg._appliedMargin = json.backgroundImage._appliedMargin;
                bg._unborderedSrc = json.backgroundImage._unborderedSrc;
                bg._outerRadius = json.backgroundImage._outerRadius;
                bg._borderEnabled = json.backgroundImage._borderEnabled;
                bg._borderFill = json.backgroundImage._borderFill;
                bg._borderRadius = json.backgroundImage._borderRadius;
                bg._borderShadowBlur = json.backgroundImage._borderShadowBlur;
                bg._borderShadowColor = json.backgroundImage._borderShadowColor;
                bg._borderShadowOpacity = json.backgroundImage._borderShadowOpacity;
            }

            restoreObjectSelectionStates();
            updateCurrentNumberFromCanvas();
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
            if (isImageCropping) exitImageCropMode(); // Exit image crop mode too

            isHistoryProcessing = true;

            // Save current canvas dimensions for canvas mode
            const currentWidth = canvas.getWidth();
            const currentHeight = canvas.getHeight();

            historyIndex++;
            const json = history[historyIndex];

            // For canvas mode, apply the saved project size first and remove existing boundary
            if (isCanvasMode) {
                const w = json?.width || currentWidth;
                const h = json?.height || currentHeight;
                canvas.setDimensions({ width: w, height: h });
                const existingBoundaryPre = canvas
                    .getObjects()
                    .find((o: any) => o._isCanvasBackground);
                if (existingBoundaryPre) canvas.remove(existingBoundaryPre);
            }

            await canvas.loadFromJSON(json);

            // For canvas mode, ensure boundary exists and has correct size/fill
            if (isCanvasMode) {
                const w = json?.width || currentWidth;
                const h = json?.height || currentHeight;
                const bgFill = (json && json.bgFill) || 'transparent';

                const existingBoundary = canvas
                    .getObjects()
                    .find((o: any) => o._isCanvasBackground);
                if (existingBoundary) {
                    try {
                        existingBoundary.set({
                            left: 0,
                            top: 0,
                            width: w,
                            height: h,
                            fill: bgFill,
                        });
                        existingBoundary.setCoords && existingBoundary.setCoords();
                        canvas.sendObjectToBack(existingBoundary);
                    } catch (e) {}
                } else {
                    const boundaryRect = new CanvasBackgroundRect({
                        left: 0,
                        top: 0,
                        width: w,
                        height: h,
                        fill: bgFill,
                        stroke: '#e0e0e0',
                        strokeWidth: 2,
                        strokeDashArray: [10, 5],
                        selectable: false,
                        evented: false,
                        hoverCursor: 'default',
                        excludeFromExport: true,
                    });
                    canvas.add(boundaryRect);
                    canvas.sendObjectToBack(boundaryRect);
                }
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
                    actual._outerRadius = json.backgroundImage._outerRadius;
                    actual._borderEnabled = json.backgroundImage._borderEnabled;
                    actual._borderFill = json.backgroundImage._borderFill;
                    actual._borderRadius = json.backgroundImage._borderRadius;
                    actual._borderShadowBlur = json.backgroundImage._borderShadowBlur;
                    actual._borderShadowColor = json.backgroundImage._borderShadowColor;
                    actual._borderShadowOpacity = json.backgroundImage._borderShadowOpacity;
                }
                bg._originalSrc = json.backgroundImage._originalSrc;
                bg._cropOffset = json.backgroundImage._cropOffset;
                bg._appliedMargin = json.backgroundImage._appliedMargin;
                bg._unborderedSrc = json.backgroundImage._unborderedSrc;
                bg._outerRadius = json.backgroundImage._outerRadius;
                bg._borderEnabled = json.backgroundImage._borderEnabled;
                bg._borderFill = json.backgroundImage._borderFill;
                bg._borderRadius = json.backgroundImage._borderRadius;
                bg._borderShadowBlur = json.backgroundImage._borderShadowBlur;
                bg._borderShadowColor = json.backgroundImage._borderShadowColor;
                bg._borderShadowOpacity = json.backgroundImage._borderShadowOpacity;
            }

            // For canvas mode, add boundary rectangle
            if (isCanvasMode) {
                const w = json.width || canvas.getWidth();
                const h = json.height || canvas.getHeight();
                const bgFill = json.bgFill || 'transparent';

                // Remove any existing boundary
                const existingBoundary = canvas
                    .getObjects()
                    .find((o: any) => o._isCanvasBackground);
                if (existingBoundary) {
                    canvas.remove(existingBoundary);
                }

                // Add new boundary rectangle
                const boundaryRect = new CanvasBackgroundRect({
                    left: 0,
                    top: 0,
                    width: w,
                    height: h,
                    fill: bgFill,
                    stroke: '#e0e0e0',
                    strokeWidth: 2,
                    strokeDashArray: [10, 5],
                    selectable: false,
                    evented: false,
                    hoverCursor: 'default',
                    excludeFromExport: true,
                });
                canvas.add(boundaryRect);
                canvas.sendObjectToBack(boundaryRect);
                // Ensure the logical background fill object exists and is updated
                try {
                    setCanvasBackground(bgFill);
                } catch (e) {}
            }

            restoreObjectSelectionStates();
            updateCurrentNumberFromCanvas();
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

    export function getStoredBorderOptions() {
        if (!canvas || !canvas.backgroundImage) return null;
        const bg = canvas.backgroundImage as any;
        if (bg._appliedMargin === undefined && bg._borderEnabled === undefined) return null;

        return {
            enabled: bg._borderEnabled !== false,
            fill: bg._borderFill,
            margin: bg._appliedMargin,
            radius: bg._borderRadius,
            outerRadius: bg._outerRadius,
            shadowBlur: bg._borderShadowBlur,
            shadowColor: bg._borderShadowColor,
            shadowOpacity: bg._borderShadowOpacity,
        };
    }

    export function getToolOptions() {
        if (activeTool === 'number-marker') {
            const active = canvas?.getActiveObject();
            if (active && active.type === 'number-marker') {
                return {
                    count: active.count,
                    textColor: active.textColor,
                    fontSize: active.fontSize,
                    nextNumber: currentNumber,
                    isSelection: true,
                };
            } else {
                return {
                    ...(activeToolOptions || {}),
                    fontSize: activeToolOptions?.fontSize || 20, // default
                    count: currentNumber,
                    nextNumber: currentNumber, // If selection active, this value might be overridden by updated logic below to show global next
                    isSelection: false,
                };
            }
        }

        // For canvas/transform tools, if width/height are not set, return current project dimensions
        if (
            activeTool === 'canvas' ||
            activeTool === 'transform' ||
            activeTool === 'image-border' ||
            activeTool === 'image' // Handle image tool
        ) {
            const opts = { ...(activeToolOptions || {}) };
            if (typeof opts.width === 'undefined' || typeof opts.height === 'undefined') {
                if (canvas) {
                    if (isCanvasMode) {
                        const boundary = canvas
                            .getObjects()
                            .find((o: any) => o._isCanvasBackground);
                        if (boundary) {
                            opts.width = Math.round(boundary.width);
                            opts.height = Math.round(boundary.height);
                        }
                    } else if (canvas.backgroundImage) {
                        const bg = canvas.backgroundImage;
                        opts.width = Math.round((bg.width || 0) * (bg.scaleX || 1));
                        opts.height = Math.round((bg.height || 0) * (bg.scaleY || 1));
                    }
                }
            }
            // If an image is selected, update options with its dimensions
            if (activeTool === 'image') {
                const activeObject = canvas?.getActiveObject();
                if (activeObject && activeObject.type === 'image') {
                    opts.width = Math.round(activeObject.getScaledWidth());
                    opts.height = Math.round(activeObject.getScaledHeight());
                    opts.lockAspectRatio = (activeObject as any).lockUniScaling;
                }
            }
            return opts;
        }

        return activeToolOptions || {};
    }

    export function applyToolOptionsToSelection(options: any) {
        try {
            if (!canvas) return;
            if (activeTool === 'image-border') {
                updateImageBorder(options);
                canvas.requestRenderAll();
                schedulePushWithType('modified');
                return;
            }

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
                    } else if (o.type === 'magnifier-rect') {
                        // Apply stroke and strokeWidth to the magnifier view itself
                        if (typeof options.stroke !== 'undefined') {
                            o.set('stroke', options.stroke);
                            o.dirty = true;
                        }
                        if (typeof options.strokeWidth !== 'undefined') {
                            o.set('strokeWidth', options.strokeWidth);
                            o.dirty = true;
                        }

                        if (typeof options.magnification !== 'undefined') {
                            o.set('magnification', options.magnification);
                            o.dirty = true;

                            // Sync View rect size based on constant Source
                            if (o.sourceId && canvas) {
                                const sourceObj = canvas
                                    .getObjects()
                                    .find((obj: any) => obj.id === o.sourceId);
                                if (sourceObj) {
                                    try {
                                        const mag = Math.max(1, options.magnification);
                                        const sourceW = sourceObj.getScaledWidth();
                                        const sourceH = sourceObj.getScaledHeight();

                                        // Update View dimensions
                                        const center = o.getCenterPoint();
                                        o.set({
                                            width: sourceW * mag,
                                            height: sourceH * mag,
                                            scaleX: 1,
                                            scaleY: 1,
                                        });
                                        o.setPositionByOrigin(center, 'center', 'center');
                                        o.setCoords();
                                    } catch (e) {
                                        console.warn('Failed to sync view rect', e);
                                    }
                                }
                            }
                        }

                        if (typeof options.magnifierShape !== 'undefined') {
                            o.set('magnifierShape', options.magnifierShape);
                            o.dirty = true;
                            // Sync to source
                            if (o.sourceId && canvas) {
                                const sourceObj = canvas
                                    .getObjects()
                                    .find((obj: any) => obj.id === o.sourceId);
                                if (sourceObj) {
                                    sourceObj.set('magnifierShape', options.magnifierShape);
                                    sourceObj.dirty = true;
                                }
                            }
                        }

                        if (
                            typeof options.sourceStroke !== 'undefined' ||
                            typeof options.sourceStrokeWidth !== 'undefined'
                        ) {
                            if (o.sourceId && canvas) {
                                const sourceObj = canvas
                                    .getObjects()
                                    .find((obj: any) => obj.id === o.sourceId);
                                if (sourceObj) {
                                    if (typeof options.sourceStroke !== 'undefined') {
                                        sourceObj.set('stroke', options.sourceStroke);
                                    }
                                    if (typeof options.sourceStrokeWidth !== 'undefined') {
                                        sourceObj.set('strokeWidth', options.sourceStrokeWidth);
                                    }
                                    sourceObj.dirty = true;
                                    canvas.requestRenderAll();
                                }
                            }
                        }

                        if (
                            typeof options.connectionStroke !== 'undefined' ||
                            typeof options.connectionStrokeWidth !== 'undefined'
                        ) {
                            if (canvas) {
                                const line = canvas
                                    .getObjects()
                                    .find(
                                        (obj: any) =>
                                            obj.type === 'magnifier-connection-line' &&
                                            obj.viewId === o.id
                                    );
                                if (line) {
                                    if (typeof options.connectionStroke !== 'undefined') {
                                        line.set('stroke', options.connectionStroke);
                                    }
                                    if (typeof options.connectionStrokeWidth !== 'undefined') {
                                        line.set('strokeWidth', options.connectionStrokeWidth);
                                    }
                                    line.dirty = true;
                                    canvas.requestRenderAll();
                                }
                            }
                        }
                    } else if (o.type === 'magnifier-source-rect') {
                        // Apply settings to self (source rect) or linked view
                        if (typeof options.sourceStroke !== 'undefined') {
                            o.set('stroke', options.sourceStroke);
                        }
                        if (typeof options.sourceStrokeWidth !== 'undefined') {
                            o.set('strokeWidth', options.sourceStrokeWidth);
                        }
                        o.dirty = true;

                        if (typeof options.magnifierShape !== 'undefined') {
                            o.set('magnifierShape', options.magnifierShape);
                            o.dirty = true;
                            // Sync to view
                            if (o.viewId && canvas) {
                                const viewObj = canvas
                                    .getObjects()
                                    .find((obj: any) => obj.id === o.viewId);
                                if (viewObj) {
                                    viewObj.set('magnifierShape', options.magnifierShape);
                                    viewObj.dirty = true;
                                }
                            }
                        }

                        // Apply magnification/stroke to linked view
                        if (canvas && o.viewId) {
                            const viewObj = canvas
                                .getObjects()
                                .find((obj: any) => obj.id === o.viewId);
                            if (viewObj) {
                                if (typeof options.magnification !== 'undefined') {
                                    viewObj.set('magnification', options.magnification);
                                    // Sync source size backwards
                                    const mag = Math.max(1, options.magnification);
                                    const w = (viewObj.width * (viewObj.scaleX || 1)) / mag;
                                    const h = (viewObj.height * (viewObj.scaleY || 1)) / mag;
                                    const center = o.getCenterPoint();
                                    o.set({
                                        width: w,
                                        height: h,
                                        scaleX: 1,
                                        scaleY: 1,
                                    });
                                    o.setPositionByOrigin(center, 'center', 'center');
                                    o.setCoords();
                                }
                                if (typeof options.stroke !== 'undefined') {
                                    viewObj.set('stroke', options.stroke);
                                }
                                if (typeof options.strokeWidth !== 'undefined') {
                                    viewObj.set('strokeWidth', options.strokeWidth);
                                }
                                viewObj.dirty = true;
                            }
                        }

                        if (
                            typeof options.connectionStroke !== 'undefined' ||
                            typeof options.connectionStrokeWidth !== 'undefined'
                        ) {
                            if (canvas) {
                                const line = canvas
                                    .getObjects()
                                    .find(
                                        (obj: any) =>
                                            obj.type === 'magnifier-connection-line' &&
                                            obj.sourceId === o.id
                                    );
                                if (line) {
                                    if (typeof options.connectionStroke !== 'undefined') {
                                        line.set('stroke', options.connectionStroke);
                                    }
                                    if (typeof options.connectionStrokeWidth !== 'undefined') {
                                        line.set('strokeWidth', options.connectionStrokeWidth);
                                    }
                                    line.dirty = true;
                                    canvas.requestRenderAll();
                                }
                            }
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
                        if ((o as any).isEditing) {
                            // Apply to selected text range
                            const styles: any = {};
                            if (typeof options.family !== 'undefined')
                                styles.fontFamily = options.family;
                            if (typeof options.size !== 'undefined')
                                styles.fontSize = +options.size;
                            if (typeof options.fill !== 'undefined') styles.fill = options.fill;
                            if (typeof options.stroke !== 'undefined')
                                styles.stroke = options.stroke;
                            if (typeof options.strokeWidth !== 'undefined')
                                styles.strokeWidth = options.strokeWidth;
                            if (typeof options.bold !== 'undefined')
                                styles.fontWeight = options.bold ? 'bold' : 'normal';
                            if (typeof options.italic !== 'undefined')
                                styles.fontStyle = options.italic ? 'italic' : 'normal';

                            if (Object.keys(styles).length > 0) {
                                (o as any).setSelectionStyles(styles);
                            }
                        } else {
                            // Apply to whole object (clear character styles to enforce uniformity)
                            const cleanStyle = (prop: string) => {
                                if (!o.styles) return;
                                for (const row in o.styles) {
                                    for (const char in o.styles[row]) {
                                        delete o.styles[row][char][prop];
                                    }
                                }
                            };

                            if (typeof options.family !== 'undefined') {
                                o.set('fontFamily', options.family);
                                cleanStyle('fontFamily');
                            }
                            if (typeof options.size !== 'undefined') {
                                o.set('fontSize', +options.size);
                                cleanStyle('fontSize');
                            }
                            if (typeof options.fill !== 'undefined') {
                                o.set('fill', options.fill);
                                cleanStyle('fill');
                            }
                            if (typeof options.stroke !== 'undefined') {
                                o.set('stroke', options.stroke);
                                cleanStyle('stroke');
                            }
                            if (typeof options.strokeWidth !== 'undefined') {
                                o.set('strokeWidth', options.strokeWidth);
                                cleanStyle('strokeWidth');
                            }
                            if (typeof options.bold !== 'undefined') {
                                o.set('fontWeight', options.bold ? 'bold' : 'normal');
                                cleanStyle('fontWeight');
                            }
                            if (typeof options.italic !== 'undefined') {
                                o.set('fontStyle', options.italic ? 'italic' : 'normal');
                                cleanStyle('fontStyle');
                            }
                        }
                        o.dirty = true;
                        o.setCoords && o.setCoords();
                    } else {
                        // shapes and other objects
                        if (typeof options.stroke !== 'undefined') o.set('stroke', options.stroke);
                        if (typeof options.strokeWidth !== 'undefined')
                            o.set('strokeWidth', options.strokeWidth);
                        // Handle fill and fillOpacity for shapes
                        if (
                            typeof options.fill !== 'undefined' ||
                            typeof options.fillOpacity !== 'undefined'
                        ) {
                            const currentFill = o.fill;
                            const targetFill =
                                typeof options.fill !== 'undefined' ? options.fill : currentFill;
                            const targetOpacity =
                                typeof options.fillOpacity !== 'undefined'
                                    ? options.fillOpacity
                                    : typeof activeToolOptions.fillOpacity !== 'undefined'
                                      ? activeToolOptions.fillOpacity
                                      : 1;

                            if (targetFill) {
                                // Apply opacity to the chosen fill
                                o.set('fill', colorWithOpacity(targetFill, targetOpacity));
                            } else {
                                o.set('fill', null);
                            }
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
                        if (typeof options.anchorStyle !== 'undefined' && 'anchorStyle' in o) {
                            const oldAnchorStyle = o.anchorStyle;
                            const newAnchorStyle = options.anchorStyle;

                            // Convert controlOffset when switching between modes to maintain visual position
                            if (
                                oldAnchorStyle !== newAnchorStyle &&
                                'controlOffsetX' in o &&
                                'controlOffsetY' in o
                            ) {
                                if (oldAnchorStyle === 'curved' && newAnchorStyle === 'straight') {
                                    // Curved to straight: the visual position is controlOffset * 2*t*(1-t) = controlOffset * 0.5
                                    // So to maintain position, divide by 2
                                    o.set('controlOffsetX', o.controlOffsetX / 2);
                                    o.set('controlOffsetY', o.controlOffsetY / 2);
                                } else if (
                                    oldAnchorStyle === 'straight' &&
                                    newAnchorStyle === 'curved'
                                ) {
                                    // Straight to curved: multiply by 2 to maintain visual position
                                    o.set('controlOffsetX', o.controlOffsetX * 2);
                                    o.set('controlOffsetY', o.controlOffsetY * 2);
                                }
                            }

                            o.set('anchorStyle', options.anchorStyle);
                            o.dirty = true;
                        }
                        // Handle custom NumberMarker class
                        if (o.type === 'number-marker') {
                            if (typeof options.count !== 'undefined') {
                                o.set('count', options.count);
                                o.dirty = true;
                                updateCurrentNumberFromCanvas();
                            }
                            if (typeof options.fontSize !== 'undefined') {
                                o.set('fontSize', options.fontSize);
                                const radius = options.fontSize * 0.8;
                                o.set('width', radius * 2);
                                o.set('height', radius * 2);
                                o.dirty = true;
                            }
                        }

                        // image objects
                        if (o.type === 'image') {
                            if (
                                typeof options.width !== 'undefined' ||
                                typeof options.height !== 'undefined'
                            ) {
                                const curW = o.getScaledWidth();
                                const curH = o.getScaledHeight();
                                const ratio = curW / curH;
                                const lock = options.lockAspectRatio !== false;

                                let newW =
                                    typeof options.width !== 'undefined' ? options.width : curW;
                                let newH =
                                    typeof options.height !== 'undefined' ? options.height : curH;

                                if (lock) {
                                    if (
                                        typeof options.width !== 'undefined' &&
                                        typeof options.height === 'undefined'
                                    ) {
                                        newH = Math.round(newW / ratio);
                                    } else if (
                                        typeof options.height !== 'undefined' &&
                                        typeof options.width === 'undefined'
                                    ) {
                                        newW = Math.round(newH * ratio);
                                    }
                                }

                                o.set({
                                    scaleX: newW / (o.width || 1),
                                    scaleY: newH / (o.height || 1),
                                    lockUniScaling: lock,
                                });
                                o.setCoords();

                                // Update tool options to reflect new state
                                activeToolOptions.width = Math.round(newW);
                                activeToolOptions.height = Math.round(newH);
                                setTimeout(() => {
                                    dispatch('selection', {
                                        options: { ...activeToolOptions },
                                        type: 'image',
                                    });
                                }, 10);
                            }
                            if (typeof options.lockAspectRatio !== 'undefined') {
                                o.set('lockAspectRatio', options.lockAspectRatio);
                                o.set('lockUniScaling', options.lockAspectRatio);
                            }
                        }
                    }
                    o.setCoords && o.setCoords();
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
                // Export based on the boundary rectangle (project size)
                const boundary = canvas.getObjects().find((o: any) => o._isCanvasBackground);
                if (boundary) {
                    imgW = boundary.width;
                    imgH = boundary.height;
                    tx = -boundary.left;
                    ty = -boundary.top;
                } else {
                    imgW = canvas.getWidth();
                    imgH = canvas.getHeight();
                    tx = 0;
                    ty = 0;
                }
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
            const boundaryRect = canvas.getObjects().find((o: any) => o._isCanvasBackground);
            const boundaryWasVisible = boundaryRect?.visible;
            if (boundaryRect) {
                boundaryRect.set('visible', false);
            }

            // Set background color to boundary fill to avoid transparent blanks
            const currentBgColor = canvas.backgroundColor;
            if (boundaryRect && boundaryRect.fill) {
                canvas.backgroundColor = boundaryRect.fill;
            }

            canvas.renderAll();

            // 5. Export
            const result = canvas.toDataURL({
                format: options.format as any,
                quality: options.quality,
                multiplier: isCanvasMode ? 3 : 1,
                enableRetinaScaling: false,
            });

            // Restore boundary visibility and background color
            if (boundaryRect && boundaryWasVisible) {
                boundaryRect.set('visible', true);
            }
            canvas.backgroundColor = currentBgColor;

            return result;
        } finally {
            // Restore state
            canvas.setDimensions({ width: currentW, height: currentH });
            if (currentVPT) (canvas as any).setViewportTransform(currentVPT);
            canvas.renderAll();
        }
    }

    export async function toJSON() {
        if (!canvas) return null;
        // Standard toObject includes HISTORY_PROPS for top-level objects.
        const json = (canvas as any).toObject(HISTORY_PROPS);

        // For canvas mode, add project dimensions from boundary rectangle and remove backgroundImage to avoid blob URL issues
        if (isCanvasMode) {
            const boundary = canvas.getObjects().find((o: any) => o._isCanvasBackground);
            if (boundary) {
                json.width = boundary.width;
                json.height = boundary.height;
                json.bgFill = boundary.fill; // Save background fill
            } else {
                json.width = canvas.getWidth();
                json.height = canvas.getHeight();
            }
            if (json.backgroundImage) {
                delete json.backgroundImage;
            }

            // Convert blob URLs to base64 data URLs for permanent storage
            if (json.objects) {
                const conversionPromises: Promise<void>[] = [];

                json.objects.forEach((obj: any, index: number) => {
                    // Fabric.js uses 'Image' (capital I) for image objects
                    if (
                        obj.type &&
                        obj.type.toLowerCase() === 'image' &&
                        obj.src &&
                        obj.src.startsWith('blob:')
                    ) {
                        // Create a promise to convert blob URL to data URL
                        const conversionPromise = new Promise<void>(resolve => {
                            const img = new Image();
                            img.crossOrigin = 'anonymous';
                            img.onload = () => {
                                try {
                                    const tempCanvas = document.createElement('canvas');
                                    tempCanvas.width = img.naturalWidth || img.width;
                                    tempCanvas.height = img.naturalHeight || img.height;
                                    const ctx = tempCanvas.getContext('2d');
                                    if (ctx) {
                                        ctx.drawImage(img, 0, 0);
                                        const dataURL = tempCanvas.toDataURL('image/png');
                                        obj.src = dataURL;
                                    }
                                } catch (e) {
                                    console.error(`Failed to convert image ${index} to base64:`, e);
                                }
                                resolve();
                            };
                            img.onerror = () => {
                                console.error(
                                    `Failed to load image ${index} from blob URL:`,
                                    obj.src
                                );
                                resolve();
                            };
                            img.src = obj.src;
                        });

                        conversionPromises.push(conversionPromise);
                    }
                });

                // Wait for all conversions to complete
                if (conversionPromises.length > 0) {
                    await Promise.all(conversionPromises);
                }
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
            json.backgroundImage._borderFill = bg._borderFill;
            json.backgroundImage._borderRadius = bg._borderRadius;
            json.backgroundImage._borderShadowBlur = bg._borderShadowBlur;
            json.backgroundImage._borderShadowColor = bg._borderShadowColor;
            json.backgroundImage._borderShadowOpacity = bg._borderShadowOpacity;
        }

        // Filter out canvas boundary and background objects from history to prevent them from being undone
        if (json.objects) {
            json.objects = json.objects.filter(
                (obj: any) => obj.type !== 'canvas-boundary' && obj.type !== 'canvas-background'
            );
        }
        return json;
    }

    export async function fromJSON(json: any) {
        if (!canvas) return;

        // Prevent history updates whilst loading JSON
        isHistoryProcessing = true;

        try {
            // Save current canvas dimensions for canvas mode
            const currentWidth = canvas.getWidth();
            const currentHeight = canvas.getHeight();

            await canvas.loadFromJSON(json);

            // Handle legacy canvas background objects (for backward compatibility)
            let legacyFill = null;
            const legacyBgObj = canvas.getObjects().find((o: any) => o._isCanvasBackground);
            if (legacyBgObj) {
                legacyFill =
                    legacyBgObj.fill && legacyBgObj.fill.toObject
                        ? legacyBgObj.fill.toObject()
                        : legacyBgObj.fill;
                canvas.remove(legacyBgObj);
            }

            // For canvas mode, restore workspace dimensions (canvas size) and add boundary
            if (isCanvasMode) {
                canvas.setDimensions({ width: currentWidth, height: currentHeight });

                const w = json.width || currentWidth;
                const h = json.height || currentHeight;
                const bgFill = legacyFill || json.bgFill || 'transparent';

                // Remove any existing boundary
                const existingBoundary = canvas
                    .getObjects()
                    .find((o: any) => o._isCanvasBackground);
                if (existingBoundary) {
                    canvas.remove(existingBoundary);
                }

                // Add new boundary rectangle
                const boundaryRect = new CanvasBackgroundRect({
                    left: 0,
                    top: 0,
                    width: w,
                    height: h,
                    stroke: '#e0e0e0',
                    strokeWidth: 2,
                    strokeDashArray: [10, 5],
                    selectable: false,
                    evented: false,
                    hoverCursor: 'default',
                    excludeFromExport: true,
                });
                canvas.add(boundaryRect);
                canvas.sendObjectToBack(boundaryRect);

                // Set background fill properly handling gradients
                if (bgFill && typeof bgFill === 'object' && bgFill.type === 'linear') {
                    try {
                        boundaryRect.set(
                            'fill',
                            new Gradient({
                                type: 'linear',
                                gradientUnits: bgFill.gradientUnits || 'pixels',
                                coords: bgFill.coords || { x1: 0, y1: 0, x2: w, y2: h },
                                colorStops: bgFill.colorStops || [],
                            })
                        );
                    } catch (e) {
                        boundaryRect.set('fill', '#ffffff');
                    }
                } else {
                    boundaryRect.set('fill', bgFill);
                }
            }

            // Resume number marker sequence if existing markers are found
            updateCurrentNumberFromCanvas();

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
                    actual._borderFill = json.backgroundImage._borderFill;
                    actual._borderRadius = json.backgroundImage._borderRadius;
                    actual._borderShadowBlur = json.backgroundImage._borderShadowBlur;
                    actual._borderShadowColor = json.backgroundImage._borderShadowColor;
                    actual._borderShadowOpacity = json.backgroundImage._borderShadowOpacity;
                }
                bg._originalSrc = json.backgroundImage._originalSrc;
                bg._cropOffset = json.backgroundImage._cropOffset;
                bg._appliedMargin = json.backgroundImage._appliedMargin;
                bg._unborderedSrc = json.backgroundImage._unborderedSrc;
                bg._outerRadius = json.backgroundImage._outerRadius;
                bg._borderEnabled = json.backgroundImage._borderEnabled;
                bg._borderFill = json.backgroundImage._borderFill;
                bg._borderRadius = json.backgroundImage._borderRadius;
                bg._borderShadowBlur = json.backgroundImage._borderShadowBlur;
                bg._borderShadowColor = json.backgroundImage._borderShadowColor;
                bg._borderShadowOpacity = json.backgroundImage._borderShadowOpacity;
            }

            // After loading, ensure all objects (except background) are selectable and evented
            restoreObjectSelectionStates();

            canvas!.renderAll();

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
            if (!canvas) return;
            const bg = canvas.backgroundImage;
            // Use background center if available, otherwise canvas center
            const center = bg ? bg.getCenterPoint() : canvas.getCenterPoint();

            // Flip background if exists
            if (bg) {
                bg.set('flipX', !bg.flipX);
                bg.setCoords();
            }

            // Flip all drawable objects relative to center
            try {
                const objs = canvas.getObjects ? canvas.getObjects() : [];
                objs.forEach((o: any) => {
                    try {
                        if (o._isCropRect || o === bg || (o as any)._isCanvasBackground) return;
                        const c = o.getCenterPoint();
                        // Mirror across the vertical axis passing through center.x
                        const newCenterX = center.x + (center.x - c.x);
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
            if (!canvas) return;
            const bg = canvas.backgroundImage;
            // Use background center if available, otherwise canvas center
            const center = bg ? bg.getCenterPoint() : canvas.getCenterPoint();

            // Flip background if exists
            if (bg) {
                bg.set('flipY', !bg.flipY);
                bg.setCoords();
            }

            // Flip all drawable objects relative to center
            try {
                const objs = canvas.getObjects ? canvas.getObjects() : [];
                objs.forEach((o: any) => {
                    try {
                        if (o._isCropRect || o === bg || (o as any)._isCanvasBackground) return;
                        const c = o.getCenterPoint();
                        // Mirror across the horizontal axis passing through center.y
                        const newCenterY = center.y + (center.y - c.y);
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
            if (!canvas) return;
            const bg = canvas.backgroundImage;

            // Get center point of current orientation
            const center = bg ? bg.getCenterPoint() : canvas.getCenterPoint();
            const angleDelta = clockwise ? 90 : -90;

            // 1. Rotate background if exists
            if (bg) {
                bg.set('angle', (bg.angle + angleDelta) % 360);
                bg.setCoords();
            }

            // 2. Rotate all drawable objects relative to the same center
            const objs = canvas
                .getObjects()
                .filter(
                    o => o !== bg && !(o as any)._isCropRect && !(o as any)._isCanvasBackground
                );
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
                o.set('angle', (o.angle + angleDelta) % 360);
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

    // Align selected objects. type examples: 'h-left','h-center','h-right','v-top','v-middle','v-bottom'
    export function alignObjects(type: string, forceCanvas: boolean = false) {
        try {
            if (!canvas) return;
            const objs = canvas.getActiveObjects ? canvas.getActiveObjects() : [];
            if (!objs || objs.length === 0) return;

            // filter drawable objects
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
                    'image',
                ].includes(o.type)
            );
            if (allowed.length === 0) return;

            // Determine reference rect: if multiple selected and not forcing canvas, use first selected
            let refRect: any = null;
            if (allowed.length > 1 && !forceCanvas) {
                try {
                    refRect = allowed[0].getBoundingRect();
                } catch (e) {
                    refRect = null;
                }
            }

            if (!refRect) {
                // Prefer using background image bounds as the canvas reference (editing mode)
                if (canvas.backgroundImage) {
                    try {
                        const bg = canvas.backgroundImage as any;
                        // Use Fabric's getBoundingRect to compute actual displayed bounds
                        const brect = bg.getBoundingRect();
                        refRect = {
                            left: brect.left,
                            top: brect.top,
                            width: brect.width,
                            height: brect.height,
                        };
                    } catch (e) {
                        refRect = null;
                    }
                }

                // Fallback to explicit canvas boundary if no background image
                if (!refRect) {
                    const boundary = canvas.getObjects().find((o: any) => o._isCanvasBackground);
                    if (boundary) {
                        refRect = {
                            left: boundary.left || 0,
                            top: boundary.top || 0,
                            width: boundary.width || canvas.getWidth(),
                            height: boundary.height || canvas.getHeight(),
                        };
                    } else {
                        refRect = {
                            left: 0,
                            top: 0,
                            width: canvas.getWidth(),
                            height: canvas.getHeight(),
                        };
                    }
                }
            }

            // For alignment we generally do not move the reference object (if ref is one of selection)
            const refObj = allowed.length > 1 && !forceCanvas ? allowed[0] : null;

            // Special handling for canvas-based center alignment with multiple objects
            // When aligning multiple objects to canvas center (h-center or v-middle),
            // treat them as a group and center the group as a whole
            if (forceCanvas && allowed.length > 1 && (type === 'h-center' || type === 'v-middle')) {
                // Calculate the overall bounding box of all selected objects
                let minLeft = Infinity;
                let minTop = Infinity;
                let maxRight = -Infinity;
                let maxBottom = -Infinity;

                allowed.forEach((o: any) => {
                    try {
                        const rect = o.getBoundingRect();
                        minLeft = Math.min(minLeft, rect.left);
                        minTop = Math.min(minTop, rect.top);
                        maxRight = Math.max(maxRight, rect.left + rect.width);
                        maxBottom = Math.max(maxBottom, rect.top + rect.height);
                    } catch (e) {}
                });

                const groupWidth = maxRight - minLeft;
                const groupHeight = maxBottom - minTop;

                // Calculate the offset needed to center the entire group
                let groupDx = 0;
                let groupDy = 0;

                if (type === 'h-center') {
                    const targetCenterX = refRect.left + refRect.width / 2;
                    const currentCenterX = minLeft + groupWidth / 2;
                    groupDx = targetCenterX - currentCenterX;
                }

                if (type === 'v-middle') {
                    const targetCenterY = refRect.top + refRect.height / 2;
                    const currentCenterY = minTop + groupHeight / 2;
                    groupDy = targetCenterY - currentCenterY;
                }

                // Apply the same offset to all objects to maintain their relative positions
                allowed.forEach((o: any) => {
                    try {
                        if (groupDx !== 0 || groupDy !== 0) {
                            o.left = (typeof o.left === 'number' ? o.left : 0) + groupDx;
                            o.top = (typeof o.top === 'number' ? o.top : 0) + groupDy;
                            o.setCoords && o.setCoords();
                        }
                    } catch (e) {}
                });
            } else {
                // Original behavior: align each object individually
                allowed.forEach((o: any) => {
                    try {
                        if (o === refObj) return;
                        const rect = o.getBoundingRect();
                        let dx = 0;
                        let dy = 0;
                        if (type === 'h-left') {
                            const target = refRect.left;
                            dx = target - rect.left;
                        } else if (type === 'h-center') {
                            const target = refRect.left + refRect.width / 2 - rect.width / 2;
                            dx = target - rect.left;
                        } else if (type === 'h-right') {
                            const target = refRect.left + refRect.width - rect.width;
                            dx = target - rect.left;
                        } else if (type === 'v-top') {
                            const target = refRect.top;
                            dy = target - rect.top;
                        } else if (type === 'v-middle') {
                            const target = refRect.top + refRect.height / 2 - rect.height / 2;
                            dy = target - rect.top;
                        } else if (type === 'v-bottom') {
                            const target = refRect.top + refRect.height - rect.height;
                            dy = target - rect.top;
                        }

                        if (dx !== 0 || dy !== 0) {
                            o.left = (typeof o.left === 'number' ? o.left : 0) + dx;
                            o.top = (typeof o.top === 'number' ? o.top : 0) + dy;
                            o.setCoords && o.setCoords();
                        }
                    } catch (e) {}
                });
            }

            canvas.requestRenderAll();
            // Update active selection by re-creating it to ensure coords are correct
            const activeObjects = canvas.getActiveObjects();
            if (activeObjects.length > 1) {
                canvas.discardActiveObject();
                const activeSelection = new ActiveSelection(activeObjects, { canvas });
                canvas.setActiveObject(activeSelection);
            }
            schedulePushWithType('modified');
        } catch (e) {
            console.warn('alignObjects failed', e);
        }
    }

    // Distribute selected objects. type examples: 'h-left','h-center','h-right','h-even','v-top','v-center','v-bottom','v-even'
    export function distributeObjects(type: string) {
        try {
            if (!canvas) return;
            const objs = canvas.getActiveObjects ? canvas.getActiveObjects() : [];
            if (!objs || objs.length < 2) return;

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
                    'image',
                ].includes(o.type)
            );
            if (allowed.length < 2) return;

            // compute key positions and sort
            const items = allowed.map(o => {
                const r = o.getBoundingRect();
                return { o, rect: r };
            });

            const horizontal = type.startsWith('h-');
            const keyFn = (it: any) => {
                const r = it.rect as any;
                if (type.endsWith('-left')) return r.left;
                if (type.endsWith('-right')) return r.left + r.width;
                if (type.endsWith('-center')) return r.left + r.width / 2;
                if (type.endsWith('-even')) return r.left + r.width / 2;
                if (type.endsWith('-top')) return r.top;
                if (type.endsWith('-bottom')) return r.top + r.height;
                if (type.endsWith('-center') && !horizontal) return r.top + r.height / 2;
                return horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
            };

            items.sort((a: any, b: any) => keyFn(a) - keyFn(b));

            const n = items.length;

            // If even distribution requested, compute gaps based on object edges (equal spacing between objects)
            if (type.endsWith('-even')) {
                if (horizontal) {
                    // sort by left
                    items.sort((a: any, b: any) => a.rect.left - b.rect.left);
                    const minLeft = items[0].rect.left;
                    const maxRight = items.reduce(
                        (acc: number, it: any) => Math.max(acc, it.rect.left + it.rect.width),
                        -Infinity
                    );
                    const totalWidths = items.reduce(
                        (acc: number, it: any) => acc + it.rect.width,
                        0
                    );
                    const gap = n > 1 ? (maxRight - minLeft - totalWidths) / (n - 1) : 0;
                    let cursor = minLeft;
                    items.forEach((it: any) => {
                        try {
                            const desiredLeft = cursor;
                            const delta = desiredLeft - it.rect.left;
                            it.o.left = (typeof it.o.left === 'number' ? it.o.left : 0) + delta;
                            it.o.setCoords && it.o.setCoords();
                            cursor = cursor + it.rect.width + gap;
                        } catch (e) {}
                    });
                } else {
                    // vertical even
                    items.sort((a: any, b: any) => a.rect.top - b.rect.top);
                    const minTop = items[0].rect.top;
                    const maxBottom = items.reduce(
                        (acc: number, it: any) => Math.max(acc, it.rect.top + it.rect.height),
                        -Infinity
                    );
                    const totalHeights = items.reduce(
                        (acc: number, it: any) => acc + it.rect.height,
                        0
                    );
                    const gap = n > 1 ? (maxBottom - minTop - totalHeights) / (n - 1) : 0;
                    let cursor = minTop;
                    items.forEach((it: any) => {
                        try {
                            const desiredTop = cursor;
                            const delta = desiredTop - it.rect.top;
                            it.o.top = (typeof it.o.top === 'number' ? it.o.top : 0) + delta;
                            it.o.setCoords && it.o.setCoords();
                            cursor = cursor + it.rect.height + gap;
                        } catch (e) {}
                    });
                }
            } else {
                const firstPos = keyFn(items[0]);
                const lastPos = keyFn(items[n - 1]);
                const gap = n > 1 ? (lastPos - firstPos) / (n - 1) : 0;
                items.forEach((it: any, idx: number) => {
                    try {
                        const current = keyFn(it);
                        const target = firstPos + gap * idx;
                        const delta = target - current;
                        if (horizontal) {
                            it.o.left = (typeof it.o.left === 'number' ? it.o.left : 0) + delta;
                        } else {
                            it.o.top = (typeof it.o.top === 'number' ? it.o.top : 0) + delta;
                        }
                        it.o.setCoords && it.o.setCoords();
                    } catch (e) {}
                });
            }

            canvas.requestRenderAll();
            // Update active selection by re-creating it to ensure coords are correct
            const activeObjects = canvas.getActiveObjects();
            if (activeObjects.length > 1) {
                canvas.discardActiveObject();
                const activeSelection = new ActiveSelection(activeObjects, { canvas });
                canvas.setActiveObject(activeSelection);
            }
            schedulePushWithType('modified');
        } catch (e) {
            console.warn('distributeObjects failed', e);
        }
    }

    // Resize canvas (for canvas mode)
    export function resizeCanvas(width: number, height: number) {
        if (!canvas || !isCanvasMode) return;

        try {
            // Update boundary rectangle (the project size)
            const boundaryRect = canvas.getObjects().find((o: any) => o._isCanvasBackground);
            if (boundaryRect) {
                boundaryRect.set({ width, height });
                boundaryRect.setCoords();
            }

            // Update background if exists
            if (activeToolOptions && activeToolOptions.fill) {
                setCanvasBackground(activeToolOptions.fill);
            } else {
                updateCanvasBackgroundSize();
            }

            // Fit to viewport
            fitImageToViewport();
            canvas.requestRenderAll();
            schedulePushWithType('modified');
            try {
                dispatch('canvasResized', { width, height });
            } catch (e) {}
        } catch (e) {
            console.error('CanvasEditor: resizeCanvas failed:', e);
        }
    }

    function updateCanvasBackgroundSize() {
        if (!canvas || !isCanvasMode) return;
        const bgNode = canvas.getObjects().find((o: any) => o._isCanvasBackground);
        const boundary = canvas.getObjects().find((o: any) => o._isCanvasBackground);
        if (bgNode && boundary) {
            bgNode.set({
                width: boundary.width,
                height: boundary.height,
                left: boundary.left,
                top: boundary.top,
            });
            // If it's a gradient, we might need to refresh it because coords depend on size
            const fill = activeToolOptions.fill;
            if (fill && typeof fill === 'string' && fill.startsWith('linear-gradient')) {
                setCanvasBackground(fill);
            }
        }
    }

    export function setCanvasBackground(fill: any) {
        if (!canvas || !isCanvasMode) return;

        let bgNode = canvas.getObjects().find((o: any) => (o as any)._isCanvasBackground) as Rect;
        const boundary = canvas
            .getObjects()
            .find((o: any) => (o as any)._isCanvasBackground) as Rect;

        const w = boundary ? boundary.width : (canvas as any).width || 800;
        const h = boundary ? boundary.height : (canvas as any).height || 600;
        const left = boundary ? boundary.left : 0;
        const top = boundary ? boundary.top : 0;

        if (!bgNode) {
            bgNode = new CanvasBackgroundRect({
                left,
                top,
                width: w,
                height: h,
                selectable: false,
                evented: false,
                excludeFromExport: false,
            });
            canvas.add(bgNode);
            canvas.sendObjectToBack(bgNode);
            if (boundary) canvas.sendObjectToBack(boundary);
        } else {
            bgNode.set({ left, top, width: w, height: h });
        }

        // Normalize fill: if missing, default to white to avoid black background on load
        let effectiveFill = typeof fill === 'undefined' || fill === null ? '#ffffff' : fill;

        // If fill is a serialized gradient object (from toObject), convert to Fabric Gradient
        if (effectiveFill && typeof effectiveFill === 'object' && effectiveFill.type === 'linear') {
            try {
                const gf = effectiveFill as any;
                bgNode.set(
                    'fill',
                    new Gradient({
                        type: 'linear',
                        gradientUnits: gf.gradientUnits || 'pixels',
                        coords: gf.coords || gf.coords || { x1: 0, y1: 0, x2: w, y2: h },
                        colorStops: gf.colorStops || gf.colorStops || [],
                    })
                );
            } catch (e) {
                bgNode.set('fill', '#ffffff');
            }
        } else if (
            typeof effectiveFill === 'string' &&
            effectiveFill.startsWith('linear-gradient')
        ) {
            const match = fill.match(
                /linear-gradient\((\d+)deg,\s*(#[a-fA-F0-9]{3,6})\s+0%,\s*(#[a-fA-F0-9]{3,6})\s+100%\)/i
            );
            if (match) {
                const angle = parseInt(match[1]);
                const c1 = match[2];
                const c2 = match[3];

                const angleRad = ((angle - 90) * Math.PI) / 180;
                const length = Math.abs(w * Math.cos(angleRad)) + Math.abs(h * Math.sin(angleRad));
                const halfLen = length / 2;

                bgNode.set(
                    'fill',
                    new Gradient({
                        type: 'linear',
                        gradientUnits: 'pixels',
                        coords: {
                            x1: w / 2 - Math.cos(angleRad) * halfLen,
                            y1: h / 2 - Math.sin(angleRad) * halfLen,
                            x2: w / 2 + Math.cos(angleRad) * halfLen,
                            y2: h / 2 + Math.sin(angleRad) * halfLen,
                        },
                        colorStops: [
                            { offset: 0, color: c1 },
                            { offset: 1, color: c2 },
                        ],
                    })
                );
            }
        } else {
            bgNode.set('fill', effectiveFill);
        }

        canvas.requestRenderAll();
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

            // Initialize metadata for cropping
            (fImg as any)._originalSrc = url;
            (fImg as any)._cropOffset = { x: 0, y: 0 };
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

    // Context menu functions
    function isEditableObject(obj: any): boolean {
        if (!obj) return false;
        // Allow context menu for shapes, arrows, text, mosaic, number markers, and images
        const editableTypes = [
            'rect',
            'ellipse',
            'circle',
            'group',
            'arrow',
            'line',
            'i-text',
            'textbox',
            'text',
            'mosaic-rect',
            'number-marker',
            'image',
            'path',
        ];
        if (!editableTypes.includes(obj.type)) return false;
        // Exclude special objects
        if (obj._isCanvasBackground || obj._isCropRect) return false;
        return true;
    }

    function showContextMenu(e: MouseEvent, target: any) {
        hideContextMenu();

        contextMenuTarget = target;
        contextMenu = document.createElement('div');
        contextMenu.className = 'canvas-context-menu';

        const isLocked = target.lockMovementX || target.lockMovementY;

        // determine selection state for grouping
        const activeObjs = canvas
            ? (canvas.getActiveObjects && canvas.getActiveObjects()) || []
            : [];
        const canGroup = activeObjs && activeObjs.length > 1;
        const isGroup = !!(
            target &&
            (target.type === 'group' || (target._objects && Array.isArray(target._objects)))
        );

        const menuItems: any[] = [];

        // Group / Ungroup options
        if (canGroup) {
            menuItems.push({ label: '组合', action: () => groupSelection() });
        }
        if (isGroup) {
            menuItems.push({ label: '取消组合', action: () => ungroupSelection() });
        }

        // Standard ordering actions
        menuItems.push({ label: '置于顶层', action: () => bringToFront() });
        menuItems.push({ label: '上移一层', action: () => bringForward() });
        menuItems.push({ label: '下移一层', action: () => sendBackward() });
        menuItems.push({ label: '置于底层', action: () => sendToBack() });
        menuItems.push({ label: '---', action: null });
        menuItems.push({ label: isLocked ? '解锁' : '锁定', action: () => toggleLock() });

        menuItems.forEach(item => {
            if (item.label === '---') {
                const divider = document.createElement('div');
                divider.className = 'menu-divider';
                contextMenu!.appendChild(divider);
            } else {
                const menuItem = document.createElement('div');
                menuItem.className = 'menu-item';
                menuItem.textContent = item.label;
                menuItem.onclick = () => {
                    if (item.action) item.action();
                    hideContextMenu();
                };
                contextMenu!.appendChild(menuItem);
            }
        });

        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(contextMenu);

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', hideContextMenu, { once: true });
        }, 0);
    }

    function hideContextMenu() {
        if (contextMenu && contextMenu.parentNode) {
            contextMenu.parentNode.removeChild(contextMenu);
        }
        contextMenu = null;
        contextMenuTarget = null;
    }

    function bringToFront() {
        if (!canvas || !contextMenuTarget) return;
        canvas.bringObjectToFront(contextMenuTarget);
        canvas.requestRenderAll();
        schedulePushWithType('modified');
    }

    function bringForward() {
        if (!canvas || !contextMenuTarget) return;
        canvas.bringObjectForward(contextMenuTarget);
        canvas.requestRenderAll();
        schedulePushWithType('modified');
    }

    function sendBackward() {
        if (!canvas || !contextMenuTarget) return;
        canvas.sendObjectBackwards(contextMenuTarget);
        canvas.requestRenderAll();
        schedulePushWithType('modified');
    }

    function sendToBack() {
        if (!canvas || !contextMenuTarget) return;
        canvas.sendObjectToBack(contextMenuTarget);
        canvas.requestRenderAll();
        schedulePushWithType('modified');
    }

    function toggleLock() {
        if (!canvas || !contextMenuTarget) return;
        const isLocked = contextMenuTarget.lockMovementX || contextMenuTarget.lockMovementY;

        contextMenuTarget.set({
            lockMovementX: !isLocked,
            lockMovementY: !isLocked,
            lockRotation: !isLocked,
            lockScalingX: !isLocked,
            lockScalingY: !isLocked,
            hasControls: isLocked, // Show controls when unlocked, hide when locked
        });

        canvas.requestRenderAll();
        schedulePushWithType('modified');
    }

    // Group selected objects into a Fabric Group
    function groupSelection() {
        if (!canvas) return;
        const active = canvas.getActiveObject() as any;
        if (!active) return;

        try {
            // Check if it's an active selection or has matching methods
            const objects = typeof active.removeAll === 'function' ? active.removeAll() : null;
            if (!objects || objects.length < 2) return;

            const group = new Group(objects, {
                selectable: true,
                evented: true,
            });
            canvas.add(group);
            canvas.setActiveObject(group);

            canvas.requestRenderAll();
            schedulePushWithType('modified');
            try {
                dispatch('grouped', { count: objects.length });
            } catch (e) {}
        } catch (e) {
            console.warn('groupSelection failed', e);
        }
    }

    // Ungroup a Fabric Group into individual objects
    function ungroupSelection() {
        if (!canvas || !contextMenuTarget) return;
        const target = contextMenuTarget as any;
        if (!target) return;

        try {
            // Support both direct group and active selection containing a group
            const groupObj = target.type === 'group' ? target : (canvas.getActiveObject() as any);
            if (!groupObj || groupObj.type !== 'group' || typeof groupObj.removeAll !== 'function')
                return;

            const objects = groupObj.removeAll();
            if (objects && objects.length > 0) {
                canvas.add(...objects);
            }
            canvas.remove(groupObj);
            if (typeof groupObj.dispose === 'function') groupObj.dispose();

            canvas.requestRenderAll();
            schedulePushWithType('modified');
            try {
                dispatch('ungrouped', { count: objects.length });
            } catch (e) {}
        } catch (e) {
            console.warn('ungroupSelection failed', e);
        }
    }
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

    :global(.canvas-context-menu) {
        position: fixed;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-theme-surface-lighter);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        padding: 4px;
        min-width: 140px;
        z-index: 10000;
        font-size: 13px;
    }

    :global(.canvas-context-menu .menu-item) {
        padding: 8px 12px;
        cursor: pointer;
        border-radius: 4px;
        color: var(--b3-theme-on-surface);
        transition: background-color 0.15s;
        user-select: none;
    }

    :global(.canvas-context-menu .menu-item:hover) {
        background: var(--b3-theme-primary-lightest);
        color: var(--b3-theme-primary);
    }

    :global(.canvas-context-menu .menu-divider) {
        height: 1px;
        background: var(--b3-theme-surface-lighter);
        margin: 4px 0;
    }
</style>
