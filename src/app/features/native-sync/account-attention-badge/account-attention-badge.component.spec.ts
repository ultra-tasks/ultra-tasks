import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { AccountSyncStatusService } from '../account-sync-status.service';
import type { AccountSyncStatus } from '../account-sync-status.model';
import { AccountAttentionBadgeComponent } from './account-attention-badge.component';

describe('AccountAttentionBadgeComponent', () => {
  let fixture: ComponentFixture<AccountAttentionBadgeComponent>;
  let needsAttention: ReturnType<typeof signal<boolean>>;
  let severity: ReturnType<typeof signal<AccountSyncStatus['severity']>>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    needsAttention = signal(false);
    severity = signal<AccountSyncStatus['severity']>('warning');
    await TestBed.configureTestingModule({
      imports: [AccountAttentionBadgeComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: AccountSyncStatusService,
          useValue: {
            needsAttention,
            status: () => ({ severity: severity() }),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AccountAttentionBadgeComponent);
    fixture.detectChanges();
  });

  it('draws nothing while sync is fine', () => {
    expect(el().textContent?.trim()).toBe('');
    expect(el().querySelector('.badge')).toBeNull();
  });

  it('shows a "!" and says "Needs attention" to assistive technology when sync needs the user', () => {
    needsAttention.set(true);
    fixture.detectChanges();
    const mark = el().querySelector('.badge')!;
    // A shape, hidden from the reader because the text beside it says the same.
    expect(mark.textContent?.trim()).toBe('!');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(el().querySelector('.cdk-visually-hidden')?.textContent).toContain(
      T.ACCOUNT_STATUS.NEEDS_ATTENTION,
    );
  });

  it('marks a failure differently from a state that only waits for the user', () => {
    needsAttention.set(true);
    fixture.detectChanges();
    expect(el().querySelector('.badge--error')).toBeNull();
    severity.set('error');
    fixture.detectChanges();
    expect(el().querySelector('.badge--error')).not.toBeNull();
  });

  it('can name its hidden text, so a row can describe itself with it', () => {
    fixture.componentRef.setInput('textId', 'row-attention');
    needsAttention.set(true);
    fixture.detectChanges();
    expect(el().querySelector('#row-attention')).not.toBeNull();
  });

  it('goes again once the state is resolved', () => {
    needsAttention.set(true);
    fixture.detectChanges();
    needsAttention.set(false);
    fixture.detectChanges();
    expect(el().querySelector('.badge')).toBeNull();
  });
});
