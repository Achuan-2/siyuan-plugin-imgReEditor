import { Dialog } from 'siyuan';
import { t } from './i18n';
import type { CompressibleImageFormat, ReencodeOptions } from './index';

export interface ImageCompressionChoice extends ReencodeOptions {
    outputFormat?: CompressibleImageFormat | 'original';
    formatOptions?: Partial<Record<CompressibleImageFormat, ReencodeOptions>>;
}

export interface CompressionPreviewItem {
    path: string;
    format: CompressibleImageFormat;
}

interface DialogOptions {
    title: string;
    items: CompressionPreviewItem[];
    defaultFormat: CompressibleImageFormat | 'original';
    limitLongEdge: boolean;
    maxLongEdge: number;
    defaults: (format: CompressibleImageFormat) => ReencodeOptions;
    load: (item: CompressionPreviewItem) => Promise<Blob>;
    encode: (item: CompressionPreviewItem, source: Blob, choice: ImageCompressionChoice) => Promise<Blob>;
    confirm: (choice: ImageCompressionChoice) => Promise<void>;
}

interface PreviewResult {
    sourceSize: number;
    outputSize?: number;
    source?: Blob;
    output?: Blob;
    error?: string;
}

function bytes(size: number) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

/** A dialog owns its previews, object URLs and temporary settings until closed. */
export function showImageCompressionDialog(options: DialogOptions): void {
    const { items } = options;
    if (!items.length) return;
    let closed = false;
    let revision = 0;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let originalURL = '';
    let outputURL = '';
    let view: 'original' | 'output' = 'output';
    let result: PreviewResult | undefined;
    // Keep quality overrides per format. Untouched formats inherit global values.
    const overrides = new Map<CompressibleImageFormat, ReencodeOptions>();
    const dispose = () => {
        closed = true;
        revision++;
        clearTimeout(timer);
        if (originalURL) URL.revokeObjectURL(originalURL);
        if (outputURL) URL.revokeObjectURL(outputURL);
        result = undefined;
    };
    const dialog = new Dialog({
        title: options.title,
        width: '1000px',
        destroyCallback: dispose,
        content: `<form class="img-compression-dialog">
<style>
.img-compression-dialog{display:flex;flex-direction:column;max-height:85vh}
.img-compression-dialog .ic-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:390px;overflow:auto}
.img-compression-dialog .ic-preview{display:flex;flex-direction:column;min-width:0;background:var(--b3-theme-background)}
.img-compression-dialog .ic-toolbar{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid var(--b3-border-color)}
.img-compression-dialog .ic-stage{display:flex;align-items:center;justify-content:center;min-height:260px;height:45vh;max-height:520px;padding:16px;overflow:hidden;background-color:var(--b3-theme-surface);background-image:conic-gradient(var(--b3-border-color) 25%,transparent 0 50%,var(--b3-border-color) 0 75%,transparent 0);background-size:16px 16px}
.img-compression-dialog .ic-stage img{max-width:100%;max-height:100%;object-fit:contain}
.img-compression-dialog .ic-settings{padding:20px;border-left:1px solid var(--b3-border-color);display:flex;flex-direction:column;gap:20px}
.img-compression-dialog .ic-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.img-compression-dialog .ic-status{padding:12px 16px;min-height:20px;overflow-wrap:anywhere}
.img-compression-dialog [data-error]{color:var(--b3-theme-error)}
.img-compression-dialog [data-file]{max-width:100%;width:100%;min-width:0}
.img-compression-dialog [data-quality]{width:100%;margin:12px 0 0}
.img-compression-dialog [data-note]{font-size:12px;color:var(--b3-theme-on-surface)}
.img-compression-dialog [data-total]{font-size:18px;font-weight:600}
@media(max-width:700px){.img-compression-dialog .ic-layout{grid-template-columns:minmax(0,1fr)}.img-compression-dialog .ic-settings{border-left:0;border-top:1px solid var(--b3-border-color)}.img-compression-dialog .ic-stage{height:28vh;min-height:180px}}
</style>
<div class="ic-layout">
  <div class="ic-preview">
    <div class="ic-toolbar">
      <button type="button" data-original class="b3-button b3-button--outline"></button>
      <button type="button" data-output class="b3-button"></button>
      <span class="fn__flex-1"></span><span data-position></span>
    </div>
    <div class="ic-stage"><img data-preview alt="" hidden></div>
    <div class="ic-status"><div data-size></div><div data-error role="status"></div></div>
  </div>
  <div class="ic-settings">
    <select data-file class="b3-select"></select>
    <label class="ic-row"><span data-format-label></span><select data-format class="b3-select">
      <option value="original" data-original-format></option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option>
    </select></label>
    <div><div class="ic-row"><span data-quality-label></span><span data-quality-value></span></div>
      <input data-quality type="range" min="1" max="100" step="1" class="b3-slider">
    </div>
    <div><label class="ic-row"><span data-limit-label></span><input data-limit type="checkbox" class="b3-switch"></label>
      <label data-pixels-row class="ic-row" style="margin-top:12px"><span data-pixels-label></span><input data-pixels type="number" min="1" step="1" required class="b3-text-field" style="width:100px"></label>
    </div>
    <div class="ic-row" style="margin-top:auto"><span data-total-label></span><span data-total>—</span></div>
    <div data-note></div>
  </div>
</div>
<div class="b3-dialog__action"><button data-cancel type="button" class="b3-button b3-button--cancel"></button><div class="fn__space"></div><button data-confirm type="submit" class="b3-button b3-button--text" disabled></button></div>
</form>`,
    });
    const root = dialog.element;
    const find = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    const text = (selector: string, key: string) => { find(selector).textContent = t(`imageCompression.${key}`); };
    for (const [selector, key] of [
        ['[data-original]', 'original'], ['[data-output]', 'preview'], ['[data-format-label]', 'format'],
        ['[data-original-format]', 'originalFormat'], ['[data-quality-label]', 'quality'],
        ['[data-limit-label]', 'limitLongEdge'], ['[data-pixels-label]', 'maxLongEdge'],
        ['[data-total-label]', 'estimatedSize'],
        ['[data-note]', 'keepSmaller'], ['[data-confirm]', 'apply'],
    ]) text(selector, key);
    find('[data-cancel]').textContent = window.siyuan.languages.cancel;
    const file = find<HTMLSelectElement>('[data-file]');
    file.setAttribute('aria-label', t('imageCompression.previewImage'));
    items.forEach((item, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = item.path.split('/').pop() || item.path;
        file.append(option);
    });
    file.hidden = items.length === 1;
    const format = find<HTMLSelectElement>('[data-format]');
    format.value = options.defaultFormat;
    const quality = find<HTMLInputElement>('[data-quality]');
    quality.setAttribute('aria-label', t('imageCompression.quality'));
    const limit = find<HTMLInputElement>('[data-limit]');
    const pixels = find<HTMLInputElement>('[data-pixels]');
    const confirm = find<HTMLButtonElement>('[data-confirm]');
    const preview = find<HTMLImageElement>('[data-preview]');
    limit.checked = options.limitLongEdge;
    pixels.value = String(options.maxLongEdge);
    const selected = () => items[Number(file.value) || 0];
    const outputFormat = (item = selected()) => format.value === 'original' ? item.format : format.value as CompressibleImageFormat;
    const choiceFor = (item = selected()): ImageCompressionChoice => {
        const output = outputFormat(item);
        return {
            ...options.defaults(output), ...overrides.get(output),
            outputFormat: format.value as ImageCompressionChoice['outputFormat'],
            maxLongEdge: limit.checked ? pixels.valueAsNumber : undefined,
        };
    };
    const syncQuality = () => {
        const output = outputFormat();
        const choice = choiceFor();
        const lossless = output === 'png' ? choice.pngMode === 'lossless' : output === 'webp' && choice.quality === 1;
        quality.value = String(lossless ? 100 : Math.round((choice.quality ?? 0.92) * 100));
        find('[data-quality-value]').textContent = lossless ? `100 · ${t('imageCompression.lossless')}` : quality.value;
    };
    const render = () => {
        if (originalURL) URL.revokeObjectURL(originalURL);
        if (outputURL) URL.revokeObjectURL(outputURL);
        originalURL = result?.source ? URL.createObjectURL(result.source) : '';
        outputURL = result?.output ? URL.createObjectURL(result.output) : '';
        const url = view === 'original' ? originalURL : outputURL || originalURL;
        preview.hidden = !url;
        if (url) preview.src = url;
        else preview.removeAttribute('src');
        find('[data-position]').textContent = items.length > 1 ? `${Number(file.value) + 1} / ${items.length}` : '';
        find('[data-size]').textContent = result?.outputSize !== undefined
            ? `${bytes(result.sourceSize)} → ${bytes(result.outputSize)}${result.outputSize < result.sourceSize ? ` (−${((1 - result.outputSize / result.sourceSize) * 100).toFixed(1)}%)` : ` · ${t('imageCompression.originalKept')}`}`
            : result?.sourceSize ? bytes(result.sourceSize) : '';
        find('[data-error]').textContent = result?.error || '';
    };
    const refreshStatus = () => {
        find('[data-total]').textContent = result?.outputSize !== undefined
            ? bytes(Math.min(result.sourceSize, result.outputSize)) : '—';
        confirm.disabled = result?.outputSize === undefined;
    };
    // One encoding at a time; moving the slider supersedes stale work rather
    // than launching a worker job for every input event. Only load the selected image.
    const run = async () => {
        if (closed || running || (limit.checked && !pixels.validity.valid)) return;
        clearTimeout(timer);
        running = true;
        const current = revision;
        try {
            const item = selected();
            let source: Blob | undefined;
            try {
                source = await options.load(item);
                if (!source?.size) throw new Error(t('imageCompression.previewFailed'));
                if (closed || current !== revision) return;
                // Show the source while its encode is still pending.
                result = { sourceSize: source.size, source };
                render();
                const encoded = await options.encode(item, source, choiceFor(item));
                if (closed || current !== revision) return;
                result = { sourceSize: source.size, outputSize: encoded.size, source, output: encoded };
            } catch (error) {
                if (closed || current !== revision) return;
                result = {
                    sourceSize: source?.size || 0, source,
                    error: error instanceof Error ? error.message : t('imageCompression.previewFailed'),
                };
            }
            render();
            refreshStatus();
        } finally {
            running = false;
            if (!closed && current !== revision) void run();
        }
    };
    const schedule = (delay = 250) => {
        revision++;
        clearTimeout(timer);
        result = undefined;
        render();
        refreshStatus();
        timer = setTimeout(() => void run(), delay);
    };
    const syncLimit = () => {
        pixels.disabled = !limit.checked;
        find('[data-pixels-row]').hidden = !limit.checked;
    };
    format.addEventListener('change', () => { syncQuality(); schedule(); });
    quality.addEventListener('input', () => {
        const output = outputFormat();
        overrides.set(output, {
            quality: quality.valueAsNumber / 100,
            ...(output === 'png' ? { pngMode: quality.valueAsNumber === 100 ? 'lossless' : 'lossy' } as const : {}),
        });
        syncQuality();
        schedule();
    });
    limit.addEventListener('change', () => { syncLimit(); schedule(); });
    pixels.addEventListener('input', () => {
        if (pixels.validity.valid) schedule();
        else { revision++; clearTimeout(timer); confirm.disabled = true; }
    });
    file.addEventListener('change', () => {
        syncQuality();
        schedule(0);
    });
    for (const tab of ['original', 'output'] as const) find(`[data-${tab}]`).addEventListener('click', () => {
        view = tab;
        find('[data-original]').classList.toggle('b3-button--outline', tab !== 'original');
        find('[data-output]').classList.toggle('b3-button--outline', tab !== 'output');
        render();
    });
    find('[data-cancel]').addEventListener('click', () => { dispose(); dialog.destroy(); });
    find<HTMLFormElement>('form').addEventListener('submit', async event => {
        event.preventDefault();
        if (confirm.disabled || (limit.checked && !pixels.reportValidity())) return;
        const choice: ImageCompressionChoice = {
            outputFormat: format.value as ImageCompressionChoice['outputFormat'],
            maxLongEdge: limit.checked ? pixels.valueAsNumber : undefined,
            formatOptions: Object.fromEntries((['png', 'jpeg', 'webp'] as const)
                .map(output => [output, { ...options.defaults(output), ...overrides.get(output) }])),
        };
        dispose();
        dialog.destroy();
        await options.confirm(choice);
    });
    syncQuality();
    syncLimit();
    refreshStatus();
    void run();
}
