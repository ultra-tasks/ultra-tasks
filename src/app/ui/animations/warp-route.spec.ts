import { AnimationMetadataType, AnimationTransitionMetadata } from '@angular/animations';
import { WARP_ROUTE_SKIP_PARAM, warpRouteAnimation } from './warp-route';

type SkipMatcher = (
  from: string,
  to: string,
  element: unknown,
  params: Record<string, unknown> | undefined,
) => boolean;

describe('warpRouteAnimation', () => {
  const transitions = warpRouteAnimation.definitions.filter(
    (definition): definition is AnimationTransitionMetadata =>
      definition.type === AnimationMetadataType.Transition,
  );
  const indexOfSkip = transitions.findIndex((t) => typeof t.expr === 'function');
  const indexOfExpr = (expr: string): number =>
    transitions.findIndex((t) => t.expr === expr);

  it('has one transition that is chosen by a parameter of the state binding', () => {
    expect(indexOfSkip).toBeGreaterThan(-1);
    expect(transitions.filter((t) => typeof t.expr === 'function').length).toBe(1);
  });

  describe('the skip transition', () => {
    const skip = (): AnimationTransitionMetadata => transitions[indexOfSkip];
    const matches = (params: Record<string, unknown> | undefined): boolean =>
      (skip().expr as SkipMatcher)('tag-tasks', 'planner', null, params);

    it('matches only a switch that is marked to skip', () => {
      expect(matches({ [WARP_ROUTE_SKIP_PARAM]: true })).toBe(true);
      expect(matches({ [WARP_ROUTE_SKIP_PARAM]: false })).toBe(false);
      expect(matches({})).toBe(false);
      expect(matches(undefined)).toBe(false);
    });

    it('animates nothing, so the old page leaves at once', () => {
      // `transition(expr, steps)` keeps the steps as given: an empty list, not a sequence.
      expect(skip().animation).toEqual([]);
    });

    it('comes after the daily-summary warp and before the ordinary switch', () => {
      // The first transition that matches wins: a phone still gets the warp into the
      // daily summary, and every other switch checks the skip before it animates.
      expect(indexOfExpr('* => daily-summary')).toBeGreaterThan(-1);
      expect(indexOfExpr('* <=> *')).toBeGreaterThan(-1);
      expect(indexOfSkip).toBeGreaterThan(indexOfExpr('* => daily-summary'));
      expect(indexOfSkip).toBeLessThan(indexOfExpr('* <=> *'));
    });
  });
});
