/**
 * Wire format and geometry helpers for the presentation feature.
 *
 * This module intentionally has no imports so that it stays a pure, easily
 * verifiable description of what goes over signalling and how incoming data
 * is validated.
 */

/**
 * The file types which can be presented.
 */
export type PresentationFileType = 'pdf' | 'jpg' | 'jpeg' | 'png';

/**
 * The tools which leave ink on the page.
 */
export type InkTool = 'pen' | 'highlighter';

/**
 * All presenter tools.
 */
export type PresentationTool = 'pointer' | InkTool | 'eraser';

/**
 * The part of the presentation state which describes what the presenter sees.
 */
export interface IPresentationView {

    /**
     * The 1-based page number.
     */
    page: number;

    /**
     * Horizontal scroll position as a fraction of the scrollable range (0-1).
     */
    scrollX: number;

    /**
     * Vertical scroll position as a fraction of the scrollable range (0-1).
     */
    scrollY: number;

    /**
     * Zoom factor relative to fit-to-width.
     */
    zoom: number;
}

/**
 * The full presentation state shared through the presenter's presence.
 */
export interface IPresentationInfo extends IPresentationView {

    /**
     * The id of the presented file in file sharing.
     */
    fileId: string;

    /**
     * The name of the presented file.
     */
    fileName: string;

    /**
     * The type of the presented file.
     */
    fileType: PresentationFileType;

    /**
     * The participant id of the presenter.
     */
    presenterId: string;

    /**
     * The part of the page the presenter currently sees. Viewers scale and scroll so that all of it is
     * visible on their screen, whatever its size.
     */
    region: IRegion;

    /**
     * When the presentation was started, used to order takeovers.
     */
    startedAt: number;
}

/**
 * A rectangle on the page in page units (0-1 of the page width and height).
 */
export interface IRegion {

    /**
     * The height as a fraction of the page height.
     */
    h: number;

    /**
     * The width as a fraction of the page width.
     */
    w: number;

    /**
     * The left edge.
     */
    x: number;

    /**
     * The top edge.
     */
    y: number;
}

/**
 * A single ink stroke on the current page.
 */
export interface IStroke {

    /**
     * The stroke colour, one of {@link ALLOWED_COLORS}.
     */
    color: string;

    /**
     * The stroke id, unique within the presentation.
     */
    id: string;

    /**
     * Flat list of points, [x0, y0, x1, y1, ...], in page units (0-1).
     */
    points: number[];

    /**
     * The tool which drew the stroke.
     */
    tool: InkTool;
}

/**
 * Messages sent over endpoint messages. A pointer with a negative x hides it.
 */
export type PresentationMessage =
    | { kind: 'pointer'; page: number; x: number; y: number; }
    | { kind: 'stroke'; page: number; stroke: IStroke; }
    | { id: string; kind: 'erase'; page: number; }
    | { append?: boolean; kind: 'strokes'; page: number; strokes: IStroke[]; }
    | { kind: 'sync-request'; };

/**
 * The name used for the presence command and the endpoint messages.
 */
export const PRESENTATION_NAME = 'presentation';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const MAX_STROKE_POINTS = 4000;
export const MAX_STROKES = 500;

/**
 * The colours offered to the presenter: red, yellow, green and blue.
 */
export const ALLOWED_COLORS: readonly string[] = [ '#E54B4B', '#F5C518', '#3BB273', '#3D7FE5' ];

const PRESENTABLE_TYPES: readonly string[] = [ 'pdf', 'jpg', 'jpeg', 'png' ];
const INK_TOOLS: readonly string[] = [ 'pen', 'highlighter' ];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ID_LENGTH = 64;

/**
 * Clamps a number into a range, using a default for non-finite values.
 *
 * @param {unknown} value - The value.
 * @param {number} min - The minimum.
 * @param {number} max - The maximum.
 * @param {number} fallback - Used when value is not a finite number.
 * @returns {number}
 */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'string' ? Number(value) : value;

    if (typeof n !== 'number' || !Number.isFinite(n)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, n));
}

/**
 * Checks whether a value is a finite number within 0-1.
 *
 * @param {unknown} n - The value.
 * @returns {boolean}
 */
function isUnit(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

/**
 * Checks whether a value is a valid 1-based page number.
 *
 * @param {unknown} n - The value.
 * @returns {boolean}
 */
function isPage(n: unknown): n is number {
    return typeof n === 'number' && Number.isInteger(n) && n >= 1;
}

/**
 * Checks whether a value is a non-empty, reasonably short string id.
 *
 * @param {unknown} id - The value.
 * @returns {boolean}
 */
function isId(id: unknown): id is string {
    return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH;
}

/**
 * Checks whether a file type can be presented. The type is expected in lower case.
 *
 * @param {string} fileType - The file type (extension).
 * @returns {boolean}
 */
export function isPresentableType(fileType?: string): fileType is PresentationFileType {
    return typeof fileType === 'string' && PRESENTABLE_TYPES.includes(fileType);
}

/**
 * Normalises a view, filling defaults and clamping every field into its range.
 *
 * @param {Partial<IPresentationView>} view - The view to normalise.
 * @param {number} pageCount - The number of pages, if known.
 * @returns {IPresentationView}
 */
export function clampView(view: Partial<IPresentationView>, pageCount?: number): IPresentationView {
    return {
        page: Math.round(clamp(view.page, 1, pageCount ?? Number.MAX_SAFE_INTEGER, 1)),
        zoom: clamp(view.zoom, MIN_ZOOM, MAX_ZOOM, MIN_ZOOM),
        scrollX: clamp(view.scrollX, 0, 1, 0),
        scrollY: clamp(view.scrollY, 0, 1, 0)
    };
}

/**
 * Serialises presentation info for the presence command. Presence attributes are strings.
 *
 * @param {IPresentationInfo} info - The presentation info.
 * @returns {Object}
 */
export function serializeStateAttributes(info: IPresentationInfo) {
    return {
        value: info.fileId,
        attributes: {
            fileName: info.fileName,
            fileType: info.fileType,
            page: String(info.page),
            rh: String(info.region.h),
            rw: String(info.region.w),
            rx: String(info.region.x),
            ry: String(info.region.y),
            scrollX: String(info.scrollX),
            scrollY: String(info.scrollY),
            startedAt: String(info.startedAt),
            state: 'on',
            zoom: String(info.zoom)
        } as Record<string, string>
    };
}

/**
 * Parses a received presence command. Returns undefined for a stop command or invalid data.
 *
 * @param {string} value - The command value (the file id).
 * @param {Record<string, string>} attributes - The command attributes.
 * @param {string} from - The id of the sending participant.
 * @returns {IPresentationInfo|undefined}
 */
export function parseStateAttributes(
        value: string, attributes: Record<string, string>, from: string): IPresentationInfo | undefined {
    const fileType = attributes?.fileType;
    const startedAt = Number(attributes?.startedAt);

    if (attributes?.state === 'stop'
            || typeof value !== 'string' || !UUID_REGEX.test(value)
            || !isPresentableType(fileType)
            || !Number.isFinite(startedAt)
            || !isId(from)) {
        return undefined;
    }

    return {
        ...clampView({
            page: Number(attributes.page),
            scrollX: Number(attributes.scrollX),
            scrollY: Number(attributes.scrollY),
            zoom: Number(attributes.zoom)
        }),
        fileId: value,
        fileName: String(attributes.fileName ?? '').slice(0, 255),
        fileType,
        presenterId: from,
        region: clampRegion({
            h: Number(attributes.rh),
            w: Number(attributes.rw),
            x: Number(attributes.rx),
            y: Number(attributes.ry)
        }),
        startedAt
    };
}

/**
 * Validates a stroke received from a remote participant.
 *
 * @param {any} s - The candidate stroke.
 * @returns {IStroke|undefined}
 */
function parseStroke(s: any): IStroke | undefined {
    if (!s || !isId(s.id) || !INK_TOOLS.includes(s.tool) || !ALLOWED_COLORS.includes(s.color)
            || !Array.isArray(s.points) || s.points.length === 0 || s.points.length % 2 !== 0
            || s.points.length > MAX_STROKE_POINTS || !s.points.every(isUnit)) {
        return undefined;
    }

    return {
        color: s.color,
        id: s.id,
        points: s.points,
        tool: s.tool
    };
}

/**
 * Parses and validates a received endpoint message.
 *
 * @param {unknown} data - The message payload.
 * @returns {PresentationMessage|undefined}
 */
export function parseEndpointMessage(data: unknown): PresentationMessage | undefined {
    const d = data as any;

    if (!d || typeof d !== 'object' || d.name !== PRESENTATION_NAME) {
        return undefined;
    }

    if (d.kind === 'sync-request') {
        return { kind: 'sync-request' };
    }

    if (!isPage(d.page)) {
        return undefined;
    }

    switch (d.kind) {
    case 'pointer':
        if (d.x === -1 && d.y === -1) {
            return { kind: 'pointer', page: d.page, x: -1, y: -1 };
        }

        return isUnit(d.x) && isUnit(d.y) ? { kind: 'pointer', page: d.page, x: d.x, y: d.y } : undefined;
    case 'stroke': {
        const stroke = parseStroke(d.stroke);

        return stroke && { kind: 'stroke', page: d.page, stroke };
    }
    case 'erase':
        return isId(d.id) ? { id: d.id, kind: 'erase', page: d.page } : undefined;
    case 'strokes': {
        if (!Array.isArray(d.strokes) || d.strokes.length > MAX_STROKES) {
            return undefined;
        }
        const strokes = d.strokes.map(parseStroke);

        if (!strokes.every(Boolean)) {
            return undefined;
        }

        return d.append === true
            ? { append: true, kind: 'strokes', page: d.page, strokes }
            : { kind: 'strokes', page: d.page, strokes };
    }
    }

    return undefined;
}

/**
 * Decides whether incoming presentation state replaces the current one. The same presenter always
 * wins; a different presenter wins only with a newer start, which makes takeovers converge.
 *
 * @param {Object} current - The current presentation, if any.
 * @param {Object} incoming - The incoming presentation.
 * @returns {boolean}
 */
export function shouldAcceptState(
        current: { presenterId: string; startedAt: number; } | undefined,
        incoming: { presenterId: string; startedAt: number; }): boolean {
    return !current
        || current.presenterId === incoming.presenterId
        || incoming.startedAt > current.startedAt
        || (incoming.startedAt === current.startedAt && incoming.presenterId > current.presenterId);
}

/**
 * Splits strokes into groups of at most maxPoints coordinates each, keeping their order, so a full page of
 * ink can be sent in messages of bounded size. A stroke larger than maxPoints gets a group of its own. There
 * is always at least one group, so an empty page is still sent.
 *
 * @param {IStroke[]} strokes - The strokes.
 * @param {number} maxPoints - The maximum number of coordinates per group.
 * @returns {Array<Array<IStroke>>}
 */
export function chunkStrokes(strokes: IStroke[], maxPoints: number): IStroke[][] {
    const chunks: IStroke[][] = [ [] ];
    let count = 0;

    for (const stroke of strokes) {
        const current = chunks[chunks.length - 1];

        if (current.length > 0 && count + stroke.points.length > maxPoints) {
            chunks.push([ stroke ]);
            count = stroke.points.length;
        } else {
            current.push(stroke);
            count += stroke.points.length;
        }
    }

    return chunks;
}

/**
 * Returns the device pixel ratio to draw a canvas with, lowered when needed so the canvas stays below a
 * pixel budget. Browsers refuse or blank canvases that are too large.
 *
 * @param {number} devicePixelRatio - The screen's device pixel ratio.
 * @param {number} cssWidth - The CSS width.
 * @param {number} cssHeight - The CSS height.
 * @param {number} maxPixels - The pixel budget.
 * @returns {number}
 */
export function canvasRatio(devicePixelRatio: number, cssWidth: number, cssHeight: number, maxPixels: number) {
    const area = cssWidth * cssHeight;

    return area > 0 ? Math.min(devicePixelRatio, Math.sqrt(maxPixels / area)) : devicePixelRatio;
}

/**
 * Normalises a region so it is a valid rectangle within the page. Invalid input gives the whole page.
 *
 * @param {Partial<IRegion>} region - The region.
 * @returns {IRegion}
 */
export function clampRegion(region?: Partial<IRegion>): IRegion {
    const valid = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

    if (!region || ![ region.w, region.h ].every(valid)) {
        return { x: 0, y: 0, w: 1, h: 1 };
    }

    const w = Math.min(1, Math.max(0.01, region.w!));
    const h = Math.min(1, Math.max(0.01, region.h!));

    return {
        x: Math.min(1 - w, Math.max(0, valid(region.x) ? region.x! : 0)),
        y: Math.min(1 - h, Math.max(0, valid(region.y) ? region.y! : 0)),
        w,
        h
    };
}

/**
 * Computes the part of a page box that lies inside a viewport, in page units.
 *
 * @param {Object} viewport - The viewport rectangle in client coordinates.
 * @param {Object} page - The page rectangle in client coordinates.
 * @returns {IRegion}
 */
export function visibleRegion(
        viewport: { height: number; left: number; top: number; width: number; },
        page: { height: number; left: number; top: number; width: number; }): IRegion {
    const left = Math.max(viewport.left, page.left);
    const top = Math.max(viewport.top, page.top);
    const right = Math.min(viewport.left + viewport.width, page.left + page.width);
    const bottom = Math.min(viewport.top + viewport.height, page.top + page.height);

    return clampRegion({
        x: (left - page.left) / page.width,
        y: (top - page.top) / page.height,
        w: (right - left) / page.width,
        h: (bottom - top) / page.height
    });
}

/**
 * Computes how a viewer lays out the page so that the presenter's whole region is visible and centred.
 * The page is horizontally centred when narrower than the viewport and has a top margin of padding.
 *
 * @param {number} availableWidth - The viewer's viewport width.
 * @param {number} availableHeight - The viewer's viewport height.
 * @param {number} aspect - The page height divided by its width.
 * @param {IRegion} region - The presenter's visible region.
 * @param {number} padding - The margin around the page.
 * @returns {{ pageWidth: number, scrollLeft: number, scrollTop: number }}
 */
export function viewerLayout(availableWidth: number, availableHeight: number, aspect: number, region: IRegion,
        padding: number) {
    const pageWidth = Math.max(0, Math.min(
        (availableWidth - (2 * padding)) / region.w,
        (availableHeight - (2 * padding)) / (aspect * region.h)));
    const marginLeft = Math.max(0, (availableWidth - pageWidth) / 2);

    return {
        pageWidth,
        scrollLeft: Math.max(0, marginLeft + ((region.x + (region.w / 2)) * pageWidth) - (availableWidth / 2)),
        scrollTop: Math.max(0, padding + ((region.y + (region.h / 2)) * pageWidth * aspect) - (availableHeight / 2))
    };
}

/**
 * Converts client coordinates into page units (0-1) relative to the page box.
 *
 * @param {number} clientX - The client X coordinate.
 * @param {number} clientY - The client Y coordinate.
 * @param {Object} box - The page box in client coordinates.
 * @returns {{ x: number, y: number }}
 */
export function toPage(clientX: number, clientY: number,
        box: { height: number; left: number; top: number; width: number; }) {
    return {
        x: (clientX - box.left) / box.width,
        y: (clientY - box.top) / box.height
    };
}

/**
 * Converts page units into pixel coordinates within a page box.
 *
 * @param {number} x - The X coordinate in page units.
 * @param {number} y - The Y coordinate in page units.
 * @param {Object} box - The page box size.
 * @returns {{ x: number, y: number }}
 */
export function fromPage(x: number, y: number, box: { height: number; width: number; }) {
    return {
        x: x * box.width,
        y: y * box.height
    };
}

/**
 * Checks whether a point in page units lies within a radius of a stroke.
 *
 * @param {IStroke} stroke - The stroke.
 * @param {number} x - The X coordinate in page units.
 * @param {number} y - The Y coordinate in page units.
 * @param {number} radius - The hit radius in page units.
 * @returns {boolean}
 */
export function hitStroke(stroke: IStroke, x: number, y: number, radius: number): boolean {
    const p = stroke.points;

    if (p.length === 2) {
        return Math.hypot(p[0] - x, p[1] - y) <= radius;
    }

    for (let i = 0; i + 3 < p.length; i += 2) {
        const [ ax, ay, bx, by ] = [ p[i], p[i + 1], p[i + 2], p[i + 3] ];
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = (dx * dx) + (dy * dy);
        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (((x - ax) * dx) + ((y - ay) * dy)) / lenSq));

        if (Math.hypot(ax + (t * dx) - x, ay + (t * dy) - y) <= radius) {
            return true;
        }
    }

    return false;
}
