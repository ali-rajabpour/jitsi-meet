import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

import { IReduxState } from '../../../app/types';
import Icon from '../../../base/icons/components/Icon';
import {
    IconArrowLeft,
    IconArrowRight,
    IconEdit,
    IconEraser,
    IconHighlight,
    IconMinus,
    IconPlus,
    IconPointer
} from '../../../base/icons/svg';
import Button from '../../../base/ui/components/web/Button';
import { BUTTON_TYPES } from '../../../base/ui/constants.any';
import { setPresentationColor, setPresentationTool, setPresentationView, stopPresentation } from '../../actions';
import { COLOR_NAME_KEYS, ZOOM_STEPS } from '../../constants';
import { ALLOWED_COLORS, PresentationTool } from '../../protocol';

const TOOLS: Array<{ icon: Function; key: string; tool: PresentationTool; }> = [
    { icon: IconPointer, key: 'presentation.pointer', tool: 'pointer' },
    { icon: IconEdit, key: 'presentation.pen', tool: 'pen' },
    { icon: IconHighlight, key: 'presentation.highlighter', tool: 'highlighter' },
    { icon: IconEraser, key: 'presentation.eraser', tool: 'eraser' }
];

const useStyles = makeStyles()(theme => {
    return {
        toolbar: {
            alignItems: 'center',
            backgroundColor: theme.palette.ui02,
            borderRadius: theme.shape.borderRadius,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: theme.spacing(1),
            justifyContent: 'center',
            maxWidth: '100%',
            padding: theme.spacing(1)
        },
        group: {
            alignItems: 'center',
            display: 'flex',
            gap: theme.spacing(1)
        },
        divider: {
            alignSelf: 'stretch',
            backgroundColor: theme.palette.ui04,
            width: 1
        },
        label: {
            ...theme.typography.labelRegular,
            color: theme.palette.text01,
            minWidth: 48,
            textAlign: 'center',
            whiteSpace: 'nowrap'
        },
        iconButton: {
            alignItems: 'center',
            background: 'none',
            border: 'none',
            borderRadius: theme.shape.borderRadius,
            cursor: 'pointer',
            display: 'flex',
            height: 32,
            justifyContent: 'center',
            padding: 0,
            width: 32,

            '&:hover:not(:disabled)': {
                backgroundColor: theme.palette.ui03
            },
            '&:disabled': {
                cursor: 'default',
                opacity: 0.4
            },
            '&:focus-visible': {
                outline: `2px solid ${theme.palette.action01}`
            }
        },
        selected: {
            backgroundColor: theme.palette.ui03
        },
        swatch: {
            border: '2px solid transparent',
            borderRadius: '50%',
            cursor: 'pointer',
            height: 24,
            padding: 0,
            width: 24,

            '&:focus-visible': {
                outline: `2px solid ${theme.palette.action01}`,
                outlineOffset: 2
            }
        },
        swatchSelected: {
            borderColor: theme.palette.text01
        }
    };
});

/**
 * The presenter's controls: page, zoom, tool, colour and stop.
 *
 * @returns {JSX.Element|null}
 */
const PresenterToolbar = () => {
    const { classes, cx } = useStyles();
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const { color, info, pageCount = 1, tool } = useSelector((state: IReduxState) => state['features/presentation']);

    const page = info?.page ?? 1;
    const zoom = info?.zoom ?? 1;
    const zoomOut = [ ...ZOOM_STEPS ].reverse().find(z => z < zoom);
    const zoomIn = ZOOM_STEPS.find(z => z > zoom);
    const hasInk = tool === 'pen' || tool === 'highlighter';

    const onPrevious = useCallback(
        () => dispatch(setPresentationView({ page: page - 1, scrollX: 0, scrollY: 0 })), [ page ]);
    const onNext = useCallback(
        () => dispatch(setPresentationView({ page: page + 1, scrollX: 0, scrollY: 0 })), [ page ]);
    const onZoomOut = useCallback(() => zoomOut && dispatch(setPresentationView({ zoom: zoomOut })), [ zoomOut ]);
    const onZoomIn = useCallback(() => zoomIn && dispatch(setPresentationView({ zoom: zoomIn })), [ zoomIn ]);
    const onTool = useCallback((event: React.MouseEvent<HTMLButtonElement>) =>
        dispatch(setPresentationTool(event.currentTarget.dataset.tool as PresentationTool)), []);
    const onColor = useCallback((event: React.MouseEvent<HTMLButtonElement>) =>
        dispatch(setPresentationColor(event.currentTarget.dataset.color ?? ALLOWED_COLORS[0])), []);
    const onStop = useCallback(() => dispatch(stopPresentation()), []);

    if (!info) {
        return null;
    }

    return (
        <div
            aria-label = { t('presentation.toolbar') }
            className = { classes.toolbar }
            role = 'toolbar'>
            {
                pageCount > 1 && (
                    <div className = { classes.group }>
                        <button
                            aria-label = { t('presentation.previousPage') }
                            className = { classes.iconButton }
                            disabled = { page <= 1 }
                            onClick = { onPrevious }
                            type = 'button'>
                            <Icon
                                size = { 20 }
                                src = { IconArrowLeft } />
                        </button>
                        <span className = { classes.label }>
                            { t('presentation.pageOf', { page, count: pageCount }) }
                        </span>
                        <button
                            aria-label = { t('presentation.nextPage') }
                            className = { classes.iconButton }
                            disabled = { page >= pageCount }
                            onClick = { onNext }
                            type = 'button'>
                            <Icon
                                size = { 20 }
                                src = { IconArrowRight } />
                        </button>
                        <div className = { classes.divider } />
                    </div>
                )
            }
            <div className = { classes.group }>
                <button
                    aria-label = { t('presentation.zoomOut') }
                    className = { classes.iconButton }
                    disabled = { zoomOut === undefined }
                    onClick = { onZoomOut }
                    type = 'button'>
                    <Icon
                        size = { 20 }
                        src = { IconMinus } />
                </button>
                <span className = { classes.label }>{ `${Math.round(zoom * 100)}%` }</span>
                <button
                    aria-label = { t('presentation.zoomIn') }
                    className = { classes.iconButton }
                    disabled = { zoomIn === undefined }
                    onClick = { onZoomIn }
                    type = 'button'>
                    <Icon
                        size = { 20 }
                        src = { IconPlus } />
                </button>
                <div className = { classes.divider } />
            </div>
            <div className = { classes.group }>
                {
                    TOOLS.map(item => (
                        <button
                            aria-label = { t(item.key) }
                            aria-pressed = { tool === item.tool }
                            className = { cx(classes.iconButton, tool === item.tool && classes.selected) }
                            data-tool = { item.tool }
                            key = { item.tool }
                            onClick = { onTool }
                            title = { t(item.key) }
                            type = 'button'>
                            <Icon
                                size = { 20 }
                                src = { item.icon } />
                        </button>
                    ))
                }
            </div>
            {
                hasInk && (
                    <div className = { classes.group }>
                        {
                            ALLOWED_COLORS.map((value, index) => (
                                <button
                                    aria-label = { t('presentation.color', { color: t(COLOR_NAME_KEYS[index]) }) }
                                    aria-pressed = { color === value }
                                    className = { cx(classes.swatch, color === value && classes.swatchSelected) }
                                    data-color = { value }
                                    key = { value }
                                    onClick = { onColor }
                                    style = {{ backgroundColor: value }}
                                    type = 'button' />
                            ))
                        }
                    </div>
                )
            }
            <div className = { classes.divider } />
            <Button
                label = { t('presentation.stop') }
                onClick = { onStop }
                size = 'small'
                type = { BUTTON_TYPES.DESTRUCTIVE } />
        </div>
    );
};

export default PresenterToolbar;
