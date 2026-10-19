/**
 * The type of redux action which asks to present a shared file. Handled by the middleware.
 *
 * {
 *     type: START_PRESENTATION,
 *     fileId: string
 * }
 */
export const START_PRESENTATION = 'START_PRESENTATION';

/**
 * The type of redux action which asks to stop the local presentation. Handled by the middleware.
 *
 * {
 *     type: STOP_PRESENTATION
 * }
 */
export const STOP_PRESENTATION = 'STOP_PRESENTATION';

/**
 * The type of redux action which sets the active presentation.
 *
 * {
 *     type: SET_PRESENTATION,
 *     info: IPresentationInfo
 * }
 */
export const SET_PRESENTATION = 'SET_PRESENTATION';

/**
 * The type of redux action which ends the active presentation locally.
 *
 * {
 *     type: CLEAR_PRESENTATION
 * }
 */
export const CLEAR_PRESENTATION = 'CLEAR_PRESENTATION';

/**
 * The type of redux action which updates the presenter's view (page, zoom, scroll).
 *
 * {
 *     type: SET_PRESENTATION_VIEW,
 *     view: Partial<IPresentationView>
 * }
 */
export const SET_PRESENTATION_VIEW = 'SET_PRESENTATION_VIEW';

/**
 * The type of redux action which stores the page count of the loaded document.
 *
 * {
 *     type: SET_PRESENTATION_PAGE_COUNT,
 *     pageCount: number
 * }
 */
export const SET_PRESENTATION_PAGE_COUNT = 'SET_PRESENTATION_PAGE_COUNT';

/**
 * The type of redux action which replaces all strokes of the current page.
 *
 * {
 *     type: SET_PRESENTATION_STROKES,
 *     strokes: Array<IStroke>,
 *     fromRemote?: boolean
 * }
 */
export const SET_PRESENTATION_STROKES = 'SET_PRESENTATION_STROKES';

/**
 * The type of redux action which adds a stroke or replaces the stroke with the same id.
 *
 * {
 *     type: UPSERT_PRESENTATION_STROKE,
 *     stroke: IStroke,
 *     fromRemote?: boolean
 * }
 */
export const UPSERT_PRESENTATION_STROKE = 'UPSERT_PRESENTATION_STROKE';

/**
 * The type of redux action which removes a stroke.
 *
 * {
 *     type: REMOVE_PRESENTATION_STROKE,
 *     id: string,
 *     fromRemote?: boolean
 * }
 */
export const REMOVE_PRESENTATION_STROKE = 'REMOVE_PRESENTATION_STROKE';

/**
 * The type of redux action which sets or hides the presenter's pointer.
 *
 * {
 *     type: SET_PRESENTATION_POINTER,
 *     pointer?: { x: number, y: number },
 *     fromRemote?: boolean
 * }
 */
export const SET_PRESENTATION_POINTER = 'SET_PRESENTATION_POINTER';

/**
 * The type of redux action which selects the presenter's tool and/or colour.
 *
 * {
 *     type: SET_PRESENTATION_TOOL,
 *     tool?: PresentationTool,
 *     color?: string
 * }
 */
export const SET_PRESENTATION_TOOL = 'SET_PRESENTATION_TOOL';
