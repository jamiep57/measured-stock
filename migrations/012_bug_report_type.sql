-- =====================================================================
-- 012 — Bug report type (bug vs feature request)
-- =====================================================================
-- Background:
--   The v2 app (v2.html → Bug & Feature Reports) lets users log both
--   bugs and feature requests against the relational bug_reports table.
--   The table already carried status / severity / area but had no way to
--   distinguish a bug from a feature request, so we add a `type` column.
--
--   Defaults to 'bug' so existing rows and any client that omits the
--   field keep working.
--
-- Safe to re-run (additive, IF NOT EXISTS).
-- =====================================================================

ALTER TABLE public.bug_reports
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'bug'
  CHECK (type IN ('bug', 'feature'));

COMMENT ON COLUMN public.bug_reports.type IS
  'Report kind: ''bug'' (something broken) or ''feature'' (a requested enhancement). Defaults to ''bug''.';
