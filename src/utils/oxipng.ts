import { OXIPNG_WASM_BASE64 } from './oxipngWasm';
import { base64ToBuffer } from './index';

let wasm: any;
let cachedUint8Memory0: Uint8Array | null = null;
let cachedInt32Memory0: Int32Array | null = null;
let WASM_VECTOR_LEN = 0;

function getUint8Memory0() {
    if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
        cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8Memory0;
}

function getInt32Memory0() {
    if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
        cachedInt32Memory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32Memory0;
}

function passArray8ToWasm0(arg: Uint8Array, malloc: (size: number, align: number) => number) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8Memory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function getArrayU8FromWasm0(ptr: number, len: number) {
    ptr = ptr >>> 0;
    return getUint8Memory0().subarray(ptr / 1, ptr / 1 + len);
}

function wbgGetImports() {
    const imports: any = {};
    imports.wbg = {};
    imports.wbg.__wbindgen_throw = function (arg0: number, arg1: number) {
        const textDecoder = new TextDecoder('utf-8');
        const msg = textDecoder.decode(getUint8Memory0().subarray(arg0 >>> 0, (arg0 >>> 0) + arg1));
        throw new Error(msg);
    };
    return imports;
}

let initPromise: Promise<void> | null = null;

export async function initOxipng(): Promise<void> {
    if (wasm) return;
    if (!initPromise) {
        initPromise = (async () => {
            const wasmBytes = base64ToBuffer(OXIPNG_WASM_BASE64);
            const imports = wbgGetImports();
            const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
            wasm = instance.exports;
            cachedUint8Memory0 = null;
            cachedInt32Memory0 = null;
        })();
    }
    return initPromise;
}

export function optimise(data: Uint8Array, level: number = 2, interlace: boolean = false, optimize_alpha: boolean = true): Uint8Array {
    if (!wasm) {
        throw new Error('Oxipng WASM is not initialized. Call initOxipng() first.');
    }
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.optimise(retptr, ptr0, len0, level, interlace, optimize_alpha);
        const r0 = getInt32Memory0()[retptr / 4 + 0];
        const r1 = getInt32Memory0()[retptr / 4 + 1];
        const v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_free(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

export interface OxipngOptions {
    level?: number;
    interlace?: boolean;
    optimiseAlpha?: boolean;
}

export async function optimizePNGData(
    data: ArrayBuffer | Uint8Array,
    options: OxipngOptions = {}
): Promise<Uint8Array> {
    await initOxipng();
    const input = data instanceof Uint8Array ? data : new Uint8Array(data);
    const level = options.level ?? 2;
    const interlace = options.interlace ?? false;
    const optimiseAlpha = options.optimiseAlpha ?? true;

    return optimise(input, level, interlace, optimiseAlpha);
}

export async function optimizePNGBlob(
    blob: Blob,
    options: OxipngOptions = {}
): Promise<Blob> {
    const arrayBuffer = await blob.arrayBuffer();
    const optimized = await optimizePNGData(arrayBuffer, options);
    return new Blob([optimized as any], { type: 'image/png' });
}
