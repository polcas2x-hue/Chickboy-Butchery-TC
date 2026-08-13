// Port of Code.gs's submitApplication (Code.gs:1382) + validateFormData_
// (1856) + findDuplicateApplication_ (1813) + generateReferenceNumber_
// (1559) + sendApplicationReceiptEmail_ (1653). Public endpoint — token is
// optional; a logged-in Staff/Super Admin submitting on someone's behalf
// auto-marks the row 'Accepted' instead of 'Pending Review'.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { getSessionOrNull } from '../_shared/session.ts';
import { canReviewApplications } from '../_shared/roles.ts';
import { uploadBase64File, estimateBase64Bytes, MAX_IMAGE_BYTES } from '../_shared/storage.ts';
import { sendEmail } from '../_shared/email.ts';

interface FormData {
  lastName?: string; firstName?: string; middleName?: string;
  gender?: string; birthday?: string; age?: number | string;
  province?: string; provinceOther?: string; municipality?: string; barangay?: string; streetPurok?: string;
  mobileNumber?: string; email?: string;
  emergencyContactPerson?: string; emergencyRelationship?: string; emergencyContactNumber?: string;
  education?: string; schoolName?: string; schoolYear?: string; strand?: string; course?: string;
  applicantPhoto?: string; applicantFaceDescriptor?: number[];
  validId?: string; psaDocument?: string; barangayClearance?: string; drugTestResult?: string;
  drugTestDate?: string;
  currentWorkStatus?: string; currentWorkDetails?: string; previousWork?: string;
  referredBy?: string; hearAboutSource?: string; hearAboutOther?: string; purpose?: string;
  otherTesdaCourses?: Array<{ course?: string; year?: string }>;
  psaWillFollow?: boolean; drugTestWillFollow?: boolean;
  agreementAccepted?: boolean;
}

function isDrugTestDateValid(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setHours(0, 0, 0, 0);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return d.getTime() <= today.getTime() && d.getTime() >= sixMonthsAgo.getTime();
}

function validateFormData(formData: FormData): { valid: boolean; message?: string } {
  const required: Record<string, string> = {
    lastName: 'Last Name', firstName: 'First Name', gender: 'Gender', birthday: 'Birthday',
    province: 'Province', municipality: 'Municipality/City', barangay: 'Barangay', streetPurok: 'Street/Purok',
    mobileNumber: 'Mobile Number', email: 'Email Address',
    emergencyContactPerson: 'Contact Person (In Case of Emergency)', emergencyRelationship: 'Relationship',
    emergencyContactNumber: 'Emergency Contact Number',
    education: 'Educational Attainment', schoolName: 'School Name', schoolYear: 'School Year Graduated',
    currentWorkStatus: 'Current Work status', hearAboutSource: 'How did you learn about the training center',
    purpose: 'Purpose of Enrolling',
  };
  for (const key of Object.keys(required)) {
    const value = (formData as Record<string, unknown>)[key];
    if (!value || String(value).trim() === '') {
      return { valid: false, message: `Missing required field: ${required[key]}` };
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(formData.email).trim())) {
    return { valid: false, message: 'Please enter a valid email address.' };
  }

  const digitsOnlyMobile = String(formData.mobileNumber).replace(/\D/g, '');
  if (digitsOnlyMobile.length < 7 || digitsOnlyMobile.length > 15) {
    return { valid: false, message: 'Please enter a valid mobile number.' };
  }

  const digitsOnlyEmergency = String(formData.emergencyContactNumber).replace(/\D/g, '');
  if (digitsOnlyEmergency.length < 7 || digitsOnlyEmergency.length > 15) {
    return { valid: false, message: 'Please enter a valid emergency contact number.' };
  }

  const psaDeferred = !!formData.psaWillFollow;
  const drugTestDeferred = !!formData.drugTestWillFollow;

  if (!drugTestDeferred) {
    if (!formData.drugTestDate || String(formData.drugTestDate).trim() === '') {
      return { valid: false, message: 'Missing required field: Date of Drug Test' };
    }
    if (!isDrugTestDateValid(formData.drugTestDate)) {
      return { valid: false, message: 'Drug Test Result must be dated within the last 6 months (and not a future date).' };
    }
  }

  if (formData.province === 'Others' && !formData.provinceOther?.trim()) {
    return { valid: false, message: 'Please specify the province.' };
  }
  if (formData.education === 'Senior High School' && !formData.strand?.trim()) {
    return { valid: false, message: 'Please indicate the Senior High School strand.' };
  }
  if (formData.education === 'College' && !formData.course?.trim()) {
    return { valid: false, message: 'Please indicate the College course.' };
  }
  if (formData.currentWorkStatus === 'Currently Working' && !formData.currentWorkDetails?.trim()) {
    return { valid: false, message: 'Please indicate your current work.' };
  }
  if (formData.hearAboutSource === 'Other' && !formData.hearAboutOther?.trim()) {
    return { valid: false, message: 'Please specify how you learned about the training center.' };
  }

  const requiredDocs: Record<string, string> = { applicantPhoto: 'Applicant Photo (live camera capture)', validId: 'Government Valid ID', barangayClearance: 'Barangay Clearance' };
  if (!psaDeferred) requiredDocs.psaDocument = 'PSA Birth Certificate';
  if (!drugTestDeferred) requiredDocs.drugTestResult = 'Drug Test Result';
  for (const [docKey, label] of Object.entries(requiredDocs)) {
    const value = (formData as Record<string, unknown>)[docKey];
    if (!value) return { valid: false, message: `Please upload: ${label}.` };
    if (estimateBase64Bytes(value as string) > MAX_IMAGE_BYTES) {
      return { valid: false, message: `The uploaded ${label} file is too large. Please use a smaller image.` };
    }
  }

  const optionalDocs: Array<[string, string]> = [];
  if (psaDeferred && formData.psaDocument) optionalDocs.push(['psaDocument', 'PSA Birth Certificate']);
  if (drugTestDeferred && formData.drugTestResult) optionalDocs.push(['drugTestResult', 'Drug Test Result']);
  for (const [docKey, label] of optionalDocs) {
    if (estimateBase64Bytes((formData as Record<string, unknown>)[docKey] as string) > MAX_IMAGE_BYTES) {
      return { valid: false, message: `The uploaded ${label} file is too large. Please use a smaller image.` };
    }
  }

  if (!formData.agreementAccepted) {
    return { valid: false, message: 'You must agree to the Trainee Training Agreement and Undertaking before submitting your application.' };
  }

  return { valid: true };
}

function formatProvince(formData: FormData): string {
  if (formData.province === 'Others' && formData.provinceOther) return `Others: ${formData.provinceOther.trim()}`;
  return formData.province || '';
}
function formatHearAbout(formData: FormData): string {
  if (formData.hearAboutSource === 'Other' && formData.hearAboutOther) return `Other: ${formData.hearAboutOther.trim()}`;
  return formData.hearAboutSource || '';
}
function formatOtherCourses(list: FormData['otherTesdaCourses']): string {
  if (!list?.length) return '';
  const parts: string[] = [];
  for (const entry of list) {
    if (!entry) continue;
    const course = String(entry.course || '').trim();
    const year = String(entry.year || '').trim();
    if (!course && !year) continue;
    parts.push(course + (year ? ` (${year})` : ''));
  }
  return parts.join('; ');
}
function formatFaceDescriptor(descriptor: unknown): unknown {
  if (!Array.isArray(descriptor) || descriptor.length < 64 || descriptor.length > 256) return null;
  if (!descriptor.every((n) => typeof n === 'number' && !Number.isNaN(n))) return null;
  return descriptor;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

async function findDuplicateApplication(
  supabaseAdmin: ReturnType<typeof createClient>,
  formData: FormData
): Promise<{ referenceNumber: string; reviewStatus: string; matchedOn: string } | null> {
  const { data: rows } = await supabaseAdmin
    .from('applicants')
    .select('reference_number, review_status, email, mobile_number, last_name, first_name, birthday')
    .neq('review_status', 'Rejected');

  const newEmail = normalizeText(formData.email);
  const newMobile = normalizeDigits(formData.mobileNumber);
  const newLast = normalizeText(formData.lastName);
  const newFirst = normalizeText(formData.firstName);
  const newBirthday = String(formData.birthday || '').trim();

  for (const row of rows ?? []) {
    const emailMatch = !!newEmail && newEmail === normalizeText(row.email);
    const mobileMatch = !!newMobile && newMobile.length >= 7 && newMobile === normalizeDigits(row.mobile_number);
    const nameDobMatch = !!newLast && !!newFirst && !!newBirthday && newLast === normalizeText(row.last_name) && newFirst === normalizeText(row.first_name) && newBirthday === String(row.birthday || '').trim();
    if (emailMatch || mobileMatch || nameDobMatch) {
      return { referenceNumber: row.reference_number, reviewStatus: row.review_status, matchedOn: emailMatch ? 'email address' : mobileMatch ? 'mobile number' : 'name and birthday' };
    }
  }
  return null;
}

function buildReceiptEmail(formData: FormData, referenceNumber: string): { subject: string; html: string; text: string } {
  const fullName = [formData.lastName, formData.firstName, formData.middleName].filter(Boolean).join(', ');
  const subject = `Chickboy Butchery Training Center — Application Received (${referenceNumber})`;
  const text =
    `Reference Number: ${referenceNumber}\n` +
    `Applicant: ${fullName}\n\n` +
    `Your application is now under review. You will receive an email within 3 days. ` +
    `If accepted, that email will also contain your Digital Student ID and login details.`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;">` +
    `<h2>Chickboy Butchery Training Center</h2>` +
    `<p>Dear ${fullName},</p>` +
    `<p>Thank you for applying. Your reference number is <strong>${referenceNumber}</strong>.</p>` +
    `<p>Your application is now under review. You will receive an email within 3 days. If accepted, that email will also contain your Digital Student ID and login details.</p>` +
    `</div>`;
  return { subject, html, text };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  let body: { token?: string | null; formData?: FormData };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid request.' }, 400);
  }

  const formData = body.formData;
  if (!formData || typeof formData !== 'object') {
    return jsonResponse({ success: false, message: 'No form data received.' });
  }

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const session = await getSessionOrNull(supabaseAdmin, body.token);
  const staffSubmission = !!session && canReviewApplications(session.role);

  const validation = validateFormData(formData);
  if (!validation.valid) {
    return jsonResponse({ success: false, message: validation.message });
  }

  const duplicate = await findDuplicateApplication(supabaseAdmin, formData);
  if (duplicate) {
    return jsonResponse({
      success: false,
      message: `An application already exists for this applicant (matched by ${duplicate.matchedOn}). Reference Number: ${duplicate.referenceNumber}, Status: ${duplicate.reviewStatus}. Please contact Chickboy Butchery Training Center if you need to update your existing application.`,
    });
  }

  const applicationId = crypto.randomUUID();
  const now = new Date();

  const docs: Array<[keyof FormData, string]> = [
    ['applicantPhoto', 'photo'],
    ['validId', 'valid-id'],
    ['psaDocument', 'psa'],
    ['barangayClearance', 'barangay-clearance'],
    ['drugTestResult', 'drug-test'],
  ];
  const urls: Record<string, string | null> = {};
  try {
    for (const [field, tag] of docs) {
      const value = formData[field] as string | undefined;
      urls[field] = value ? await uploadBase64File(supabaseAdmin, value, `${applicationId}/${tag}`) : null;
    }
  } catch (uploadErr) {
    return jsonResponse({ success: false, message: `Submission failed: ${(uploadErr as Error).message}` }, 500);
  }

  const yearKey = `reference_number_${now.getFullYear()}`;
  const { data: seq, error: seqError } = await supabaseAdmin.rpc('next_counter_value', { counter_name: yearKey });
  if (seqError || !seq) {
    return jsonResponse({ success: false, message: 'Submission failed: could not generate a reference number.' }, 500);
  }
  const referenceNumber = `CHICKBOY-${now.getFullYear()}-${String(seq).padStart(4, '0')}`;

  const insertRow = {
    id: applicationId,
    reference_number: referenceNumber,
    submitted_at: now.toISOString(),
    last_name: formData.lastName,
    first_name: formData.firstName,
    middle_name: formData.middleName || null,
    gender: formData.gender,
    birthday: formData.birthday,
    age: formData.age !== undefined && formData.age !== null && formData.age !== '' ? Number(formData.age) : null,
    province: formatProvince(formData),
    municipality: formData.municipality,
    barangay: formData.barangay,
    street_purok: formData.streetPurok,
    mobile_number: formData.mobileNumber,
    email: formData.email,
    emergency_contact_person: formData.emergencyContactPerson,
    emergency_contact_relationship: formData.emergencyRelationship,
    emergency_contact_number: formData.emergencyContactNumber,
    educational_attainment: formData.education,
    school_name: formData.schoolName,
    school_year_graduated: formData.schoolYear,
    strand: formData.strand || null,
    course: formData.course || null,
    applicant_photo_url: urls.applicantPhoto,
    face_descriptor: formatFaceDescriptor(formData.applicantFaceDescriptor),
    valid_id_url: urls.validId,
    psa_url: urls.psaDocument,
    barangay_clearance_url: urls.barangayClearance,
    drug_test_url: urls.drugTestResult,
    drug_test_date: formData.drugTestDate || null,
    current_work_status: formData.currentWorkStatus,
    current_work_details: formData.currentWorkDetails || null,
    previous_work: formData.previousWork || null,
    referred_by: formData.referredBy || null,
    hear_about_source: formatHearAbout(formData),
    purpose_of_enrolling: formData.purpose,
    other_tesda_courses: formatOtherCourses(formData.otherTesdaCourses) || null,
    batch_number: null,
    review_status: staffSubmission ? 'Accepted' : 'Pending Review',
    reviewed_by: staffSubmission ? session!.userId : null,
    reviewed_at: staffSubmission ? now.toISOString() : null,
    approval_status: 'Pending',
    training_result: 'Not Yet Available',
    result_approval_status: 'Pending',
    psa_status: formData.psaWillFollow ? 'Pending Follow-up' : 'Submitted',
    drug_test_status: formData.drugTestWillFollow ? 'Pending Follow-up' : 'Submitted',
    agreement_accepted: !!formData.agreementAccepted,
    agreement_accepted_at: formData.agreementAccepted ? now.toISOString() : null,
  };

  const { error: insertError } = await supabaseAdmin.from('applicants').insert(insertRow);
  if (insertError) {
    return jsonResponse({ success: false, message: `Submission failed: ${insertError.message}` }, 500);
  }

  let emailSent = false;
  if (formData.email) {
    try {
      const { subject, html, text } = buildReceiptEmail(formData, referenceNumber);
      await sendEmail({ to: formData.email, subject, html, text });
      emailSent = true;
    } catch (emailErr) {
      await supabaseAdmin.from('email_log').insert({
        context: `Application receipt for ${referenceNumber} (${formData.email})`,
        detail: (emailErr as Error).message,
      });
    }
  }

  return jsonResponse({
    success: true,
    message: 'Application submitted successfully! Thank you for applying to Chickboy Butchery Training Center.',
    referenceNumber,
    emailSent,
  });
});
