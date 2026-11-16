import React from 'react';

import { IconAdmin, IconDoctor, IconModerator } from '../../../base/icons/svg';
import BaseIndicator from '../../../base/react/components/web/BaseIndicator';
import { TOOLTIP_POSITION } from '../../../base/ui/constants.any';

/**
 * The type of the React {@code Component} props of {@link ModeratorIndicator}.
 */
interface IProps {

    /**
     * Whether the moderator is the admin (see getModeratorBadge).
     */
    admin?: boolean;

    /**
     * The badge label from config.moderatorBadge, used as the tooltip; none for the stock badge.
     */
    label?: string;

    /**
     * From which side of the indicator the tooltip should appear from.
     */
    tooltipPosition: TOOLTIP_POSITION;
}

/**
 * React {@code Component} for showing a moderator icon with a tooltip.
 *
 * @returns {JSX.Element}
 */
const ModeratorIndicator = ({ admin, label, tooltipPosition }: IProps): JSX.Element => (
    <BaseIndicator
        icon = { admin ? IconAdmin : label ? IconDoctor : IconModerator }
        iconSize = { 16 }

        // A plain label works as a translation key: it is returned unchanged.
        tooltipKey = { label ?? 'videothumbnail.moderator' }
        tooltipPosition = { tooltipPosition } />
);

export default ModeratorIndicator;
