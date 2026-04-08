import nodemailer from "nodemailer";
import Imap from "imap";
import { simpleParser } from "mailparser";

// ── send via nodemailer ───────────────────────────────────────
function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

// ✅ send email
export async function sendEmail({ to, subject, body }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return "❌ GMAIL_USER or GMAIL_APP_PASSWORD missing in .env";
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Dori AI" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text: body,
    });
    return `✅ Email sent to ${to}`;
  } catch (err) {
    console.error("[gmail] send error:", err.message);
    return `❌ Failed to send email: ${err.message}`;
  }
}

// ✅ read unread emails via IMAP
export async function getUnreadEmails(limit = 5) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return "❌ GMAIL_USER or GMAIL_APP_PASSWORD missing in .env";
  }

  return new Promise((resolve) => {
    const imap = new Imap({
      user: process.env.GMAIL_USER,
      password: process.env.GMAIL_APP_PASSWORD,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const emails = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err, box) => {
        if (err) { imap.end(); return resolve(`❌ IMAP error: ${err.message}`); }

        imap.search(["UNSEEN"], (err, results) => {
          if (err || !results?.length) {
            imap.end();
            return resolve("📭 No unread emails.");
          }

          // take last N unread
          const toFetch = results.slice(-limit);
          const fetch = imap.fetch(toFetch, { bodies: "" });

          fetch.on("message", (msg) => {
            msg.on("body", (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;
                emails.push([
                  `📧 **${parsed.subject || "(no subject)"}**`,
                  `👤 From: ${parsed.from?.text || "Unknown"}`,
                  `🕐 ${parsed.date?.toLocaleString() || ""}`,
                  parsed.text
                    ? `📝 ${parsed.text.slice(0, 300).replace(/\n+/g, " ")}...`
                    : "",
                ].filter(Boolean).join("\n"));
              });
            });
          });

          fetch.once("end", () => {
            imap.end();
          });
        });
      });
    });

    imap.once("end", () => {
      if (!emails.length) return resolve("📭 No unread emails.");
      resolve(emails.join("\n\n━━━━━━━━━━━━━━━━━━━━\n\n"));
    });

    imap.once("error", (err) => {
      resolve(`❌ IMAP connection error: ${err.message}`);
    });

    imap.connect();
  });
}

export default { sendEmail, getUnreadEmails };