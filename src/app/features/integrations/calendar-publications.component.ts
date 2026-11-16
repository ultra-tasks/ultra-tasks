import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import { T } from '../../t.const';
import {
  CalendarPublicationService,
  PublishedCalendar,
} from './calendar-publication.service';

@Component({
  selector: 'calendar-publications',
  imports: [FormsModule, TranslatePipe, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (publication.available()) {
      <section>
        <h2>{{ T.CALENDAR_PUBLICATION.TITLE | translate }}</h2>
        <button
          mat-button
          type="button"
          [disabled]="publication.busy()"
          (click)="publication.refresh()"
        >
          {{ T.PS.RELOAD | translate }}
        </button>
        <p>{{ T.CALENDAR_PUBLICATION.DISCLOSURE | translate }}</p>
        <p>{{ T.CALENDAR_PUBLICATION.REFRESH_HELP | translate }}</p>
        @if (failed() || publication.error()) {
          <p role="alert">{{ T.CALENDAR_PUBLICATION.ERROR | translate }}</p>
        }
        <form (ngSubmit)="publish()">
          <p>
            <label
              >{{ T.CALENDAR_PUBLICATION.LABEL | translate }}
              <input
                name="calendarLabel"
                [(ngModel)]="label"
                required
                maxlength="100"
              />
            </label>
          </p>
          <p>
            <label
              >{{ T.CALENDAR_PUBLICATION.SELECTION | translate }}
              <select
                name="calendarSelection"
                [(ngModel)]="selection"
              >
                <option value="all">{{ T.CALENDAR_PUBLICATION.ALL | translate }}</option>
                @for (project of projects.list(); track project.id) {
                  <option [value]="'project:' + project.id">{{ project.title }}</option>
                }
                @for (tag of tags.tagsNoMyDayAndNoList(); track tag.id) {
                  <option [value]="'tag:' + tag.id">#{{ tag.title }}</option>
                }
              </select>
            </label>
          </p>
          <p>
            <label
              >{{ T.CALENDAR_PUBLICATION.PRIVACY | translate }}
              <select
                name="calendarPrivacy"
                [(ngModel)]="privacy"
              >
                <option value="busy">
                  {{ T.CALENDAR_PUBLICATION.BUSY | translate }}
                </option>
                <option value="titles">
                  {{ T.CALENDAR_PUBLICATION.TITLES | translate }}
                </option>
              </select>
            </label>
          </p>
          <p>
            <label
              ><input
                type="checkbox"
                name="calendarConsent"
                [(ngModel)]="consent"
              />
              {{ T.CALENDAR_PUBLICATION.CONSENT | translate }}
            </label>
          </p>
          <button
            mat-flat-button
            type="submit"
            [disabled]="!consent || !label.trim() || publication.busy()"
          >
            {{ T.CALENDAR_PUBLICATION.PUBLISH | translate }}
          </button>
        </form>
        @if (url()) {
          <p>{{ T.CALENDAR_PUBLICATION.URL_HELP | translate }}</p>
          <p>
            <label
              >{{ T.CALENDAR_PUBLICATION.URL | translate }}
              <input
                readonly
                [value]="url()"
              />
            </label>
          </p>
        }
        @for (feed of publication.feeds(); track feed.id) {
          <article>
            <h3>{{ feed.label }}</h3>
            <p>
              {{
                (publication.ownedIds().has(feed.id)
                  ? T.CALENDAR_PUBLICATION.OWNER
                  : T.CALENDAR_PUBLICATION.OTHER_DEVICE
                ) | translate
              }}
            </p>
            <button
              mat-stroked-button
              type="button"
              [disabled]="publication.busy()"
              (click)="rotate(feed)"
            >
              {{ T.CALENDAR_PUBLICATION.ROTATE | translate }}
            </button>
            <button
              mat-button
              type="button"
              [disabled]="publication.busy()"
              (click)="stop(feed)"
            >
              {{ T.CALENDAR_PUBLICATION.STOP | translate }}
            </button>
          </article>
        }
      </section>
    }
  `,
})
export class CalendarPublicationsComponent {
  readonly T = T;
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
