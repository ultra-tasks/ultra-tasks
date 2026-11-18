import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import { T } from '../../t.const';
import {
  CalendarPublicationService,
  PublishedCalendar,
} from './calendar-publication.service';

@Component({
  selector: 'calendar-publications',
  imports: [
    FormsModule,
    TranslatePipe,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar-publications.component.html',
  styleUrl: './calendar-publications.component.scss',
})
export class CalendarPublicationsComponent {
  readonly T = T;
  /** The label is announced as required, but an empty field is not painted as an error. */
  readonly plainFieldMatcher: ErrorStateMatcher = { isErrorState: () => false };
  readonly publication = inject(CalendarPublicationService);
  readonly projects = inject(ProjectService);
  readonly tags = inject(TagService);
  readonly url = signal('');
  readonly failed = signal(false);
  label = '';
  selection = 'all';
  privacy: 'busy' | 'titles' = 'busy';
  consent = false;
  async publish(): Promise<void> {
    if (!this.consent || !this.label.trim()) return;
    this.failed.set(false);
    const separator = this.selection.indexOf(':');
    const type = separator < 0 ? 'all' : this.selection.slice(0, separator);
    if (type !== 'all' && type !== 'project' && type !== 'tag') return;
    try {
      this.url.set(
        await this.publication.create(this.label.trim(), this.privacy, {
          type,
          ...(separator < 0 ? {} : { id: this.selection.slice(separator + 1) }),
        }),
      );
      this.consent = false;
    } catch {
      this.failed.set(true);
    }
  }
  async rotate(feed: PublishedCalendar): Promise<void> {
    this.failed.set(false);
    this.url.set('');
    try {
      this.url.set(await this.publication.rotate(feed));
    } catch {
      this.failed.set(true);
    }
  }
  async stop(feed: PublishedCalendar): Promise<void> {
    this.failed.set(false);
    this.url.set('');
    try {
      await this.publication.stop(feed);
    } catch {
      this.failed.set(true);
    }
  }
}
