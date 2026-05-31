-- Add user-editable tags to features (mirrors modules.tags / test_definitions.tags)
ALTER TABLE "features" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Optional saved filter spec for scheduled reports (tags/epics/status/search/date range)
ALTER TABLE "phase_report_schedules" ADD COLUMN "appliedFilters" JSONB;
