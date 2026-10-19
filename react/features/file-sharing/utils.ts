import { IReduxState } from '../app/types';
import { getCurrentConference } from '../base/conference/functions';

/**
 * Asks the file sharing service for a short-lived presigned URL of a shared file.
 *
 * @param {IReduxState} state - The redux state.
 * @param {string} fileId - The id of the shared file.
 * @returns {Promise<{ fileName: string, presignedUrl: string }>}
 */
export async function fetchPresignedUrl(
        state: IReduxState, fileId: string): Promise<{ fileName: string; presignedUrl: string; }> {
    const { fileSharing } = state['features/base/config'];
    const conference = getCurrentConference(state);
    const sessionId = conference?.getMeetingUniqueId();

    if (!sessionId) {
        throw new Error('The meeting is not joined yet.');
    }

    const token: string = await conference?.getShortTermCredentials(conference?.getFileSharing()?.getIdentityType());
    const response = await fetch(`${fileSharing!.apiUrl!}/sessions/${sessionId}/files/${fileId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to get file URL: ${response.statusText}`);
    }

    const data: { fileName: string; presignedUrl: string; } = await response.json();

    if (!data?.presignedUrl) {
        throw new Error('No presigned URL found in the response.');
    }

    return data;
}

const generateDownloadUrl = async (url: string) => {
    const resp = await fetch(url);
    const respBlob = await resp.blob();

    const blob = new Blob([ respBlob ]);

    // @ts-ignore
    return URL.createObjectURL(blob);
};

export const downloadFile = async (url: string, fileName: string) => {
    const dowloadUrl = await generateDownloadUrl(url);
    const link = document.createElement('a');

    if (fileName) {
        link.download = fileName;
    }
    link.href = dowloadUrl;

    document.body.appendChild(link);
    link.click();
    link.remove();

    // fix for certain browsers
    setTimeout(() => {

        // @ts-ignore
        URL.revokeObjectURL(dowloadUrl);
    }, 0);
};
