import React, { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';
import { v4 as uuidv4 } from 'uuid';

import { IReduxState } from '../../../app/types';
import {
    removePresentationStroke,
    setPresentationPointer,
    upsertPresentationStroke
} from '../../actions';
import { POINTER_IDLE_TIMEOUT } from '../../constants';
import { isLocalPresenter } from '../../functions';
import { MAX_CANVAS_PIXELS } from '../../pdf';
import { IStroke, MAX_STROKE_POINTS, canvasRatio, hitStroke, toPage } from '../../protocol';

/**
 * Stroke widths as fractions of the page width, so ink looks the same at every viewer size.
 */
const PEN_WIDTH = 0.004;
const HIGHLIGHTER_WIDTH = 0.025;
const HIGHLIGHTER_ALPHA = 0.35;

/**
 * Points closer than this to the previous one (in page units) are skipped.
 */
const MIN_POINT_DISTANCE = 0.002;

/**
 * Eraser hit radius in page units.
 */
const ERASER_RADIUS = 0.01;

const POINTER_RADIUS = 6;
const POINTER_COLOR = '#E54B4B';

// Ink tools must not scroll the page on touch screens; the pointer tool may.
const useStyles = makeStyles()(() => {
    return {
        canvas: {
            left: 0,
            position: 'absolute',
            top: 0
        },
        viewer: {
            pointerEvents: 'none'
        },
        pointer: {
            cursor: 'default'
        },
        pen: {
            cursor: 'crosshair',
            touchAction: 'none'
        },
        highlighter: {
            cursor: 'crosshair',
            touchAction: 'none'
        },
        eraser: {
            cursor: 'cell',
            touchAction: 'none'
        }
    };
});

interface IProps {

    /**
     * The CSS height of the page.
     */
    height: number;

    /**
     * The CSS width of the page.
     */
    width: number;
}

/**
 * Converts a pointer event into page units, clamped to the page.
 *
 * @param {React.PointerEvent} event - The event.
 * @returns {{ x: number, y: number }}
 */
function eventToPage(event: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = toPage(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    const clampRound = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;

    return { x: clampRound(x), y: clampRound(y) };
}

/**
 * Draws the presenter's ink and pointer over the page, and takes the presenter's drawing input.
 *
 * @param {IProps} props - The component props.
 * @returns {JSX.Element}
 */
const InkLayer = ({ height, width }: IProps) => {
    const { classes, cx } = useStyles();
    const dispatch = useDispatch();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef<IStroke>();
    const erasingRef = useRef(false);
    const idleTimerRef = useRef<number>();
    const isPresenter = useSelector(isLocalPresenter);
    const { color, pointer, strokes, tool } = useSelector((state: IReduxState) => state['features/presentation']);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');

        if (!canvas || !context) {
            return;
        }

        const ratio = canvasRatio(window.devicePixelRatio || 1, width, height, MAX_CANVAS_PIXELS);

        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.lineCap = 'round';
        context.lineJoin = 'round';

        for (const stroke of strokes) {
            const p = stroke.points;
            const isHighlighter = stroke.tool === 'highlighter';

            context.globalAlpha = isHighlighter ? HIGHLIGHTER_ALPHA : 1;
            context.strokeStyle = stroke.color;
            context.lineWidth = (isHighlighter ? HIGHLIGHTER_WIDTH : PEN_WIDTH) * width;
            context.beginPath();
            context.moveTo(p[0] * width, p[1] * height);

            // A single point is drawn as a dot.
            context.lineTo(p.length > 2 ? p[2] * width : (p[0] * width) + 0.01, p.length > 2 ? p[3] * height : p[1] * height);
            for (let i = 4; i + 1 < p.length; i += 2) {
                context.lineTo(p[i] * width, p[i + 1] * height);
            }
            context.stroke();
        }

        if (pointer) {
            context.globalAlpha = 1;
            context.fillStyle = POINTER_COLOR;
            context.shadowColor = POINTER_COLOR;
            context.shadowBlur = 12;
            context.beginPath();
            context.arc(pointer.x * width, pointer.y * height, POINTER_RADIUS, 0, 2 * Math.PI);
            context.fill();
            context.shadowBlur = 0;
        }
    }, [ strokes, pointer, width, height ]);

    useEffect(() => () => window.clearTimeout(idleTimerRef.current), []);

    const movePointer = useCallback((point?: { x: number; y: number; }) => {
        window.clearTimeout(idleTimerRef.current);
        dispatch(setPresentationPointer(point));
        if (point) {
            idleTimerRef.current = window.setTimeout(() => dispatch(setPresentationPointer()), POINTER_IDLE_TIMEOUT);
        }
    }, []);

    const erase = useCallback((point: { x: number; y: number; }) => {
        const hit = strokes.find(s => hitStroke(s, point.x, point.y, ERASER_RADIUS));

        hit && dispatch(removePresentationStroke(hit.id));
    }, [ strokes ]);

    const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
        const point = eventToPage(event);

        event.currentTarget.setPointerCapture(event.pointerId);

        if (tool === 'pen' || tool === 'highlighter') {
            drawingRef.current = { color, id: uuidv4(), points: [ point.x, point.y ], tool };
            dispatch(upsertPresentationStroke(drawingRef.current));
        } else if (tool === 'eraser') {
            erasingRef.current = true;
            erase(point);
        } else {
            movePointer(point);
        }
    }, [ tool, color, erase ]);

    const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
        const point = eventToPage(event);
        const stroke = drawingRef.current;

        if (stroke) {
            const p = stroke.points;

            if (p.length < MAX_STROKE_POINTS
                    && Math.hypot(point.x - p[p.length - 2], point.y - p[p.length - 1]) >= MIN_POINT_DISTANCE) {
                drawingRef.current = { ...stroke, points: [ ...p, point.x, point.y ] };
                dispatch(upsertPresentationStroke(drawingRef.current));
            }
        } else if (erasingRef.current) {
            erase(point);
        } else if (tool === 'pointer') {
            movePointer(point);
        }
    }, [ tool, erase ]);

    const onPointerUp = useCallback(() => {
        drawingRef.current = undefined;
        erasingRef.current = false;
    }, []);

    const onPointerLeave = useCallback(() => {
        if (tool === 'pointer') {
            movePointer();
        }
    }, [ tool ]);

    return (
        <canvas
            className = { cx(classes.canvas, isPresenter ? classes[tool] : classes.viewer) }
            onPointerCancel = { isPresenter ? onPointerUp : undefined }
            onPointerDown = { isPresenter ? onPointerDown : undefined }
            onPointerLeave = { isPresenter ? onPointerLeave : undefined }
            onPointerMove = { isPresenter ? onPointerMove : undefined }
            onPointerUp = { isPresenter ? onPointerUp : undefined }
            ref = { canvasRef }
            style = {{ height, width }} />
    );
};

export default InkLayer;
