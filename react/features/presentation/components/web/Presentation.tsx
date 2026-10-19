import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

import { IReduxState } from '../../../app/types';
import { getParticipantDisplayName } from '../../../base/participants/functions';
import { fetchPresignedUrl } from '../../../file-sharing/utils';
import { showErrorNotification } from '../../../notifications/actions';
import { shouldDisplayTileView } from '../../../video-layout/functions.any';
import { setPresentationPageCount, setPresentationView, stopPresentation } from '../../actions';
import { getPresentation, isLocalPresenter } from '../../functions';
import logger from '../../logger';
import { IPresentationDocument, loadDocument } from '../../pdf';
import { viewerLayout, visibleRegion } from '../../protocol';

import InkLayer from './InkLayer';
import PresenterToolbar from './PresenterToolbar';

/**
 * Space at the top of the stage taken by the meeting subject, as for the whiteboard.
 */
const TOP_OFFSET = 80;

/**
 * Horizontal padding around the page at fit-to-width zoom.
 */
const PAGE_PADDING = 16;

/**
 * Scroll differences below this fraction are not applied, which keeps the presenter's own scrolling
 * from fighting with the echo of the state it just published.
 */
const SCROLL_EPSILON = 0.01;

const useStyles = makeStyles()(theme => {
    return {
        container: {
            backgroundColor: theme.palette.ui01,
            bottom: 0,
            left: 0,
            outline: 'none',
            position: 'absolute',
            right: 0,
            top: TOP_OFFSET,
            zIndex: 1
        },
        hidden: {
            display: 'none'
        },
        scroller: {
            height: '100%',
            overflow: 'auto',
            width: '100%'
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
            backgroundColor: theme.palette.ui02,
            borderRadius: theme.shape.borderRadius,
            color: theme.palette.text01,
            left: theme.spacing(2),
            padding: theme.spacing(1, 2),
            pointerEvents: 'none',
            position: 'absolute',
            top: theme.spacing(2),
            zIndex: 2
        }
    };
});

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
    const isPresenter = useSelector(isLocalPresenter);
    const isInTileView = useSelector(shouldDisplayTileView);
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
    const page = info?.page ?? 1;
    const zoom = info?.zoom ?? 1;
    const viewerScroll = !isPresenter && info && pageAspect > 0
        ? viewerLayout(available.width, available.height, pageAspect, info.region, PAGE_PADDING)
        : undefined;

    // The presenter zooms relative to fit-to-width. Viewers size the page so that the presenter's whole
    // visible region fits their screen, whatever its size and shape.
    const pageWidth = viewerScroll?.pageWidth ?? Math.max(0, available.width - (2 * PAGE_PADDING)) * zoom;
    const pageHeight = pageWidth * pageAspect;

    // Load the document whenever the presented file changes. The bytes stay in memory and are never saved.
    useEffect(() => {
        if (!fileId || !fileType) {
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
    }, [ fileId, fileType ]);

    // Track the space available for the page.
    useEffect(() => {
        const el = scrollerRef.current;

        if (!el) {
            return;
        }

        const observer = new ResizeObserver(() => setAvailable({ height: el.clientHeight, width: el.clientWidth }));

        observer.observe(el);

        return () => observer.disconnect();
    }, []);

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

    if (!info) {
        return null;
    }

    return (
        <div
            aria-label = { t('presentation.presentedBy', { name: presenterName, fileName: info.fileName }) }
            className = { cx(classes.container, (isInTileView || loadFailed) && classes.hidden) }
            onKeyDown = { onKeyDown }
            role = 'region'
            tabIndex = { isPresenter ? 0 : -1 }>
            { isPresenter && <PresenterToolbar /> }
            {
                !isPresenter && (
                    <div className = { classes.label }>
                        { t('presentation.presentedBy', { name: presenterName, fileName: info.fileName }) }
                    </div>
                )
            }
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
    );
};

export default Presentation;
