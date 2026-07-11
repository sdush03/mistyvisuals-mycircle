-- Add PER_EVENT to unit_type enum if it doesn't already exist
ALTER TYPE unit_type ADD VALUE IF NOT EXISTS 'PER_EVENT';
