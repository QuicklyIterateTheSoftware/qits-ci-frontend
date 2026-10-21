import { uiComponentsPact } from '@qits/ui-components/testing';
import { appConfig } from './app.config';

/**
 * The REST calls @qits/ui-components makes on this frontend's behalf, pacted here rather than in
 * the library (qits-1284): only this application knows which of the library's features it turns
 * on. `uiComponentsPact` boots `appConfig`, derives the features from what it provides and from
 * what `src/app` uses, runs each call through the library's real client against the pact mock
 * server, and compares one file per provider with the committed
 * `pacts/qits-ci-frontend_qits-ui-components-jslib_<provider>.json` — every row carrying `qits-via`,
 * the library version this frontend resolves. It fails when `src/app` uses a calling symbol whose
 * feature has no row. Regenerate with `QITS_GOLDEN_UPDATE=true npm test`; the release publishes the
 * files as `eu.wohlben.qits:qits-ci-frontend-pacts-<provider>` (`.config/qits/release.yml`).
 */
describe('@qits/ui-components pacts', () =>
  uiComponentsPact({ consumer: 'qits-ci-frontend', appConfig, sources: 'src/app' }));
