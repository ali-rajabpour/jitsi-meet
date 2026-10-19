/**
 * Minimum interval between presence updates of the presenter's view, in milliseconds.
 */
export const VIEW_SEND_INTERVAL = 150;

/**
 * Minimum interval between pointer messages, in milliseconds. Messages go through the XMPP server,
 * which works in both P2P and JVB mode, so they are kept infrequent and small.
 */
export const POINTER_SEND_INTERVAL = 100;

/**
 * Minimum interval between messages carrying new points of the strokes being drawn, in milliseconds.
 */
export const STROKE_SEND_INTERVAL = 100;

/**
 * Time after which an idle pointer is hidden, in milliseconds.
 */
export const POINTER_IDLE_TIMEOUT = 2000;

/**
 * The zoom steps offered by the zoom in and zoom out buttons.
 */
export const ZOOM_STEPS = [ 1, 1.5, 2, 3, 4 ];

/**
 * Translation keys for the colour names, in the order of ALLOWED_COLORS.
 */
export const COLOR_NAME_KEYS = [ 'presentation.red', 'presentation.yellow', 'presentation.green', 'presentation.blue' ];
