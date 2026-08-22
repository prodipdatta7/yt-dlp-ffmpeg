import { signal } from '@preact/signals'
import type { AnalyzeResult, MfErrorCode } from '../../../shared/models'

export const analyzing = signal(false)
export const analysis = signal<AnalyzeResult | null>(null)
export const analyzeError = signal<{ code: MfErrorCode; message: string } | null>(null)

export function resetAnalysis(): void {
  analysis.value = null
  analyzeError.value = null
}
