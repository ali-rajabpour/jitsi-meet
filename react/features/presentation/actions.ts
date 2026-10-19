import {
    CLEAR_PRESENTATION,
    REMOVE_PRESENTATION_STROKE,
    SET_PRESENTATION,
    SET_PRESENTATION_PAGE_COUNT,
    SET_PRESENTATION_POINTER,
    SET_PRESENTATION_STROKES,
    SET_PRESENTATION_TOOL,
    SET_PRESENTATION_VIEW,
    START_PRESENTATION,
    STOP_PRESENTATION,
    UPSERT_PRESENTATION_STROKE
} from './actionTypes';
import { IPresentationInfo, IPresentationView, IStroke, PresentationTool } from './protocol';

/**
 * Starts presenting a shared file.
 *
 * @param {string} fileId - The id of the shared file.
 * @returns {Object}
 */
export function startPresentation(fileId: string) {
    return {
        type: START_PRESENTATION,
        fileId
    };
}

/**
 * Stops the local presentation for everyone.
 *
 * @returns {Object}
 */
export function stopPresentation() {
    return {
        type: STOP_PRESENTATION
    };
}

/**
 * Sets the active presentation.
 *
 * @param {IPresentationInfo} info - The presentation info.
 * @returns {Object}
 */
export function setPresentation(info: IPresentationInfo) {
    return {
        type: SET_PRESENTATION,
        info
    };
}

/**
 * Ends the active presentation locally.
 *
 * @returns {Object}
 */
export function clearPresentation() {
    return {
        type: CLEAR_PRESENTATION
    };
}

/**
 * Updates the presenter's view.
 *
 * @param {Partial<IPresentationView>} view - The changed view fields.
 * @returns {Object}
 */
export function setPresentationView(view: Partial<IPresentationView>) {
    return {
        type: SET_PRESENTATION_VIEW,
        view
    };
}

/**
 * Stores the page count of the loaded document.
 *
 * @param {number} pageCount - The number of pages.
 * @returns {Object}
 */
export function setPresentationPageCount(pageCount: number) {
    return {
        type: SET_PRESENTATION_PAGE_COUNT,
        pageCount
    };
}

/**
 * Replaces all strokes of the current page.
 *
 * @param {IStroke[]} strokes - The strokes.
 * @param {boolean} fromRemote - Whether the strokes came from the presenter over signalling.
 * @returns {Object}
 */
export function setPresentationStrokes(strokes: IStroke[], fromRemote = false) {
    return {
        type: SET_PRESENTATION_STROKES,
        fromRemote,
        strokes
    };
}

/**
 * Adds a stroke, or replaces the stroke with the same id.
 *
 * @param {IStroke} stroke - The stroke.
 * @param {boolean} fromRemote - Whether the stroke came from the presenter over signalling.
 * @returns {Object}
 */
export function upsertPresentationStroke(stroke: IStroke, fromRemote = false) {
    return {
        type: UPSERT_PRESENTATION_STROKE,
        fromRemote,
        stroke
    };
}

/**
 * Removes a stroke.
 *
 * @param {string} id - The stroke id.
 * @param {boolean} fromRemote - Whether the removal came from the presenter over signalling.
 * @returns {Object}
 */
export function removePresentationStroke(id: string, fromRemote = false) {
    return {
        type: REMOVE_PRESENTATION_STROKE,
        fromRemote,
        id
    };
}

/**
 * Sets or hides the presenter's pointer.
 *
 * @param {Object} pointer - The pointer position in page units, or undefined to hide it.
 * @param {boolean} fromRemote - Whether the pointer came from the presenter over signalling.
 * @returns {Object}
 */
export function setPresentationPointer(pointer?: { x: number; y: number; }, fromRemote = false) {
    return {
        type: SET_PRESENTATION_POINTER,
        fromRemote,
        pointer
    };
}

/**
 * Selects the presenter's tool.
 *
 * @param {PresentationTool} tool - The tool.
 * @returns {Object}
 */
export function setPresentationTool(tool: PresentationTool) {
    return {
        type: SET_PRESENTATION_TOOL,
        tool
    };
}

/**
 * Selects the presenter's ink colour.
 *
 * @param {string} color - One of the allowed colours.
 * @returns {Object}
 */
export function setPresentationColor(color: string) {
    return {
        type: SET_PRESENTATION_TOOL,
        color
    };
}
