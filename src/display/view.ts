import type { State } from '../demo-state';
import { escapeHTML } from '../shared/render-helpers';
import { icon } from '../shared/icons';

export function renderDisplay(state: State, demoMode = true): string {
  const progress = state.progress !== null && Number.isFinite(state.progress) && state.progress >= 0 && state.progress <= 100 ? state.progress : 0;
  const mainTitle = progress >= 100 ? 'Task complete.' : state.running ? 'Working on it.' : 'Standing by.';
  const phase = progress >= 100 ? 'TASK FINISHED' : state.running ? 'AGENT ACTIVE' : 'AGENT PAUSED';
  const tiles = state.widgets.slice(0, 3).map(w => `<div class="display-tile"><div class="display-tile-head">${escapeHTML(w.label)}</div><div class="display-tile-value">${escapeHTML(w.value)}</div></div>`).join('');
  return `<div class="display ${state.running ? '' : 'paused'}"><header class="display-bar"><div class="display-brand"><span class="display-brand-mark">${icon('spark',19)}</span><span>Glimpse Dock</span></div><div class="display-meta"><span class="display-hint">${demoMode ? 'LOCAL DEMO • NOT CONNECTED TO HERMES' : 'LOCAL WORKSPACE'}</span><span class="display-pill"><i class="display-live-dot"></i>${state.running ? 'SIMULATING' : 'PAUSED'}</span></div></header><main class="display-stage"><div class="display-ambient" aria-hidden="true"><div class="display-halo"></div><div class="display-halo two"></div><div class="display-halo three"></div><div class="display-orb"></div></div><div class="display-kicker">${phase}</div><h1>${mainTitle}</h1><p class="display-description">${escapeHTML(state.task)}</p><div class="display-progress" aria-label="Task progress"><span style="width:${progress}%"></span></div><div class="display-progress-note">${progress}% progress</div></main><section class="display-bottom">${tiles}</section><footer class="display-footer"><span>GLIMPSE DOCK · VISUAL DISPLAY</span><span>Press F11 for fullscreen &nbsp;·&nbsp; <a href="/admin">Admin view</a></span></footer></div>`;
}
