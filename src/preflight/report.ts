/** Human-readable report; also the text handed to Claude Code for the fix loop. */
import { HONESTY_LINE, STEP_NAME, STEP_ORDER, STEP_STATUS_LABEL, type PreflightReport } from './types';

export function renderMarkdown(report: PreflightReport): string {
  const steps = STEP_ORDER.map((id) => report.steps.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => s !== undefined);
  const lines: string[] = [];
  lines.push('# Yayın öncesi denetim', '');
  lines.push(`Sonuç: **${report.verdict === 'green' ? 'YEŞİL' : 'KIRMIZI'}** · ${report.finishedAt} · proje: ${report.project || '(çalışma klasörü kökü)'}`, '');
  lines.push('| Adım | Durum | Özet |', '|---|---|---|');
  for (const s of steps) lines.push(`| ${STEP_NAME[s.id]} | ${STEP_STATUS_LABEL[s.status]} | ${s.summary.replace(/\|/g, '\\|')} |`);
  lines.push('');
  for (const s of steps) {
    if (s.details.length === 0) continue;
    lines.push(`## ${STEP_NAME[s.id]}`, '');
    for (const d of s.details) lines.push(`- ${d}`);
    lines.push('');
  }
  lines.push(`> ${HONESTY_LINE}`, '');
  lines.push('## Claude Code için', '');
  lines.push('Kırmızı adımları düzelt, sonra denetimi yeniden çalıştır. Önce derleme hatalarını, sonra manifest/simge eksiklerini, en son politika uyarılarını ele al. Testleri atlama veya devre dışı bırakma.', '');
  lines.push(`Parmak izi: \`${report.fingerprint}\``);
  return lines.join('\n') + '\n';
}
