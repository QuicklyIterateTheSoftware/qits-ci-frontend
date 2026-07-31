import type { Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';

/**
 * The layout is the root *route* component rather than something the shell templates, so the
 * platform chrome mounts once and survives every navigation beneath it. `children` is empty on
 * purpose: this app's own pages are still to come, and they arrive here.
 */
export const routes: Routes = [{ path: '', component: QitsMainLayout, children: [] }];
