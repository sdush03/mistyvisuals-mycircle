module.exports = function installFormattingHelpers(opts) {
  const { fs, path } = opts;

  const toISTDateString = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  };

  function boolToYesNo(value) {
    return value === true ? 'Yes' : 'No';
  }

  function yesNoToBool(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value;
    const v = String(value).trim().toLowerCase();
    if (v === 'yes' || v === 'true') return true;
    if (v === 'no' || v === 'false') return false;
    return null;
  }

  function ensureDirectory(dirPath) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch (err) {
      console.warn('Failed to ensure upload directory:', err?.message || err);
    }
  }

  function sanitizeTags(input) {
    if (!Array.isArray(input)) return [];
    const clean = input
      .map(tag => String(tag || '').trim())
      .filter(Boolean);
    return Array.from(new Set(clean));
  }

  function getImageContentType(filename) {
    const ext = path.extname(filename || '').toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    return 'application/octet-stream';
  }

  function startOfDay(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function dateToYMD(d) {
    return toISTDateString(d);
  }

  function addDaysYMD(days, base = new Date()) {
    const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    return dateToYMD(next);
  }

  function normalizeYMD(value) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const parsed = new Date(`${trimmed}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    return trimmed;
  }

  function addDaysToYMD(ymd, days) {
    const base = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(base.getTime())) return null;
    base.setDate(base.getDate() + days);
    return dateToYMD(base);
  }

  function normalizeDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    const str = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return str.slice(0, 10);
  }

  function formatRefDate(value) {
    if (!value) return '';
    return String(value).replace(/-/g, '').slice(0, 8);
  }

  function getFirstName(value) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    return trimmed.split(/\s+/)[0] || null;
  }

  function normalizeNickname(value) {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const capped = trimmed.length > 50 ? trimmed.slice(0, 50) : trimmed;
    return `${capped.charAt(0).toUpperCase()}${capped.slice(1)}`;
  }

  function getUserDisplayName(user) {
    if (!user) return null;
    const nickname = normalizeNickname(user.nickname);
    if (nickname) return nickname;
    const firstName = getFirstName(user.first_name || user.name);
    if (firstName) return firstName;
    if (user.name && String(user.name).trim()) return String(user.name).trim();
    return null;
  }

  function getDateRange(query) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  function normalizePhone(raw) {
    if (!raw) return null;
    let p = raw.trim();
    if (p.startsWith('+')) return p;
    return `+91${p}`;
  }

  function canonicalizePhone(raw) {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return null;
    const value = hasPlus ? `+${digits}` : digits;
    return normalizePhone(value);
  }

  function formatName(value) {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    return trimmed
      .split(/\s+/)
      .map(part =>
        part
          ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
          : ''
      )
      .join(' ');
  }

  const EMAIL_TYPO_MAP = {
    'gmial.com': 'gmail.com',
    'gmal.com': 'gmail.com',
    'gmail.con': 'gmail.com',
    'hotmial.com': 'hotmail.com',
    'yaho.com': 'yahoo.com',
    'outlook.con': 'outlook.com',
  };

  const ALLOWED_EMAIL_TLDS = new Set([
    'com', 'in', 'co', 'org', 'net', 'edu', 'gov',
  ]);

  const ALLOWED_COMPOUND_TLDS = new Set([
    'co.in', 'org.in',
  ]);

  const COMMON_EMAIL_DOMAINS = new Set([
    'gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'icloud.com',
    'live.com', 'msn.com', 'protonmail.com', 'zoho.com', 'ymail.com', 'rediffmail.com',
  ]);

  function normalizeEmailInput(value) {
    if (!value) return '';
    let email = String(value).trim().toLowerCase();
    if (!email) return '';
    email = email.replace(/^https?:\/\//i, '');
    email = email.replace(/^mailto:/i, '');
    email = email.replace(/\s+/g, '');

    const parts = email.split('@');
    if (parts.length === 2) {
      let [local, domain] = parts;
      if (EMAIL_TYPO_MAP[domain]) {
        domain = EMAIL_TYPO_MAP[domain];
      }
      email = `${local}@${domain}`;
    }
    return email;
  }

  function validateEmail(value) {
    if (!value) return { valid: true, normalized: '' };
    const normalized = normalizeEmailInput(value);
    if (!normalized) return { valid: true, normalized: '' };

    const parts = normalized.split('@');
    if (parts.length !== 2) return { valid: false, normalized };
    const [local, domain] = parts;
    if (!local || !domain) return { valid: false, normalized };

    if (!/^[a-z0-9._%+-]+$/.test(local)) return { valid: false, normalized };
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return { valid: false, normalized };

    if (!/^[a-z0-9.-]+$/.test(domain)) return { valid: false, normalized };
    if (!domain.includes('.')) return { valid: false, normalized };
    if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return { valid: false, normalized };

    const labels = domain.split('.');
    if (labels.some(l => !l || l.length > 63)) return { valid: false, normalized };
    if (labels.some(l => l.startsWith('-') || l.endsWith('-'))) return { valid: false, normalized };

    const lowerDomain = domain.toLowerCase();
    let sld = '';
    if (ALLOWED_COMPOUND_TLDS.has(labels.slice(-2).join('.'))) {
      sld = labels[labels.length - 3] || '';
    } else {
      const tld = labels[labels.length - 1];
      if (!ALLOWED_EMAIL_TLDS.has(tld)) return { valid: false, normalized };
      sld = labels[labels.length - 2] || '';
    }

    if (!sld) return { valid: false, normalized };
    if (sld.length >= 5 && !/[aeiouy]/i.test(sld) && !COMMON_EMAIL_DOMAINS.has(lowerDomain)) {
      return { valid: false, normalized };
    }

    return { valid: true, normalized };
  }

  function isValidInstagramUsername(value) {
    if (!value) return false;
    const username = String(value).trim();
    if (!username) return false;
    if (/^https?:/i.test(username)) return false;
    if (/instagram\.com/i.test(username)) return false;
    if (username.includes('/') || username.includes('@')) return false;
    const normalized = username.toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(normalized)) return false;
    return true;
  }

  function normalizeInstagramUrl(value) {
    if (!value) return null;
    const username = String(value).trim().toLowerCase();
    if (!isValidInstagramUsername(username)) return null;
    return `https://instagram.com/${username}`;
  }

  function canonicalizeEmail(value) {
    if (!value) return null;
    const normalized = normalizeEmailInput(value);
    if (!normalized) return null;
    return normalized;
  }

  function parseDataUrl(dataUrl) {
    const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl || '');
    if (!match) return null;
    const mime = match[1].toLowerCase().replace('jpg', 'jpeg');
    const base64 = match[2];
    return { mime, base64 };
  }

  return {
    toISTDateString,
    boolToYesNo,
    yesNoToBool,
    ensureDirectory,
    sanitizeTags,
    getImageContentType,
    startOfDay,
    dateToYMD,
    addDaysYMD,
    normalizeYMD,
    addDaysToYMD,
    normalizeDateValue,
    formatRefDate,
    getFirstName,
    normalizeNickname,
    getUserDisplayName,
    getDateRange,
    normalizePhone,
    canonicalizePhone,
    formatName,
    EMAIL_TYPO_MAP,
    ALLOWED_EMAIL_TLDS,
    ALLOWED_COMPOUND_TLDS,
    COMMON_EMAIL_DOMAINS,
    normalizeEmailInput,
    validateEmail,
    isValidInstagramUsername,
    normalizeInstagramUrl,
    canonicalizeEmail,
    parseDataUrl,
  };
};
