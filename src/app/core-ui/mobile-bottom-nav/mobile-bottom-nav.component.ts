import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  IsActiveMatchOptions,
  NavigationEnd,
  Router,
  RouterModule,
} from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { filter, map, startWith } from 'rxjs/operators';

import { LayoutService } from '../layout/layout.service';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { T } from '../../t.const';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { NAV_SECTION_ICON } from '../magic-side-nav/nav-section-icons.const';
import { AccountAttentionBadgeComponent } from '../../features/native-sync/account-attention-badge/account-attention-badge.component';

// What `routerLinkActive` matches with `exact: false`: the tab's URL is contained in the
// current one, ignoring the fragment and matrix params.
const TAB_MATCH: IsActiveMatchOptions = {
  paths: 'subset',
  queryParams: 'subset',
  fragment: 'ignored',
  matrixParams: 'ignored',
};

/**
 * The phone's floating navigation: Today, Upcoming, Inbox and Browse, nothing
 * else. Browse opens the side nav as the drawer, which holds everything that is
 * not a daily destination (projects, tags, Search, the right-panel toggles,
 * Settings). Adding a task happens in the lists' own "Add task" rows.
 *
 * "You are here" is always on one of the four: a tab on its own page, Browse on every
 * other page (a project, a tag, Calendar, Boards, Habits, Search, History, Metrics...)
 * and while the drawer is open.
 */
@Component({
  selector: 'mobile-bottom-nav',
  standalone: true,
  imports: [RouterModule, MatIconModule, TranslateModule, AccountAttentionBadgeComponent],
  templateUrl: './mobile-bottom-nav.component.html',
  styleUrls: ['./mobile-bottom-nav.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileBottomNavComponent {
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _router = inject(Router);

  isEntrance = input(false);

  readonly T = T;
  readonly todayRoute = `/tag/${TODAY_TAG.id}/tasks`;
  readonly inboxRoute = `/project/${INBOX_PROJECT.id}/tasks`;
  readonly plannerIcon = NAV_SECTION_ICON.PLANNER;

  // Services for template access
  readonly layoutService = inject(LayoutService);

  // Output events
  toggleMobileNavEvent = output<void>();

  // Upcoming is the Planner page; it can be switched off in the app features.
  readonly isPlannerEnabled = computed(
    () => this._globalConfigService.appFeatures().isPlannerEnabled,
  );

  private readonly _url = toSignal(
    this._router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this._router.url),
    ),
    { initialValue: this._router.url },
  );

  /** The current page is none of the tabs, so it is somewhere in Browse. */
  readonly isOnBrowsePage = computed(() => {
    this._url();
    const tabs = [
      this.todayRoute,
      ...(this.isPlannerEnabled() ? ['/planner'] : []),
      this.inboxRoute,
    ];
    return !tabs.some((url) => this._router.isActive(url, TAB_MATCH));
  });

  toggleMobileNav(): void {
    this.toggleMobileNavEvent.emit();
  }

  /** Tapping the tab of the page that is already open scrolls that page back to the top. */
  onTabTap(isActive: boolean): void {
    if (isActive) {
      this.layoutService.scrollPageToTop();
    }
  }
}
