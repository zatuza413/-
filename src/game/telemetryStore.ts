import { Telemetry, type StorageLike } from '../core/Telemetry';

function safeStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** ゲーム全体で1つの計測 */
export const telemetry = new Telemetry({ storage: safeStorage() });

/** 計測データを JSON で書き出す（ダウンロード＋クリップボード）。どちらか成功したら true */
export async function exportTelemetry(): Promise<string> {
  const json = telemetry.exportJson();
  const results: string[] = [];
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sousai-telemetry-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    results.push('ダウンロード');
  } catch {
    /* ダウンロードできない環境 */
  }
  try {
    await navigator.clipboard.writeText(json);
    results.push('クリップボードにコピー');
  } catch {
    /* クリップボードが使えない環境 */
  }
  (window as unknown as { __telemetryJson: string }).__telemetryJson = json;
  return results.length > 0 ? results.join('・') : '書き出せませんでした（コンソールの __telemetryJson にあります）';
}
