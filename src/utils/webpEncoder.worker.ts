import createWebPEncoder, {
    type WebPModule,
} from '@jsquash/webp/codec/enc/webp_enc.js';
import { defaultOptions as defaultWebPOptions } from '@jsquash/webp/meta.js';

interface WebPEncodeRequest {
    id: number;
    pixels: ArrayBuffer;
    width: number;
    height: number;
    quality: number;
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
        encoderModule = createWebPEncoder({ noInitialRun: true });
    }
    return encoderModule;
}

const workerScope = self as unknown as Worker;

workerScope.onmessage = async (event: MessageEvent<WebPEncodeRequest>) => {
    const { id, pixels, width, height, quality } = event.data;

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
                quality: isLossless ? 100 : Math.min(100, Math.max(0, quality * 100)),
                // method 6 only saves around 1% for ordinary photos but can take
                // several times longer. method 4 is libwebp's balanced default.
                method: 4,
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
