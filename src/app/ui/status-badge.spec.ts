import { TestBed } from '@angular/core/testing';
import { StatusBadge } from './status-badge';

/**
 * The map is the component, so the map is what is asserted — including the fallback, because a new
 * enum value on either side must render as a plain badge rather than crash or claim success.
 */
describe('StatusBadge', () => {
  async function toneOf(status: string): Promise<string> {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('qits-badge');
    return badge?.firstElementChild?.className ?? '';
  }

  it('gives a run outcome the tone that says what it is', async () => {
    expect(await toneOf('RUNNING')).toContain('info');
    expect(await toneOf('SUCCESS')).toContain('success');
    expect(await toneOf('FAILED')).toContain('danger');
    expect(await toneOf('CONFIG_ERROR')).toContain('warning');
  });

  it('reads a step’s SKIPPED as neutral, because it is not a failure', async () => {
    expect(await toneOf('SKIPPED')).toContain('neutral');
  });

  it('falls back to neutral for a status this build has never heard of', async () => {
    expect(await toneOf('SOMETHING_NEW')).toContain('neutral');
  });

  it('renders the status word itself — a coloured dot is not a status', async () => {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', 'CONFIG_ERROR');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('CONFIG_ERROR');
  });
});
