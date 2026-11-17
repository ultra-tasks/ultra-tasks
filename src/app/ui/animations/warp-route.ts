import {
  animate,
  animateChild,
  group,
  query,
  style,
  transition,
  trigger,
} from '@angular/animations';
import {
  ANI_ENTER_TIMING,
  ANI_LEAVE_TIMING,
  ANI_LONG_TIMING,
  ANI_STANDARD_TIMING_,
  TRANSITION_DURATION_L,
  TRANSITION_DURATION_S,
} from './animation.const';

// starts shortly after the headline so the page still reads top to bottom
const CONTENT_FADE_TIMING = `${TRANSITION_DURATION_L} ${TRANSITION_DURATION_S} ${ANI_STANDARD_TIMING_}`;

/**
 * Carried in the state binding (`{ value, params: { skip } }`, see app.component.html):
 * set for a switch that should have no animation at all. A parameter rather than
 * `[@.disabled]` on the wrapper, so animations inside the page keep running.
 */
export const WARP_ROUTE_SKIP_PARAM = 'skip';

export const warpRouteAnimation = trigger('warpRoute', [
  transition('* => daily-summary', [
    /* 1 */ query(
      ':enter, :leave',
      style({ position: 'absolute', width: '100%', minHeight: '100%', height: '100%' }),
      { optional: true },
    ),
    group([
      query(
        ':leave',
        [
          style({ opacity: 1, transform: 'scale(1)' }),
          animate(ANI_ENTER_TIMING, style({ opacity: 0, transform: 'scale(1.1)' })),
          animateChild(),
        ],
        { optional: true },
      ),
      query(
        ':enter',
        [
          style({ opacity: 0, transform: 'scale(1.2)' }),
          // One group so the content fades in while the headline does, instead
          // of the content appearing only after the headline has finished.
          group([
            animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'scale(1)' })),
            query('h1', [
              style({ opacity: 0 }),
              animate(ANI_LONG_TIMING, style({ opacity: 1 })),
            ]),
            query(
              '.daily-summary-summary, .simple-counter-summary, .day-end-note, mat-tab-group',
              [
                style({ opacity: 0 }),
                animate(CONTENT_FADE_TIMING, style({ opacity: 1 })),
              ],
            ),
          ]),
          animateChild(),
        ],
        { optional: true },
      ),
    ]),
  ]),

  // Phones and big lists: no animation. The old page would stay in the DOM next to the
  // new one for the 165ms out and 190ms in, and a full-screen layer would be scaled
  // meanwhile; measured, that is 190-250ms of every switch and most of it on heavy pages.
  transition((_from, _to, _element, params) => !!params?.[WARP_ROUTE_SKIP_PARAM], []),

  // Ordinary view switches: the old page eases out as the new one settles in
  // from just above its place. A small scale, not the daily-summary "warp".
  transition('* <=> *', [
    /* 1 */ query(
      ':enter, :leave',
      style({ position: 'absolute', width: '100%', minHeight: '100%', height: '100%' }),
      { optional: true },
    ),
    group([
      query(
        ':leave',
        [
          style({ opacity: 1, transform: 'scale(1)' }),
          animate(ANI_LEAVE_TIMING, style({ opacity: 0, transform: 'scale(1.02)' })),
          animateChild(),
        ],
        { optional: true },
      ),
      query(
        ':enter',
        [
          style({ opacity: 0, transform: 'scale(1.04)' }),
          animate(ANI_ENTER_TIMING, style({ opacity: 1, transform: 'scale(1)' })),
          animateChild(),
        ],
        { optional: true },
      ),
    ]),
  ]),
]);
