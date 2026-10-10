import UPNG from 'upng-js';
import { initOxipng, optimizePNGData } from './oxipng';
import type { PNGEncodeRequest } from './pngEncoder';

const workerScope = self as unknown as Worker;

workerScope.onmessage = async (event: MessageEvent<PNGEncodeRequest>) => {
    const request = event.data;
    try {
        if (request.type === 'init') {
            await initOxipng();
            workerScope.postMessage({ id: request.id });
            return;
        }
        let encoded: Uint8Array;
        if (request.type === 'optimize') {
            encoded = await optimizePNGData(request.buffer, request.options);
        } else {
            const colors = Math.max(2, Math.min(256, Math.round(request.quality * 256)));
            const quantized = UPNG.encode([request.buffer], request.width, request.height, colors);
            try {
                encoded = await optimizePNGData(quantized, { level: 2 });
            } catch {
                // Quantization succeeded; lossless post-optimization is optional.
                encoded = new Uint8Array(quantized);
            }
        }
        const buffer = encoded.buffer as ArrayBuffer;
        workerScope.postMessage({ id: request.id, buffer }, [buffer]);
    } catch (error) {
        workerScope.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
};
