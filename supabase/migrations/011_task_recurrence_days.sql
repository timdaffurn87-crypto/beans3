-- 011_task_recurrence_days.sql
--
-- Adds a recurrence_days column to task_templates so weekly tasks can be
-- scheduled by day of week without parsing the description string.
--
-- recurrence_days: text[] of day names, e.g. ARRAY['Monday'] or ARRAY['Sunday','Wednesday']
-- NULL means the template uses is_active for its schedule (daily when is_active = true).

alter table task_templates
  add column if not exists recurrence_days text[] default null;

-- Backfill from existing "· Weekly: DayName" / "· Weekly: Day & Day" descriptions.
-- Splits on " & " to handle multi-day entries like "Sunday & Wednesday".
update task_templates
set recurrence_days = (
  select array_agg(trim(d))
  from unnest(
    string_to_array(
      -- extract the part after "Weekly: "
      substring(description from 'Weekly:\s*(.+)$'),
      ' & '
    )
  ) as d
)
where description like '%Weekly:%'
  and recurrence_days is null;
