import type { State } from '../demo-state';
import { escapeHTML } from '../shared/render-helpers';
import { icon } from '../shared/icons';

export function renderDisplay(state: State, demoMode = true, connected = true): string {
  const presentations = {
    idle: ['Standing by.', 'IDLE'],
    thinking: ['Thinking.', 'THINKING'],
    'tool-use': ['Using a tool.', 'USING A TOOL'],
    responding: ['Responding.', 'RESPONDING'],
    waiting: ['Waiting.', 'WAITING'],
    completed: ['Task complete.', 'COMPLETED'],
    error: ['Something went wrong.', 'ERROR'],
  } as const;
  const [mainTitle, phase] = presentations[state.activity];
  const progress = typeof state.progress === 'number' && Number.isFinite(state.progress) && state.progress >= 0 && state.progress <= 100 ? state.progress : null;
  const tiles = state.widgets.slice(0, 3).map(w => `<div class="display-tile"><div class="display-tile-head">${escapeHTML(w.label)}</div><div class="display-tile-value">${escapeHTML(w.value)}</div></div>`).join('');
  return `<div class="display display--${state.displayStyle}${connected ? '' : ' display--offline'}" data-activity="${state.activity}"><header class="display-bar"><div class="display-brand"><span class="display-brand-mark">${icon('spark',19)}</span><span>Glimpse Dock</span></div><div class="display-meta"><span class="display-hint">${demoMode ? 'LOCAL DEMO • NOT CONNECTED TO HERMES' : 'LOCAL WORKSPACE'}</span><span class="display-pill" role="status" aria-live="polite">${connected ? 'Connected' : 'Connection lost · reconnecting'}</span></div></header><main class="display-stage"><div class="display-ambient" aria-hidden="true"><div class="display-halo"></div><div class="display-halo two"></div><div class="display-halo three"></div><div class="display-orb"></div></div><div class="display-kicker">${phase}</div><h1>${mainTitle}</h1><p class="display-description">${escapeHTML(state.task)}</p>${progress === null ? '' : `<div class="display-progress" role="progressbar" aria-label="Task progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><div class="display-progress-note">${progress}% progress</div>`}</main><section class="display-bottom">${tiles}</section><footer class="display-footer"><span>GLIMPSE DOCK · VISUAL DISPLAY</span><span>Press F11 for fullscreen &nbsp;·&nbsp; <a href="/admin">Admin view</a></span></footer></div>`;
}
