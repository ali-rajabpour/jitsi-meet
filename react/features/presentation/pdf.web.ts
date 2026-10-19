import { getBaseUrl } from '../base/util/helpers';

import { PresentationFileType, canvasRatio } from './protocol';

/**
 * A loaded document, either a PDF or a single image.
 */
export interface IPresentationDocument {

    /**
     * Releases the document and everything it holds.
     */
    destroy: () => void;

    /**
     * Returns the natural size of a page at scale 1.
     */
    getPageSize: (page: number) => Promise<{ height: number; width: number; }>;

    /**
     * The number of pages.
     */
    pageCount: number;

    /**
     * Renders a page into a canvas, sized to the given CSS width. A newer call on the same canvas wins: an
     * older call that has not finished yet resolves without drawing.
     */
    renderPage: (page: number, canvas: HTMLCanvasElement, cssWidth: number) => Promise<void>;
}

/**
 * The largest canvas backing store, in pixels. Larger canvases are blanked by Safari (about 16.7M pixels) and
 * use too much memory elsewhere, so the drawing resolution is lowered for high zoom levels instead.
 */
export const MAX_CANVAS_PIXELS = 16 * 1000 * 1000;

let worker: Worker | undefined;

/**
 * Sizes a canvas for crisp drawing on high density screens, within the pixel budget, and returns its 2D
 * context and the scale from CSS pixels to canvas pixels.
 *
 * @param {HTMLCanvasElement} canvas - The canvas.
 * @param {number} cssWidth - The CSS width.
 * @param {number} cssHeight - The CSS height.
 * @returns {Object}
 */
export function prepareCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number) {
    const ratio = canvasRatio(window.devicePixelRatio || 1, cssWidth, cssHeight, MAX_CANVAS_PIXELS);

    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    return { context: canvas.getContext('2d')!, ratio };
}

/**
 * Loads an image as a single page document.
 *
 * @param {ArrayBuffer} bytes - The image bytes.
 * @returns {Promise<IPresentationDocument>}
 */
async function loadImage(bytes: ArrayBuffer): Promise<IPresentationDocument> {
    const bitmap = await createImageBitmap(new Blob([ bytes ]));

    return {
        destroy: () => bitmap.close(),
        getPageSize: () => Promise.resolve({ height: bitmap.height, width: bitmap.width }),
        pageCount: 1,
        renderPage: (_page, canvas, cssWidth) => {
            const { context } = prepareCanvas(canvas, cssWidth, cssWidth * bitmap.height / bitmap.width);

            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

            return Promise.resolve();
        }
    };
}

/**
 * Loads a PDF with pdf.js, which is fetched as a separate chunk on first use. The character maps, standard
 * fonts, colour profiles and image decoders (JPEG 2000 and JBIG2, common in scanned documents) are served
 * from libs/pdfjs/ by the deployment.
 *
 * @param {ArrayBuffer} bytes - The PDF bytes.
 * @returns {Promise<IPresentationDocument>}
 */
async function loadPdf(bytes: ArrayBuffer): Promise<IPresentationDocument> {
    const pdfjs = await import(/* webpackChunkName: "pdfjs" */ 'pdfjs-dist');
    const resources = `${getBaseUrl()}libs/pdfjs/`;

    if (!worker) {
        worker = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
        pdfjs.GlobalWorkerOptions.workerPort = worker;
    }

    const loadingTask = pdfjs.getDocument({
        cMapPacked: true,
        cMapUrl: `${resources}cmaps/`,
        data: new Uint8Array(bytes),
        iccUrl: `${resources}iccs/`,
        standardFontDataUrl: `${resources}standard_fonts/`,
        wasmUrl: `${resources}wasm/`
    });
    const pdf = await loadingTask.promise;
    const renders = new WeakMap<HTMLCanvasElement, { cancel?: () => void; generation: number; }>();

    return {
        destroy: () => {
            loadingTask.destroy();
        },
        getPageSize: async page => {
            const viewport = (await pdf.getPage(page)).getViewport({ scale: 1 });

            return { height: viewport.height, width: viewport.width };
        },
        pageCount: pdf.numPages,
        renderPage: async (page, canvas, cssWidth) => {
            const generation = (renders.get(canvas)?.generation ?? 0) + 1;
            const isCurrent = () => renders.get(canvas)?.generation === generation;

            renders.get(canvas)?.cancel?.();
            renders.set(canvas, { generation });

            const pdfPage = await pdf.getPage(page);

            if (!isCurrent()) {
                return;
            }

            const scale = cssWidth / pdfPage.getViewport({ scale: 1 }).width;
            const viewport = pdfPage.getViewport({ scale });

            // Render into a detached canvas and copy at the end, so a cancelled or slow render never
            // leaves a blank or half-drawn page on screen.
            const offscreen = document.createElement('canvas');
            const { context, ratio } = prepareCanvas(offscreen, viewport.width, viewport.height);
            const task = pdfPage.render({
                canvas: offscreen,
                canvasContext: context,
                transform: ratio === 1 ? undefined : [ ratio, 0, 0, ratio, 0, 0 ],
                viewport
            });

            renders.set(canvas, { cancel: () => task.cancel(), generation });

            try {
                await task.promise;
            } catch (error: any) {
                if (error?.name === 'RenderingCancelledException') {
                    return;
                }
                throw error;
            }

            if (!isCurrent()) {
                return;
            }

            const { context: target } = prepareCanvas(canvas, viewport.width, viewport.height);

            target.drawImage(offscreen, 0, 0);
        }
    };
}

/**
 * Loads a presentable file.
 *
 * @param {ArrayBuffer} bytes - The file bytes.
 * @param {PresentationFileType} fileType - The file type.
 * @returns {Promise<IPresentationDocument>}
 */
export function loadDocument(bytes: ArrayBuffer, fileType: PresentationFileType): Promise<IPresentationDocument> {
    return fileType === 'pdf' ? loadPdf(bytes) : loadImage(bytes);
}
