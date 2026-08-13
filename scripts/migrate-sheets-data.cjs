#!/usr/bin/env node
// One-time data migration: reads the exported "GFFC Butchery TC" Google
// Sheet (as .xlsx) and generates a SQL script that loads it into the Chickboy
// Training Center Supabase schema (supabase/migrations/0004_gffc_schema.sql).
//
// Usage:
//   node scripts/migrate-sheets-data.cjs <path-to-xlsx> [output-dir]
//
// Output (written to output-dir, default: supabase/data/ — gitignored):
//   import_data.sql          run this in the Supabase SQL Editor
//   import_credentials.txt   temp login password per migrated user account
//   import_report.json       rows excluded / unresolved references, for review
//
// Ground truth for column order and role names is Code.gs (the live Apps
// Script source), not the sheet's own header text or the prose migration
// docs — both were found to have drifted from what the app actually writes.
// See the header-order note on the Schedule sheet below, and the role-rename
// map, for the two concrete drifts this accounts for.
const XLSX = require('xlsx');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [, , srcPath, outDirArg] = process.argv;
if (!srcPath) {
  console.error('Usage: node scripts/migrate-sheets-data.cjs <path-to-xlsx> [output-dir]');
  process.exit(1);
}
const outDir = outDirArg || path.join(__dirname, '..', 'supabase', 'data');
fs.mkdirSync(outDir, { recursive: true });

const wb = XLSX.readFile(srcPath, { cellDates: true }); // raw values (real numbers/dates), not formatted display text

function rowsOf(sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('missing sheet ' + sheetName);
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

function isBlankRow(row) {
  return row.every((v) => v === null || v === undefined || String(v).trim() === '');
}

function positionalRowsOf(sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('missing sheet ' + sheetName);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  // Google Sheets exports can carry a fully-blank trailing row inside the
  // used range; header:1 mode (unlike the default object mode) doesn't
  // drop it on its own.
  return [rows[0], ...rows.slice(1).filter((r) => !isBlankRow(r))];
}

// ---- SQL literal helpers ---------------------------------------------------

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlNum(v) {
  if (v === null || v === undefined || v === '') return 'null';
  const n = Number(v);
  if (Number.isNaN(n)) return 'null';
  return String(n);
}

function sqlBool(v) {
  if (v === null || v === undefined || v === '') return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v).trim().toLowerCase();
  if (s === 'true') return 'true';
  if (s === 'false') return 'false';
  return 'null';
}

function sqlTimestamp(v) {
  if (v === null || v === undefined || v === '') return 'null';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return 'null';
  return `'${d.toISOString()}'`;
}

// Date-only cells (Birthday, Drug Test Date, Start/End Date) carry no
// timezone info in the spreadsheet — SheetJS reconstructs them as a JS Date
// whose LOCAL calendar date matches what the cell displayed (verified
// against the source file: Birthday "10/4/02" -> Date object
// 2002-10-03T16:00:00Z, whose *local* Y/M/D in Asia/Manila is 2002-10-04,
// the correct value). Using toISOString() here would silently shift every
// date back a day. This assumes the generating environment's local
// timezone is Asia/Manila, matching the source spreadsheet's origin
// (Bukidnon, Philippines) — if you ever rerun this from a machine in a
// different timezone, re-verify against a known applicant birthday first
// (e.g. `TZ=Asia/Manila node scripts/migrate-sheets-data.cjs ...`).
function sqlDate(v) {
  if (v === null || v === undefined || v === '') return 'null';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return 'null';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `'${y}-${m}-${day}'`;
}

// A "number-shaped free-text" field (phone numbers): may arrive as a JS
// number (SheetJS parsed the cell as numeric) or a string. Either way we
// want the full-precision integer as plain text, never scientific notation
// or a formatted/truncated display string (some rows' phone numbers render
// as e.g. "6.39923E+11" in formatted/display mode while the underlying raw
// value is the intact 12-digit number).
function sqlPhoneText(v) {
  if (v === null || v === undefined || v === '') return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'null';
    return sqlStr(BigInt(Math.round(v)).toString());
  }
  return sqlStr(String(v).trim());
}

function sqlJsonb(v) {
  if (v === null || v === undefined || v === '') return 'null';
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  try {
    JSON.parse(text);
  } catch (e) {
    return null; // caller must treat this as a data-quality issue
  }
  return `'${text.replace(/'/g, "''")}'::jsonb`;
}

function userRef(usernameExpr) {
  // usernameExpr is already a sqlStr(...) result, e.g. "'pginihao'" or "null"
  if (usernameExpr === 'null') return 'null';
  return `(select id from users where username = ${usernameExpr})`;
}

const sqlLines = [];
const report = { excluded: [], unresolvedRefs: [], counts: {} };
const creds = [];

sqlLines.push('-- Generated one-time data import from the GFFC Butchery TC Google Sheet.');
sqlLines.push('-- Run this AFTER supabase/migrations/0004_gffc_schema.sql has been applied.');
sqlLines.push('-- Safe to re-run only after truncating the target tables first (ids/usernames are unique).');
sqlLines.push('');
sqlLines.push('begin;');
sqlLines.push('');

// ---- USERS ------------------------------------------------------------------
// Only rows with a real Username are imported — the sheet also contains
// legacy rows with no Username at all (pre-dating the username field), which
// Code.gs's own account-migration tool (runRenameRolesAndResetPasswords_)
// already skips for the same reason (`if (!row[idx['Username']]) continue;`).
// Those rows are duplicates of accounts later properly recreated with a
// username, so importing them would just create unusable, unloggable-into
// duplicate rows.
const ROLE_RENAME = { Admin1: 'Super Admin', Admin2: 'Admin', Student: 'Trainees' };
const usersRaw = positionalRowsOf('Users').slice(1); // drop header row
const knownUsernames = new Set(usersRaw.map((r) => r[0]).filter(Boolean));
function checkUserRef(table, field, username, context) {
  if (username && !knownUsernames.has(username)) {
    report.unresolvedRefs.push({ table, field, value: username, ...context });
  }
}
sqlLines.push('-- USERS --------------------------------------------------------------------');
for (const row of usersRaw) {
  const [username, , role, fullName, createdAt, active, lastLoginAt, passwordChangedAt] = row;
  if (!username) {
    report.excluded.push({ table: 'users', reason: 'no username (legacy pre-rename row)', fullName, role });
    continue;
  }
  const finalRole = ROLE_RENAME[role] || role;
  const tempPassword = crypto.randomBytes(9).toString('base64url'); // 12 chars, url-safe
  creds.push({ username, role: finalRole, fullName, tempPassword });
  sqlLines.push(
    `insert into users (username, password_hash, must_reset_password, role, full_name, active, created_at, last_login_at, password_changed_at) values (` +
      `${sqlStr(username)}, crypt(${sqlStr(tempPassword)}, gen_salt('bf')), true, ${sqlStr(finalRole)}, ${sqlStr(fullName)}, ${sqlBool(active)}, ${sqlTimestamp(createdAt)}, ${sqlTimestamp(lastLoginAt)}, ${sqlTimestamp(passwordChangedAt)});`
  );
}
report.counts.users = creds.length;
sqlLines.push('');

// ---- TOOLS CATALOG -----------------------------------------------------------
const catalog = rowsOf('Tools Catalog');
sqlLines.push('-- TOOLS CATALOG --------------------------------------------------------------');
for (const r of catalog) {
  checkUserRef('tools_catalog', 'submitted_by', r['Submitted By'], { itemId: r['Item ID'] });
  checkUserRef('tools_catalog', 'reviewed_by', r['Reviewed By'], { itemId: r['Item ID'] });
  sqlLines.push(
    `insert into tools_catalog (item_id, name, description, unit, price, active, status, pending_data, submitted_by, submitted_at, reviewed_by, reviewed_at, review_notes) values (` +
      `${sqlStr(r['Item ID'])}, ${sqlStr(r['Name'])}, ${sqlStr(r['Description'])}, ${sqlStr(r['Unit'])}, ${sqlNum(r['Price'])}, ${sqlBool(r['Active'])}, ${sqlStr(r['Status'] || 'Live')}, ${sqlJsonb(r['Pending Data (JSON)']) ?? 'null'}, ${userRef(sqlStr(r['Submitted By']))}, ${sqlTimestamp(r['Submitted At'])}, ${userRef(sqlStr(r['Reviewed By']))}, ${sqlTimestamp(r['Reviewed At'])}, ${sqlStr(r['Review Notes'])});`
  );
}
report.counts.tools_catalog = catalog.length;
sqlLines.push('');

// ---- EXPENSE ACCOUNTS ---------------------------------------------------------
const accounts = rowsOf('Expense Accounts');
sqlLines.push('-- EXPENSE ACCOUNTS -----------------------------------------------------------');
for (const r of accounts) {
  sqlLines.push(
    `insert into expense_accounts (name, monthly_budget, active, created_at, updated_at) values (` +
      `${sqlStr(r['Account Name'])}, ${sqlNum(r['Monthly Budget'])}, ${sqlBool(r['Active'])}, ${sqlTimestamp(r['Created At'])}, ${sqlTimestamp(r['Updated At'])});`
  );
}
report.counts.expense_accounts = accounts.length;
sqlLines.push('');

// ---- TRAINING SCHEDULE ---------------------------------------------------------
// NOTE: this sheet's own header row is stale — cells 9-12 literally read
// "Created At", "", "", "" instead of the real column names. The DATA still
// follows Code.gs's SCHEDULE_HEADERS positional order (Submitted By,
// Approval Status, Approved By, Created At), confirmed against actual row
// contents. Reading this sheet by header name would silently scramble these
// four columns.
const scheduleRows = positionalRowsOf('Schedule').slice(1);
sqlLines.push('-- TRAINING SCHEDULE -----------------------------------------------------------');
for (const row of scheduleRows) {
  const [, batchName, startDate, endDate, venue, slots, status, notes, submittedBy, approvalStatus, approvedBy, createdAt, tuitionFee] = row;
  let notesFinal = notes;
  checkUserRef('training_schedule', 'submitted_by', submittedBy, { batchName });
  checkUserRef('training_schedule', 'approved_by', approvedBy, { batchName });
  const submittedByExpr = userRef(sqlStr(submittedBy));
  if (submittedBy) {
    // The subquery resolves to null at insert time if there's no such
    // username (e.g. a pre-rename identity that was never recreated) — the
    // raw value is preserved here so the reference isn't silently lost.
    notesFinal = [notes, `[legacy submitted_by: ${submittedBy}]`].filter(Boolean).join(' ');
  }
  sqlLines.push(
    `insert into training_schedule (batch_name, start_date, end_date, venue, slots, status, notes, submitted_by, approval_status, approved_by, created_at, tuition_fee) values (` +
      `${sqlStr(batchName)}, ${sqlDate(startDate)}, ${sqlDate(endDate)}, ${sqlStr(venue)}, ${sqlNum(slots)}, ${sqlStr(status)}, ${sqlStr(notesFinal)}, ${submittedByExpr}, ${sqlStr(approvalStatus)}, ${userRef(sqlStr(approvedBy))}, ${sqlTimestamp(createdAt)}, ${sqlNum(tuitionFee) === 'null' ? '0' : sqlNum(tuitionFee)});`
  );
}
report.counts.training_schedule = scheduleRows.length;
sqlLines.push('');

// ---- EMAIL LOG ------------------------------------------------------------------
const emailLog = rowsOf('Email Log');
sqlLines.push('-- EMAIL LOG -------------------------------------------------------------------');
for (const r of emailLog) {
  sqlLines.push(
    `insert into email_log (logged_at, context, detail) values (${sqlTimestamp(r['Timestamp'])}, ${sqlStr(r['Context'])}, ${sqlStr(r['Detail'])});`
  );
}
report.counts.email_log = emailLog.length;
sqlLines.push('');

// ---- APPLICANTS ------------------------------------------------------------------
const applicants = rowsOf('Applicants');
sqlLines.push('-- APPLICANTS ------------------------------------------------------------------');
for (const r of applicants) {
  const faceDescriptor = sqlJsonb(r['Face Descriptor (JSON)']);
  if (r['Face Descriptor (JSON)'] && faceDescriptor === null) {
    report.unresolvedRefs.push({ table: 'applicants', field: 'face_descriptor', value: r['Reference Number'], reason: 'invalid JSON, imported as null' });
  }
  checkUserRef('applicants', 'reviewed_by', r['Reviewed By'], { ref: r['Reference Number'] });
  checkUserRef('applicants', 'approved_by', r['Approved By'], { ref: r['Reference Number'] });
  checkUserRef('applicants', 'result_approved_by', r['Result Approved By'], { ref: r['Reference Number'] });
  checkUserRef('applicants', 'student_user_id (via Student Username)', r['Student Username'], { ref: r['Reference Number'] });
  const cols = [
    ['id', sqlStr(r['Application ID'])],
    ['reference_number', sqlStr(r['Reference Number'])],
    ['submitted_at', sqlTimestamp(r['Timestamp'])],
    ['last_name', sqlStr(r['Last Name'])],
    ['first_name', sqlStr(r['First Name'])],
    ['middle_name', sqlStr(r['Middle Name'])],
    ['gender', sqlStr(r['Gender'])],
    ['birthday', sqlDate(r['Birthday'])],
    ['age', sqlNum(r['Age'])],
    ['province', sqlStr(r['Province'])],
    ['municipality', sqlStr(r['Municipality/City'])],
    ['barangay', sqlStr(r['Barangay'])],
    ['street_purok', sqlStr(r['Street/Purok'])],
    ['mobile_number', sqlPhoneText(r['Mobile Number'])],
    ['email', sqlStr(r['Email Address'])],
    ['emergency_contact_person', sqlStr(r['Emergency Contact Person'])],
    ['emergency_contact_relationship', sqlStr(r['Emergency Contact Relationship'])],
    ['emergency_contact_number', sqlPhoneText(r['Emergency Contact Number'])],
    ['educational_attainment', sqlStr(r['Educational Attainment'])],
    ['school_name', sqlStr(r['School Name'])],
    ['school_year_graduated', sqlStr(r['School Year Graduated'])],
    ['strand', sqlStr(r['Strand (Senior High)'])],
    ['course', sqlStr(r['Course (College)'])],
    ['applicant_photo_url', sqlStr(r['Applicant Photo (Link)'])],
    ['face_descriptor', faceDescriptor ?? 'null'],
    ['valid_id_url', sqlStr(r['Government Valid ID (Link)'])],
    ['psa_url', sqlStr(r['PSA Birth Certificate (Link)'])],
    ['barangay_clearance_url', sqlStr(r['Barangay Clearance (Link)'])],
    ['drug_test_url', sqlStr(r['Drug Test Result (Link)'])],
    ['drug_test_date', sqlDate(r['Drug Test Date'])],
    ['current_work_status', sqlStr(r['Current Work Status'])],
    ['current_work_details', sqlStr(r['Current Work Details'])],
    ['previous_work', sqlStr(r['Previous Work Experience'])],
    ['referred_by', sqlStr(r['Referred By'])],
    ['hear_about_source', sqlStr(r['How Did You Learn About the Training Center'])],
    ['purpose_of_enrolling', sqlStr(r['Purpose of Enrolling'])],
    ['other_tesda_courses', sqlStr(r['Other TESDA Courses Attended'])],
    ['batch_number', sqlStr(r['Batch Number'])],
    ['review_status', sqlStr(r['Review Status'] || 'Pending Review')],
    ['reviewed_by', userRef(sqlStr(r['Reviewed By']))],
    ['reviewed_at', sqlTimestamp(r['Reviewed At'])],
    ['approval_status', sqlStr(r['Approval Status'] || 'Pending')],
    ['approved_by', userRef(sqlStr(r['Approved By']))],
    ['approved_at', sqlTimestamp(r['Approved At'])],
    ['training_result', sqlStr(r['Training Result'] || 'Not Yet Available')],
    ['result_approval_status', sqlStr(r['Result Approval Status'] || 'Pending')],
    ['result_approved_by', userRef(sqlStr(r['Result Approved By']))],
    ['result_approved_at', sqlTimestamp(r['Result Approved At'])],
    ['student_id_number', sqlStr(r['Student ID Number'])],
    ['student_user_id', userRef(sqlStr(r['Student Username']))],
    ['student_account_created_at', sqlTimestamp(r['Student Account Created At'])],
    ['photo_reprocessed_at', sqlTimestamp(r['Photo Reprocessed At'])],
    ['psa_status', sqlStr(r['PSA Status'])],
    ['drug_test_status', sqlStr(r['Drug Test Status'])],
    ['agreement_accepted', sqlBool(r['Agreement Accepted'])],
    ['agreement_accepted_at', sqlTimestamp(r['Agreement Accepted At'])],
  ];
  sqlLines.push(`insert into applicants (${cols.map((c) => c[0]).join(', ')}) values (${cols.map((c) => c[1]).join(', ')});`);
}
report.counts.applicants = applicants.length;

sqlLines.push('');
sqlLines.push('commit;');

const outSql = path.join(outDir, 'import_data.sql');
const outCreds = path.join(outDir, 'import_credentials.txt');
const outReport = path.join(outDir, 'import_report.json');

fs.writeFileSync(outSql, sqlLines.join('\n') + '\n');
fs.writeFileSync(
  outCreds,
  'Temporary passwords generated for this import — share each one with its owner over a\n' +
    'private/secure channel (not email/SMS in plaintext, ideally in person or via a password\n' +
    'manager share), then delete this file. Every account has must_reset_password = true, so\n' +
    'these should be treated as one-time codes.\n\n' +
    creds.map((c) => `${c.username}\t(${c.role}, ${c.fullName})\t${c.tempPassword}`).join('\n') +
    '\n'
);
fs.writeFileSync(outReport, JSON.stringify(report, null, 2));

console.log('Wrote:');
console.log(' ', outSql);
console.log(' ', outCreds);
console.log(' ', outReport);
console.log('Row counts:', report.counts);
console.log('Excluded rows:', report.excluded.length, '(see import_report.json)');
console.log('Unresolved references:', report.unresolvedRefs.length, '(see import_report.json)');
