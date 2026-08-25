import UPNG from 'upng-js';
import { optimizePNGBlob, optimizePNGData, initOxipng, type OxipngOptions } from './oxipng';

export type CompressibleImageFormat = 'png' | 'jpeg' | 'webp';

export { optimizePNGBlob, optimizePNGData, initOxipng, type OxipngOptions };

export interface ReencodeOptions {
    pngMode?: 'lossless' | 'lossy';
    quality?: number; // 0.01 ~ 1.0
}

export function getMimeByFormat(format: CompressibleImageFormat): string {
    if (format === 'jpeg') return 'image/jpeg';
    if (format === 'webp') return 'image/webp';
    return 'image/png';
}

export async function reencodeImageBlob(
    blob: Blob,
    format: CompressibleImageFormat,
    qualityOrOptions?: number | ReencodeOptions
): Promise<Blob> {
    let options: ReencodeOptions;
    if (typeof qualityOrOptions === 'number') {
        options = { quality: qualityOrOptions };
    } else {
        options = qualityOrOptions || {};
    }

    const quality = options.quality ?? 0.92;
    const pngMode = options.pngMode ?? (quality >= 1 ? 'lossless' : 'lossy');

    if (format === 'png') {
        if (pngMode === 'lossless') {
            try {
                return await optimizePNGBlob(blob, { level: 2, optimiseAlpha: true });
            } catch (err) {
                console.warn('Oxipng direct optimization failed, falling back to canvas PNG export:', err);
            }
        } else {
            // PNG 有损调色板量化压缩
            return new Promise<Blob>((resolve, reject) => {
                const image = new Image();
                const objectURL = URL.createObjectURL(blob);
                image.onload = async () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = image.naturalWidth || image.width;
                        canvas.height = image.naturalHeight || image.height;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) {
                            URL.revokeObjectURL(objectURL);
                            reject(new Error('Failed to create canvas context'));
                            return;
                        }
                        ctx.drawImage(image, 0, 0);
                        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const cnum = Math.max(2, Math.min(256, Math.round(quality * 256)));
                        const pngArrayBuffer = UPNG.encode([imgData.data.buffer], canvas.width, canvas.height, cnum);
                        URL.revokeObjectURL(objectURL);

                        try {
                            const optimizedBuffer = await optimizePNGData(pngArrayBuffer, { level: 2 });
                            resolve(new Blob([optimizedBuffer as any], { type: 'image/png' }));
                        } catch {
                            resolve(new Blob([pngArrayBuffer], { type: 'image/png' }));
                        }
                    } catch (error) {
                        URL.revokeObjectURL(objectURL);
                        reject(error);
                    }
                };
                image.onerror = () => {
                    URL.revokeObjectURL(objectURL);
                    reject(new Error('Failed to load image'));
                };
                image.src = objectURL;
            });
        }
    }

    return new Promise<Blob>((resolve, reject) => {
        const image = new Image();
        const objectURL = URL.createObjectURL(blob);
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth || image.width;
                canvas.height = image.naturalHeight || image.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    URL.revokeObjectURL(objectURL);
                    reject(new Error('Failed to create canvas context'));
                    return;
                }

                if (format === 'jpeg') {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(image, 0, 0);

                    canvas.toBlob(
                        outputBlob => {
                            URL.revokeObjectURL(objectURL);
                            if (outputBlob) {
                                resolve(outputBlob);
                            } else {
                                reject(new Error('Failed to encode image'));
                            }
                        },
                        getMimeByFormat(format),
                        quality
                    );
                } else if (format === 'png') {
                    ctx.drawImage(image, 0, 0);
                    canvas.toBlob(
                        async outputBlob => {
                            URL.revokeObjectURL(objectURL);
                            if (!outputBlob) {
                                reject(new Error('Failed to encode image'));
                                return;
                            }
                            try {
                                const optimized = await optimizePNGBlob(outputBlob, { level: 2, optimiseAlpha: true });
                                resolve(optimized);
                            } catch {
                                resolve(outputBlob);
                            }
                        },
                        'image/png'
                    );
                } else if (format === 'webp') {
                    ctx.drawImage(image, 0, 0);
                    canvas.toBlob(
                        outputBlob => {
                            URL.revokeObjectURL(objectURL);
                            if (outputBlob?.type === 'image/webp') {
                                resolve(outputBlob);
                            } else {
                                reject(new Error('WebP encoding is not supported by this client'));
                            }
                        },
                        'image/webp',
                        quality
                    );
                }
            } catch (error) {
                URL.revokeObjectURL(objectURL);
                reject(error);
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectURL);
            reject(new Error('Failed to load image'));
        };
        image.src = objectURL;
    });
}

interface WebPChunk {
    fourCC: string;
    data: Uint8Array;
}

const WEBP_XMP_NAMESPACE =
    'https://github.com/Achuan-2/siyuan-plugin-imgReEditor/ns/editor-metadata/1.0/';
const WEBP_XMP_PREFIX = 'siyuanImgReEditor';
const WEBP_XMP_FLAG = 0x04;

function readUint32LE(data: Uint8Array, offset: number): number {
    return (
        data[offset] |
        (data[offset + 1] << 8) |
        (data[offset + 2] << 16) |
        (data[offset + 3] << 24)
    ) >>> 0;
}

function writeUint32LE(data: Uint8Array, offset: number, value: number) {
    data[offset] = value & 0xff;
    data[offset + 1] = (value >>> 8) & 0xff;
    data[offset + 2] = (value >>> 16) & 0xff;
    data[offset + 3] = (value >>> 24) & 0xff;
}

function readUint24LE(data: Uint8Array, offset: number): number {
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function writeUint24LE(data: Uint8Array, offset: number, value: number) {
    data[offset] = value & 0xff;
    data[offset + 1] = (value >>> 8) & 0xff;
    data[offset + 2] = (value >>> 16) & 0xff;
}

function isWebPData(data: Uint8Array): boolean {
    if (data.length < 12) return false;
    return (
        String.fromCharCode(...data.subarray(0, 4)) === 'RIFF' &&
        String.fromCharCode(...data.subarray(8, 12)) === 'WEBP'
    );
}

function parseWebPChunks(data: Uint8Array): WebPChunk[] | null {
    if (!isWebPData(data)) return null;

    const riffEnd = readUint32LE(data, 4) + 8;
    if (riffEnd > data.length || riffEnd < 12) return null;

    const chunks: WebPChunk[] = [];
    let offset = 12;
    while (offset + 8 <= riffEnd) {
        const fourCC = String.fromCharCode(...data.subarray(offset, offset + 4));
        const size = readUint32LE(data, offset + 4);
        const dataStart = offset + 8;
        const dataEnd = dataStart + size;
        if (dataEnd > riffEnd) return null;

        chunks.push({ fourCC, data: data.slice(dataStart, dataEnd) });
        offset = dataEnd + (size & 1);
    }

    return offset === riffEnd ? chunks : null;
}

function buildWebP(chunks: WebPChunk[]): Uint8Array {
    const chunksLength = chunks.reduce(
        (total, chunk) => total + 8 + chunk.data.length + (chunk.data.length & 1),
        0
    );
    const result = new Uint8Array(12 + chunksLength);
    result.set(new TextEncoder().encode('RIFF'), 0);
    writeUint32LE(result, 4, result.length - 8);
    result.set(new TextEncoder().encode('WEBP'), 8);

    let offset = 12;
    for (const chunk of chunks) {
        if (chunk.fourCC.length !== 4) throw new Error('Invalid WebP FourCC');
        result.set(new TextEncoder().encode(chunk.fourCC), offset);
        writeUint32LE(result, offset + 4, chunk.data.length);
        result.set(chunk.data, offset + 8);
        offset += 8 + chunk.data.length + (chunk.data.length & 1);
    }
    return result;
}

function getWebPDimensions(chunks: WebPChunk[]): { width: number; height: number } | null {
    const vp8x = chunks.find(chunk => chunk.fourCC === 'VP8X');
    if (vp8x && vp8x.data.length >= 10) {
        return {
            width: readUint24LE(vp8x.data, 4) + 1,
            height: readUint24LE(vp8x.data, 7) + 1,
        };
    }

    const vp8 = chunks.find(chunk => chunk.fourCC === 'VP8 ');
    if (
        vp8 &&
        vp8.data.length >= 10 &&
        vp8.data[3] === 0x9d &&
        vp8.data[4] === 0x01 &&
        vp8.data[5] === 0x2a
    ) {
        return {
            width: (vp8.data[6] | (vp8.data[7] << 8)) & 0x3fff,
            height: (vp8.data[8] | (vp8.data[9] << 8)) & 0x3fff,
        };
    }

    const vp8l = chunks.find(chunk => chunk.fourCC === 'VP8L');
    if (vp8l && vp8l.data.length >= 5 && vp8l.data[0] === 0x2f) {
        const bits = readUint32LE(vp8l.data, 1);
        return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >>> 14) & 0x3fff) + 1,
        };
    }

    return null;
}

function createEditorXMPDescription(keyword: string, text: string): string {
    return `<rdf:Description rdf:about="" xmlns:${WEBP_XMP_PREFIX}="${WEBP_XMP_NAMESPACE}" ${WEBP_XMP_PREFIX}:keyword="${unicodeToBase64(keyword)}" ${WEBP_XMP_PREFIX}:value="${unicodeToBase64(text)}"/>`;
}

function mergeEditorMetadataIntoXMP(existingXMP: string | null, keyword: string, text: string): string {
    const description = createEditorXMPDescription(keyword, text);
    if (existingXMP) {
        const escapedNamespace = WEBP_XMP_NAMESPACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const oldDescription = new RegExp(
            `<rdf:Description\\b(?=[^>]*\\bxmlns:${WEBP_XMP_PREFIX}="${escapedNamespace}")[^>]*\\/>`,
            'gi'
        );
        const cleanedXMP = existingXMP.replace(oldDescription, '');
        if (/<\/rdf:RDF\s*>/i.test(cleanedXMP)) {
            return cleanedXMP.replace(/<\/rdf:RDF\s*>/i, `${description}</rdf:RDF>`);
        }
    }

    return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${description}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

/**
 * 将插件工程数据写入 WebP 的标准 XMP 块，并正确设置 VP8X 的 XMP 标志。
 */
export function insertWebPMetadata(data: Uint8Array, keyword: string, text: string): Uint8Array {
    const chunks = parseWebPChunks(data);
    if (!chunks) throw new Error('Not a valid WebP file');

    const existingXMPChunk = chunks.find(chunk => chunk.fourCC === 'XMP ');
    const existingXMP = existingXMPChunk
        ? new TextDecoder('utf-8').decode(existingXMPChunk.data)
        : null;
    const xmpData = new TextEncoder().encode(mergeEditorMetadataIntoXMP(existingXMP, keyword, text));

    const existingVP8X = chunks.find(chunk => chunk.fourCC === 'VP8X');
    let vp8xData: Uint8Array;
    if (existingVP8X) {
        if (existingVP8X.data.length < 10) throw new Error('Invalid WebP VP8X chunk');
        vp8xData = existingVP8X.data.slice();
        vp8xData[0] |= WEBP_XMP_FLAG;
    } else {
        const dimensions = getWebPDimensions(chunks);
        if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
            throw new Error('Unable to determine WebP dimensions');
        }

        vp8xData = new Uint8Array(10);
        if (chunks.some(chunk => chunk.fourCC === 'ICCP')) vp8xData[0] |= 0x20;
        if (chunks.some(chunk => chunk.fourCC === 'ALPH')) vp8xData[0] |= 0x10;
        if (chunks.some(chunk => chunk.fourCC === 'EXIF')) vp8xData[0] |= 0x08;
        if (chunks.some(chunk => chunk.fourCC === 'ANIM' || chunk.fourCC === 'ANMF')) {
            vp8xData[0] |= 0x02;
        }
        const vp8l = chunks.find(chunk => chunk.fourCC === 'VP8L');
        if (vp8l && vp8l.data.length >= 5 && (vp8l.data[4] & 0x10) !== 0) {
            vp8xData[0] |= 0x10;
        }
        vp8xData[0] |= WEBP_XMP_FLAG;
        writeUint24LE(vp8xData, 4, dimensions.width - 1);
        writeUint24LE(vp8xData, 7, dimensions.height - 1);
    }

    const remainingChunks = chunks.filter(
        chunk => chunk.fourCC !== 'VP8X' && chunk.fourCC !== 'XMP '
    );
    return buildWebP([
        { fourCC: 'VP8X', data: vp8xData },
        ...remainingChunks,
        { fourCC: 'XMP ', data: xmpData },
    ]);
}

/** 从 WebP XMP 块读取由插件写入的工程数据。 */
export function readWebPMetadata(data: Uint8Array, keyword: string): string | null {
    const chunks = parseWebPChunks(data);
    if (!chunks) return null;

    const xmpChunk = chunks.find(chunk => chunk.fourCC === 'XMP ');
    if (!xmpChunk) return null;

    const xmp = new TextDecoder('utf-8').decode(xmpChunk.data);
    const descriptionPattern = new RegExp(
        `<rdf:Description\\b[^>]*\\b${WEBP_XMP_PREFIX}:keyword="([^"]*)"[^>]*\\b${WEBP_XMP_PREFIX}:value="([^"]*)"[^>]*/?>`,
        'gi'
    );
    for (const match of xmp.matchAll(descriptionPattern)) {
        try {
            if (base64ToUnicode(match[1]) === keyword) {
                return base64ToUnicode(match[2]);
            }
        } catch {
            // Ignore malformed plugin metadata and continue searching.
        }
    }
    return null;
}

export function HTMLToElement(html: string): HTMLElement {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.firstChild as HTMLElement;
}

export function escapeHTML(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export function unescapeHTML(str: string): string {
    const div = document.createElement('div');
    div.innerHTML = str;
    return div.textContent || '';
}

export function unicodeToBase64(str: string): string {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let binary = '';
    const len = bytes.length;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToUnicode(base64: string): string {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export function bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function dataURLToBlob(dataURL: string): Blob {
    const urlParts = dataURL.split(',');
    const mime = urlParts[0].match(/:(.*?);/)![1];
    const base64 = urlParts[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

export async function blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export function mimeTypeToFormat(mime: string): string {
    const mineToFormat = {
        'image/svg+xml': 'svg',
        'image/png': 'png',
    };
    return mineToFormat[mime] || '';
}

export function formatToMimeType(format: string): string {
    const formatToMimeType = {
        'svg': 'image/svg+xml',
        'png': 'image/png',
    };
    return formatToMimeType[format] || '';
}

export function mimeTypeOfDataURL(dataURL: string): string {
    const mime = dataURL.match(/:(.*?);/)![1];
    return mime || '';
}

export function base64ToArray(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function arrayToBase64(array: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < array.length; i++) {
        binary += String.fromCharCode(array[i]);
    }
    return btoa(binary);
}

function getPNGSizeFromBase64(dataUrl: string): { width: number, height: number } | null {
    // 1. 检查是否是 PNG Data URL
    if (!dataUrl.startsWith('data:image/png;base64,')) {
        console.warn('Not a PNG data URL');
        return null;
    }

    // 2. 提取 base64 部分并解码为 Uint8Array
    const base64 = dataUrl.split(',')[1];
    if (!base64) return null;

    let binaryString: string;
    try {
        binaryString = atob(base64);
    } catch (e) {
        console.warn('Invalid base64 string');
        return null;
    }

    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    // 3. 检查 PNG 签名（前8字节）
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 0; i < 8; i++) {
        if (bytes[i] !== pngSignature[i]) {
            console.warn('Invalid PNG signature');
            return null;
        }
    }

    // 4. 读取 IHDR 中的 width 和 height（大端序，从第16字节开始？注意：IHDR chunk 在第8字节后开始）
    // 实际结构：
    // - bytes[0..7]: signature
    // - bytes[8..11]: chunk length (should be 13 for IHDR)
    // - bytes[12..15]: chunk type "IHDR"
    // - bytes[16..19]: width (4 bytes, big-endian)
    // - bytes[20..23]: height (4 bytes, big-endian)

    if (bytes.length < 24) {
        console.warn('PNG data too short');
        return null;
    }

    // 可选：验证 chunk type is "IHDR"
    const ihdrType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (ihdrType !== 'IHDR') {
        console.warn('First chunk is not IHDR');
        return null;
    }

    const width = (
        (bytes[16] << 24) |
        (bytes[17] << 16) |
        (bytes[18] << 8) |
        bytes[19]
    ) >>> 0; // 无符号

    const height = (
        (bytes[20] << 24) |
        (bytes[21] << 16) |
        (bytes[22] << 8) |
        bytes[23]
    ) >>> 0;

    return {
        width: width,
        height: height,
    };
}

function getSVGSizeFromBase64(dataUrl: string): { width: number, height: number } | null {
    if (!dataUrl.startsWith('data:image/svg+xml;base64,')) {
        console.warn('Not a SVG data URL');
        return null;
    }

    const base64 = dataUrl.split(',')[1];
    if (!base64) return null;

    let xmlStr: string;
    try {
        xmlStr = atob(base64);
    } catch {
        return null;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'image/svg+xml');
    const svg = doc.documentElement;

    if (svg.tagName.toLowerCase() !== 'svg') return null;

    // Try getBoundingClientRect-like intrinsic size
    const widthAttr = svg.getAttribute('width');
    const heightAttr = svg.getAttribute('height');
    const viewBox = svg.getAttribute('viewBox');

    const parseLength = (val: string | null): number | null => {
        if (!val) return null;
        const match = val.match(/^(\d+(?:\.\d+)?)$/); // only pure number or float
        if (match) return parseFloat(match[1]);
        const pxMatch = val.match(/^(\d+(?:\.\d+)?)px$/i);
        if (pxMatch) return parseFloat(pxMatch[1]);
        return null;
    };

    let w = parseLength(widthAttr);
    let h = parseLength(heightAttr);

    if ((w === null || h === null) && viewBox) {
        const vb = viewBox.trim().split(/\s+/).map(Number);
        if (vb.length === 4 && !vb.some(isNaN)) {
            if (w === null) w = vb[2];
            if (h === null) h = vb[3];
        }
    }

    return w != null && h != null && w > 0 && h > 0 ? { width: w, height: h } : null;
}

export function getImageSizeFromBase64(dataUrl: string): { width: number, height: number } | null {
    if (dataUrl.startsWith('data:image/png;base64,')) {
        return getPNGSizeFromBase64(dataUrl);
    }
    else if (dataUrl.startsWith('data:image/svg+xml;base64,')) {
        return getSVGSizeFromBase64(dataUrl);
    }
    return null;
}

export function locatePNGtEXt(data: Uint8Array): { index: number; length: number } | null {
    if (data.length < 8) return null;

    // 检查 PNG 文件头（可选，但推荐）
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 0; i < 8; i++) {
        if (data[i] !== pngSignature[i]) {
            return null; // 不是合法 PNG
        }
    }

    let offset = 8; // 跳过签名

    while (offset <= data.length - 12) {
        // 读取 Length（大端序，4字节）
        const length = (
            (data[offset] << 24) |
            (data[offset + 1] << 16) |
            (data[offset + 2] << 8) |
            data[offset + 3]
        ) >>> 0;

        // 检查是否超出文件边界
        if (offset + 12 + length > data.length) {
            break; // chunk 不完整
        }

        // 读取 Chunk Type（4字节）
        const typeBytes = data.subarray(offset + 4, offset + 8);
        const typeStr = String.fromCharCode(...typeBytes);

        if (typeStr === 'tEXt') {
            // 找到 tEXt chunk
            return { index: offset, length: 12 + length };
        }

        // 跳到下一个 chunk（12 = 4 Length + 4 Type + 4 CRC）
        offset += 12 + length;
    }

    return null; // 未找到 tEXt
}

export function replaceSubArray(
    srcArray: Uint8Array,
    srcSubArrayLocation: { index: number; length: number },
    destArray: Uint8Array,
    destSubArrayLocation: { index: number; length: number }
): Uint8Array {
    const { index: srcIndex, length: srcLength } = srcSubArrayLocation;
    const { index: destIndex, length: destLength } = destSubArrayLocation;

    // 边界检查：确保源子数组有效
    if (srcIndex < 0 || srcLength < 0 || srcIndex + srcLength > srcArray.length) {
        throw new Error('Invalid srcSubArrayLocation: out of bounds');
    }

    // 边界检查：确保目标子数组有效
    if (destIndex < 0 || destLength < 0 || destIndex + destLength > destArray.length) {
        throw new Error('Invalid destSubArrayLocation: out of bounds');
    }

    // 提取源子数组
    const srcSubArray = srcArray.subarray(srcIndex, srcIndex + srcLength);

    // 计算新数组长度
    const newLength = destArray.length - destLength + srcSubArray.length;

    // 创建结果数组
    const result = new Uint8Array(newLength);

    // 1. 复制 destArray 的前半部分 [0, destIndex)
    result.set(destArray.subarray(0, destIndex), 0);

    // 2. 插入 srcSubArray
    result.set(srcSubArray, destIndex);

    // 3. 复制 destArray 的后半部分 [destIndex + destLength, end)
    const afterDestIndex = destIndex + destLength;
    const afterSrcIndex = destIndex + srcSubArray.length;
    result.set(destArray.subarray(afterDestIndex), afterSrcIndex);

    return result;
}

export function insertPNGpHYs(data: Uint8Array, dpi: number): Uint8Array {
    if (data.length < 8) throw new Error('Invalid PNG: too short');

    // 验证 PNG 签名
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 0; i < 8; i++) {
        if (data[i] !== pngSignature[i]) {
            throw new Error('Not a valid PNG file');
        }
    }

    let offset = 8; // 跳过签名

    // Step 1: 找到 IHDR 块并定位其结束位置
    let ihdrEnd = -1;
    while (offset <= data.length - 12) {
        const length = (
            (data[offset] << 24) |
            (data[offset + 1] << 16) |
            (data[offset + 2] << 8) |
            data[offset + 3]
        ) >>> 0;

        if (offset + 12 + length > data.length) break;

        const typeBytes = data.subarray(offset + 4, offset + 8);
        const typeStr = String.fromCharCode(...typeBytes);

        if (typeStr === 'IHDR') {
            ihdrEnd = offset + 12 + length; // IHDR 结束位置（下一个 chunk 开始处）
            break;
        }

        offset += 12 + length;
    }

    if (ihdrEnd === -1) {
        throw new Error('IHDR chunk not found');
    }

    // Step 2: 构造 pHYs chunk data
    const ppm = Math.round(dpi * 39.3701); // pixels per meter
    const physData = new Uint8Array(9);
    // ppm_x (4 bytes, big-endian)
    physData[0] = (ppm >> 24) & 0xff;
    physData[1] = (ppm >> 16) & 0xff;
    physData[2] = (ppm >> 8) & 0xff;
    physData[3] = ppm & 0xff;
    // ppm_y (same as x)
    physData[4] = physData[0];
    physData[5] = physData[1];
    physData[6] = physData[2];
    physData[7] = physData[3];
    // unit = 1 (meter)
    physData[8] = 1;

    // Chunk type "pHYs"
    const physType = new Uint8Array([0x70, 0x48, 0x59, 0x73]); // 'pHYs'

    // Step 3: 计算 CRC32 over "pHYs" + physData
    const crcBuffer = new Uint8Array(physType.length + physData.length);
    crcBuffer.set(physType, 0);
    crcBuffer.set(physData, physType.length);
    const crc = crc32(crcBuffer);

    // Step 4: 构造完整的 pHYs chunk
    const chunkLength = new Uint8Array(4);
    chunkLength[0] = (physData.length >> 24) & 0xff;
    chunkLength[1] = (physData.length >> 16) & 0xff;
    chunkLength[2] = (physData.length >> 8) & 0xff;
    chunkLength[3] = physData.length & 0xff;

    const crcBytes = new Uint8Array(4);
    crcBytes[0] = (crc >> 24) & 0xff;
    crcBytes[1] = (crc >> 16) & 0xff;
    crcBytes[2] = (crc >> 8) & 0xff;
    crcBytes[3] = crc & 0xff;

    const physChunk = new Uint8Array(4 + 4 + physData.length + 4);
    physChunk.set(chunkLength, 0);
    physChunk.set(physType, 4);
    physChunk.set(physData, 8);
    physChunk.set(crcBytes, 8 + physData.length);

    // Step 5: 插入到 IHDR 之后
    const result = new Uint8Array(data.length + physChunk.length);
    // [0, ihdrEnd)
    result.set(data.subarray(0, ihdrEnd), 0);
    // insert pHYs chunk
    result.set(physChunk, ihdrEnd);
    // [ihdrEnd, end)
    result.set(data.subarray(ihdrEnd), ihdrEnd + physChunk.length);

    return result;
}

// --- CRC32 工具函数（PNG 标准）---
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c;
    }
    return table;
})();

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// --- PNG zTXt 元数据操作函数（类似 drawio 的实现）---

/**
 * 使用 zlib 压缩数据
 */
function deflateData(data: Uint8Array): Uint8Array {
    // 简单的 deflate 实现，使用 pako 库（如果可用）或原生 CompressionStream
    // 这里我们使用原生 API
    if (typeof CompressionStream !== 'undefined') {
        // 同步压缩不可用，我们使用简单的存储方式
        // 返回未压缩的数据，compression method = 0
    }
    // 如果没有压缩 API，返回原始数据
    return data;
}

/**
 * 使用 zlib 解压数据
 */
function inflateData(data: Uint8Array): Uint8Array {
    // 简单的 inflate 实现
    if (typeof DecompressionStream !== 'undefined') {
        // 同步解压不可用，返回原始数据
    }
    return data;
}

/**
 * 在 PNG 中插入 zTXt 块，用于存储思维导图数据
 * 使用 tEXt 块而非 zTXt，因为 tEXt 更简单且兼容性更好
 * @param data PNG 二进制数据
 * @param keyword 关键字（如 "mindmap"）
 * @param text 要存储的文本数据
 * @returns 修改后的 PNG 数据
 */
export function insertPNGTextChunk(data: Uint8Array, keyword: string, text: string): Uint8Array {
    if (data.length < 8) throw new Error('Invalid PNG: too short');

    // 验证 PNG 签名
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 0; i < 8; i++) {
        if (data[i] !== pngSignature[i]) {
            throw new Error('Not a valid PNG file');
        }
    }

    let offset = 8;

    // 找到 IEND 块的位置（插入到 IEND 之前）
    let iendStart = -1;
    while (offset <= data.length - 12) {
        const length = (
            (data[offset] << 24) |
            (data[offset + 1] << 16) |
            (data[offset + 2] << 8) |
            data[offset + 3]
        ) >>> 0;

        if (offset + 12 + length > data.length) break;

        const typeBytes = data.subarray(offset + 4, offset + 8);
        const typeStr = String.fromCharCode(...typeBytes);

        if (typeStr === 'IEND') {
            iendStart = offset;
            break;
        }

        offset += 12 + length;
    }

    if (iendStart === -1) {
        throw new Error('IEND chunk not found');
    }

    // 首先移除已存在的同名 tEXt 块
    let cleanedData = removePNGTextChunk(data, keyword);

    // 重新找到 IEND 位置
    offset = 8;
    iendStart = -1;
    while (offset <= cleanedData.length - 12) {
        const length = (
            (cleanedData[offset] << 24) |
            (cleanedData[offset + 1] << 16) |
            (cleanedData[offset + 2] << 8) |
            cleanedData[offset + 3]
        ) >>> 0;

        if (offset + 12 + length > cleanedData.length) break;

        const typeBytes = cleanedData.subarray(offset + 4, offset + 8);
        const typeStr = String.fromCharCode(...typeBytes);

        if (typeStr === 'IEND') {
            iendStart = offset;
            break;
        }

        offset += 12 + length;
    }

    if (iendStart === -1) {
        throw new Error('IEND chunk not found after cleanup');
    }

    // 构造 tEXt chunk
    // tEXt 格式: keyword + null separator + text
    const keywordBytes = new TextEncoder().encode(keyword);
    const textBytes = new TextEncoder().encode(text);
    const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
    chunkData.set(keywordBytes, 0);
    chunkData[keywordBytes.length] = 0; // null separator
    chunkData.set(textBytes, keywordBytes.length + 1);

    // Chunk type "tEXt"
    const chunkType = new Uint8Array([0x74, 0x45, 0x58, 0x74]); // 'tEXt'

    // 计算 CRC32 over "tEXt" + chunkData
    const crcBuffer = new Uint8Array(chunkType.length + chunkData.length);
    crcBuffer.set(chunkType, 0);
    crcBuffer.set(chunkData, chunkType.length);
    const crc = crc32(crcBuffer);

    // 构造完整的 tEXt chunk
    const chunkLength = new Uint8Array(4);
    chunkLength[0] = (chunkData.length >> 24) & 0xff;
    chunkLength[1] = (chunkData.length >> 16) & 0xff;
    chunkLength[2] = (chunkData.length >> 8) & 0xff;
    chunkLength[3] = chunkData.length & 0xff;

    const crcBytes = new Uint8Array(4);
    crcBytes[0] = (crc >> 24) & 0xff;
    crcBytes[1] = (crc >> 16) & 0xff;
    crcBytes[2] = (crc >> 8) & 0xff;
    crcBytes[3] = crc & 0xff;

    const textChunk = new Uint8Array(4 + 4 + chunkData.length + 4);
    textChunk.set(chunkLength, 0);
    textChunk.set(chunkType, 4);
    textChunk.set(chunkData, 8);
    textChunk.set(crcBytes, 8 + chunkData.length);

    // 插入到 IEND 之前
    const result = new Uint8Array(cleanedData.length + textChunk.length);
    result.set(cleanedData.subarray(0, iendStart), 0);
    result.set(textChunk, iendStart);
    result.set(cleanedData.subarray(iendStart), iendStart + textChunk.length);

    return result;
}

/**
 * 从 PNG 中移除指定关键字的 tEXt 块
 * @param data PNG 二进制数据
 * @param keyword 要移除的关键字
 * @returns 修改后的 PNG 数据
 */
export function removePNGTextChunk(data: Uint8Array, keyword: string): Uint8Array {
    if (data.length < 8) return data;

    // 验证 PNG 签名
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 0; i < 8; i++) {
        if (data[i] !== pngSignature[i]) {
            return data;
        }
    }

    const chunks: { start: number; length: number; type: string; keyword?: string }[] = [];
    let offset = 8;

    while (offset <= data.length - 12) {
        const length = (
            (data[offset] << 24) |
            (data[offset + 1] << 16) |
            (data[offset + 2] << 8) |
            data[offset + 3]
        ) >>> 0;

        if (offset + 12 + length > data.length) break;

        const typeBytes = data.subarray(offset + 4, offset + 8);
        const typeStr = String.fromCharCode(...typeBytes);

        let chunkKeyword: string | undefined;
        if (typeStr === 'tEXt' || typeStr === 'zTXt' || typeStr === 'iTXt') {
            // 读取关键字（到第一个 null 字节为止）
            const chunkDataStart = offset + 8;
            let nullIndex = chunkDataStart;
            while (nullIndex < chunkDataStart + length && data[nullIndex] !== 0) {
                nullIndex++;
            }
            chunkKeyword = new TextDecoder().decode(data.subarray(chunkDataStart, nullIndex));
        }

        chunks.push({
            start: offset,
            length: 12 + length,
            type: typeStr,
            keyword: chunkKeyword
        });

        offset += 12 + length;
    }

    // 过滤掉匹配关键字的 tEXt 块
    const chunksToKeep = chunks.filter(chunk => {
        if ((chunk.type === 'tEXt' || chunk.type === 'zTXt' || chunk.type === 'iTXt') && chunk.keyword === keyword) {
            return false;
        }
        return true;
    });

    // 如果没有移除任何块，返回原始数据
    if (chunksToKeep.length === chunks.length) {
        return data;
    }

    // 重新构建 PNG
    const totalLength = 8 + chunksToKeep.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    result.set(pngSignature, 0);

    let writeOffset = 8;
    for (const chunk of chunksToKeep) {
        result.set(data.subarray(chunk.start, chunk.start + chunk.length), writeOffset);
        writeOffset += chunk.length;
    }

    return result;
}

/**
 * 从 PNG 中读取指定关键字的 tEXt 块数据
 * @param data PNG 二进制数据
 * @param keyword 要读取的关键字
 * @returns 文本数据，如果未找到则返回 null
 */
export function readPNGTextChunk(data: Uint8Array, keyword: string): string | null {
    if (data.length < 8) return null;

    // 验证 PNG 签名
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 0; i < 8; i++) {
        if (data[i] !== pngSignature[i]) {
            return null;
        }
    }

    let offset = 8;

    while (offset <= data.length - 12) {
        const length = (
            (data[offset] << 24) |
            (data[offset + 1] << 16) |
            (data[offset + 2] << 8) |
            data[offset + 3]
        ) >>> 0;

        if (offset + 12 + length > data.length) break;

        const typeBytes = data.subarray(offset + 4, offset + 8);
        const typeStr = String.fromCharCode(...typeBytes);

        if (typeStr === 'tEXt') {
            const chunkDataStart = offset + 8;
            const chunkDataEnd = chunkDataStart + length;

            // 找到关键字结束位置（null 字节）
            let nullIndex = chunkDataStart;
            while (nullIndex < chunkDataEnd && data[nullIndex] !== 0) {
                nullIndex++;
            }

            const chunkKeyword = new TextDecoder().decode(data.subarray(chunkDataStart, nullIndex));

            if (chunkKeyword === keyword && nullIndex < chunkDataEnd) {
                // 读取文本数据（null 字节之后）
                const textData = data.subarray(nullIndex + 1, chunkDataEnd);
                return new TextDecoder().decode(textData);
            }
        }

        offset += 12 + length;
    }

    return null;
}

/**
 * 从 PNG data URL 中读取思维导图数据
 * @param dataUrl PNG 图片的 data URL
 * @returns 思维导图数据对象，如果未找到则返回 null
 */
export function readImageHistoryFromPNG(dataUrl: string): { mindMapData: any; mindMapConfig: any } | null {
    if (!dataUrl.startsWith('data:image/png;base64,')) {
        return null;
    }

    try {
        const base64 = dataUrl.split(',')[1];
        const binaryArray = base64ToArray(base64);
        const textData = readPNGTextChunk(binaryArray, 'siyuan-image-editor');

        if (!textData) {
            return null;
        }

        const parsed = JSON.parse(textData);
        return {
            mindMapData: parsed.mindMapData || null,
            mindMapConfig: parsed.mindMapConfig || null
        };
    } catch (e) {
        console.error('Failed to read mindmap data from PNG:', e);
        return null;
    }
}

/**
 * 将思维导图数据写入 PNG data URL
 * @param dataUrl PNG 图片的 data URL
 * @param mindMapData 思维导图节点数据
 * @param mindMapConfig 思维导图配置数据
 * @returns 带有元数据的新 data URL
 */
export function writeImageHistoryToPNG(dataUrl: string, mindMapData: any, mindMapConfig: any): string {
    if (!dataUrl.startsWith('data:image/png;base64,')) {
        return dataUrl;
    }

    try {
        const base64 = dataUrl.split(',')[1];
        let binaryArray = base64ToArray(base64);

        const textData = JSON.stringify({
            mindMapData: mindMapData,
            mindMapConfig: mindMapConfig
        });

        binaryArray = insertPNGTextChunk(binaryArray, 'siyuan-image-editor', textData);

        const newBase64 = arrayToBase64(binaryArray);
        return `data:image/png;base64,${newBase64}`;
    } catch (e) {
        console.error('Failed to write mindmap data to PNG:', e);
        return dataUrl;
    }
}

/**
 * 检查 PNG 是否包含思维导图数据
 * @param dataUrl PNG 图片的 data URL
 * @returns 是否包含思维导图数据
 */
export function hasImageHistoryInPNG(dataUrl: string): boolean {
    if (!dataUrl.startsWith('data:image/png;base64,')) {
        return false;
    }

    try {
        const base64 = dataUrl.split(',')[1];
        const binaryArray = base64ToArray(base64);
        const textData = readPNGTextChunk(binaryArray, 'siyuan-image-editor');
        return textData !== null;
    } catch (e) {
        return false;
    }
}


