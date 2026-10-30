import { escapeHTML } from '../shared/render-helpers';

type Feedback = { error?: string; status?: string; pending?: boolean };
type OwnerOptions = Feedback & { mode: 'setup' | 'login' };

const feedback = ({ error, status, pending }: Feedback) => `<p class="auth-feedback ${error ? 'is-error' : ''}" role="${error ? 'alert' : 'status'}" aria-live="${error ? 'assertive' : 'polite'}">${escapeHTML(error || status || (pending ? 'Please wait…' : ''))}</p>`;

export function renderOwnerGate(options: OwnerOptions): string {
  const setup = options.mode === 'setup';
  return `<main class="auth-gate"><section class="auth-card" aria-labelledby="auth-title"><div class="auth-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="auth-eyebrow">GLIMPSE DOCK · OWNER ACCESS</div><h1 id="auth-title">${setup ? 'Make this space yours.' : 'Welcome back.'}</h1><p class="auth-intro">${setup ? 'Create the owner password for this local workspace.' : 'Sign in to manage your workspace.'}</p>${feedback(options)}<form class="auth-form" data-auth-form="owner" data-mode="${setup ? 'setup' : 'login'}">${setup ? '<label for="bootstrap-secret">Bootstrap secret</label><input id="bootstrap-secret" name="secret" type="password" autocomplete="off" required>' : ''}<label for="owner-password">${setup ? 'New password' : 'Password'}</label><input id="owner-password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 12 : 1}" maxlength="128" required><button class="auth-submit" type="submit" ${options.pending ? 'disabled' : ''}>${options.pending ? 'Working…' : setup ? 'Set owner password' : 'Sign in'}</button></form><button class="auth-switch" type="button" data-auth-mode="${setup ? 'login' : 'setup'}">${setup ? 'Already set up? Sign in' : 'First time here? Set up owner access'}</button><p class="auth-footnote">Your workspace stays on this device.</p></section></main>`;
}

export function renderDisplayGate(options: Feedback = {}): string {
  return `<main class="auth-gate display-auth"><section class="auth-card" aria-labelledby="display-auth-title"><div class="auth-eyebrow">GLIMPSE DOCK · VISUAL DISPLAY</div><h1 id="display-auth-title">Connect this display.</h1><p class="auth-intro">Enter the pairing code from your owner workspace to link this screen.</p>${feedback(options)}<form class="auth-form" data-auth-form="display"><label for="pairing-code">Pairing code</label><input id="pairing-code" name="code" type="text" inputmode="text" autocomplete="one-time-code" required><button class="auth-submit" type="submit" ${options.pending ? 'disabled' : ''}>${options.pending ? 'Connecting…' : 'Connect display'}</button></form><p class="auth-footnote">Pairing codes are created in the owner workspace.</p></section></main>`;
}
