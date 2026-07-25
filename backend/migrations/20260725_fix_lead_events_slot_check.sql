-- Fix lead_events_slot_check constraint to allow Night, Afternoon, Full Day, and case-insensitive slot values
ALTER TABLE lead_events DROP CONSTRAINT IF EXISTS lead_events_slot_check;

ALTER TABLE lead_events ADD CONSTRAINT lead_events_slot_check 
  CHECK (slot IS NULL OR LOWER(slot) IN ('morning', 'day', 'afternoon', 'evening', 'night', 'full day', 'full_day'));
