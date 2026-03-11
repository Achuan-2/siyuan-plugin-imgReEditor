

export const getDefaultSettings = () => ({
    storageMode: 'embed', // 'embed' or 'backup'
    // Recent colors storage, keyed by color picker identifier
    recentColors: {} as Record<string, string[]>,
    // Last used tool settings, keyed by tool name
    lastToolSettings: {} as Record<string, any>,
    screenshotLimit: 200,
    screenshotSelectionHistory: [] as Array<{ x: number, y: number, width: number, height: number, ts: number }>,
    screenshotCaptureHistory: [] as Array<{
        id: string,
        imagePath: string,
        name: string,
        rect: { x: number, y: number, width: number, height: number },
        normalizedRect: { x: number, y: number, width: number, height: number },
        ts: number,
    }>,
});
