

export const getDefaultSettings = () => ({
    storageMode: 'embed', // 'embed' or 'backup'
    // Recent colors storage, keyed by color picker identifier
    recentColors: {} as Record<string, string[]>,
    // Last used tool settings, keyed by tool name
    lastToolSettings: {} as Record<string, any>,
    screenshotLimit: 200,
});
