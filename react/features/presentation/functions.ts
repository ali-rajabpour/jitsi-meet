import { IReduxState } from '../app/types';
import { getLocalParticipant, isLocalParticipantModerator } from '../base/participants/functions';
import { isFileSharingEnabled } from '../file-sharing/functions.any';
import { IFileMetadata } from '../file-sharing/types';

import { IPresentationInfo, isPresentableType } from './protocol';

/**
 * Checks whether the presentation feature is enabled. It needs file sharing, which provides the files.
 *
 * @param {IReduxState} state - The redux state.
 * @returns {boolean}
 */
export function isPresentationEnabled(state: IReduxState): boolean {
    return Boolean(state['features/base/config'].presentation?.enabled) && isFileSharingEnabled(state);
}

/**
 * Returns the active presentation, if any.
 *
 * @param {IReduxState} state - The redux state.
 * @returns {IPresentationInfo|undefined}
 */
export function getPresentation(state: IReduxState): IPresentationInfo | undefined {
    return state['features/presentation'].info;
}

/**
 * Checks whether a document is being presented.
 *
 * @param {IReduxState} state - The redux state.
 * @returns {boolean}
 */
export function isPresentationActive(state: IReduxState): boolean {
    return Boolean(state['features/presentation']?.info);
}

/**
 * Checks whether the local participant is the active presenter.
 *
 * @param {IReduxState} state - The redux state.
 * @returns {boolean}
 */
export function isLocalPresenter(state: IReduxState): boolean {
    const info = getPresentation(state);

    return Boolean(info) && info?.presenterId === getLocalParticipant(state)?.id;
}

/**
 * Checks whether the local participant may present files at all.
 *
 * @param {IReduxState} state - The redux state.
 * @returns {boolean}
 */
export function canPresent(state: IReduxState): boolean {
    return isPresentationEnabled(state) && isLocalParticipantModerator(state);
}

/**
 * Checks whether a shared file is of a presentable type and fully uploaded.
 *
 * @param {IFileMetadata} file - The shared file.
 * @returns {boolean}
 */
export function isPresentableFile(file: IFileMetadata): boolean {
    return isPresentableType(file.fileType?.toLowerCase()) && !file.isDeleted && (file.progress ?? 100) === 100;
}

/**
 * Checks whether the local participant may present the given file.
 *
 * @param {IReduxState} state - The redux state.
 * @param {IFileMetadata} file - The shared file.
 * @returns {boolean}
 */
export function canPresentFile(state: IReduxState, file: IFileMetadata): boolean {
    return canPresent(state) && isPresentableFile(file);
}
