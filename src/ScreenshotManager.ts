import { Plugin } from "siyuan";
import { pushErrMsg, putFile } from "./api";

export class ScreenshotManager {
    private plugin: Plugin;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    public async captureScreen(): Promise<string | null> {
        try {
            const remote = (window as any).require('@electron/remote');
            if (!remote) {
                pushErrMsg('当前环境不支持截图功能');
                return null;
            }


            const { desktopCapturer, screen } = remote;

            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.size;
            const scaleFactor = primaryDisplay.scaleFactor || 1;

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

            // Find the primary screen source
            const source = sources.find((s: any) => s.display_id === primaryDisplay.id.toString()) || sources[0];
            const dataURL = source.thumbnail.toDataURL();

            // Focus SiYuan window to ensure the dialog is visible if it was minimized
            try {
                remote.getCurrentWindow().show();
                remote.getCurrentWindow().focus();
            } catch (e) { }
            return dataURL;
        } catch (error) {
            console.error('Screenshot capture failed:', error);
            return null;
        }
    }

    public async registerShortcut() {
        this.plugin.addCommand({
            langKey: "screenshotedit",
            langText: "截图编辑",
            hotkey: "⌘4", // Shift+Command+A default
            globalCallback: async () => {
                const dataURL = await this.captureScreen();
                if (dataURL) {
                    (this.plugin as any).openImageEditorDialog(dataURL, null, false, true);
                }
            }
        });
    }

    // saveToHistory removed: ImageEditor.svelte provides screenshot history handling

    public async showHistoryDialog() {
        const { readDir, Dialog } = await import('./api');
        const path = 'data/storage/petal/siyuan-plugin-imgReEditor/screenshot_history';

        try {
            const files = await readDir(path);

            if (!files || files.length === 0) {
                pushErrMsg('暂无截图历史');
                return;
            }

            // Sort by modification time (descending)
            files.sort((a, b) => (b.updated || 0) - (a.updated || 0));

            const { Dialog: SiyuanDialog } = await import('siyuan');
            const dialog = new SiyuanDialog({
                title: '截图历史',
                content: `
                    <div class="screenshot-history" style="padding: 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; max-height: 60vh; overflow-y: auto;">
                        ${files.map(file => `
                            <div class="screenshot-item" data-path="${path}/${file.name}" style="border: 1px solid var(--b3-border-color); border-radius: 4px; overflow: hidden; display: flex; flex-direction: column; cursor: pointer; transition: transform 0.2s;">
                                <img src="/api/file/getFile?path=${encodeURIComponent(path + '/' + file.name)}" style="width: 100%; height: 120px; object-fit: cover;" />
                                <div style="padding: 8px; font-size: 12px; text-align: center; background: var(--b3-theme-surface);">
                                    ${file.name}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `,
                width: '800px'
            });

            // Add event listeners to items
            dialog.element.querySelectorAll('.screenshot-item').forEach(item => {
                item.addEventListener('click', () => {
                    const filePath = item.getAttribute('data-path');
                    if (filePath) {
                        (this.plugin as any).openImageEditorDialog(filePath, null, false, true);
                        dialog.destroy();
                    }
                });
            });
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
                    transparent: true,
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
                    <div style="position:absolute;top:0;right:0;padding:4px;cursor:pointer;-webkit-app-region: no-drag;background:rgba(0,0,0,0.5);color:white;border-bottom-left-radius:4px;font-family:sans-serif;font-size:12px;" onclick="window.close()">X</div>
                </body>
                </html>
                `;
                win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`);
            };
            img.src = dataURL;
        } catch (e) {
            console.error('Failed to open sticker window', e);
            pushErrMsg('创建贴图失败');
        }
    }
}
