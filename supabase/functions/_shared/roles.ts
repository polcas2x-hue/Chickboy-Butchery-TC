// Port of Code.gs's role-check helpers (Code.gs:887-896).
export function isAdmin1(role: string): boolean {
  return role === 'Super Admin';
}
export function canReviewApplications(role: string): boolean {
  return isAdmin1(role) || role === 'Staff';
}
export function canApproveApplications(role: string): boolean {
  return isAdmin1(role) || role === 'Admin';
}
export function canSubmitTrainingResults(role: string): boolean {
  return isAdmin1(role) || role === 'Staff';
}
export function canApproveTrainingResults(role: string): boolean {
  return isAdmin1(role) || role === 'Admin';
}
export function canViewApplicantRecords(role: string): boolean {
  return isAdmin1(role) || role === 'Admin' || role === 'Staff' || role === 'Instructor';
}

export function canSubmitSchedule(role: string): boolean {
  return isAdmin1(role) || role === 'Admin' || role === 'Staff' || role === 'Instructor';
}
export function canApproveSchedule(role: string): boolean {
  return isAdmin1(role) || role === 'Admin';
}
export function canDeleteSchedule(role: string): boolean {
  return isAdmin1(role);
}
export function canManageSchedulePricing(role: string): boolean {
  return isAdmin1(role) || role === 'Admin';
}

export const VALID_ROLES = ['Super Admin', 'Admin', 'Instructor', 'Staff', 'Kiosk', 'Trainees'];
