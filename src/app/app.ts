import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * The shell, and deliberately nothing else. Everything this app puts on screen under `/ci/` —
 * the platform chrome included — comes from `QitsMainLayout` behind the `''` route, so the one
 * thing this component owns is the outlet that lets the route table render at all.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
