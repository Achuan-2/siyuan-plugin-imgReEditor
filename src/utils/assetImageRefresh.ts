/** Refresh overwritten assets without changing the URL SiYuan uses to locate a preview. */
export async function refreshAssetImages(images: Iterable<HTMLImageElement>, assetPath: string): Promise<void> {
    const snapshots = [...new Set(images)].map(image => ({
        image,
        src: image.getAttribute('src'),
        dataSrc: image.getAttribute('data-src'),
    }));
    if (snapshots.length === 0) return;

    try {
        // Reload the canonical URL into the HTTP cache before reassigning img.src.
        // A persistent ?t=/?v= suffix breaks SiYuan's current-image matching.
        const response = await fetch(assetPath, { cache: 'reload' });
        if (!response.ok) throw new Error(`Image refresh failed: ${response.status}`);
        await response.arrayBuffer();
    } catch (error) {
        // The asset has already been saved. A failed preview refresh must not turn
        // a successful compression/save into a failure or trigger file removal.
        console.warn('Failed to reload image cache:', assetPath, error);
    }

    for (const { image, src, dataSrc } of snapshots) {
        // Preserve an image replaced by the user while the request was in flight.
        if (image.getAttribute('src') !== src || image.getAttribute('data-src') !== dataSrc) continue;
        image.setAttribute('data-src', assetPath);
        image.setAttribute('src', assetPath);
    }
}
