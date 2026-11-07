import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

import { LayoutService } from '../layout/layout.service';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { T } from '../../t.const';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { NAV_SECTION_ICON } from '../magic-side-nav/nav-section-icons.const';

/**
 * The phone's floating navigation: Today, Upcoming, Inbox and Browse, nothing
 * else. Browse opens the side nav as the drawer, which holds everything that is
 * not a daily destination (projects, tags, Search, the right-panel toggles,
 * Settings). Adding a task happens in the lists' own "Add task" rows.
 */
@Component({
  selector: 'mobile-bottom-nav',
  standalone: true,
  imports: [RouterModule, MatIconModule, TranslateModule],
  templateUrl: './mobile-bottom-nav.component.html',
  styleUrls: ['./mobile-bottom-nav.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileBottomNavComponent {
  private readonly _globalConfigService = inject(GlobalConfigService);

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

  toggleMobileNav(): void {
    this.toggleMobileNavEvent.emit();
  }
}
