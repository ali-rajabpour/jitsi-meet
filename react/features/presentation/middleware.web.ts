import { throttle } from 'lodash-es';

import { IStore } from '../app/types';
import {
    CONFERENCE_JOIN_IN_PROGRESS,
    CONFERENCE_LEFT,
    CONFERENCE_WILL_LEAVE,
    ENDPOINT_MESSAGE_RECEIVED
} from '../base/conference/actionTypes';
import { getCurrentConference } from '../base/conference/functions';
import { IJitsiConference } from '../base/conference/reducer';
import {
    PARTICIPANT_JOINED,
    PARTICIPANT_LEFT,
    PARTICIPANT_ROLE_CHANGED
} from '../base/participants/actionTypes';
import { PARTICIPANT_ROLE } from '../base/participants/constants';
import {
    getLocalParticipant,
    getParticipantById,
    getParticipantDisplayName,
    isParticipantModerator
} from '../base/participants/functions';
import MiddlewareRegistry from '../base/redux/MiddlewareRegistry';
import { _FILE_REMOVED } from '../file-sharing/actionTypes';
import { showNotification } from '../notifications/actions';
import { NOTIFICATION_TIMEOUT_TYPE } from '../notifications/constants';
import { setTileView } from '../video-layout/actions.any';

import {
    REMOVE_PRESENTATION_STROKE,
    SET_PRESENTATION_POINTER,
    SET_PRESENTATION_VIEW,
    START_PRESENTATION,
    STOP_PRESENTATION,
    UPSERT_PRESENTATION_STROKE
} from './actionTypes';
import {
    clearPresentation,
    removePresentationStroke,
    setPresentation,
    setPresentationPointer,
    setPresentationStrokes,
    upsertPresentationStroke
} from './actions';
import {
    POINTER_SEND_INTERVAL,
    STROKE_SEND_INTERVAL,
    SYNC_REQUEST_INTERVAL,
    VIEW_SEND_INTERVAL
} from './constants';
import { canPresentFile, getPresentation, isLocalPresenter, isPresentationEnabled } from './functions';
import logger from './logger';
import {
    IPresentationInfo,
    MAX_STROKE_POINTS,
    PRESENTATION_NAME,
    PresentationMessage,
    chunkStrokes,
    clampRegion,
    clampView,
    parseEndpointMessage,
    parseStateAttributes,
    serializeStateAttributes,
    shouldAcceptState
} from './protocol';

/**
 * Presentation state received from participants whose moderator role is not known yet. A late joiner can
 * receive the presenter's presence before the presenter's role, so the state is applied once the role arrives.
 */
const pending = new Map<string, IPresentationInfo>();

/**
 * Ids of strokes with points not sent yet, and how many points of each stroke were already sent.
 */
const dirtyStrokes = new Set<string>();

/**
 * When each participant last asked for the current ink, to bound how often the presenter replies.
 */
const syncRequests = new Map<string, number>();
const sentPoints = new Map<string, number>();

/**
 * Sends a presentation message to everyone, or to one participant. Messages go through the XMPP server, which
 * also works in P2P mode where there may be no bridge channel.
 *
 * @param {IJitsiConference} conference - The conference.
 * @param {Object} message - The message without the name.
 * @param {string} to - The recipient's participant id, empty for everyone.
 * @returns {void}
 */
function send(conference: IJitsiConference | undefined, message: PresentationMessage, to = '') {
    try {
        conference?.sendMessage({ name: PRESENTATION_NAME, ...message }, to, false);
    } catch (error) {
        logger.warn('Could not send presentation message', error);
    }
}

/**
 * Publishes the local presentation state in the local presence.
 *
 * @param {IStore} store - The redux store.
 * @returns {void}
 */
function publishState({ getState }: IStore) {
    const state = getState();
    const info = getPresentation(state);

    if (info && isLocalPresenter(state)) {
        getCurrentConference(state)?.sendCommand(PRESENTATION_NAME, serializeStateAttributes(info));
    }
}

const publishStateThrottled = throttle(publishState, VIEW_SEND_INTERVAL);

const sendPointerThrottled = throttle(({ getState }: IStore) => {
    const state = getState();
    const { info, pointer } = state['features/presentation'];

    if (info) {
        send(getCurrentConference(state), {
            kind: 'pointer',
            page: info.page,
            x: pointer ? round(pointer.x) : -1,
            y: pointer ? round(pointer.y) : -1
        });
    }
}, POINTER_SEND_INTERVAL);

const flushStrokesThrottled = throttle(({ getState }: IStore) => {
    const state = getState();
    const { info, strokes } = state['features/presentation'];
    const conference = getCurrentConference(state);

    for (const id of dirtyStrokes) {
        const stroke = strokes.find(s => s.id === id);
        const from = sentPoints.get(id) ?? 0;

        if (info && stroke && stroke.points.length > from) {
            send(conference, {
                kind: 'stroke',
                page: info.page,
                stroke: {
                    ...stroke,
                    points: stroke.points.slice(from)
                }
            });
            sentPoints.set(id, stroke.points.length);
        }
    }
    dirtyStrokes.clear();
}, STROKE_SEND_INTERVAL);

/**
 * Rounds a page coordinate to keep messages small.
 *
 * @param {number} n - The coordinate.
 * @returns {number}
 */
function round(n: number) {
    return Math.round(n * 10000) / 10000;
}

/**
 * Drops all pending outgoing data.
 *
 * @returns {void}
 */
function resetOutgoing() {
    publishStateThrottled.cancel();
    sendPointerThrottled.cancel();
    flushStrokesThrottled.cancel();
    dirtyStrokes.clear();
    sentPoints.clear();
    syncRequests.clear();
}

/**
 * Ends the presentation locally.
 *
 * @param {IStore} store - The redux store.
 * @returns {void}
 */
function clear({ dispatch }: IStore) {
    resetOutgoing();
    dispatch(clearPresentation());
}

/**
 * Stops the local presentation for everyone.
 *
 * @param {IStore} store - The redux store.
 * @returns {void}
 */
function stopLocal(store: IStore) {
    withdrawState(getCurrentConference(store.getState()));
    clear(store);
}

/**
 * Removes the presentation from the local presence. Removing the extension alone does not send presence, so
 * the server would keep the stale state and hand it to later joiners; the stop command forces an update.
 * Participants following another presenter ignore it.
 *
 * @param {IJitsiConference} conference - The conference.
 * @returns {void}
 */
function withdrawState(conference?: IJitsiConference) {
    conference?.removeCommand(PRESENTATION_NAME);
    conference?.sendCommandOnce(PRESENTATION_NAME, {
        value: '',
        attributes: { state: 'stop' }
    });
}

/**
 * Applies presentation state received from a remote participant, if that participant may present.
 *
 * @param {IStore} store - The redux store.
 * @param {IPresentationInfo} info - The received state.
 * @returns {void}
 */
function applyRemoteState(store: IStore, info: IPresentationInfo) {
    const { dispatch, getState } = store;
    const state = getState();
    const current = getPresentation(state);
    const localId = getLocalParticipant(state)?.id;

    if (!isParticipantModerator(getParticipantById(state, info.presenterId))) {
        pending.set(info.presenterId, info);

        return;
    }
    pending.delete(info.presenterId);

    if (!shouldAcceptState(current, info)) {
        return;
    }

    if (current?.presenterId === localId) {
        // Another moderator took over: stop holding the presentation in our presence.
        withdrawState(getCurrentConference(state));
        resetOutgoing();
        dispatch(showNotification({
            titleKey: 'presentation.takenOver',
            titleArguments: { name: getParticipantDisplayName(state, info.presenterId) }
        }, NOTIFICATION_TIMEOUT_TYPE.MEDIUM));
    }

    const isNew = current?.fileId !== info.fileId || current?.presenterId !== info.presenterId;
    const { pageCount } = state['features/presentation'];

    dispatch(setPresentation({
        ...info,
        ...clampView(info, isNew ? undefined : pageCount)
    }));

    if (isNew) {
        dispatch(setTileView(false));
        send(getCurrentConference(state), { kind: 'sync-request' }, info.presenterId);
    }
}

/**
 * Handles a presentation message from a remote participant.
 *
 * @param {IStore} store - The redux store.
 * @param {string} fromId - The sender's participant id.
 * @param {PresentationMessage} message - The validated message.
 * @returns {void}
 */
function onMessage(store: IStore, fromId: string, message: PresentationMessage) {
    const { dispatch, getState } = store;
    const state = getState();
    const { info, strokes } = state['features/presentation'];

    if (!info) {
        return;
    }

    if (message.kind === 'sync-request') {
        const now = Date.now();

        if (isLocalPresenter(state) && getParticipantById(state, fromId)
                && now - (syncRequests.get(fromId) ?? 0) >= SYNC_REQUEST_INTERVAL) {
            const conference = getCurrentConference(state);

            syncRequests.set(fromId, now);
            chunkStrokes(strokes, MAX_STROKE_POINTS).forEach((chunk, index) =>
                send(conference, {
                    append: index > 0,
                    kind: 'strokes',
                    page: info.page,
                    strokes: chunk
                }, fromId));
        }

        return;
    }

    if (fromId !== info.presenterId || !isParticipantModerator(getParticipantById(state, fromId))
            || message.page !== info.page) {
        return;
    }

    switch (message.kind) {
    case 'pointer':
        dispatch(setPresentationPointer(message.x < 0 ? undefined : { x: message.x, y: message.y }, true));
        break;
    case 'stroke': {
        // Stroke messages carry only the points added since the previous message for that stroke.
        const existing = strokes.find(s => s.id === message.stroke.id);
        const points = existing ? existing.points.concat(message.stroke.points) : message.stroke.points;

        dispatch(upsertPresentationStroke({
            ...message.stroke,
            points: points.slice(0, MAX_STROKE_POINTS)
        }, true));
        break;
    }
    case 'erase':
        dispatch(removePresentationStroke(message.id, true));
        break;
    case 'strokes':
        dispatch(setPresentationStrokes(message.append ? strokes.concat(message.strokes) : message.strokes, true));
        break;
    }
}

MiddlewareRegistry.register(store => next => action => {
    const { dispatch, getState } = store;

    if (!isPresentationEnabled(getState())) {
        return next(action);
    }

    switch (action.type) {
    case CONFERENCE_JOIN_IN_PROGRESS: {
        const localId = () => getLocalParticipant(getState())?.id;

        action.conference.addCommandListener(PRESENTATION_NAME,
            ({ value, attributes }: { attributes: Record<string, string>; value: string; }, from: string) => {
                if (from === localId()) {
                    return;
                }

                if (attributes?.state === 'stop') {
                    pending.delete(from);
                    getPresentation(getState())?.presenterId === from && clear(store);

                    return;
                }

                const info = parseStateAttributes(value, attributes, from);

                if (info) {
                    applyRemoteState(store, info);
                } else {
                    logger.debug(`Ignoring invalid presentation state from ${from}`);
                }
            });
        break;
    }

    case CONFERENCE_WILL_LEAVE:
    case CONFERENCE_LEFT:
        pending.clear();
        clear(store);
        break;

    case PARTICIPANT_JOINED:
    case PARTICIPANT_ROLE_CHANGED: {
        const result = next(action);
        const { id, role } = action.participant;
        const state = getState();
        const info = getPresentation(state);

        if (pending.has(id) && role === PARTICIPANT_ROLE.MODERATOR) {
            applyRemoteState(store, pending.get(id)!);
        } else if (action.type === PARTICIPANT_ROLE_CHANGED && info?.presenterId === id
                && role !== PARTICIPANT_ROLE.MODERATOR) {
            isLocalPresenter(state) ? stopLocal(store) : clear(store);
        }

        return result;
    }

    case PARTICIPANT_LEFT:
        pending.delete(action.participant.id);
        getPresentation(getState())?.presenterId === action.participant.id && clear(store);
        break;

    case START_PRESENTATION: {
        const state = getState();
        const file = state['features/file-sharing'].files.get(action.fileId);
        const localId = getLocalParticipant(state)?.id;
        const fileType = file?.fileType?.toLowerCase();

        if (!file || !localId || !canPresentFile(state, file)) {
            return next(action);
        }

        const current = getPresentation(state);

        resetOutgoing();
        dispatch(setPresentation({
            ...clampView({}),
            fileId: file.fileId,
            fileName: file.fileName,
            fileType: fileType as IPresentationInfo['fileType'],
            presenterId: localId,
            region: clampRegion(),

            // Clocks differ between machines, so a takeover is always ordered after what it replaces.
            startedAt: Math.max(Date.now(), (current?.startedAt ?? 0) + 1)
        }));
        dispatch(setTileView(false));
        publishState(store);
        break;
    }

    case STOP_PRESENTATION:
        isLocalPresenter(getState()) && stopLocal(store);
        break;

    case SET_PRESENTATION_VIEW: {
        const before = getPresentation(getState());
        const result = next(action);
        const after = getPresentation(getState());

        if (isLocalPresenter(getState())) {
            if (before?.page !== after?.page) {
                resetOutgoing();
            }
            publishStateThrottled(store);
        }

        return result;
    }

    case _FILE_REMOVED:
        if (getPresentation(getState())?.fileId === action.fileId) {
            isLocalPresenter(getState()) ? stopLocal(store) : clear(store);
        }
        break;

    case ENDPOINT_MESSAGE_RECEIVED: {
        const message = parseEndpointMessage(action.data);
        const fromId = action.participant?.getId?.();

        if (message && fromId) {
            onMessage(store, fromId, message);
        }
        break;
    }

    case UPSERT_PRESENTATION_STROKE: {
        const result = next(action);

        if (!action.fromRemote && isLocalPresenter(getState())) {
            dirtyStrokes.add(action.stroke.id);
            flushStrokesThrottled(store);
        }

        return result;
    }

    case REMOVE_PRESENTATION_STROKE: {
        const state = getState();
        const info = getPresentation(state);

        if (info && !action.fromRemote && isLocalPresenter(state)) {
            // Points still waiting to be sent would recreate the stroke on the other side.
            flushStrokesThrottled.flush();
            dirtyStrokes.delete(action.id);
            sentPoints.delete(action.id);
            send(getCurrentConference(state), { id: action.id, kind: 'erase', page: info.page });
        }
        break;
    }

    case SET_PRESENTATION_POINTER: {
        const result = next(action);

        if (!action.fromRemote && isLocalPresenter(getState())) {
            sendPointerThrottled(store);
        }

        return result;
    }
    }

    return next(action);
});
