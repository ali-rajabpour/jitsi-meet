import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useDispatch, useSelector, useStore } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

// @ts-expect-error
import Filmstrip from '../../../../../modules/UI/videolayout/Filmstrip';
import { IReduxState } from '../../../app/types';
import { getParticipantDisplayName } from '../../../base/participants/functions';
import { fetchPresignedUrl } from '../../../file-sharing/utils';
import { getVerticalViewMaxWidth } from '../../../filmstrip/functions.web';
import { showErrorNotification } from '../../../notifications/actions';
import { getToolboxHeight } from '../../../toolbox/functions.web';
import { shouldDisplayTileView } from '../../../video-layout/functions.any';
import { setPresentationPageCount, setPresentationView, stopPresentation } from '../../actions';
import { getPresentation, isLocalPresenter } from '../../functions';
import logger from '../../logger';
import { IPresentationDocument, loadDocument } from '../../pdf';
import { viewerLayout, visibleRegion } from '../../protocol';

import InkLayer from './InkLayer';
import PresenterToolbar from './PresenterToolbar';

/**
 * Duration of the enter, exit and resize animations, in milliseconds.
 */
const TRANSITION_MS = 300;

/**
 * Padding around the page at 100% zoom, where the whole page fits the stage.
 */
const PAGE_PADDING = 16;

/**
 * Scroll differences below this fraction are not applied, which keeps the presenter's own scrolling
 * from fighting with the echo of the state it just published.
 */
const SCROLL_EPSILON = 0.01;

const useStyles = makeStyles()(theme => {
    return {
        // Covers the whole stage, including the camera video behind the filmstrip, so nothing shows
        // around the document.
        container: {
            backgroundColor: theme.palette.uiBackground,
            bottom: 0,
            left: 0,
            outline: 'none',
            position: 'absolute',
            right: 0,
            top: 0,
            opacity: 0,
            pointerEvents: 'none',
            transform: 'scale(0.98)',
            transition: `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms ease`,
            zIndex: 1
        },

        // The area next to the filmstrip: a header row, then the document.
        stage: {
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing(2),
            left: 0,
            padding: theme.spacing(3, 3, 2),
            position: 'absolute',
            top: 0,
            transition: `width ${TRANSITION_MS}ms ease, height ${TRANSITION_MS}ms ease`
        },
        header: {
            display: 'flex',
            flexShrink: 0,
            justifyContent: 'center',
            minHeight: 48
        },
        shown: {
            opacity: 1,
            pointerEvents: 'auto',
            transform: 'none'
        },
        hidden: {
            display: 'none'
        },
        scroller: {
            flex: 1,
            minHeight: 0,
            overflow: 'auto'
        },
        locked: {
            overflow: 'hidden',
            pointerEvents: 'none'
        },
        page: {
            margin: `${PAGE_PADDING}px auto`,
            position: 'relative',

            '& canvas': {
                display: 'block'
            }
        },
        label: {
            ...theme.typography.labelBold,
            alignSelf: 'center',
            backgroundColor: theme.palette.ui02,
            borderRadius: theme.shape.borderRadius,
            color: theme.palette.text01,
            padding: theme.spacing(1, 2)
        }
    };
});

/**
 * Returns the size of the stage next to the filmstrip, computed the same way as for the whiteboard, so the
 * document takes the main area and the participants stay visible beside or below it.
 *
 * @param {IReduxState} state - The redux state.
 * @returns {{ height: number, width: number }}
 */
function getStageSize(state: IReduxState) {
    const { clientHeight, videoSpaceWidth } = state['features/base/responsive-ui'];
    const { visible } = state['features/filmstrip'];

    if (interfaceConfig.VERTICAL_FILMSTRIP) {
        return {
            height: clientHeight - getToolboxHeight(),
            width: visible ? videoSpaceWidth - getVerticalViewMaxWidth(state) : videoSpaceWidth
        };
    }

    return {
        height: visible ? clientHeight - Filmstrip.getFilmstripHeight() : clientHeight,
        width: videoSpaceWidth
    };
}

/**
 * Returns the scroll position of an element as fractions of its scrollable range.
 *
 * @param {HTMLElement} el - The element.
 * @returns {{ scrollX: number, scrollY: number }}
 */
function getScrollFractions(el: HTMLElement) {
    const maxX = el.scrollWidth - el.clientWidth;
    const maxY = el.scrollHeight - el.clientHeight;

    return {
        scrollX: maxX > 0 ? el.scrollLeft / maxX : 0,
        scrollY: maxY > 0 ? el.scrollTop / maxY : 0
    };
}

/**
 * Shows the presented document in the stage. Everyone sees the presenter's page, zoom and scroll.
 *
 * @returns {JSX.Element|null}
 */
const Presentation = () => {
    const { classes, cx } = useStyles();
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const store = useStore<IReduxState>();
    const info = useSelector(getPresentation);

    // Stay on screen while fading out after the presentation ends, showing what was presented last.
    const lastInfoRef = useRef(info);
    const isActive = Boolean(info);
    const [ isRendered, setRendered ] = useState(isActive);
    const [ isShown, setShown ] = useState(false);

    if (info) {
        lastInfoRef.current = info;
    }
    const isPresenter = useSelector(isLocalPresenter);
    const isInTileView = useSelector(shouldDisplayTileView);
    const stageSize = useSelector(getStageSize, shallowEqual);
    const presenterName = useSelector((state: IReduxState) =>
        info ? getParticipantDisplayName(state, info.presenterId) : '');
    const scrollerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [ doc, setDoc ] = useState<IPresentationDocument>();
    const pageRef = useRef<HTMLDivElement>(null);
    const [ available, setAvailable ] = useState({ height: 0, width: 0 });
    const [ pageAspect, setPageAspect ] = useState(0);
    const [ loadFailed, setLoadFailed ] = useState(false);
    const fileId = info?.fileId;
    const fileType = info?.fileType;

    // Known once the conference is joined. A late joiner receives the presentation while still joining.
    const meetingId: string | undefined = useSelector((state: IReduxState) =>
        state['features/base/conference'].conference?.getMeetingUniqueId?.());
    const page = info?.page ?? 1;
    const zoom = info?.zoom ?? 1;
    const viewerScroll = !isPresenter && info && pageAspect > 0
        ? viewerLayout(available.width, available.height, pageAspect, info.region, PAGE_PADDING)
        : undefined;

    // The presenter zooms relative to fit-to-width. Viewers size the page so that the presenter's whole
    // visible region fits their screen, whatever its size and shape.
    const fitPageWidth = Math.max(0, pageAspect > 0
        ? Math.min(available.width - (2 * PAGE_PADDING), (available.height - (2 * PAGE_PADDING)) / pageAspect)
        : available.width - (2 * PAGE_PADDING));
    const pageWidth = viewerScroll?.pageWidth ?? fitPageWidth * zoom;
    const pageHeight = pageWidth * pageAspect;

    // Load the document whenever the presented file changes. The bytes stay in memory and are never saved.
    useEffect(() => {
        if (!fileId || !fileType || !meetingId) {
            return;
        }

        let cancelled = false;
        let loaded: IPresentationDocument | undefined;

        setDoc(undefined);
        setPageAspect(0);
        setLoadFailed(false);

        fetchPresignedUrl(store.getState(), fileId)
            .then(({ presignedUrl }) => fetch(presignedUrl))
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch the presented file: ${response.statusText}`);
                }

                return response.arrayBuffer();
            })
            .then(bytes => loadDocument(bytes, fileType))
            .then(document => {
                loaded = document;
                if (cancelled) {
                    document.destroy();

                    return;
                }
                setDoc(document);
                dispatch(setPresentationPageCount(document.pageCount));
            })
            .catch(error => {
                if (cancelled) {
                    return;
                }
                logger.warn('Could not load the presented file', error);
                dispatch(showErrorNotification({ titleKey: 'presentation.loadFailed' }));
                if (isLocalPresenter(store.getState())) {
                    dispatch(stopPresentation());
                } else {
                    // Give this viewer the normal stage back; a new presentation tries again.
                    setLoadFailed(true);
                }
            });

        return () => {
            cancelled = true;
            loaded?.destroy();
        };
    }, [ fileId, fileType, meetingId ]);

    // Track the space available for the page.
    useEffect(() => {
        const el = scrollerRef.current;

        if (!el) {
            return;
        }

        const observer = new ResizeObserver(() => setAvailable({ height: el.clientHeight, width: el.clientWidth }));

        observer.observe(el);

        return () => observer.disconnect();
    }, [ isRendered ]);

    useEffect(() => {
        let cancelled = false;

        doc?.getPageSize(page).then(size => !cancelled && setPageAspect(size.height / size.width))
            .catch(error => logger.warn('Could not read page size', error));

        return () => {
            cancelled = true;
        };
    }, [ doc, page ]);

    useEffect(() => {
        if (doc && canvasRef.current && pageWidth > 0 && page <= doc.pageCount) {
            doc.renderPage(page, canvasRef.current, pageWidth)
                .catch(error => logger.warn('Could not render page', error));
        }
    }, [ doc, page, pageWidth ]);

    // Viewers scroll to centre the presenter's region.
    useEffect(() => {
        const el = scrollerRef.current;

        if (el && viewerScroll) {
            el.scrollLeft = viewerScroll.scrollLeft;
            el.scrollTop = viewerScroll.scrollTop;
        }
    }, [ viewerScroll?.scrollLeft, viewerScroll?.scrollTop, pageWidth ]);

    // The presenter's own scroll is reset on page changes; the echo of its own scrolling is ignored by the epsilon.
    useEffect(() => {
        const el = scrollerRef.current;

        if (!el || !info || !isPresenter) {
            return;
        }

        const current = getScrollFractions(el);
        const maxX = el.scrollWidth - el.clientWidth;
        const maxY = el.scrollHeight - el.clientHeight;

        if (Math.abs(current.scrollX - info.scrollX) > SCROLL_EPSILON) {
            el.scrollLeft = info.scrollX * maxX;
        }
        if (Math.abs(current.scrollY - info.scrollY) > SCROLL_EPSILON) {
            el.scrollTop = info.scrollY * maxY;
        }
    }, [ info?.scrollX, info?.scrollY, pageWidth, pageHeight ]);

    const publishView = useCallback(() => {
        const scroller = scrollerRef.current;
        const pageEl = pageRef.current;

        if (isPresenter && scroller && pageEl && pageEl.clientWidth > 0 && pageEl.clientHeight > 0) {
            dispatch(setPresentationView({
                ...getScrollFractions(scroller),
                region: visibleRegion(scroller.getBoundingClientRect(), pageEl.getBoundingClientRect())
            }));
        }
    }, [ isPresenter ]);

    // The visible region also changes when the page or the stage is resized.
    useEffect(publishView, [ publishView, pageWidth, pageHeight, available.height ]);

    const onKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (!isPresenter || !doc) {
            return;
        }

        const next = event.key === 'ArrowRight' ? page + 1 : event.key === 'ArrowLeft' ? page - 1 : page;

        if (next !== page && next >= 1 && next <= doc.pageCount) {
            event.preventDefault();
            dispatch(setPresentationView({ page: next, scrollX: 0, scrollY: 0 }));
        }
    }, [ isPresenter, doc, page ]);

    useEffect(() => {
        if (isActive) {
            setRendered(true);

            const frame = window.requestAnimationFrame(() => setShown(true));

            return () => window.cancelAnimationFrame(frame);
        }

        setShown(false);

        const timer = window.setTimeout(() => setRendered(false), TRANSITION_MS);

        return () => window.clearTimeout(timer);
    }, [ isActive ]);

    const shownInfo = info ?? lastInfoRef.current;

    if (!isRendered || !shownInfo) {
        return null;
    }

    return (
        <div
            aria-label = { t('presentation.presentedBy', { name: presenterName, fileName: shownInfo.fileName }) }
            className = { cx(classes.container, isShown && classes.shown, (isInTileView || loadFailed) && classes.hidden) }
            onKeyDown = { onKeyDown }
            role = 'region'
            tabIndex = { isPresenter ? 0 : -1 }>
            <div
                className = { classes.stage }
                style = { stageSize }>
                <div className = { classes.header }>
                    {
                        isPresenter
                            ? <PresenterToolbar />
                            : (
                                <div className = { classes.label }>
                                    { t('presentation.presentedBy', {
                                        name: presenterName,
                                        fileName: shownInfo.fileName
                                    }) }
                                </div>
                            )
                    }
                </div>
                <div
                    className = { cx(classes.scroller, !isPresenter && classes.locked) }
                    onScroll = { publishView }
                    ref = { scrollerRef }>
                    <div
                        className = { classes.page }
                        ref = { pageRef }
                        style = {{ height: pageHeight, width: pageWidth }}>
                        <canvas ref = { canvasRef } />
                        {
                            pageHeight > 0 && (
                                <InkLayer
                                    height = { pageHeight }
                                    width = { pageWidth } />
                            )
                        }
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Presentation;
