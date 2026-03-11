import { Plugin } from "siyuan";
import { getFileBlob, pushErrMsg, readDir, removeFile, pushMsg, putFile } from "./api";
import { confirm } from "siyuan";
import {
    Dialog,
} from "siyuan";
export class ScreenshotManager {
    private plugin: Plugin;
    private selectionWin: any | null = null;
    private readonly screenshotHistoryPath = 'data/storage/petal/siyuan-plugin-imgReEditor/screenshot_history';
    private readonly screenshotCaptureHistoryPath = 'data/storage/petal/siyuan-plugin-imgReEditor/capture_history';
    private readonly screenshotRangeHistoryLimit = 50;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    public async warmupSelectionWindow(): Promise<void> {
        try {
            const remote = (window as any).require('@electron/remote');
            if (!remote) return;

            const { screen } = remote;
            const currentWin = remote.getCurrentWindow();
            const display = screen.getDisplayMatching(currentWin.getBounds()) || screen.getPrimaryDisplay();
            this.ensureSelectionWindow(remote, display);
        } catch (e) {
            console.warn('Selection window warmup failed:', e);
        }
    }

    public disposeSelectionWindow() {
        try {
            if (this.selectionWin && !this.selectionWin.isDestroyed()) {
                this.selectionWin.destroy();
            }
        } catch (e) {
            console.warn('Failed to dispose selection window:', e);
        } finally {
            this.selectionWin = null;
        }
    }

    private getAbsoluteWorkspacePath(path: string): string {
        const workspaceDir = (window as any).siyuan?.config?.system?.workspaceDir || '';
        return `${workspaceDir}/${path}`.replace(/\\/g, '/');
    }

    private async dataUrlToBlob(dataURL: string): Promise<Blob> {
        const response = await fetch(dataURL);
        return response.blob();
    }

    private async blobToDataURL(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Failed to convert blob to data URL'));
            reader.readAsDataURL(blob);
        });
    }

    private getCaptureHistoryEntries(limit: number = this.screenshotRangeHistoryLimit): Array<{
        id: string,
        imagePath: string,
        name: string,
        rect: { x: number, y: number, width: number, height: number },
        normalizedRect: { x: number, y: number, width: number, height: number },
        ts: number,
    }> {
        const settings = (this.plugin as any).settings || {};
        const history = Array.isArray(settings.screenshotCaptureHistory)
            ? settings.screenshotCaptureHistory
            : [];

        return history
            .filter((item: any) => item
                && typeof item.id === 'string'
                && typeof item.imagePath === 'string'
                && item.rect
                && item.normalizedRect)
            .slice(0, limit);
    }

    private async getRecentCaptureHistory(limit: number = this.screenshotRangeHistoryLimit): Promise<Array<{
        id: string,
        name: string,
        absolutePath: string,
        imagePath: string,
        rect: { x: number, y: number, width: number, height: number },
        normalizedRect: { x: number, y: number, width: number, height: number },
        ts: number,
    }>> {
        return this.getCaptureHistoryEntries(limit).map(item => ({
            id: item.id,
            name: item.name,
            absolutePath: this.getAbsoluteWorkspacePath(item.imagePath),
            imagePath: item.imagePath,
            rect: item.rect,
            normalizedRect: item.normalizedRect,
            ts: item.ts,
        }));
    }

    private async rememberCaptureHistory(
        fullDataURL: string,
        rect: { x: number, y: number, width: number, height: number },
        imageSize: { width: number, height: number }
    ): Promise<void> {
        try {
            const settings = ((this.plugin as any).settings ||= {});
            const existing = this.getCaptureHistoryEntries(this.screenshotRangeHistoryLimit);
            const id = `capture-${Date.now()}`;
            const name = `${id}.png`;
            const imagePath = `${this.screenshotCaptureHistoryPath}/${name}`;
            const blob = await this.dataUrlToBlob(fullDataURL);
            const file = new File([blob], name, { type: 'image/png' });
            await putFile(imagePath, false, file);

            const imageWidth = Math.max(imageSize.width || rect.x + rect.width, 1);
            const imageHeight = Math.max(imageSize.height || rect.y + rect.height, 1);
            const entry = {
                id,
                imagePath,
                name,
                rect,
                normalizedRect: {
                    x: Math.max(0, Math.min(1, rect.x / imageWidth)),
                    y: Math.max(0, Math.min(1, rect.y / imageHeight)),
                    width: Math.max(0, Math.min(1, rect.width / imageWidth)),
                    height: Math.max(0, Math.min(1, rect.height / imageHeight)),
                },
                ts: Date.now(),
            };

            settings.screenshotCaptureHistory = [entry].concat(existing).slice(0, this.screenshotRangeHistoryLimit);

            const removedEntries = existing.slice(Math.max(0, this.screenshotRangeHistoryLimit - 1));
            for (const removed of removedEntries) {
                if (!removed || !removed.imagePath) continue;
                try {
                    await removeFile(removed.imagePath);
                } catch (e) {
                    console.warn('Failed to remove old capture history image', e);
                }
            }

            if (typeof (this.plugin as any).saveSettings === 'function') {
                await (this.plugin as any).saveSettings(settings);
            }
        } catch (e) {
            console.warn('Failed to remember capture history', e);
        }
    }

    private async loadCaptureHistoryDataURL(imagePath: string): Promise<string | null> {
        try {
            const blob = await getFileBlob(imagePath);
            if (!blob) return null;
            return await this.blobToDataURL(blob);
        } catch (e) {
            console.warn('Failed to load capture history image', e);
            return null;
        }
    }

    private getSelectionRangeHistory(limit: number = this.screenshotRangeHistoryLimit): Array<{ x: number, y: number, width: number, height: number, ts: number }> {
        const settings = (this.plugin as any).settings || {};
        const history = Array.isArray(settings.screenshotSelectionHistory)
            ? settings.screenshotSelectionHistory
            : [];

        return history
            .filter((item: any) => item && [item.x, item.y, item.width, item.height].every((value: any) => typeof value === 'number' && Number.isFinite(value)))
            .slice(0, limit);
    }

    private isSameSelectionRange(
        a: { x: number, y: number, width: number, height: number },
        b: { x: number, y: number, width: number, height: number }
    ): boolean {
        const tolerance = 0.002;
        return Math.abs(a.x - b.x) <= tolerance
            && Math.abs(a.y - b.y) <= tolerance
            && Math.abs(a.width - b.width) <= tolerance
            && Math.abs(a.height - b.height) <= tolerance;
    }

    private async rememberSelectionRange(
        rect: { x: number, y: number, width: number, height: number },
        displaySize: { width: number, height: number }
    ): Promise<void> {
        const displayWidth = Math.max(displaySize.width || 0, 1);
        const displayHeight = Math.max(displaySize.height || 0, 1);
        const normalized = {
            x: Math.max(0, Math.min(1, rect.x / displayWidth)),
            y: Math.max(0, Math.min(1, rect.y / displayHeight)),
            width: Math.max(0, Math.min(1, rect.width / displayWidth)),
            height: Math.max(0, Math.min(1, rect.height / displayHeight)),
            ts: Date.now(),
        };

        const isFullscreen = normalized.x <= 0.002
            && normalized.y <= 0.002
            && normalized.width >= 0.998
            && normalized.height >= 0.998;
        if (isFullscreen) {
            return;
        }

        const settings = ((this.plugin as any).settings ||= {});
        const existing = this.getSelectionRangeHistory(this.screenshotRangeHistoryLimit);
        settings.screenshotSelectionHistory = [normalized]
            .concat(existing.filter(item => !this.isSameSelectionRange(item, normalized)))
            .slice(0, this.screenshotRangeHistoryLimit);

        if (typeof (this.plugin as any).saveSettings === 'function') {
            await (this.plugin as any).saveSettings(settings);
        }
    }

    private ensureSelectionWindow(remote: any, display: any) {
        if (this.selectionWin && !this.selectionWin.isDestroyed()) {
            const { width, height } = display.size;
            this.selectionWin.setBounds({
                x: display.bounds.x,
                y: display.bounds.y,
                width,
                height
            });
            return this.selectionWin;
        }

        const { BrowserWindow } = remote;
        const { width, height } = display.size;

        this.selectionWin = new BrowserWindow({
            width,
            height,
            x: display.bounds.x,
            y: display.bounds.y,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            fullscreen: true,
            resizable: false,
            enableLargerThanScreen: true,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        const content = this.getSelectionWindowContent();
        this.selectionWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`);
        this.selectionWin.on('closed', () => {
            this.selectionWin = null;
        });

        return this.selectionWin;
    }

    private getSelectionWindowContent(): string {
        return `
            <html>
            <head>
                <style>
                    body { margin: 0; padding: 0; overflow: hidden; cursor: crosshair; user-select: none; background: transparent; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
                    #background { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
                    #overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); pointer-events: none; }
                    #selection {
                        position: absolute;
                        border: 2px solid #007bff;
                        box-sizing: border-box;
                        display: none;
                        background: transparent;
                        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
                        z-index: 10;
                    }
                    #selection.movable { cursor: move; }
                    .resize-handle {
                        position: absolute;
                        background: #007bff;
                        z-index: 11;
                    }
                    .resize-handle.corner {
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                    }
                    .resize-handle.edge {
                        background: transparent;
                    }
                    .resize-handle.edge.horizontal {
                        height: 8px;
                        left: 8px;
                        right: 8px;
                        cursor: ns-resize;
                    }
                    .resize-handle.edge.vertical {
                        width: 8px;
                        top: 8px;
                        bottom: 8px;
                        cursor: ew-resize;
                    }
                    .handle-nw { top: -4px; left: -4px; cursor: nw-resize; }
                    .handle-n { top: -4px; cursor: n-resize; }
                    .handle-ne { top: -4px; right: -4px; cursor: ne-resize; }
                    .handle-e { right: -4px; cursor: e-resize; }
                    .handle-se { bottom: -4px; right: -4px; cursor: se-resize; }
                    .handle-s { bottom: -4px; cursor: s-resize; }
                    .handle-sw { bottom: -4px; left: -4px; cursor: sw-resize; }
                    .handle-w { left: -4px; cursor: w-resize; }
                    #info {
                        position: absolute;
                        background: rgba(0,0,0,0.7);
                        color: white;
                        padding: 4px 8px;
                        font-size: 12px;
                        border-radius: 4px;
                        pointer-events: none;
                        display: none;
                        z-index: 20;
                        white-space: nowrap;
                    }
                    .hint {
                        position: absolute;
                        top: 20px;
                        left: 50%;
                        transform: translateX(-50%);
                        background: rgba(0,0,0,0.6);
                        color: white;
                        padding: 8px 16px;
                        border-radius: 20px;
                        font-size: 14px;
                        pointer-events: none;
                        z-index: 100;
                    }
                    .history-badge {
                        position: absolute;
                        right: 20px;
                        top: 20px;
                        background: rgba(0,0,0,0.6);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 999px;
                        font-size: 12px;
                        pointer-events: none;
                        z-index: 101;
                        display: none;
                        max-width: 40vw;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .range-badge {
                        position: absolute;
                        right: 20px;
                        top: 58px;
                        background: rgba(0,0,0,0.6);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 999px;
                        font-size: 12px;
                        pointer-events: none;
                        z-index: 101;
                        display: none;
                        max-width: 40vw;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                </style>
            </head>
            <body>
                <img id="background" src="">
                <div id="overlay"></div>
                <div id="selection">
                    <div class="resize-handle corner handle-nw"></div>
                    <div class="resize-handle edge horizontal handle-n"></div>
                    <div class="resize-handle corner handle-ne"></div>
                    <div class="resize-handle edge vertical handle-e"></div>
                    <div class="resize-handle corner handle-se"></div>
                    <div class="resize-handle edge horizontal handle-s"></div>
                    <div class="resize-handle corner handle-sw"></div>
                    <div class="resize-handle edge vertical handle-w"></div>
                </div>
                <div id="info"></div>
                <div class="hint" id="hint">默认全屏，直接回车确认；拖拽可重新框选；按 R / Shift+R 回顾历史范围；按 ， / 。 回顾历史截图</div>
                <div class="history-badge" id="history-badge"></div>
                <div class="range-badge" id="range-badge"></div>
                <script>
                    const { ipcRenderer } = require('electron');
                    const fs = require('fs');
                    const selection = document.getElementById('selection');
                    const overlay = document.getElementById('overlay');
                    const info = document.getElementById('info');
                    const background = document.getElementById('background');
                    const hint = document.getElementById('hint');
                    const historyBadge = document.getElementById('history-badge');
                    const rangeBadge = document.getElementById('range-badge');

                    let mode = 'none';
                    let startX, startY;
                    let initialRect = { left: 0, top: 0, width: 0, height: 0 };
                    let resizeDirection = '';
                    let currentSessionId = '';
                    let liveDataURL = '';
                    let historyEntries = [];
                    let historyCursor = -1;
                    let rangeEntries = [];
                    let rangeCursor = -1;

                    function setHintText(text) {
                        if (hint) hint.textContent = text;
                    }

                    function updateHistoryBadge() {
                        if (!historyBadge) return;
                        if (historyCursor < 0 || !historyEntries[historyCursor]) {
                            historyBadge.style.display = 'none';
                            return;
                        }
                        const item = historyEntries[historyCursor];
                        historyBadge.style.display = 'block';
                        historyBadge.textContent = '历史 ' + (historyCursor + 1) + '/' + historyEntries.length + '  ' + item.name;
                    }

                    function updateRangeBadge() {
                        if (!rangeBadge) return;
                        if (rangeCursor < 0 || !rangeEntries[rangeCursor]) {
                            rangeBadge.style.display = 'none';
                            return;
                        }
                        const item = rangeEntries[rangeCursor];
                        rangeBadge.style.display = 'block';
                        rangeBadge.textContent = '范围 ' + (rangeCursor + 1) + '/' + rangeEntries.length + '  ' + Math.round(item.width * window.innerWidth) + ' x ' + Math.round(item.height * window.innerHeight);
                    }

                    function clearRangePreview() {
                        rangeCursor = -1;
                        updateRangeBadge();
                    }

                    function applySelectionRect(left, top, width, height) {
                        selection.style.display = 'block';
                        selection.style.left = left + 'px';
                        selection.style.top = top + 'px';
                        selection.style.width = width + 'px';
                        selection.style.height = height + 'px';
                        overlay.style.display = 'none';
                        updateInfo();
                    }

                    function applyFullscreenSelection() {
                        applySelectionRect(0, 0, window.innerWidth, window.innerHeight);
                    }

                    function resetState() {
                        mode = 'none';
                        resizeDirection = '';
                        clearRangePreview();
                        selection.style.left = '0px';
                        selection.style.top = '0px';
                        selection.style.width = '0px';
                        selection.style.height = '0px';
                        selection.classList.remove('movable');
                        info.style.display = 'none';
                        applyFullscreenSelection();
                    }

                    function isFullSelection() {
                        const rect = selection.getBoundingClientRect();
                        return rect.left <= 0 && rect.top <= 0 && Math.abs(rect.width - window.innerWidth) <= 2 && Math.abs(rect.height - window.innerHeight) <= 2;
                    }

                    function switchToLiveCapture(resetSelection = true) {
                        historyCursor = -1;
                        background.src = liveDataURL || '';
                        updateHistoryBadge();
                        setHintText('默认全屏，直接回车确认；拖拽可重新框选；按 R / Shift+R 回顾历史范围；按 ， / 。 回顾历史截图');
                        if (resetSelection) {
                            resetState();
                        }
                    }

                    function getHistoryImageSrc(item) {
                        if (!item) return '';
                        if (item.dataURL) return item.dataURL;
                        try {
                            const bytes = fs.readFileSync(item.absolutePath);
                            item.dataURL = 'data:image/png;base64,' + bytes.toString('base64');
                            return item.dataURL;
                        } catch (e) {
                            console.error('Failed to read capture history image', e);
                            return '';
                        }
                    }

                    function applyNormalizedRect(normalizedRect) {
                        if (!normalizedRect) return;
                        const left = Math.max(0, Math.min(window.innerWidth - 10, Math.round(normalizedRect.x * window.innerWidth)));
                        const top = Math.max(0, Math.min(window.innerHeight - 10, Math.round(normalizedRect.y * window.innerHeight)));
                        const width = Math.max(10, Math.min(window.innerWidth - left, Math.round(normalizedRect.width * window.innerWidth)));
                        const height = Math.max(10, Math.min(window.innerHeight - top, Math.round(normalizedRect.height * window.innerHeight)));
                        applySelectionRect(left, top, width, height);
                    }

                    function previewRange(index) {
                        if (index < 0 || index >= rangeEntries.length) return;
                        if (historyCursor >= 0) {
                            historyCursor = -1;
                            background.src = liveDataURL || '';
                            updateHistoryBadge();
                        }
                        rangeCursor = index;
                        const item = rangeEntries[index];
                        const left = Math.max(0, Math.min(window.innerWidth - 10, Math.round(item.x * window.innerWidth)));
                        const top = Math.max(0, Math.min(window.innerHeight - 10, Math.round(item.y * window.innerHeight)));
                        const width = Math.max(10, Math.min(window.innerWidth - left, Math.round(item.width * window.innerWidth)));
                        const height = Math.max(10, Math.min(window.innerHeight - top, Math.round(item.height * window.innerHeight)));
                        applySelectionRect(left, top, width, height);
                        updateRangeBadge();
                        setHintText('R 回顾更早的框选范围；Shift+R 返回更新的范围；回车确认当前范围；拖拽可微调');
                    }

                    function previewHistory(index) {
                        if (index < 0 || index >= historyEntries.length) return;
                        historyCursor = index;
                        const item = historyEntries[index];
                        const historySrc = getHistoryImageSrc(item);
                        if (!historySrc) return;
                        background.src = historySrc;
                        selection.classList.remove('movable');
                        mode = 'none';
                        resizeDirection = '';
                        clearRangePreview();
                        applyNormalizedRect(item.normalizedRect);
                        updateHistoryBadge();
                        setHintText('回车复用当前历史截图；按 。 返回更新的截图；拖拽任意位置回到实时截图重新框选');
                    }

                    ipcRenderer.on('imgreeditor-selection-init', (_e, payload) => {
                        if (!payload) return;
                        currentSessionId = payload.sessionId || '';
                        liveDataURL = payload.dataURL || '';
                        historyEntries = Array.isArray(payload.historyEntries) ? payload.historyEntries : [];
                        rangeEntries = Array.isArray(payload.selectionRangeEntries) ? payload.selectionRangeEntries : [];
                        switchToLiveCapture(true);
                    });

                    function updateInfo() {
                        const rect = selection.getBoundingClientRect();
                        info.style.display = 'block';
                        info.style.left = rect.left + 'px';
                        if (rect.top > 30) {
                            info.style.top = (rect.top - 28) + 'px';
                        } else {
                            info.style.top = (rect.top + rect.height + 5) + 'px';
                        }
                        info.innerText = Math.round(rect.width) + ' x ' + Math.round(rect.height);
                    }

                    function isInsideSelection(x, y) {
                        const rect = selection.getBoundingClientRect();
                        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
                    }

                    function getResizeDirection(target) {
                        if (target.classList.contains('handle-nw')) return 'nw';
                        if (target.classList.contains('handle-n')) return 'n';
                        if (target.classList.contains('handle-ne')) return 'ne';
                        if (target.classList.contains('handle-e')) return 'e';
                        if (target.classList.contains('handle-se')) return 'se';
                        if (target.classList.contains('handle-s')) return 's';
                        if (target.classList.contains('handle-sw')) return 'sw';
                        if (target.classList.contains('handle-w')) return 'w';
                        return '';
                    }

                    document.addEventListener('mousedown', (e) => {
                        if (!currentSessionId) return;
                        if (e.button === 2) {
                            ipcRenderer.send('imgreeditor-selection-cancel', { sessionId: currentSessionId });
                            return;
                        }
                        if (e.button !== 0) return;

                        if (historyCursor >= 0) {
                            switchToLiveCapture(true);
                        }
                        clearRangePreview();

                        const target = e.target;
                        const direction = getResizeDirection(target);

                        if (direction) {
                            mode = 'resizing';
                            resizeDirection = direction;
                            startX = e.clientX;
                            startY = e.clientY;
                            const rect = selection.getBoundingClientRect();
                            initialRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                        } else if (selection.style.display === 'block' && isInsideSelection(e.clientX, e.clientY) && !isFullSelection()) {
                            mode = 'moving';
                            startX = e.clientX;
                            startY = e.clientY;
                            const rect = selection.getBoundingClientRect();
                            initialRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                            selection.classList.add('movable');
                        } else {
                            mode = 'creating';
                            startX = e.clientX;
                            startY = e.clientY;
                            overlay.style.display = 'none';
                            selection.style.display = 'block';
                            selection.style.left = startX + 'px';
                            selection.style.top = startY + 'px';
                            selection.style.width = '0px';
                            selection.style.height = '0px';
                        }
                    });

                    document.addEventListener('mousemove', (e) => {
                        if (!currentSessionId) return;
                        if (mode === 'creating') {
                            const currentX = e.clientX;
                            const currentY = e.clientY;
                            const left = Math.min(startX, currentX);
                            const top = Math.min(startY, currentY);
                            const width = Math.abs(currentX - startX);
                            const height = Math.abs(currentY - startY);

                            selection.style.left = left + 'px';
                            selection.style.top = top + 'px';
                            selection.style.width = width + 'px';
                            selection.style.height = height + 'px';

                            updateInfo();
                        } else if (mode === 'moving') {
                            const deltaX = e.clientX - startX;
                            const deltaY = e.clientY - startY;

                            selection.style.left = (initialRect.left + deltaX) + 'px';
                            selection.style.top = (initialRect.top + deltaY) + 'px';

                            updateInfo();
                        } else if (mode === 'resizing') {
                            const deltaX = e.clientX - startX;
                            const deltaY = e.clientY - startY;

                            let newLeft = initialRect.left;
                            let newTop = initialRect.top;
                            let newWidth = initialRect.width;
                            let newHeight = initialRect.height;

                            if (resizeDirection.includes('w')) {
                                newLeft = initialRect.left + deltaX;
                                newWidth = initialRect.width - deltaX;
                            } else if (resizeDirection.includes('e')) {
                                newWidth = initialRect.width + deltaX;
                            }

                            if (resizeDirection.includes('n')) {
                                newTop = initialRect.top + deltaY;
                                newHeight = initialRect.height - deltaY;
                            } else if (resizeDirection.includes('s')) {
                                newHeight = initialRect.height + deltaY;
                            }

                            if (newWidth < 10) {
                                newWidth = 10;
                                if (resizeDirection.includes('w')) newLeft = initialRect.left + initialRect.width - 10;
                            }
                            if (newHeight < 10) {
                                newHeight = 10;
                                if (resizeDirection.includes('n')) newTop = initialRect.top + initialRect.height - 10;
                            }

                            selection.style.left = newLeft + 'px';
                            selection.style.top = newTop + 'px';
                            selection.style.width = newWidth + 'px';
                            selection.style.height = newHeight + 'px';

                            updateInfo();
                        }
                    });

                    document.addEventListener('mouseup', (e) => {
                        if (!currentSessionId) return;
                        if (e.button !== 0) return;

                        if (mode === 'creating') {
                            const rect = selection.getBoundingClientRect();
                            if (rect.width < 2 || rect.height < 2) {
                                overlay.style.display = 'block';
                                selection.style.display = 'none';
                                info.style.display = 'none';
                            }
                        } else if (mode === 'moving') {
                            selection.classList.remove('movable');
                        }

                        mode = 'none';
                        resizeDirection = '';
                    });

                    document.addEventListener('dblclick', () => {
                        confirmSelection();
                    });

                    function confirmSelection() {
                        if (historyCursor >= 0 && historyEntries[historyCursor]) {
                            ipcRenderer.send('imgreeditor-selection-done', {
                                sessionId: currentSessionId,
                                kind: 'history',
                                id: historyEntries[historyCursor].id
                            });
                            return;
                        }
                        const rect = selection.getBoundingClientRect();
                        if (currentSessionId && rect.width >= 2 && rect.height >= 2) {
                            ipcRenderer.send('imgreeditor-selection-done', {
                                sessionId: currentSessionId,
                                kind: 'capture',
                                rect: {
                                    x: Math.round(rect.left),
                                    y: Math.round(rect.top),
                                    width: Math.round(rect.width),
                                    height: Math.round(rect.height)
                                }
                            });
                        }
                    }

                    document.addEventListener('keydown', (e) => {
                        if (!currentSessionId) return;
                        if (e.key === 'Enter') {
                            confirmSelection();
                        } else if (e.key === 'Escape') {
                            ipcRenderer.send('imgreeditor-selection-cancel', { sessionId: currentSessionId });
                        } else if ((e.key === ',' || e.key === '，') && historyEntries.length > 0) {
                            e.preventDefault();
                            const nextIndex = historyCursor < 0 ? 0 : Math.min(historyCursor + 1, historyEntries.length - 1);
                            previewHistory(nextIndex);
                        } else if ((e.key === '.' || e.key === '。') && (historyEntries.length > 0 || historyCursor >= 0)) {
                            e.preventDefault();
                            if (historyCursor <= 0) {
                                switchToLiveCapture(true);
                            } else {
                                previewHistory(historyCursor - 1);
                            }
                        } else if (e.key && e.key.toLowerCase() === 'r' && rangeEntries.length > 0) {
                            e.preventDefault();
                            if (e.shiftKey) {
                                if (rangeCursor <= 0) {
                                    switchToLiveCapture(true);
                                } else {
                                    previewRange(rangeCursor - 1);
                                }
                            } else {
                                const nextIndex = rangeCursor < 0 ? 0 : Math.min(rangeCursor + 1, rangeEntries.length - 1);
                                previewRange(nextIndex);
                            }
                        }
                    });

                    window.addEventListener('resize', () => {
                        if (historyCursor < 0 && selection.style.display === 'block' && isFullSelection()) {
                            applyFullscreenSelection();
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }

    public async captureScreen(): Promise<string | null> {
        try {
            const remote = (window as any).require('@electron/remote');
            if (!remote) {
                pushErrMsg('当前环境不支持截图功能');
                return null;
            }


            const { desktopCapturer, screen } = remote;
            const currentWin = remote.getCurrentWindow();
            const display = screen.getDisplayMatching(currentWin.getBounds()) || screen.getPrimaryDisplay();
            const { width, height } = display.size;
            const scaleFactor = display.scaleFactor || 1;

            // Get all screens
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: {
                    width: Math.floor(width * scaleFactor),
                    height: Math.floor(height * scaleFactor)
                }
            });

            if (sources.length === 0) {
                pushErrMsg('无法获取屏幕截图源');
                return null;
            }

            // Find the screen source
            const source = sources.find((s: any) => s.display_id === display.id.toString()) || sources[0];
            const dataURL = source.thumbnail.toDataURL();

            return dataURL;
        } catch (error) {
            console.error('Screenshot capture failed:', error);
            return null;
        }
    }

    public async captureWithSelection(): Promise<
        | { source: 'capture', dataURL: string, rect: { x: number, y: number, width: number, height: number } }
        | { source: 'history', dataURL: string, rect: { x: number, y: number, width: number, height: number } }
        | null
    > {
        const remote = (window as any).require('@electron/remote');
        if (!remote) {
            pushErrMsg('当前环境不支持截图功能');
            return null;
        }

        const { screen } = remote;
        const currentWin = remote.getCurrentWindow();
        const display = screen.getDisplayMatching(currentWin.getBounds()) || screen.getPrimaryDisplay();

        // 1. Capture full screen first
        const fullDataURL = await this.captureScreen();
        if (!fullDataURL) return null;

        // 2. Show selection window
        const selection = await this.showSelectionWindow(fullDataURL);
        if (!selection) return null;

        if (selection.kind === 'history') {
            return {
                source: 'history',
                dataURL: selection.dataURL,
                rect: selection.rect
            };
        }

        const scaleFactor = display.scaleFactor || 1;
        void this.rememberSelectionRange(selection, display.size);
        void this.rememberCaptureHistory(fullDataURL, {
            x: Math.round(selection.x * scaleFactor),
            y: Math.round(selection.y * scaleFactor),
            width: Math.round(selection.width * scaleFactor),
            height: Math.round(selection.height * scaleFactor)
        }, {
            width: Math.round(display.size.width * scaleFactor),
            height: Math.round(display.size.height * scaleFactor)
        });

        // Focus SiYuan window to ensure the dialog is visible if it was minimized
        try {
            remote.getCurrentWindow().show();
            remote.getCurrentWindow().focus();
        } catch (e) { }
        // Selection is in screen (DIPs) coordinates, transform to pixel coordinates
        return {
            source: 'capture',
            dataURL: fullDataURL,
            rect: {
                x: Math.round(selection.x * scaleFactor),
                y: Math.round(selection.y * scaleFactor),
                width: Math.round(selection.width * scaleFactor),
                height: Math.round(selection.height * scaleFactor)
            }
        };
    }

    private async showSelectionWindow(dataURL: string): Promise<
        | { kind: 'capture', x: number, y: number, width: number, height: number }
        | { kind: 'history', dataURL: string, rect: { x: number, y: number, width: number, height: number } }
        | null
    > {
        return new Promise((resolve) => {
            const remote = (window as any).require('@electron/remote');
            const { screen, ipcMain } = remote;
            const currentWin = remote.getCurrentWindow();
            const display = screen.getDisplayMatching(currentWin.getBounds()) || screen.getPrimaryDisplay();
            const { width, height } = display.size; // These are in DIPs (logical pixels)

            // Generate a unique ID for this selection session to avoid IPC collisions
            const sessionId = `selection-${Date.now()}`;

            void Promise.all([
                this.getRecentCaptureHistory(50),
                Promise.resolve(this.getSelectionRangeHistory()),
            ]).then(([historyEntries, selectionRangeEntries]) => {
                const win = this.ensureSelectionWindow(remote, display);
                win.setBounds({
                    x: display.bounds.x,
                    y: display.bounds.y,
                    width,
                    height
                });

                const onWindowClosed = () => {
                    cleanupListeners();
                    resolve(null);
                };

                const cleanupListeners = () => {
                    ipcMain.removeListener('imgreeditor-selection-done', onDone);
                    ipcMain.removeListener('imgreeditor-selection-cancel', onCancel);
                    win.removeListener('closed', onWindowClosed);
                };

                const onDone = async (_event, payload) => {
                    if (!payload || payload.sessionId !== sessionId) return;
                    cleanupListeners();
                    if (!win.isDestroyed()) {
                        win.hide();
                    }
                    if (payload.kind === 'history' && payload.id) {
                        const entry = historyEntries.find(item => item.id === payload.id);
                        if (!entry) {
                            resolve(null);
                            return;
                        }
                        const historyDataURL = await this.loadCaptureHistoryDataURL(entry.imagePath);
                        if (!historyDataURL) {
                            resolve(null);
                            return;
                        }
                        resolve({ kind: 'history', dataURL: historyDataURL, rect: entry.rect });
                        return;
                    }
                    resolve(payload.rect ? { kind: 'capture', ...payload.rect } : null);
                };
                const onCancel = (_event, payload) => {
                    if (!payload || payload.sessionId !== sessionId) return;
                    cleanupListeners();
                    if (!win.isDestroyed()) {
                        win.hide();
                    }
                    resolve(null);
                };

                ipcMain.on('imgreeditor-selection-done', onDone);
                ipcMain.on('imgreeditor-selection-cancel', onCancel);
                win.once('closed', onWindowClosed);

                const startSelection = () => {
                    if (win.isDestroyed()) {
                        cleanupListeners();
                        resolve(null);
                        return;
                    }
                    win.webContents.send('imgreeditor-selection-init', {
                        sessionId,
                        dataURL,
                        historyEntries,
                        selectionRangeEntries
                    });
                    win.show();
                    win.focus();
                };

                if (win.webContents.isLoading()) {
                    win.webContents.once('did-finish-load', startSelection);
                } else {
                    startSelection();
                }
            });
        });
    }

    public async registerShortcut() {
        this.plugin.addCommand({
            langKey: "screenshotedit",
            langText: "截图编辑",
            hotkey: "⌘`", // Shift+Command+A default
            globalCallback: async () => {
                const result = await this.captureWithSelection();
                if (result) {
                    (this.plugin as any).openImageEditorDialog(result.dataURL, null, false, true, null, result.rect);
                }
            }
        });
    }


    // saveToHistory removed: ImageEditor.svelte provides screenshot history handling

    public async showHistoryDialog(onSelect?: (path: string) => void) {
        const path = this.screenshotHistoryPath;

        try {
            let files = await readDir(path);

            if (!files || files.length === 0) {
                pushErrMsg('暂无截图历史');
                return;
            }

            const getTimestamp = (file: any, type: 'updated' | 'created') => {
                if (type === 'updated') {
                    let ts = file.updated || 0;
                    // If timestamp is in seconds (10 digits), convert to milliseconds
                    if (ts > 0 && ts < 10000000000) ts *= 1000;
                    return ts;
                }
                const match = file.name.match(/screenshot-(\d+)\.png/);
                return match ? parseInt(match[1]) : ((file.updated || 0) * 1000);
            };

            const formatDate = (ts: number) => {
                if (!ts) return '-';
                const date = new Date(ts);
                return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            };

            const renderHistory = (sortType: 'updated' | 'created') => {
                files.sort((a, b) => getTimestamp(b, sortType) - getTimestamp(a, sortType));

                const now = new Date();
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

                const groups: { title: string, items: any[] }[] = [
                    { title: '今天', items: [] },
                    { title: '昨天', items: [] },
                    { title: '更早', items: [] }
                ];

                files.forEach(file => {
                    const ts = getTimestamp(file, sortType);
                    if (ts >= startOfToday) groups[0].items.push(file);
                    else if (ts >= startOfYesterday) groups[1].items.push(file);
                    else groups[2].items.push(file);
                });

                return `
                <div class="screenshot-history-container" style="padding: 16px; max-height: 80vh; overflow-y: auto;">
                    <style>
                        .screenshot-history-toolbar {
                            display: flex;
                            justify-content: flex-end;
                            gap: 8px;
                            margin-bottom: 20px;
                            padding-bottom: 12px;
                            border-bottom: 1px solid var(--b3-border-color);
                            position: sticky;
                            top: 0;
                            background: var(--b3-theme-surface);
                            z-index: 10;
                        }
                        .screenshot-group-title {
                            font-size: 14px;
                            font-weight: bold;
                            margin: 24px 0 12px 0;
                            padding-left: 8px;
                            border-left: 4px solid var(--b3-theme-primary);
                            color: var(--b3-theme-on-surface);
                        }
                        .screenshot-history-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                            gap: 16px;
                            margin-bottom: 32px;
                        }
                        .screenshot-item {
                            border: 1px solid var(--b3-border-color);
                            border-radius: 8px;
                            overflow: hidden;
                            display: flex;
                            flex-direction: column;
                            cursor: pointer;
                            transition: all 0.2s ease-in-out;
                            background: var(--b3-theme-surface);
                            position: relative;
                        }
                        .screenshot-item:hover {
                            transform: translateY(-4px);
                            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                            border-color: var(--b3-theme-primary);
                        }
                        .screenshot-item.selected {
                            border-color: var(--b3-theme-primary);
                            border-width: 2px;
                        }
                        .screenshot-item img {
                            width: 100%;
                            height: 140px;
                            object-fit: cover;
                            background: var(--b3-border-color);
                        }
                        .screenshot-item .info {
                            padding: 8px;
                            display: flex;
                            flex-direction: column;
                            gap: 4px;
                            background: var(--b3-theme-background);
                            border-top: 1px solid var(--b3-border-color);
                        }
                        .screenshot-item .name {
                            font-size: 12px;
                            color: var(--b3-theme-on-surface);
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        }
                        .screenshot-item .time-meta {
                            font-size: 10px;
                            color: var(--b3-theme-on-surface-light);
                            display: flex;
                            justify-content: space-between;
                            opacity: 0.7;
                        }
                        .screenshot-item .delete-btn {
                            position: absolute;
                            top: 8px;
                            right: 8px;
                            width: 24px;
                            height: 24px;
                            background: rgba(255, 69, 58, 0.8);
                            color: white;
                            border-radius: 4px;
                            display: none;
                            align-items: center;
                            justify-content: center;
                            transition: all 0.2s;
                            z-index: 5;
                        }
                        .screenshot-item:hover .delete-btn {
                            display: flex;
                        }
                        .screenshot-item .delete-btn:hover {
                            background: rgb(255, 69, 58);
                            transform: scale(1.1);
                        }
                        .screenshot-item .checkbox {
                            position: absolute;
                            top: 8px;
                            left: 8px;
                            width: 20px;
                            height: 20px;
                            z-index: 5;
                            display: none;
                        }
                        .multi-select-mode .screenshot-item .checkbox {
                            display: block;
                        }
                        .multi-select-mode .screenshot-item .delete-btn {
                            display: none !important;
                        }
                        .screenshot-history-container {
                            position: relative;
                            user-select: none;
                        }
                        .selection-marquee {
                            position: absolute;
                            border: 1px solid var(--b3-theme-primary);
                            background: rgba(var(--b3-theme-primary-rgb, 66, 133, 244), 0.2);
                            pointer-events: none;
                            z-index: 100;
                        }
                    </style>
                    <div class="screenshot-history-toolbar">
                        <span style="margin-right: auto; line-height: 28px; font-weight: bold; font-size: 14px;">排序与管理：</span>
                        <button class="b3-button ${multiSelectMode ? '' : 'b3-button--outline'}" id="toggle-multi-select">多选模式</button>
                        ${multiSelectMode ? `
                            <button class="b3-button b3-button--outline" id="select-all">全选</button>
                            <button class="b3-button b3-button--outline b3-button--error" id="delete-selected" disabled>删除选中</button>
                        ` : ''}
                        <button class="b3-button ${sortType === 'updated' ? '' : 'b3-button--outline'}" data-sort="updated">按更新时间</button>
                        <button class="b3-button ${sortType === 'created' ? '' : 'b3-button--outline'}" data-sort="created">按创建时间</button>
                    </div>
                    <div class="${multiSelectMode ? 'multi-select-mode' : ''}">
                    ${groups.map(group => group.items.length > 0 ? `
                        <div class="screenshot-group-title">${group.title} (${group.items.length})</div>
                        <div class="screenshot-history-grid">
                            ${group.items.map(file => {
                    const createdTs = getTimestamp(file, 'created');
                    const updatedTs = getTimestamp(file, 'updated');
                    return `
                                <div class="screenshot-item" data-path="${path}/${file.name}" data-name="${file.name}">
                                    <input type="checkbox" class="checkbox" ${selectedFiles.includes(`${path}/${file.name}`) ? 'checked' : ''} />
                                    <div class="delete-btn" title="删除">
                                        <svg style="width:14px;height:14px;"><use xlink:href="#iconTrashcan"></use></svg>
                                    </div>
                                    <img src="${window.siyuan.config.system.workspaceDir}/${path}/${file.name}" loading="lazy" />
                                    <div class="info">
                                        <div class="name" title="${file.name}">${file.name}</div>
                                        <div class="time-meta"><span>创:</span> <span>${formatDate(createdTs)}</span></div>
                                        <div class="time-meta"><span>改:</span> <span>${formatDate(updatedTs)}</span></div>
                                    </div>
                                </div>
                                `;
                }).join('')}
                        </div>
                    ` : '').join('')}
                    </div>
                    <div id="filename-preview" style="position: fixed; display: none; z-index: 99999; pointer-events: none; background: var(--b3-theme-surface); border: 1px solid var(--b3-border-color); box-shadow: 0 4px 12px rgba(0,0,0,0.2); border-radius: 4px; padding: 4px; max-width: 600px; max-height: 600px;">
                        <img src="" style="max-width: 100%; max-height: 580px; display: block; object-fit: contain;" />
                    </div>
                </div>
                `;
            };

            let currentSort: 'updated' | 'created' = 'updated';
            let multiSelectMode = false;
            let selectedFiles: string[] = [];

            const dialog = new Dialog({
                title: '截图历史',
                content: `<div id="screenshot-history-wrapper">${renderHistory(currentSort)}</div>`,
                width: '900px'
            });

            let lastSelectedIndex = -1;
            const bindEvents = () => {
                const preview = dialog.element.querySelector('#filename-preview') as HTMLDivElement;
                const previewImg = preview?.querySelector('img') as HTMLImageElement;

                // Multi-select toggle
                const toggleBtn = dialog.element.querySelector('#toggle-multi-select');
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', () => {
                        multiSelectMode = !multiSelectMode;
                        selectedFiles = [];
                        lastSelectedIndex = -1;
                        const wrapper = dialog.element.querySelector('#screenshot-history-wrapper');
                        if (wrapper) {
                            wrapper.innerHTML = renderHistory(currentSort);
                            bindEvents();
                        }
                    });
                }

                // Select all
                const selectAllBtn = dialog.element.querySelector('#select-all');
                if (selectAllBtn) {
                    selectAllBtn.addEventListener('click', () => {
                        const items = Array.from(dialog.element.querySelectorAll('.screenshot-item'));
                        const allPaths = items.map(item => item.getAttribute('data-path') || '');
                        const allSelected = allPaths.length > 0 && allPaths.every(p => selectedFiles.includes(p));

                        if (allSelected) {
                            // Deselect all
                            selectedFiles = [];
                            items.forEach(item => {
                                item.classList.remove('selected');
                                const cb = item.querySelector('.checkbox') as HTMLInputElement;
                                if (cb) cb.checked = false;
                            });
                        } else {
                            // Select all
                            selectedFiles = [...allPaths];
                            items.forEach(item => {
                                item.classList.add('selected');
                                const cb = item.querySelector('.checkbox') as HTMLInputElement;
                                if (cb) cb.checked = true;
                            });
                        }

                        // Update delete button state
                        const deleteSelectedBtn = dialog.element.querySelector('#delete-selected') as HTMLButtonElement;
                        if (deleteSelectedBtn) {
                            deleteSelectedBtn.disabled = selectedFiles.length === 0;
                            deleteSelectedBtn.innerText = `删除选中 (${selectedFiles.length})`;
                        }
                    });
                }

                // Delete selected
                const deleteSelectedBtn = dialog.element.querySelector('#delete-selected') as HTMLButtonElement;
                if (deleteSelectedBtn) {
                    deleteSelectedBtn.addEventListener('click', async () => {
                        if (selectedFiles.length === 0) return;
                        confirm('删除确认', `确定删除选中的 ${selectedFiles.length} 张图片吗？`, async () => {
                            for (const filePath of selectedFiles) {
                                await removeFile(filePath);
                                // Also remove backup json if it exists
                                try {
                                    const fileName = filePath.split('/').pop();
                                    await removeFile(`data/storage/petal/siyuan-plugin-imgReEditor/backup/${fileName}.json`);
                                } catch (e) { }
                            }
                            pushMsg(`已删除 ${selectedFiles.length} 张图片`);
                            files = await readDir(path); // refreshing
                            selectedFiles = [];
                            lastSelectedIndex = -1;
                            const wrapper = dialog.element.querySelector('#screenshot-history-wrapper');
                            if (wrapper) {
                                wrapper.innerHTML = renderHistory(currentSort);
                                bindEvents();
                            }
                        });
                    });
                }

                // Add event listeners to items
                const items = Array.from(dialog.element.querySelectorAll('.screenshot-item'));
                items.forEach((item, index) => {
                    const filePath = item.getAttribute('data-path') || '';
                    const checkbox = item.querySelector('.checkbox') as HTMLInputElement;

                    // Support preview on hover
                    if (preview && previewImg) {
                        item.addEventListener('mouseenter', () => {
                            const img = item.querySelector('img');
                            if (img) {
                                previewImg.src = img.src;
                                preview.style.display = 'block';
                            }
                        });
                        item.addEventListener('mousemove', (e: MouseEvent) => {
                            const offset = 15;
                            let top = e.clientY + offset;
                            let left = e.clientX + offset;

                            // Prevent going off screen
                            if (left + preview.offsetWidth > window.innerWidth) {
                                left = e.clientX - preview.offsetWidth - offset;
                            }
                            if (top + preview.offsetHeight > window.innerHeight) {
                                top = e.clientY - preview.offsetHeight - offset;
                            }

                            preview.style.top = `${top}px`;
                            preview.style.left = `${left}px`;
                        });
                        item.addEventListener('mouseleave', () => {
                            preview.style.display = 'none';
                        });
                    }

                    item.addEventListener('click', (e: MouseEvent) => {
                        const isDeleteBtn = (e.target as HTMLElement).closest('.delete-btn');
                        if (isDeleteBtn) {
                            e.stopPropagation();
                            confirm('删除确认', '确定删除这张图片吗？', async () => {
                                await removeFile(filePath);
                                try {
                                    const fileName = filePath.split('/').pop();
                                    await removeFile(`data/storage/petal/siyuan-plugin-imgReEditor/backup/${fileName}.json`);
                                } catch (e) { }
                                pushMsg('图片已删除');
                                files = await readDir(path);
                                selectedFiles = selectedFiles.filter(f => f !== filePath);
                                lastSelectedIndex = -1;
                                const wrapper = dialog.element.querySelector('#screenshot-history-wrapper');
                                if (wrapper) {
                                    wrapper.innerHTML = renderHistory(currentSort);
                                    bindEvents();
                                }
                            });
                            return;
                        }

                        if (multiSelectMode) {
                            if (e.shiftKey && lastSelectedIndex !== -1) {
                                const start = Math.min(lastSelectedIndex, index);
                                const end = Math.max(lastSelectedIndex, index);
                                for (let i = start; i <= end; i++) {
                                    const targetItem = items[i];
                                    const targetPath = targetItem.getAttribute('data-path') || '';
                                    const targetCheckbox = targetItem.querySelector('.checkbox') as HTMLInputElement;
                                    if (targetCheckbox) {
                                        targetCheckbox.checked = true;
                                        updateSelection(targetPath, true, targetItem);
                                    }
                                }
                            } else {
                                if (checkbox) {
                                    checkbox.checked = !checkbox.checked;
                                    updateSelection(filePath, checkbox.checked, item);
                                }
                                lastSelectedIndex = index;
                            }
                        } else {
                            if (filePath) {
                                if (onSelect) {
                                    onSelect(filePath);
                                } else {
                                    (this.plugin as any).openImageEditorDialog(filePath, null, false, true);
                                }
                                dialog.destroy();
                            }
                        }
                    });

                    if (checkbox) {
                        checkbox.addEventListener('click', (e: MouseEvent) => {
                            e.stopPropagation();
                            if (e.shiftKey && lastSelectedIndex !== -1) {
                                const start = Math.min(lastSelectedIndex, index);
                                const end = Math.max(lastSelectedIndex, index);
                                for (let i = start; i <= end; i++) {
                                    const targetItem = items[i];
                                    const targetPath = targetItem.getAttribute('data-path') || '';
                                    const targetCheckbox = targetItem.querySelector('.checkbox') as HTMLInputElement;
                                    if (targetCheckbox) {
                                        targetCheckbox.checked = true;
                                        updateSelection(targetPath, true, targetItem);
                                    }
                                }
                            } else {
                                updateSelection(filePath, checkbox.checked, item);
                                lastSelectedIndex = index;
                            }
                        });
                    }
                });

                // Right-click marquee selection
                let isRightDragging = false;
                let startX = 0;
                let startY = 0;
                let marquee: HTMLDivElement | null = null;
                const container = dialog.element.querySelector('.screenshot-history-container') as HTMLElement;

                if (container) {
                    const onMouseMove = (e: MouseEvent) => {
                        if (!isRightDragging) return;

                        if (!marquee) {
                            marquee = document.createElement('div');
                            marquee.className = 'selection-marquee';
                            container.appendChild(marquee);
                        }

                        const rect = container.getBoundingClientRect();
                        const currentX = e.clientX - rect.left + container.scrollLeft;
                        const currentY = e.clientY - rect.top + container.scrollTop;

                        const left = Math.min(startX, currentX);
                        const top = Math.min(startY, currentY);
                        const width = Math.abs(startX - currentX);
                        const height = Math.abs(startY - currentY);

                        marquee.style.left = left + 'px';
                        marquee.style.top = top + 'px';
                        marquee.style.width = width + 'px';
                        marquee.style.height = height + 'px';

                        const marqueeRect = marquee.getBoundingClientRect();
                        items.forEach(item => {
                            const itemRect = item.getBoundingClientRect();
                            const isIntersect = !(itemRect.right < marqueeRect.left ||
                                itemRect.left > marqueeRect.right ||
                                itemRect.bottom < marqueeRect.top ||
                                itemRect.top > marqueeRect.bottom);

                            if (isIntersect) {
                                const checkbox = item.querySelector('.checkbox') as HTMLInputElement;
                                const filePath = item.getAttribute('data-path') || '';
                                if (checkbox && !checkbox.checked) {
                                    checkbox.checked = true;
                                    updateSelection(filePath, true, item);
                                }
                            }
                        });
                    };

                    const onMouseUp = () => {
                        if (isRightDragging) {
                            isRightDragging = false;
                            if (marquee) {
                                marquee.remove();
                                marquee = null;
                            }
                            window.removeEventListener('mousemove', onMouseMove);
                            window.removeEventListener('mouseup', onMouseUp);
                        }
                    };

                    container.addEventListener('mousedown', (e: MouseEvent) => {
                        if (!multiSelectMode || e.button !== 2) return;

                        const rect = container.getBoundingClientRect();
                        startX = e.clientX - rect.left + container.scrollLeft;
                        startY = e.clientY - rect.top + container.scrollTop;

                        isRightDragging = true;

                        window.addEventListener('mousemove', onMouseMove);
                        window.addEventListener('mouseup', onMouseUp);

                        const handleContextMenu = (ce: MouseEvent) => {
                            ce.preventDefault();
                            window.removeEventListener('contextmenu', handleContextMenu);
                        };
                        window.addEventListener('contextmenu', handleContextMenu);
                    });
                }

                function updateSelection(filePath: string, selected: boolean, item: Element) {
                    if (selected) {
                        if (!selectedFiles.includes(filePath)) selectedFiles.push(filePath);
                        item.classList.add('selected');
                    } else {
                        selectedFiles = selectedFiles.filter(f => f !== filePath);
                        item.classList.remove('selected');
                    }
                    if (deleteSelectedBtn) {
                        deleteSelectedBtn.disabled = selectedFiles.length === 0;
                        deleteSelectedBtn.innerText = `删除选中 (${selectedFiles.length})`;
                    }
                }

                // Add sort event listeners
                dialog.element.querySelectorAll('.screenshot-history-toolbar button[data-sort]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const sort = btn.getAttribute('data-sort') as 'updated' | 'created';
                        if (sort !== currentSort) {
                            currentSort = sort;
                            lastSelectedIndex = -1;
                            const wrapper = dialog.element.querySelector('#screenshot-history-wrapper');
                            if (wrapper) {
                                wrapper.innerHTML = renderHistory(currentSort);
                                bindEvents();
                            }
                        }
                    });
                });
            };

            bindEvents();

        } catch (error) {
            console.error('Failed to show history:', error);
            pushErrMsg('打开截图历史失败');
        }
    }

    public openSticker(dataURL: string) {
        try {
            const remote = (window as any).require('@electron/remote');
            if (!remote) {
                pushErrMsg('当前环境不支持贴图功能');
                return;
            }

            const { BrowserWindow, screen } = remote;

            // Get original image dimensions from dataURL
            const img = new Image();
            img.onload = () => {
                const { width, height } = img;
                const display = screen.getPrimaryDisplay();
                const screenWidth = display.workAreaSize.width;
                const screenHeight = display.workAreaSize.height;

                // Scale down if too large
                let winWidth = width;
                let winHeight = height;
                const maxW = screenWidth * 0.8;
                const maxH = screenHeight * 0.8;
                if (winWidth > maxW || winHeight > maxH) {
                    const ratio = Math.min(maxW / winWidth, maxH / winHeight);
                    winWidth *= ratio;
                    winHeight *= ratio;
                }

                const win = new BrowserWindow({
                    width: Math.round(winWidth),
                    height: Math.round(winHeight),
                    frame: false,
                    transparent: false,
                    alwaysOnTop: true,
                    skipTaskbar: false,
                    resizable: true,
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false
                    }
                });

                const content = `
                <html>
                <body style="margin:0;padding:0;overflow:hidden;background:transparent;display:flex;justify-content:center;align-items:center;-webkit-app-region: drag;">
                    <img src="${dataURL}" style="width:100%;height:100%;object-fit:contain;pointer-events:none;" />
                </body>
                </html>
                `;
                win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`);
                try {
                    win.setAspectRatio(Math.round(winWidth) / Math.round(winHeight));
                } catch (e) { }
            };
            img.src = dataURL;
        } catch (e) {
            console.error('Failed to open sticker window', e);
            pushErrMsg('创建贴图失败');
        }
    }
}
