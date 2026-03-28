-- Migration 004: Allow UPDATE on eod_reports and till_reconciliation
-- Needed for the resubmit feature which uses upsert (INSERT ... ON CONFLICT UPDATE)
-- Without UPDATE permission the upsert fails with an RLS violation on resubmit.

-- Allow any authenticated user to update eod_reports (e.g. resubmit overwrites the day's report)
CREATE POLICY "All authenticated can update eod_reports"
  ON eod_reports FOR UPDATE TO authenticated USING (true);

-- Allow any authenticated user to update till_reconciliation (resubmit overwrites the day's record)
CREATE POLICY "All authenticated can update till reconciliation"
  ON till_reconciliation FOR UPDATE TO authenticated USING (true);
