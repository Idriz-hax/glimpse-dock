import type { State } from '../demo-state';
import { escapeHTML } from '../shared/render-helpers';
import { icon } from '../shared/icons';

export function renderDisplay(state: State, demoMode = true, connected = true, role: 'owner' | 'display' = 'display', ownerAutoAccess = false): string {
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
  const active = ['thinking', 'tool-use', 'responding'].includes(state.activity);
  const toolCategory = (state as State & { toolCategory?: 'shell' | 'code' | 'search' | null }).toolCategory;
  const toolContextMarker = state.activity === 'tool-use' ? ' data-tool-context' : '';
  const toolCategoryMarker = state.activity === 'tool-use' && ['shell', 'code', 'search'].includes(toolCategory ?? '') ? ` data-tool-category="${toolCategory}"` : '';
  const toolContext = state.activity === 'tool-use' ? `<span class="display-tool-context" role="img" aria-label="${toolCategory === 'shell' ? 'Shell tool' : toolCategory === 'code' ? 'Code tool' : toolCategory === 'search' ? 'Search tool' : 'Tool activity'}">${icon(toolCategory === 'shell' ? 'settings' : toolCategory === 'code' ? 'code' : toolCategory === 'search' ? 'search' : 'box', 24)}</span>` : '';
  const elapsed = active && state.turnStartedAt !== null ? `<time class="display-elapsed" data-turn-started-at="${state.turnStartedAt}">Active for ${Math.floor(Math.max(0, Date.now() - state.turnStartedAt) / 1000)} seconds</time>` : '';
  const progress = typeof state.progress === 'number' && Number.isFinite(state.progress) && state.progress >= 0 && state.progress <= 100 ? state.progress : null;
  const prefs = state.displayPreferences;
  const existing = `<div class="display display--${state.displayStyle}${connected ? '' : ' display--offline'} display-scale--${prefs.scale} display-intensity--${prefs.intensity} display-layout--${prefs.layout}${prefs.reducedMotion ? ' display-reduced-motion' : ''}" data-activity="${state.activity}" data-show-widgets="${prefs.showWidgets}"${toolContextMarker}${toolCategoryMarker}><header class="display-bar"><div class="display-brand"><span class="display-brand-mark">${icon('spark',19)}</span><span>Glimpse Dock</span></div><div class="display-meta"><span class="display-hint">${demoMode ? 'LOCAL DEMO • NOT CONNECTED TO HERMES' : 'LOCAL WORKSPACE'}</span>${prefs.showClock ? `<time class="display-clock">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>` : ''}<span class="display-pill" role="status" aria-live="polite">${connected ? 'Connected' : 'Connection lost · reconnecting'}</span></div></header><main class="display-stage"><div class="display-ambient" aria-hidden="true"><div class="display-halo"></div><div class="display-halo two"></div><div class="display-halo three"></div><div class="display-orb"></div></div>${toolContext}<div class="display-kicker">${phase}</div><h1>${mainTitle}</h1><p class="display-description">${escapeHTML(state.task)}</p>${elapsed}${progress === null ? '' : `<div class="display-progress" role="progressbar" aria-label="Task progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><div class="display-progress-note">${progress}% progress</div>`}</main><section class="display-widgets" aria-label="Agent slots"><div class="display-slot-region" data-placement="primary"></div><div class="display-slot-region" data-placement="secondary"></div><div class="display-slot-region" data-placement="notification"></div><p class="display-empty">No agent slots yet</p><p class="display-overflow" hidden></p></section><footer class="display-footer"><span>GLIMPSE DOCK · VISUAL DISPLAY</span><span>Press F11 for fullscreen &nbsp;·&nbsp; <a href="/admin">Admin view</a></span></footer></div>`;
  if (role !== 'owner') return existing;
  return `<div class="display display--${state.displayStyle} display-owner"><header class="display-bar"><div class="display-brand"><span class="display-brand-mark">${icon('spark',19)}</span><span>Glimpse Dock</span></div><span class="display-pill" role="status">Owner voice stage</span></header>${ownerAutoAccess ? '<aside class="owner-auto-access-warning display-owner-warning" role="alert"><strong>Same-device owner access is active</strong><span>Anyone with access to this device may be able to open the owner workspace.</span></aside>' : ''}<main class="voice-layout"><section class="voice-conversation"><p class="display-kicker">HERMES · PRIVATE SESSION</p><h1>Talk to Hermes</h1><p class="display-description">Your voice stays on this device until its text is sent to your private Hermes session.</p><p class="voice-status" data-voice-status role="status" aria-live="polite">Voice is off</p><div class="voice-transcript" data-transcript role="log" aria-label="Conversation" aria-live="polite"></div><div class="voice-controls"><button type="button" data-voice-enable>Enable voice</button><button type="button" data-voice-manual disabled>Talk</button><button type="button" data-voice-pause disabled>Pause listening</button><button type="button" data-voice-mute disabled>Mute</button><button type="button" data-voice-stop disabled>Stop</button></div><p class="voice-error" data-voice-error role="alert"></p><details class="voice-settings"><summary>Voice settings</summary><label>Wake phrase <select data-wake-name disabled></select></label><label>Local voice <select data-output-voice disabled></select></label><p data-voice-readiness role="status">Loading voice availability…</p><p>The Hermes connection can use the agent’s full tool access. Only enable voice on a device you trust.</p></details></section><aside class="voice-roster"><h2>Subagents</h2><p data-subagents>No active subagents</p></aside></main><section class="display-widgets" aria-label="Agent slots"><div class="display-slot-region" data-placement="primary"></div><div class="display-slot-region" data-placement="secondary"></div><div class="display-slot-region" data-placement="notification"></div><p class="display-empty" hidden>No agent slots yet</p><p class="display-overflow" hidden></p></section></div>`;
}

export function updateElapsedHint(root: Pick<HTMLElement, 'querySelector'>, now = Date.now()): void {
  const hint = root.querySelector<HTMLTimeElement>('time[data-turn-started-at]');
  if (!hint) return;
  const startedAt = Number(hint.dataset.turnStartedAt);
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) return;
  hint.textContent = `Active for ${Math.floor(Math.max(0, now - startedAt) / 1000)} seconds`;
}
