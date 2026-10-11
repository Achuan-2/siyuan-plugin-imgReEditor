/** Normalize equivalent Fabric object types for batch editing. */
export function getSelectionType(object: any): string {
    const type = object?.type || '';
    if (['text', 'i-text', 'textbox'].includes(type)) return 'text';
    if (['circle', 'ellipse'].includes(type)) return 'circle';
    if (type === 'line' && object.arrowHead) return 'arrow';
    return type;
}

export function getSelectionTool(type: string): string | null {
    const tools: Record<string, string> = {
        rect: 'shape', circle: 'shape', ellipse: 'shape',
        text: 'text', 'i-text': 'text', textbox: 'text',
        arrow: 'arrow', path: 'brush', image: 'image',
        'number-marker': 'number-marker', mosaic: 'mosaic', 'mosaic-rect': 'mosaic',
        'magnifier-rect': 'magnifier', 'magnifier-source-rect': 'magnifier',
    };
    return tools[type] || null;
}

/** Style refreshes keep the panel open; changing selection membership resets it. */
export function createSelectionTracker() {
    let previous: any[] = [];
    let revision = 0;
    return {
        update(objects: any[]) {
            if (objects.length !== previous.length || objects.some(object => !previous.includes(object))) {
                previous = [...objects];
                revision++;
            }
            return { selectionRevision: revision, selectionCount: objects.length };
        },
    };
}
