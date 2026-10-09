import nodemailer, { Transporter } from 'nodemailer';

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let cachedTransporter: Transporter | null = null;

export const getEmailTransporter = async (): Promise<Transporter> => {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USERNAME || process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
  const isSecure = port === 465;
  const rawTimeout = parseInt(process.env.SMTP_TIMEOUT || '10000', 10);
  const timeout = rawTimeout > 0 && rawTimeout < 100 ? rawTimeout * 1000 : rawTimeout;

  if (host && user && pass) {
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure,
      auth: { user, pass },
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });
    return cachedTransporter;
  }

  // If credentials are not configured, create an Ethereal test account so real email testing works without mocking
  try {
    const testAccount = await nodemailer.createTestAccount();
    cachedTransporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('[EMAIL] Using Ethereal test account for SMTP emails:', testAccount.user);
    return cachedTransporter;
  } catch (err) {
    console.warn('[EMAIL] Could not create Ethereal test account, creating fallback transporter:', err);
    cachedTransporter = nodemailer.createTransport({
      host: host || 'localhost',
      port,
      secure: false,
    });
    return cachedTransporter;
  }
};

export const sendPasswordResetEmail = async (
  toEmail: string,
  resetUrl: string,
  adminName?: string
): Promise<void> => {
  const fromEmail = process.env.SMTP_FROM_EMAIL || 'noreply@fuelpoint.in';
  const fromName = process.env.SMTP_FROM_NAME || 'FuelPoint Admin';
  const from = `"${fromName}" <${fromEmail}>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your FuelPoint Admin Password</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
    .container { max-width: 560px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 32px; text-align: left; }
    .logo-text { color: #ffffff; font-size: 20px; font-weight: 700; margin: 0; letter-spacing: -0.5px; }
    .logo-sub { color: #94a3b8; font-size: 12px; margin: 4px 0 0 0; }
    .content { padding: 36px 32px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 16px 0; }
    .text { font-size: 15px; line-height: 24px; color: #475569; margin: 0 0 24px 0; }
    .btn-wrapper { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 600; padding: 13px 32px; border-radius: 8px; box-shadow: 0 2px 4px rgba(2, 132, 199, 0.2); }
    .divider { height: 1px; background-color: #e2e8f0; margin: 28px 0; }
    .fallback { font-size: 13px; color: #64748b; line-height: 20px; word-break: break-all; margin-top: 12px; }
    .warning { font-size: 13px; color: #64748b; line-height: 20px; background-color: #f1f5f9; padding: 14px 16px; border-radius: 8px; margin: 24px 0 0 0; border-left: 3px solid #0284c7; }
    .footer { background-color: #f8fafc; padding: 24px 32px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <p class="logo-text">FuelPoint</p>
      <p class="logo-sub">Petrol Pump Management Suite · Admin Console</p>
    </div>
    <div class="content">
      <h2 class="title">Reset your FuelPoint Admin Password</h2>
      <p class="text">Hello${adminName ? ` ${adminName}` : ''},</p>
      <p class="text">We received a request to reset your administrator password for the FuelPoint Admin Console.</p>
      <p class="text">Click the button below to create a new password:</p>
      <div class="btn-wrapper">
        <a href="${resetUrl}" class="btn" target="_blank" rel="noopener noreferrer">Reset Password</a>
      </div>
      <div class="warning">
        <strong>Note:</strong> This link expires in 30 minutes and can only be used once.<br>
        If you did not request a password reset, you can safely ignore this email.
      </div>
      <div class="divider"></div>
      <p class="fallback">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${resetUrl}" style="color: #0284c7;">${resetUrl}</a>
      </p>
    </div>
    <div class="footer">
      © ${new Date().getFullYear()} FuelPoint Team. All rights reserved.
    </div>
  </div>
</body>
</html>`;

  const text = `Hello${adminName ? ` ${adminName}` : ''},

We received a request to reset your administrator password for the FuelPoint Admin Console.

To reset your password, visit the following secure link:
${resetUrl}

This link expires in 30 minutes and can only be used once.

If you did not request a password reset, you can safely ignore this email.
For security reasons, please do not share this link with anyone.

Regards,
FuelPoint Team`;

  const transporter = await getEmailTransporter();
  const info = await transporter.sendMail({
    from,
    to: toEmail,
    subject: 'FuelPoint Admin Password Reset',
    text,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log('[EMAIL] Password reset email sent! Preview URL:', previewUrl);
  } else {
    console.log('[EMAIL] Password reset email sent to:', toEmail);
  }
};
