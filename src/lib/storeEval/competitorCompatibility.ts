import type { Competitor } from "./types";

/** Read compatibility for documents saved before the surveyState rename. */
export function migrateCompetitorInvestigationStatus(data: Record<string, unknown>): Competitor {
  if (data.investigationStatus == null && data.surveyState != null) {
    return { ...data, investigationStatus: data.surveyState } as Competitor;
  }
  return data as Competitor;
}
