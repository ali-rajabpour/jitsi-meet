import ReducerRegistry from '../base/redux/ReducerRegistry';

import {
    CLEAR_PRESENTATION,
    REMOVE_PRESENTATION_STROKE,
    SET_PRESENTATION,
    SET_PRESENTATION_PAGE_COUNT,
    SET_PRESENTATION_POINTER,
    SET_PRESENTATION_STROKES,
    SET_PRESENTATION_TOOL,
    SET_PRESENTATION_VIEW,
    UPSERT_PRESENTATION_STROKE
} from './actionTypes';
import {
    ALLOWED_COLORS,
    IPresentationInfo,
    IStroke,
    PresentationTool,
    clampRegion,
    clampView
} from './protocol';

export interface IPresentationState {

    /**
     * The presenter's selected ink colour.
     */
    color: string;

    /**
     * The active presentation, undefined when nothing is presented.
     */
    info?: IPresentationInfo;

    /**
     * The page count of the loaded document.
     */
    pageCount?: number;

    /**
     * The presenter's pointer in page units, undefined when hidden.
     */
    pointer?: { x: number; y: number; };

    /**
     * The strokes on the current page.
     */
    strokes: IStroke[];

    /**
     * The presenter's selected tool.
     */
    tool: PresentationTool;
}

const DEFAULT_STATE: IPresentationState = {
    color: ALLOWED_COLORS[0],
    strokes: [],
    tool: 'pointer'
};

/**
 * Applies new presentation info, dropping ink and pointer when the file or page changes.
 *
 * @param {IPresentationState} state - The current state.
 * @param {IPresentationInfo} info - The new info.
 * @returns {IPresentationState}
 */
function withInfo(state: IPresentationState, info: IPresentationInfo): IPresentationState {
    const fileChanged = state.info?.fileId !== info.fileId;

    // A new presenter starts with a clean page: the previous presenter's ink and pointer are not theirs.
    if (fileChanged || state.info?.page !== info.page || state.info?.presenterId !== info.presenterId) {
        return {
            ...state,
            info,
            pageCount: fileChanged ? undefined : state.pageCount,
            pointer: undefined,
            strokes: []
        };
    }

    return {
        ...state,
        info
    };
}

ReducerRegistry.register<IPresentationState>('features/presentation',
(state = DEFAULT_STATE, action): IPresentationState => {
    switch (action.type) {
    case SET_PRESENTATION:
        return withInfo(state, action.info);

    case SET_PRESENTATION_VIEW:
        return state.info
            ? withInfo(state, {
                ...state.info,
                ...clampView({ ...state.info, ...action.view }, state.pageCount),
                region: action.view.region ? clampRegion(action.view.region) : state.info.region
            })
            : state;

    case CLEAR_PRESENTATION:
        return {
            ...DEFAULT_STATE,
            color: state.color,
            tool: state.tool
        };

    case SET_PRESENTATION_PAGE_COUNT:
        return {
            ...state,
            pageCount: action.pageCount
        };

    case SET_PRESENTATION_STROKES:
        return {
            ...state,
            strokes: action.strokes
        };

    case UPSERT_PRESENTATION_STROKE: {
        const index = state.strokes.findIndex(s => s.id === action.stroke.id);
        const strokes = [ ...state.strokes ];

        if (index === -1) {
            strokes.push(action.stroke);
        } else {
            strokes[index] = action.stroke;
        }

        return {
            ...state,
            strokes
        };
    }

    case REMOVE_PRESENTATION_STROKE:
        return {
            ...state,
            strokes: state.strokes.filter(s => s.id !== action.id)
        };

    case SET_PRESENTATION_POINTER:
        return {
            ...state,
            pointer: action.pointer
        };

    case SET_PRESENTATION_TOOL:
        return {
            ...state,
            color: action.color ?? state.color,
            tool: action.tool ?? state.tool
        };

    default:
        return state;
    }
});
