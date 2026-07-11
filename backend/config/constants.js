const path = require('path')
const LEAD_STATUSES = [
  'New',
  'Contacted',
  'Quoted',
  'Follow Up',
  'Negotiation',
  'Awaiting Advance',
  'Converted',
  'Lost',
  'Rejected',
]
const COVERAGE_SCOPES = ['Both Sides', 'Bride Side', 'Groom Side']

const FOLLOWUP_TYPES = ['call', 'whatsapp', 'email', 'in-person', 'other', 'meeting']
const HEAT_VALUES = ['Hot', 'Warm', 'Cold']
const UPLOADS_DIR = path.join(__dirname, '../uploads')
const PHOTO_UPLOAD_DIR = path.join(UPLOADS_DIR, 'photos')
module.exports = {
  LEAD_STATUSES,
  COVERAGE_SCOPES,
  FOLLOWUP_TYPES,
  HEAT_VALUES,
  UPLOADS_DIR,
  PHOTO_UPLOAD_DIR,
}
