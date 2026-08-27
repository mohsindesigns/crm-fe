// Shared between the form builder's live preview (LeadFormModal) and the
// actual public embed page (app/embed/form/[token]) — both render through
// LeadFormRenderer off this same type/defaults, so the preview you design
// against is exactly what a visitor sees, never an approximation of it.

export type BorderRadius = 'sharp' | 'rounded' | 'pill';

export interface LeadFormTheme {
  headline: string;
  description: string;
  buttonText: string;
  primaryColor: string;
  backgroundColor: string;
  showLogo: boolean;
  showName: boolean;
  showHeadline: boolean;
  borderRadius: BorderRadius;
}

export const RADIUS_PX: Record<BorderRadius, number> = {
  sharp: 4,
  rounded: 10,
  pill: 999,
};

export const BORDER_RADIUS_OPTIONS: { value: BorderRadius; label: string }[] = [
  { value: 'sharp', label: 'Sharp' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'pill', label: 'Pill' },
];

export const DEFAULT_THEME: LeadFormTheme = {
  headline: '',
  description: '',
  buttonText: 'Submit',
  primaryColor: '#0B1D5E',
  backgroundColor: '#FFFFFF',
  showLogo: true,
  showName: true,
  showHeadline: true,
  borderRadius: 'rounded',
};
