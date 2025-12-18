<script lang="ts">
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import { fabric } from 'fabric';

    export let dataURL: string | null = null;
    export let fileName: string | undefined;
    export let blobURL: string | null = null;
    // active tool state
    let activeTool: string | null = null;
    let activeToolOptions: any = {};
    // shape drawing state
    let isDrawingShape = false;
    let shapeStart = { x: 0, y: 0 };
    let tempShape: any = null;

    let container: HTMLCanvasElement;
    let canvas: fabric.Canvas | null = null;
    const dispatch = createEventDispatcher();
    // Track if image has been loaded to prevent duplicate loads
    let imageLoaded = false;
    // History (undo/redo)
    let history: any[] = [];
    let historyIndex = -1;
    const MAX_HISTORY = 60;

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
            const json = canvas.toJSON(['selectable']);
            // If recent changes are rapid modifications, merge them into the last step
            const now = Date.now();
            const MERGE_THRESHOLD = 800; // ms
            if (
                lastActionType === 'modified' &&
                lastPushTime > 0 &&
                now - lastPushTime < MERGE_THRESHOLD &&
                historyIndex === history.length - 1
            ) {
                // replace last history snapshot
                history[historyIndex] = json;
            } else {
                // Truncate future history when pushing new state
                if (historyIndex < history.length - 1) {
                    history = history.slice(0, historyIndex + 1);
                }
                history.push(json);
                if (history.length > MAX_HISTORY) history.shift();
                historyIndex = history.length - 1;
            }
            lastPushTime = now;
            lastActionType = pendingActionType || null;
            notifyHistoryUpdate();
        } catch (e) {
            // ignore
        }
    }

    // pending action type to inform merging logic
    let pendingActionType: string | null = null;
    let lastActionType: string | null = null;
    let lastPushTime = 0;
    let onDocKeyShortcuts: ((e: KeyboardEvent) => void) | null = null;

    const schedulePushWithType = (type: string) => {
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
    function copySelectedShapes() {
        try {
            if (!canvas) return;
            const objs = (canvas.getActiveObjects && canvas.getActiveObjects()) || [];
            if (!objs || objs.length === 0) return;
            const allowed = objs.filter((o: any) => ['rect', 'ellipse', 'circle'].includes(o.type));
            if (allowed.length === 0) return;
            clipboard = allowed.map((o: any) => o.toObject(['selectable']));
            try {
                dispatch('copied', { count: clipboard.length });
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
                    'i-text',
                    'textbox',
                    'text',
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

    function pasteClipboard() {
        try {
            if (!canvas || !clipboard || clipboard.length === 0) return;
            (fabric.util as any).enlivenObjects(clipboard, (enlivened: any[]) => {
                if (!enlivened || enlivened.length === 0) return;
                const added: any[] = [];
                enlivened.forEach(o => {
                    // offset pasted objects slightly
                    o.left = (o.left || 0) + 12;
                    o.top = (o.top || 0) + 12;
                    o.selectable = true;
                    o.evented = true;
                    canvas.add(o);
                    added.push(o);
                });
                if (added.length) {
                    canvas.discardActiveObject();
                    if (added.length === 1) canvas.setActiveObject(added[0]);
                    else {
                        const group = new fabric.Group(added, { selectable: true });
                        canvas.add(group);
                        canvas.setActiveObject(group);
                    }
                    canvas.requestRenderAll();
                    schedulePushWithType('added');
                }
            });
        } catch (e) {}
    }

    onMount(() => {
        canvas = new fabric.Canvas(container, {
            selection: true,
            preserveObjectStacking: true,
            renderOnAddRemove: true,
        });

        // basic wheel zoom
        canvas.on('mouse:wheel', (opt: any) => {
            const delta = opt.e.deltaY;
            let zoom = canvas!.getZoom();
            zoom *= 0.999 ** delta;
            zoom = Math.max(0.1, Math.min(5, zoom));
            canvas!.setZoom(zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });

        dispatch('ready');

        // Attach basic history listeners (use typed scheduling for merging)
        canvas.on('object:added', () => schedulePushWithType('added'));
        canvas.on('object:modified', () => schedulePushWithType('modified'));
        canvas.on('object:removed', () => schedulePushWithType('removed'));

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

            const ctrl = e.ctrlKey || e.metaKey;
            if (!ctrl) return;
            const key = (e.key || '').toLowerCase();
            if (key === 'c') {
                e.preventDefault();
                copySelectedShapes();
            } else if (key === 'v') {
                e.preventDefault();
                pasteClipboard();
            }
        };
        document.addEventListener('keydown', onDocKeyShortcuts);

        // mouse handlers for panning and tools
        canvas.on('mouse:down', opt => {
            if (isSpaceDown) {
                const e = opt.e as MouseEvent;
                isDragging = true;
                lastPosX = e.clientX;
                lastPosY = e.clientY;
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
                    tempShape = new fabric.Rect({
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
                    });
                } else {
                    // use ellipse for circle-like drawing
                    tempShape = new fabric.Ellipse({
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
                    });
                }
                if (tempShape) {
                    canvas.add(tempShape);
                    canvas.requestRenderAll();
                }
                return;
            }
            // Arrow tool: start drawing a line
            if (activeTool === 'arrow') {
                arrowStart = { x: pointer.x, y: pointer.y };
                // create temporary line
                const line = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
                    stroke: activeToolOptions.stroke || '#ff0000',
                    strokeWidth: activeToolOptions.strokeWidth || 4,
                    selectable: false,
                    evented: false,
                });
                // Determine arrow heads presence
                const headLeftNeeded =
                    (activeToolOptions.arrowHead || 'right') === 'left' ||
                    (activeToolOptions.arrowHead || 'right') === 'both';
                const headRightNeeded =
                    (activeToolOptions.arrowHead || 'right') === 'right' ||
                    (activeToolOptions.arrowHead || 'right') === 'both';
                const headRight = headRightNeeded
                    ? new fabric.Triangle({
                          left: pointer.x,
                          top: pointer.y,
                          originX: 'center',
                          originY: 'center',
                          width: Math.max(8, (activeToolOptions.strokeWidth || 4) * 2.2),
                          height: Math.max(8, (activeToolOptions.strokeWidth || 4) * 2.6),
                          angle: 0,
                          fill: activeToolOptions.stroke || '#ff0000',
                          selectable: false,
                          evented: false,
                      })
                    : undefined;
                const headLeft = headLeftNeeded
                    ? new fabric.Triangle({
                          left: pointer.x,
                          top: pointer.y,
                          originX: 'center',
                          originY: 'center',
                          width: Math.max(8, (activeToolOptions.strokeWidth || 4) * 2.2),
                          height: Math.max(8, (activeToolOptions.strokeWidth || 4) * 2.6),
                          angle: 180,
                          fill: activeToolOptions.stroke || '#ff0000',
                          selectable: false,
                          evented: false,
                      })
                    : undefined;
                arrowTemp = { line, headLeft, headRight };
                canvas.add(line);
                if (headLeft) canvas.add(headLeft);
                if (headRight) canvas.add(headRight);
                canvas.requestRenderAll();
                return;
            }

            // Text tool: create or select an editable text object
            if (activeTool === 'text') {
                try {
                    // debug info to trace clicks
                    try {
                        console.debug('CanvasEditor: mouse down (text tool)', {
                            activeTool,
                            activeToolOptions,
                            pointer,
                        });
                    } catch (e) {}

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
                            activeToolOptions.family = hit.fontFamily || activeToolOptions.family;
                            activeToolOptions.size = hit.fontSize || activeToolOptions.size;
                            activeToolOptions.fill =
                                typeof hit.fill !== 'undefined' ? hit.fill : activeToolOptions.fill;
                            canvas.requestRenderAll();
                            // try to enter editing mode
                            try {
                                if (typeof (hit as any).enterEditing === 'function') {
                                    (hit as any).enterEditing();
                                    (hit as any).selectAll && (hit as any).selectAll();
                                } else if (typeof (hit as any).enterEdit === 'function') {
                                    (hit as any).enterEdit();
                                }
                            } catch (e) {
                                console.warn(
                                    'CanvasEditor: enter editing failed on existing text',
                                    e
                                );
                            }
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

                    let itext: any = null;
                    // Try common fabric text classes in order of preference
                    try {
                        if ((fabric as any).IText) {
                            itext = new (fabric as any).IText('文字', {
                                left: pointer.x,
                                top: pointer.y,
                                fontFamily,
                                fontSize,
                                fill,
                                selectable: true,
                                evented: true,
                            });
                        }
                    } catch (e) {
                        console.warn('CanvasEditor: IText creation failed', e);
                        itext = null;
                    }
                    if (!itext) {
                        try {
                            if ((fabric as any).Textbox) {
                                itext = new (fabric as any).Textbox('文字', {
                                    left: pointer.x,
                                    top: pointer.y,
                                    fontFamily,
                                    fontSize,
                                    fill,
                                    selectable: true,
                                    evented: true,
                                });
                            }
                        } catch (e) {
                            console.warn('CanvasEditor: Textbox creation failed', e);
                            itext = null;
                        }
                    }
                    if (!itext) {
                        try {
                            itext = new (fabric as any).Text('文字', {
                                left: pointer.x,
                                top: pointer.y,
                                fontFamily,
                                fontSize,
                                fill,
                                selectable: true,
                                evented: true,
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
                            family: active.fontFamily,
                            size: active.fontSize,
                            fill: active.fill,
                        },
                        type: active.type,
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
                } else {
                    dispatch('selection', { options: null, type: active.type });
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
            if (activeTool === 'arrow' && arrowTemp && arrowTemp.line) {
                const ln = arrowTemp.line;
                ln.set({ x2: pointer.x, y2: pointer.y });
                // update triangle position and rotation to match end direction
                const dx = pointer.x - (arrowStart.x || 0);
                const dy = pointer.y - (arrowStart.y || 0);
                const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                if (arrowTemp.headRight) {
                    arrowTemp.headRight.set({ left: pointer.x, top: pointer.y, angle: angle });
                }
                if (arrowTemp.headLeft) {
                    // left head should be at start and rotated opposite
                    arrowTemp.headLeft.set({
                        left: arrowStart.x,
                        top: arrowStart.y,
                        angle: angle + 180,
                    });
                }
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
                canvas.selection = true;
                return;
            }

            // finish arrow
            if (activeTool === 'arrow' && arrowTemp && arrowTemp.line) {
                try {
                    const parts: any[] = [];
                    arrowTemp.line.set({ selectable: true, evented: true });
                    parts.push(arrowTemp.line);
                    if (arrowTemp.headLeft) {
                        arrowTemp.headLeft.set({ selectable: true, evented: true });
                        parts.push(arrowTemp.headLeft);
                    }
                    if (arrowTemp.headRight) {
                        arrowTemp.headRight.set({ selectable: true, evented: true });
                        parts.push(arrowTemp.headRight);
                    }
                    const group = new fabric.Group(parts, {
                        selectable: true,
                        evented: true,
                    });
                    if (arrowTemp.line) canvas.remove(arrowTemp.line);
                    if (arrowTemp.headLeft) canvas.remove(arrowTemp.headLeft);
                    if (arrowTemp.headRight) canvas.remove(arrowTemp.headRight);
                    canvas.add(group);
                    canvas.setActiveObject(group);
                    canvas.requestRenderAll();
                    schedulePushWithType('added');
                } catch (e) {}
                arrowTemp = {};
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
    });

    // Reactive statement to load image when dataURL changes (fixes race condition on first load)
    // Only load if image hasn't been loaded yet to prevent clearing canvas on state changes
    $: if (canvas && dataURL && !imageLoaded) {
        loadImageFromURL(dataURL, fileName);
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
        activeTool = tool;
        activeToolOptions = options || {};
        // provide sensible defaults for text tool
        if (tool === 'text') {
            activeToolOptions.family =
                activeToolOptions.family || activeToolOptions.fontFamily || 'Microsoft Yahei';
            activeToolOptions.size = activeToolOptions.size || activeToolOptions.fontSize || 24;
            activeToolOptions.fill = activeToolOptions.fill || '#000000';
        }
        // update cursor
        if (canvas) {
            if (tool === 'shape') canvas.defaultCursor = 'crosshair';
            else if (tool === 'arrow') canvas.defaultCursor = 'crosshair';
            else if (tool === 'brush') canvas.defaultCursor = 'crosshair';
            else if (tool === 'eraser') canvas.defaultCursor = 'crosshair';
            else if (tool === 'text') canvas.defaultCursor = 'text';
            else canvas.defaultCursor = 'default';
        }

        // configure brush mode
        if (canvas) {
            if (tool === 'brush') {
                canvas.isDrawingMode = true;
                const brush: any = (canvas as any).freeDrawingBrush;
                if (brush) {
                    brush.width = options.strokeWidth || options.size || 4;
                    brush.color = options.stroke || '#ff0000';
                    try {
                        brush.globalCompositeOperation = 'source-over';
                    } catch (e) {}
                }
            } else if (tool === 'eraser') {
                canvas.isDrawingMode = true;
                const brush: any = (canvas as any).freeDrawingBrush;
                if (brush) {
                    brush.width = options.strokeWidth || options.size || 16;
                    try {
                        brush.globalCompositeOperation = 'destination-out';
                    } catch (e) {
                        // fallback: draw white
                        brush.color = '#ffffff';
                    }
                }
            } else {
                canvas.isDrawingMode = false;
            }
        }
    }

    // Arrow drawing state
    let arrowTemp: { line?: fabric.Line; headLeft?: fabric.Triangle; headRight?: fabric.Triangle } =
        {};
    let arrowStart = { x: 0, y: 0 };

    // Crop mode state
    let cropMode = false;
    let cropRect: any = null;
    let _cropHandlers: any = null;
    let _cropKeyHandler: ((e: KeyboardEvent) => void) | null = null;

    // Crop helpers (exported)
    export function enterCropMode() {
        if (!canvas) return;
        if (cropMode) return;
        cropMode = true;

        // Deselect all objects
        try {
            canvas.discardActiveObject();
        } catch (e) {}

        // Disable selectability for existing objects during crop
        canvas.getObjects().forEach((obj: any) => {
            obj.selectable = false;
            obj.evented = false;
        });

        let isDrawing = false;
        let startX = 0;
        let startY = 0;

        const onMouseDown = (opt: any) => {
            if (cropRect) return;
            const pointer = canvas.getPointer(opt.e);
            isDrawing = true;
            startX = pointer.x;
            startY = pointer.y;
            cropRect = new fabric.Rect({
                type: 'custom-crop-rect',
                left: startX,
                top: startY,
                width: 0,
                height: 0,
                fill: 'rgba(0,0,0,0.25)',
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

        const onMouseMove = (opt: any) => {
            if (!isDrawing || !cropRect) return;
            const pointer = canvas.getPointer(opt.e);
            const width = pointer.x - startX;
            const height = pointer.y - startY;
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
                cropMode = false;
                // restore selectability
                canvas.getObjects().forEach((obj: any) => {
                    obj.selectable = true;
                    obj.evented = true;
                });
                canvas.requestRenderAll();
                return;
            }

            // finalize: apply crop immediately
            try {
                const left = Math.max(0, cropRect.left || 0);
                const top = Math.max(0, cropRect.top || 0);
                const cwidth = Math.min(width, canvas.getWidth());
                const cheight = Math.min(height, canvas.getHeight());

                // remove crop rectangle first
                try {
                    canvas.remove(cropRect);
                } catch (e) {}

                // shift objects
                canvas.getObjects().forEach((obj: any) => {
                    if (obj._isCropRect) return;
                    obj.left = (obj.left || 0) - left;
                    obj.top = (obj.top || 0) - top;
                    obj.setCoords();
                });

                // adjust background image
                if (canvas.backgroundImage) {
                    const bg = canvas.backgroundImage;
                    bg.left = (bg.left || 0) - left;
                    bg.top = (bg.top || 0) - top;
                    bg.setCoords();
                }

                // set canvas size
                canvas.setWidth(cwidth);
                canvas.setHeight(cheight);
                if (canvas.lowerCanvasEl && canvas.lowerCanvasEl.parentElement) {
                    const lower = canvas.lowerCanvasEl;
                    lower.style.width = `${cwidth}px`;
                    lower.style.height = `${cheight}px`;
                    lower.parentElement.style.width = `${cwidth}px`;
                    lower.parentElement.style.height = `${cheight}px`;
                }

                // reset viewport transform
                canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
                canvas.requestRenderAll();

                // record cropData and notify host
                const cropData = { left, top, width: cwidth, height: cheight };
                try {
                    dispatch('cropApplied', { cropData });
                } catch (e) {}
                schedulePushWithType('modified');
            } catch (e) {
                console.warn('Failed to apply crop', e);
            }

            cropRect = null;
            cropMode = false;

            // restore selectability
            canvas.getObjects().forEach((obj: any) => {
                obj.selectable = true;
                obj.evented = true;
            });
            canvas.requestRenderAll();
        };

        // Attach listeners
        canvas.on('mouse:down', onMouseDown);
        canvas.on('mouse:move', onMouseMove);
        canvas.on('mouse:up', onMouseUp);
        _cropHandlers = { onMouseDown, onMouseMove, onMouseUp };

        // keyboard shortcuts for crop
        _cropKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                // cancel
                try {
                    if (cropRect) {
                        canvas.remove(cropRect);
                        cropRect = null;
                    }
                } catch (err) {}
                cropMode = false;
                canvas.getObjects().forEach((obj: any) => {
                    obj.selectable = true;
                    obj.evented = true;
                });
                canvas.requestRenderAll();
            } else if (e.key === 'Enter') {
                // finalize immediately
                onMouseUp();
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

    export function exitCropMode() {
        if (!canvas || !cropMode) return;
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
        try {
            if (cropRect) {
                canvas.remove(cropRect);
                cropRect = null;
            }
        } catch (e) {}
        cropMode = false;
        try {
            document.removeEventListener('keydown', _cropKeyHandler as any);
        } catch (e) {}
        _cropKeyHandler = null;
        canvas.getObjects().forEach((obj: any) => {
            obj.selectable = true;
            obj.evented = true;
        });
        canvas.requestRenderAll();
    }

    // If there's a pending crop rectangle, apply it (used by host before save)
    export function applyPendingCrop() {
        try {
            if (_cropHandlers && _cropHandlers.onMouseUp) {
                _cropHandlers.onMouseUp();
            }
        } catch (e) {}
    }

    export async function loadImageFromURL(url: string, name?: string) {
        if (!canvas) return;
        return new Promise<void>((resolve, reject) => {
            try {
                // Use HTMLImageElement to get reliable success/error events (better for data URLs and local blobs)
                const imgEl = new Image();
                imgEl.crossOrigin = 'anonymous';
                imgEl.onload = () => {
                    try {
                        // reset canvas
                        canvas!.clear();
                        canvas!.setWidth((imgEl as any).width || 800);
                        canvas!.setHeight((imgEl as any).height || 600);
                        const fImg = new (fabric as any).Image(imgEl, { selectable: false });
                        fImg.set({ left: 0, top: 0, selectable: false });
                        canvas!.setBackgroundImage(fImg, canvas!.renderAll.bind(canvas));
                        canvas!.renderAll();

                        // Fit image to visible canvas container height by default and center it
                        try {
                            const lower = canvas!.lowerCanvasEl;
                            const containerEl =
                                lower && lower.parentElement
                                    ? (lower.parentElement as HTMLElement)
                                    : null;
                            const rect = containerEl ? containerEl.getBoundingClientRect() : null;
                            const containerH = rect
                                ? rect.height
                                : Math.min(window.innerHeight, imgEl.height);
                            const containerW = rect
                                ? rect.width
                                : Math.min(window.innerWidth, imgEl.width);
                            if (imgEl.height && containerH) {
                                const scale = containerH / imgEl.height;
                                // center the scaled image inside the visible area
                                const tx = Math.round((containerW - imgEl.width * scale) / 2);
                                const ty = Math.round((containerH - imgEl.height * scale) / 2);
                                canvas!.setZoom(scale);
                                // apply translation so the image is centered
                                canvas!.setViewportTransform([scale, 0, 0, scale, tx, ty]);
                                canvas!.requestRenderAll();
                            }
                        } catch (e) {}

                        dispatch('loaded', { width: imgEl.width, height: imgEl.height, name });
                        // Mark image as loaded to prevent duplicate loads from reactive statement
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

    function pushInitialHistory() {
        try {
            if (!canvas) return;
            history = [];
            historyIndex = -1;
            const json = canvas.toJSON(['selectable']);
            history.push(json);
            historyIndex = 0;
            notifyHistoryUpdate();
        } catch (e) {}
    }

    export function undo() {
        try {
            if (!canvas) return;
            if (historyIndex <= 0) return;
            historyIndex--;
            const json = history[historyIndex];
            canvas.loadFromJSON(json, () => {
                canvas.renderAll();
                notifyHistoryUpdate();
            });
        } catch (e) {}
    }

    export function redo() {
        try {
            if (!canvas) return;
            if (historyIndex >= history.length - 1) return;
            historyIndex++;
            const json = history[historyIndex];
            canvas.loadFromJSON(json, () => {
                canvas.renderAll();
                notifyHistoryUpdate();
            });
        } catch (e) {}
    }

    export function getToolOptions() {
        return activeToolOptions || {};
    }

    export function applyToolOptionsToSelection(options: any) {
        try {
            if (!canvas) return;
            const objs = canvas.getActiveObjects ? canvas.getActiveObjects() : [];
            if (!objs || objs.length === 0) return;
            objs.forEach((o: any) => {
                try {
                    // text objects
                    if (['i-text', 'textbox', 'text'].includes(o.type)) {
                        if (typeof options.family !== 'undefined')
                            o.set('fontFamily', options.family);
                        if (typeof options.size !== 'undefined') o.set('fontSize', +options.size);
                        if (typeof options.fill !== 'undefined') o.set('fill', options.fill);
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
                        o.setCoords && o.setCoords();
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

        // Save current viewport transform
        const currentVPT = canvas.viewportTransform ? [...canvas.viewportTransform] : null;

        try {
            // Reset viewport transform to export at original size without zoom/pan
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            canvas.renderAll();

            // Export the canvas at original dimensions
            const dataURL = canvas.toDataURL(options);

            return dataURL;
        } finally {
            // Restore original viewport transform
            if (currentVPT) {
                canvas.setViewportTransform(currentVPT);
                canvas.renderAll();
            }
        }
    }

    export function toJSON() {
        if (!canvas) return null;
        // Include selectable and evented properties so they can be restored
        return canvas.toJSON(['selectable', 'evented']);
    }

    export function fromJSON(json: any) {
        if (!canvas) return;
        console.log('CanvasEditor.fromJSON called with:', json);
        canvas.loadFromJSON(json, () => {
            console.log('loadFromJSON completed, objects count:', canvas!.getObjects().length);
            // After loading, ensure all objects (except background) are selectable and evented
            try {
                canvas!.getObjects().forEach((obj: any, index: number) => {
                    console.log(`Object ${index}:`, {
                        type: obj.type,
                        selectable: obj.selectable,
                        evented: obj.evented,
                        _isCropRect: obj._isCropRect,
                        isBackground: obj === canvas!.backgroundImage,
                    });

                    // Don't make crop rectangles or background images selectable
                    if (obj._isCropRect || obj === canvas!.backgroundImage) {
                        console.log(`Skipping object ${index} (crop rect or background)`);
                        return;
                    }

                    // Make shapes and other objects selectable and interactive
                    obj.selectable = true;
                    obj.evented = true;
                    obj.setCoords();
                    console.log(`Set object ${index} to selectable=true, evented=true`);
                });
            } catch (e) {
                console.warn('Failed to restore object selectability', e);
            }
            canvas!.renderAll();
            console.log('fromJSON completed, canvas rendered');
        });
    }

    // Image transforms: flip and rotate (exposed to host)
    export function flipHorizontal() {
        try {
            if (!canvas) return;
            const w = canvas.getWidth();
            // Flip background if exists
            const bg = canvas.backgroundImage as any;
            try {
                if (bg) {
                    // flip horizontally around canvas center
                    const c =
                        bg.getCenterPoint?.() ||
                        new (fabric as any).Point(
                            (bg.left || 0) + (bg.width || 0) / 2,
                            (bg.top || 0) + (bg.height || 0) / 2
                        );
                    const newCenterX = w - (c.x || 0);
                    bg.set('flipX', !bg.flipX);
                    bg.setPositionByOrigin &&
                        bg.setPositionByOrigin(
                            new (fabric as any).Point(newCenterX, c.y || 0),
                            'center',
                            'center'
                        );
                    bg.setCoords && bg.setCoords();
                }
            } catch (e) {}

            // Flip all drawable objects
            try {
                const objs = canvas.getObjects ? canvas.getObjects() : [];
                objs.forEach((o: any) => {
                    try {
                        if (o._isCropRect) return;
                        const c = o.getCenterPoint();
                        const newCenterX = w - (c.x || 0);
                        o.setPositionByOrigin &&
                            o.setPositionByOrigin(
                                new (fabric as any).Point(newCenterX, c.y || 0),
                                'center',
                                'center'
                            );
                        o.set('flipX', !o.flipX);
                        o.setCoords && o.setCoords();
                    } catch (e) {}
                });
                canvas.requestRenderAll();
                schedulePushWithType('modified');
                try {
                    dispatch('flipped', { dir: 'horizontal' });
                } catch (e) {}
            } catch (e) {}
        } catch (e) {}
    }

    export function flipVertical() {
        try {
            if (!canvas) return;
            const h = canvas.getHeight();
            // Flip background if exists
            const bg = canvas.backgroundImage as any;
            try {
                if (bg) {
                    const c =
                        bg.getCenterPoint?.() ||
                        new (fabric as any).Point(
                            (bg.left || 0) + (bg.width || 0) / 2,
                            (bg.top || 0) + (bg.height || 0) / 2
                        );
                    const newCenterY = h - (c.y || 0);
                    bg.set('flipY', !bg.flipY);
                    bg.setPositionByOrigin &&
                        bg.setPositionByOrigin(
                            new (fabric as any).Point(c.x || 0, newCenterY),
                            'center',
                            'center'
                        );
                    bg.setCoords && bg.setCoords();
                }
            } catch (e) {}

            // Flip all drawable objects
            try {
                const objs = canvas.getObjects ? canvas.getObjects() : [];
                objs.forEach((o: any) => {
                    try {
                        if (o._isCropRect) return;
                        const c = o.getCenterPoint();
                        const newCenterY = h - (c.y || 0);
                        o.setPositionByOrigin &&
                            o.setPositionByOrigin(
                                new (fabric as any).Point(c.x || 0, newCenterY),
                                'center',
                                'center'
                            );
                        o.set('flipY', !o.flipY);
                        o.setCoords && o.setCoords();
                    } catch (e) {}
                });
                canvas.requestRenderAll();
                schedulePushWithType('modified');
                try {
                    dispatch('flipped', { dir: 'vertical' });
                } catch (e) {}
            } catch (e) {}
        } catch (e) {}
    }

    // Rotate 90 degrees without flattening objects (keep editable objects)
    export async function rotate90(clockwise: boolean = true) {
        try {
            if (!canvas) return;
            const W = canvas.getWidth();
            const H = canvas.getHeight();

            // Prepare list of objects to transform (exclude crop rect if present)
            const objs = (canvas.getObjects ? canvas.getObjects() : []).filter(
                (o: any) => !o._isCropRect
            );

            // Temporarily hide objects to export background-only image
            const prevVisible: boolean[] = [];
            objs.forEach((o: any) => {
                prevVisible.push(typeof o.visible === 'undefined' ? true : o.visible);
                o.visible = false;
            });
            canvas.renderAll();

            const bgData = toDataURL({ format: 'png', quality: 1 });

            // restore object visibility
            objs.forEach((o: any, idx: number) => {
                o.visible = prevVisible[idx];
            });
            canvas.renderAll();

            if (!bgData) return;

            // load bg image
            const imgEl = new Image();
            imgEl.crossOrigin = 'anonymous';
            await new Promise<void>((resolve, reject) => {
                imgEl.onload = () => resolve();
                imgEl.onerror = err => reject(err);
                imgEl.src = bgData;
            });

            // draw onto offscreen canvas rotated
            const off = document.createElement('canvas');
            off.width = H;
            off.height = W;
            const ctx = off.getContext('2d');
            if (!ctx) return;
            if (clockwise) {
                ctx.translate(H, 0);
                ctx.rotate((Math.PI / 2) * 1);
            } else {
                ctx.translate(0, W);
                ctx.rotate((-Math.PI / 2) * 1);
            }
            ctx.drawImage(imgEl, 0, 0);

            const rotatedDataURL = off.toDataURL();

            // create rotated image element
            const rotImg = new Image();
            rotImg.crossOrigin = 'anonymous';
            await new Promise<void>((resolve, reject) => {
                rotImg.onload = () => resolve();
                rotImg.onerror = err => reject(err);
                rotImg.src = rotatedDataURL;
            });

            // set canvas new size
            canvas.setWidth(H);
            canvas.setHeight(W);
            if (canvas.lowerCanvasEl && canvas.lowerCanvasEl.parentElement) {
                const lower = canvas.lowerCanvasEl;
                lower.style.width = `${H}px`;
                lower.style.height = `${W}px`;
                lower.parentElement.style.width = `${H}px`;
                lower.parentElement.style.height = `${W}px`;
            }

            // set rotated background
            const fImg = new (fabric as any).Image(rotImg, { selectable: false });
            canvas.setBackgroundImage(fImg, canvas.renderAll.bind(canvas));

            // transform each object's center and rotate its angle
            objs.forEach((o: any) => {
                try {
                    const c = o.getCenterPoint();
                    let newCenterX: number, newCenterY: number;
                    if (clockwise) {
                        newCenterX = c.y;
                        newCenterY = W - c.x;
                    } else {
                        newCenterX = H - c.y;
                        newCenterY = c.x;
                    }
                    o.setPositionByOrigin &&
                        o.setPositionByOrigin(
                            new (fabric as any).Point(newCenterX, newCenterY),
                            'center',
                            'center'
                        );
                    o.angle = ((o.angle || 0) + (clockwise ? 90 : -90)) % 360;
                    o.setCoords && o.setCoords();
                } catch (e) {}
            });

            // reset viewport transform
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            canvas.requestRenderAll();
            schedulePushWithType('modified');
            try {
                dispatch('rotated', { clockwise });
            } catch (e) {}
        } catch (e) {
            console.warn('rotate failed', e);
        }
    }
</script>

<div class="canvas-editor">
    <canvas bind:this={container}></canvas>
</div>

<style>
    .canvas-editor {
        width: 100%;
        height: 100%;
    }
    canvas {
        display: block;
        width: 100%;
        height: 100%;
    }
</style>
