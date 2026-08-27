// Country calling codes + expected national-number digit length, used by the
// phone field's country-code selector (LeadFormRenderer, client-request forms
// only — see `enablePhoneCountryCode`). Mirrors crm-be
// utils/phoneCountries.js — keep the two in sync.
export interface PhoneCountry {
  iso: string;
  name: string;
  dial: string;
  digits: number | [number, number];
}

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { iso: 'US', name: 'United States', dial: '1', digits: 10 },
  { iso: 'CA', name: 'Canada', dial: '1', digits: 10 },
  { iso: 'PK', name: 'Pakistan', dial: '92', digits: 10 },
  { iso: 'GB', name: 'United Kingdom', dial: '44', digits: 10 },
  { iso: 'IN', name: 'India', dial: '91', digits: 10 },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', digits: 9 },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966', digits: 9 },
  { iso: 'AU', name: 'Australia', dial: '61', digits: 9 },
  { iso: 'DE', name: 'Germany', dial: '49', digits: [10, 11] },
  { iso: 'FR', name: 'France', dial: '33', digits: 9 },
  { iso: 'CN', name: 'China', dial: '86', digits: 11 },
  { iso: 'BD', name: 'Bangladesh', dial: '880', digits: 10 },
  { iso: 'LK', name: 'Sri Lanka', dial: '94', digits: 9 },
  { iso: 'NG', name: 'Nigeria', dial: '234', digits: 10 },
  { iso: 'ZA', name: 'South Africa', dial: '27', digits: 9 },
  { iso: 'BR', name: 'Brazil', dial: '55', digits: [10, 11] },
  { iso: 'JP', name: 'Japan', dial: '81', digits: 10 },
  { iso: 'SG', name: 'Singapore', dial: '65', digits: 8 },
  { iso: 'MY', name: 'Malaysia', dial: '60', digits: [9, 10] },
  { iso: 'PH', name: 'Philippines', dial: '63', digits: 10 },
  { iso: 'ID', name: 'Indonesia', dial: '62', digits: [9, 12] },
  { iso: 'TR', name: 'Turkey', dial: '90', digits: 10 },
  { iso: 'EG', name: 'Egypt', dial: '20', digits: 10 },
  { iso: 'QA', name: 'Qatar', dial: '974', digits: 8 },
  { iso: 'KW', name: 'Kuwait', dial: '965', digits: 8 },
  { iso: 'OM', name: 'Oman', dial: '968', digits: 8 },
  { iso: 'BH', name: 'Bahrain', dial: '973', digits: 8 },
  { iso: 'NZ', name: 'New Zealand', dial: '64', digits: [8, 9] },
  { iso: 'IE', name: 'Ireland', dial: '353', digits: 9 },
  { iso: 'IT', name: 'Italy', dial: '39', digits: [9, 10] },
  { iso: 'ES', name: 'Spain', dial: '34', digits: 9 },
  { iso: 'NL', name: 'Netherlands', dial: '31', digits: 9 },
  { iso: 'RU', name: 'Russia', dial: '7', digits: 10 },
  { iso: 'MX', name: 'Mexico', dial: '52', digits: 10 },
  { iso: 'KR', name: 'South Korea', dial: '82', digits: [9, 10] },
];

export function digitRange(c: PhoneCountry): [number, number] {
  return Array.isArray(c.digits) ? c.digits : [c.digits, c.digits];
}
