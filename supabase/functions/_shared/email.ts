// Transactional email via Resend, replacing Code.gs's MailApp.sendEmail.
// Requires the RESEND_API_KEY secret (supabase secrets set RESEND_API_KEY=...).
export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(input: EmailInput): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Chickboy Butchery Training Center <noreply@chickboybutcherytc.com>',
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}
