import { Dialog } from 'siyuan';
import { t } from './i18n';

interface CompressionProgressState {
    phase: 'scanning' | 'compressing' | 'updatingReferences';
    current?: number;
    total?: number;
    fileName?: string;
}

/** Progress belongs to one operation and is closed by its caller in finally. */
export function showImageCompressionProgress(title: string) {
    let closed = false;
    const dialog = new Dialog({
        title,
        width: '480px',
        disableClose: true,
        hideCloseIcon: true,
        destroyCallback: () => { closed = true; },
        content: `<div class="img-compression-progress" style="padding:24px;display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;justify-content:space-between;gap:16px" aria-live="polite">
                <span data-phase></span><span data-count style="white-space:nowrap"></span>
            </div>
            <progress data-progress max="1" style="width:100%;height:10px;accent-color:var(--b3-theme-primary)"></progress>
            <div data-file style="overflow-wrap:anywhere;color:var(--b3-theme-on-surface)"></div>
        </div>`,
    });
    const phase = dialog.element.querySelector<HTMLElement>('[data-phase]')!;
    const count = dialog.element.querySelector<HTMLElement>('[data-count]')!;
    const bar = dialog.element.querySelector<HTMLProgressElement>('[data-progress]')!;
    const file = dialog.element.querySelector<HTMLElement>('[data-file]')!;
    const update = (state: CompressionProgressState) => {
        if (closed) return;
        phase.textContent = t(`documentImageCompression.${state.phase}`);
        bar.setAttribute('aria-label', phase.textContent);
        const total = Math.max(0, Math.floor(state.total ?? 0));
        if (total > 0) {
            const current = Math.min(total, Math.max(0, Math.floor(state.current || 0)));
            bar.max = total;
            bar.value = current;
            count.textContent = `${current}/${total} · ${Math.floor(current / total * 100)}%`;
        } else {
            bar.removeAttribute('value');
            count.textContent = '';
        }
        file.textContent = state.fileName || '';
        file.hidden = !state.fileName;
    };
    update({ phase: 'scanning' });
    return {
        update,
        close() {
            if (closed) return;
            closed = true;
            dialog.destroy();
        },
    };
}
