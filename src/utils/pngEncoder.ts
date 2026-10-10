import PNGEncoderWorker from './pngEncoder.worker?worker&inline';
import type { OxipngOptions } from './oxipng';

export type { OxipngOptions } from './oxipng';

export type PNGEncodeRequest =
    | { id: number; type: 'init' }
    | { id: number; type: 'optimize'; buffer: ArrayBuffer; options: OxipngOptions }
    | { id: number; type: 'quantize'; buffer: ArrayBuffer; width: number; height: number; quality: number };

interface PNGEncodeResponse {
    id: number;
    buffer?: ArrayBuffer;
    error?: string;
}

interface PendingEncode {
    resolve: (buffer: ArrayBuffer | undefined) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

const ENCODE_TIMEOUT_MS = 120_000;
let encoderWorker: Worker | null = null;
let nextRequestID = 1;
const pendingEncodes = new Map<number, PendingEncode>();

function resetWorker(error: Error) {
    encoderWorker?.terminate();
    encoderWorker = null;
    for (const pending of pendingEncodes.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
    }
    pendingEncodes.clear();
}

function getWorker(): Worker {
    if (encoderWorker) return encoderWorker;
    const worker = new PNGEncoderWorker();
    worker.onmessage = (event: MessageEvent<PNGEncodeResponse>) => {
        const { id, buffer, error } = event.data;
        const pending = pendingEncodes.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pendingEncodes.delete(id);
        if (error) pending.reject(new Error(error));
        else pending.resolve(buffer);
    };
    worker.onerror = event => resetWorker(new Error(event.message || 'PNG worker failed'));
    worker.onmessageerror = () => resetWorker(new Error('Invalid PNG worker response'));
    encoderWorker = worker;
    return worker;
}

async function requestEncoding(request: PNGEncodeRequest): Promise<ArrayBuffer | undefined> {
    const worker = getWorker();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resetWorker(new Error('PNG encoding timed out')), ENCODE_TIMEOUT_MS);
        pendingEncodes.set(request.id, { resolve, reject, timeout });
        try {
            worker.postMessage(request, 'buffer' in request ? [request.buffer] : []);
        } catch (error) {
            clearTimeout(timeout);
            pendingEncodes.delete(request.id);
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

function requirePNGData(buffer: ArrayBuffer | undefined): Uint8Array {
    if (!buffer || buffer.byteLength === 0) throw new Error('PNG worker returned no data');
    return new Uint8Array(buffer);
}

export async function initOxipng(): Promise<void> {
    await requestEncoding({ id: nextRequestID++, type: 'init' });
}

export async function optimizePNGData(
    data: ArrayBuffer | Uint8Array,
    options: OxipngOptions = {}
): Promise<Uint8Array> {
    // Public callers keep ownership of their input, including sliced Uint8Arrays.
    const buffer = data instanceof Uint8Array ? data.slice().buffer as ArrayBuffer : data.slice(0);
    return requirePNGData(await requestEncoding({ id: nextRequestID++, type: 'optimize', buffer, options }));
}

export async function optimizePNGBlob(blob: Blob, options: OxipngOptions = {}): Promise<Blob> {
    // Blob.arrayBuffer() is already a private buffer; transfer it without another copy.
    const buffer = await blob.arrayBuffer();
    const encoded = requirePNGData(await requestEncoding({ id: nextRequestID++, type: 'optimize', buffer, options }));
    return new Blob([encoded as BlobPart], { type: 'image/png' });
}

export async function quantizePNG(imageData: ImageData, quality: number): Promise<Blob> {
    const buffer = imageData.data.buffer as ArrayBuffer;
    const encoded = requirePNGData(await requestEncoding({
        id: nextRequestID++, type: 'quantize', buffer,
        width: imageData.width, height: imageData.height, quality,
    }));
    return new Blob([encoded as BlobPart], { type: 'image/png' });
}
