/** Synced preference for “record screen + microphone” across Manual Testing / TestingView. */
export const MANUAL_REC_MIC_KEY = 'manual-rec-mic';
export const MANUAL_REC_MIC_EVENT = 'qa:manual-rec-mic-changed';

export function getManualRecMicEnabled(): boolean {
  return localStorage.getItem(MANUAL_REC_MIC_KEY) === '1';
}

export function setManualRecMicEnabled(enabled: boolean): void {
  localStorage.setItem(MANUAL_REC_MIC_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new CustomEvent(MANUAL_REC_MIC_EVENT, { detail: { enabled } }));
}
