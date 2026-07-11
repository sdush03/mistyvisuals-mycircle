-- Add Facebook Ads lead quality and spam fields
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fb_lead_quality VARCHAR(20) DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fb_is_spam BOOLEAN DEFAULT false;

-- Index for fast filtering on FB Ads page
CREATE INDEX IF NOT EXISTS idx_leads_source_fb ON leads (source) WHERE source = 'FB Ads';
CREATE INDEX IF NOT EXISTS idx_leads_fb_quality ON leads (fb_lead_quality) WHERE fb_lead_quality IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_fb_spam ON leads (fb_is_spam) WHERE fb_is_spam = true;
