type UploadedAssetsHandler<T> = (paths: string[], documentID: string, context: T) => Promise<void>;

/** Observe successful uploads without delaying their request or response. */
export function observeAssetUploads<T = undefined>(
    enabled: () => boolean,
    onUploaded: UploadedAssetsHandler<T>,
    captureContext: () => T = () => undefined as T
): () => void {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalFetch = window.fetch;
    const requests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
    let active = true;

    const isAssetUpload = (method: string, url: string) => {
        if (method.toUpperCase() !== 'POST') return false;
        try {
            const parsed = new URL(url, window.location.href);
            return parsed.origin === window.location.origin &&
                ['/api/asset/upload', '/api/asset/insertLocalAssets'].includes(parsed.pathname);
        } catch {
            return false;
        }
    };

    const getDocumentID = (body: unknown): string => {
        try {
            const id = body instanceof FormData ? body.get('id') :
                typeof body === 'string' ? JSON.parse(body)?.id : '';
            return typeof id === 'string' ? id : '';
        } catch {
            return '';
        }
    };

    const handleResponse = (response: any, documentID: string, context: T) => {
        if (!active || !enabled() || response?.code !== 0) return;
        const data = response.data;
        // New kernels retain duplicate filenames in succFiles; older kernels use succMap.
        const paths = Array.isArray(data?.succFiles)
            ? data.succFiles.map((file: any) => file.path)
            : Object.values(data?.succMap || {});
        const uniquePaths = [...new Set<string>(paths.filter((path: unknown) => typeof path === 'string'))];
        if (uniquePaths.length === 0) return;
        // Release the response to the editor before starting any compression work.
        window.setTimeout(() => {
            if (!active || !enabled()) return;
            void onUploaded(uniquePaths, documentID, context).catch(error => {
                console.error('Background image compression failed:', error);
            });
        }, 0);
    };

    const open: typeof originalOpen = function(method: string, url: string | URL, ...args: any[]) {
        requests.set(this, { method, url: String(url) });
        return originalOpen.apply(this, [method, url, ...args]);
    };
    const send: typeof originalSend = function(body) {
        const request = requests.get(this);
        if (active && enabled() && request && isAssetUpload(request.method, request.url)) {
            const documentID = getDocumentID(body);
            const context = captureContext();
            this.addEventListener('loadend', () => {
                if (this.status < 200 || this.status >= 300) return;
                try {
                    handleResponse(this.responseType === 'json' ? this.response :
                        JSON.parse(this.responseText), documentID, context);
                } catch (error) {
                    console.warn('Unable to read asset upload response:', error);
                }
            }, { once: true });
        }
        return originalSend.call(this, body);
    };
    const fetch: typeof originalFetch = function(input, init) {
        const request = input instanceof Request ? input : null;
        const url = request?.url || String(input);
        const method = init?.method || request?.method || 'GET';
        const observed = active && enabled() && isAssetUpload(method, url);
        const context = observed ? captureContext() : undefined as T;
        let documentID = Promise.resolve(getDocumentID(init?.body));
        if (observed && request && init?.body === undefined) {
            // Clone before fetch consumes a Request body; reading it never holds up fetch.
            try {
                const copy = request.clone();
                documentID = copy.headers.get('content-type')?.includes('multipart/form-data')
                    ? copy.formData().then(getDocumentID).catch(() => '')
                    : copy.text().then(getDocumentID).catch(() => '');
            } catch { /* A consumed Request is handled by the original fetch. */ }
        }
        const result = originalFetch.call(window, input, init);
        if (observed) {
            // Read a clone independently; the editor receives the original Promise and body.
            void result.then(response => {
                if (response.ok) {
                    void Promise.all([response.clone().json(), documentID]).then(([data, docID]) => {
                        handleResponse(data, docID, context);
                    }).catch(error => console.warn('Unable to read asset upload response:', error));
                }
            }).catch(() => { /* The caller handles upload failures. */ });
        }
        return result;
    };

    XMLHttpRequest.prototype.open = open;
    XMLHttpRequest.prototype.send = send;
    window.fetch = fetch;
    return () => {
        active = false;
        if (XMLHttpRequest.prototype.open === open) XMLHttpRequest.prototype.open = originalOpen;
        if (XMLHttpRequest.prototype.send === send) XMLHttpRequest.prototype.send = originalSend;
        if (window.fetch === fetch) window.fetch = originalFetch;
    };
}
