// gffc-app/index.html's admin Applications panel (Index.html ~4180-4600)
// was built entirely around the literal sheet-header-string keys
// Code.gs's getAllApplications returned (e.g. row['Review Status'],
// row['Government Valid ID (Link)']), and does `<a href="${val}">` directly
// on the link columns. Rather than rewrite that rendering code, this shim
// reshapes a Postgres `applicants` row (plus resolved usernames and signed
// Storage URLs) back into that exact shape, so the existing UI works
// unchanged — same pattern used throughout this migration (keep Index.html
// as-is, adapt the data underneath it).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { DOCUMENTS_BUCKET } from './storage.ts';

const SIGNED_URL_TTL_SECONDS = 3600;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApplicantRow = Record<string, any>;

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  // en-CA gives "YYYY-MM-DD, HH:mm:ss" in the requested timezone.
  const parts = d.toLocaleString('en-CA', { timeZone: 'Asia/Manila', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return parts.replace(',', '');
}

async function resolveUsernames(supabaseAdmin: SupabaseClient, rows: ApplicantRow[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const field of ['reviewed_by', 'approved_by', 'result_approved_by']) {
      if (row[field]) ids.add(row[field]);
    }
  }
  if (ids.size === 0) return new Map();
  const { data } = await supabaseAdmin.from('users').select('id, username').in('id', Array.from(ids));
  return new Map((data ?? []).map((u: { id: string; username: string }) => [u.id, u.username]));
}

async function resolveSignedUrls(supabaseAdmin: SupabaseClient, rows: ApplicantRow[]): Promise<Map<string, string>> {
  const paths = new Set<string>();
  const fields = ['applicant_photo_url', 'valid_id_url', 'psa_url', 'barangay_clearance_url', 'drug_test_url'];
  for (const row of rows) {
    for (const field of fields) {
      if (row[field]) paths.add(row[field]);
    }
  }
  if (paths.size === 0) return new Map();
  const { data } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).createSignedUrls(Array.from(paths), SIGNED_URL_TTL_SECONDS);
  const map = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) map.set(item.path, item.signedUrl);
  }
  return map;
}

// Batch version — resolves usernames and signs Storage URLs once for the
// whole list, then maps every row. Use for getAllApplications-style bulk
// endpoints; for a single row, the maps just end up with 0-5 entries.
export async function toLegacyApplicantShapeBatch(supabaseAdmin: SupabaseClient, rows: ApplicantRow[]): Promise<Record<string, unknown>[]> {
  const [usernames, signedUrls] = await Promise.all([resolveUsernames(supabaseAdmin, rows), resolveSignedUrls(supabaseAdmin, rows)]);
  const urlOrEmpty = (path: string | null) => (path ? signedUrls.get(path) ?? '' : '');
  const usernameOrEmpty = (id: string | null) => (id ? usernames.get(id) ?? '' : '');

  return rows.map((row) => ({
    'Application ID': row.id,
    'Reference Number': row.reference_number,
    Timestamp: formatDateTime(row.submitted_at),
    'Last Name': row.last_name,
    'First Name': row.first_name,
    'Middle Name': row.middle_name || '',
    Gender: row.gender,
    Birthday: row.birthday,
    Age: row.age ?? '',
    Province: row.province,
    'Municipality/City': row.municipality,
    Barangay: row.barangay,
    'Street/Purok': row.street_purok,
    'Mobile Number': row.mobile_number,
    'Email Address': row.email,
    'Emergency Contact Person': row.emergency_contact_person,
    'Emergency Contact Relationship': row.emergency_contact_relationship,
    'Emergency Contact Number': row.emergency_contact_number,
    'Educational Attainment': row.educational_attainment,
    'School Name': row.school_name,
    'School Year Graduated': row.school_year_graduated,
    'Strand (Senior High)': row.strand || '',
    'Course (College)': row.course || '',
    'Applicant Photo (Link)': urlOrEmpty(row.applicant_photo_url),
    'Face Descriptor (JSON)': row.face_descriptor ? JSON.stringify(row.face_descriptor) : '',
    'Government Valid ID (Link)': urlOrEmpty(row.valid_id_url),
    'PSA Birth Certificate (Link)': urlOrEmpty(row.psa_url),
    'Barangay Clearance (Link)': urlOrEmpty(row.barangay_clearance_url),
    'Drug Test Result (Link)': urlOrEmpty(row.drug_test_url),
    'Drug Test Date': row.drug_test_date || '',
    'Current Work Status': row.current_work_status,
    'Current Work Details': row.current_work_details || '',
    'Previous Work Experience': row.previous_work || '',
    'Referred By': row.referred_by || '',
    'How Did You Learn About the Training Center': row.hear_about_source,
    'Purpose of Enrolling': row.purpose_of_enrolling,
    'Other TESDA Courses Attended': row.other_tesda_courses || '',
    'Batch Number': row.batch_number || '',
    'Review Status': row.review_status,
    'Reviewed By': usernameOrEmpty(row.reviewed_by),
    'Reviewed At': formatDateTime(row.reviewed_at),
    'Approval Status': row.approval_status,
    'Approved By': usernameOrEmpty(row.approved_by),
    'Approved At': formatDateTime(row.approved_at),
    'Training Result': row.training_result,
    'Result Approval Status': row.result_approval_status,
    'Result Approved By': usernameOrEmpty(row.result_approved_by),
    'Result Approved At': formatDateTime(row.result_approved_at),
    'Student ID Number': row.student_id_number || '',
    'Student Username': row.student_id_number ? row.student_id_number.toLowerCase() : '',
    'Student Account Created At': formatDateTime(row.student_account_created_at),
    'Photo Reprocessed At': formatDateTime(row.photo_reprocessed_at),
    'PSA Status': row.psa_status || '',
    'Drug Test Status': row.drug_test_status || '',
    'Agreement Accepted': row.agreement_accepted ? 'Yes' : 'No',
    'Agreement Accepted At': formatDateTime(row.agreement_accepted_at),
  }));
}
