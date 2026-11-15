import createWebPEncoder, {
    type WebPModule,
} from '@jsquash/webp/codec/enc/webp_enc.js';
import createSIMDWebPEncoder from '@jsquash/webp/codec/enc/webp_enc_simd.js';
import { defaultOptions as defaultWebPOptions } from '@jsquash/webp/meta.js';

interface WebPEncodeRequest {
    id: number;
    pixels: ArrayBuffer;
    width: number;
    height: number;
    quality: number;
    effort?: 'fast' | 'balanced';
}

interface WebPEncodeSuccess {
    id: number;
    buffer: ArrayBuffer;
}

interface WebPEncodeFailure {
    id: number;
    error: string;
}

let encoderModule: Promise<WebPModule> | null = null;

function getEncoderModule(): Promise<WebPModule> {
    if (!encoderModule) {
        encoderModule = (async () => {
            // A minimal module using i8x16.splat and i8x16.popcnt. Validate the
            // feature before loading SIMD; older browsers retain scalar support.
            const supportsSIMD = WebAssembly.validate(Uint8Array.from([
                0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
                3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
            ]));
            if (supportsSIMD) {
                try { return await createSIMDWebPEncoder({ noInitialRun: true }); }
                catch (error) { console.warn('SIMD WebP encoder unavailable, using scalar encoder:', error); }
            }
            return createWebPEncoder({ noInitialRun: true });
        })();
    }
    return encoderModule;
}

const workerScope = self as unknown as Worker;

workerScope.onmessage = async (event: MessageEvent<WebPEncodeRequest>) => {
    const { id, pixels, width, height, quality, effort } = event.data;

    try {
        const encoder = await getEncoderModule();
        const isLossless = quality >= 1;
        const encoded = encoder.encode(
            new Uint8ClampedArray(pixels),
            width,
            height,
            {
                ...defaultWebPOptions,
                lossless: isLossless ? 1 : 0,
                // In lossless mode this field controls search effort, not pixel
                // quality. Keep exact RGBA while avoiding the expensive q=100 search.
                quality: isLossless ? (effort === 'fast' ? 50 : 70) : Math.min(100, Math.max(0, quality * 100)),
                // Interactive saves favor speed; batch compression keeps method 4.
                method: effort === 'fast' ? 1 : 4,
                exact: isLossless ? 1 : 0,
                near_lossless: 100,
                alpha_quality: 100,
            }
        );
        if (!encoded) throw new Error('WebP encoding failed');

        const buffer = encoded.slice().buffer;
        const message: WebPEncodeSuccess = { id, buffer };
        workerScope.postMessage(message, [buffer]);
    } catch (error) {
        const message: WebPEncodeFailure = {
            id,
            error: error instanceof Error ? error.message : String(error),
        };
        workerScope.postMessage(message);
    }
};
