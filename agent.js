
Copier

/**
 * ============================================================
 *  LiliCleanServices — Agent Email Gmail + Claude AI
 * ============================================================
 *  Fonctions :
 *    ✅ Lit les nouveaux emails automatiquement
 *    ✅ Répond avec Claude (ton chaleureux, pro)
 *    ✅ Détecte les demandes de devis et envoie un email dédié
 *    ✅ Tourne en boucle toutes les 2 minutes
 * ============================================================
 *  Prérequis :
 *    - Node.js 18+
 *    - Un compte Gmail avec mot de passe d'application activé
 *    - Une clé API Anthropic
 * ============================================================
 */
 
import Anthropic from "@anthropic-ai/sdk";
import Imap from "imap";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { inspect } from "util";
 
// ─── CONFIG ──────────────────────────────────────────────────
const {
  GMAIL_USER,        // ex: lilicleanservices17@gmail.com
  GMAIL_APP_PASSWORD, // Mot de passe d'application Gmail (16 caractères)
  ANTHROPIC_API_KEY,
} = process.env;
 
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // Vérifie toutes les 2 minutes
 
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
 
// ─── PROMPTS ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es l'assistante email de LiliCleanServices, une entreprise de nettoyage professionnelle basée à Saint-Julien-de-l'Escap (Charente-Maritime, 17).
 
Ton rôle : rédiger des réponses email professionnelles, chaleureuses et concises.
 
Infos clés :
- Prestations : ménage régulier, nettoyage Airbnb/courte durée, après déménagement, grand nettoyage de printemps, vitres, repassage
- Zone : Saint-Julien-de-l'Escap et alentours (Charente-Maritime)
- Contact : 06 28 83 78 18 | lilicleanservices17@gmail.com
- Site : lilicleanservice.fr
- Devis : toujours gratuit, personnalisé
 
Règles :
- Commence par "Bonjour [prénom si connu],"
- Sois chaleureuse, professionnelle, rassurante
- 3-5 phrases maximum sauf si plusieurs questions complexes
- Termine toujours par une signature :
  "Cordialement,
  Lili — LiliCleanServices
  📞 06 28 83 78 18
  🌐 lilicleanservice.fr"
- Réponds TOUJOURS en français
- NE génère PAS de sujet d'email, seulement le corps`;
 
const DEVIS_DETECTION_PROMPT = `Analyse cet email et réponds UNIQUEMENT par "OUI" ou "NON".
Est-ce que cet email contient une demande de devis, une demande de tarif, ou une demande d'intervention ?
 
Email : """
{EMAIL_CONTENT}
"""`;
 
const DEVIS_PROMPT = `Tu es l'assistante de LiliCleanServices. Rédige un email de réponse à une demande de devis.
 
Infos client extraites de l'email : {EMAIL_CONTENT}
 
L'email doit :
1. Remercier le client pour sa demande
2. Confirmer que le devis est GRATUIT
3. Demander les infos manquantes si nécessaire (adresse, surface, fréquence souhaitée, date souhaitée)
4. Proposer un appel rapide pour affiner le devis : 06 28 83 78 18
5. Mentionner le formulaire en ligne : lilicleanservice.fr
 
Terminer par :
"Cordialement,
Lili — LiliCleanServices
📞 06 28 83 78 18
🌐 lilicleanservice.fr"
 
Réponds UNIQUEMENT en français. Ne génère pas de sujet, seulement le corps de l'email.`;
 
// ─── NODEMAILER (envoi) ───────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});
 
async function sendEmail({ to, subject, text, inReplyTo, references }) {
  const mailOptions = {
    from: `LiliCleanServices <${GMAIL_USER}>`,
    to,
    subject,
    text,
    ...(inReplyTo && { inReplyTo }),
    ...(references && { references }),
  };
 
  await transporter.sendMail(mailOptions);
  console.log(`✅ Email envoyé à ${to} — Sujet: "${subject}"`);
}
 
// ─── CLAUDE : DÉTECTER DEMANDE DE DEVIS ──────────────────────
async function isDevisRequest(emailContent) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 10,
    messages: [{
      role: "user",
      content: DEVIS_DETECTION_PROMPT.replace("{EMAIL_CONTENT}", emailContent),
    }],
  });
  const answer = response.content[0].text.trim().toUpperCase();
  return answer.startsWith("OUI");
}
 
// ─── CLAUDE : GÉNÉRER RÉPONSE ─────────────────────────────────
async function generateReply(emailContent, isDevis) {
  const prompt = isDevis
    ? DEVIS_PROMPT.replace("{EMAIL_CONTENT}", emailContent)
    : `Voici un email reçu par LiliCleanServices. Rédige une réponse appropriée.\n\nEmail reçu:\n"""\n${emailContent}\n"""`;
 
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });
 
  return response.content[0].text;
}
 
// ─── IMAP : LIRE LES NOUVEAUX EMAILS ─────────────────────────
function fetchUnreadEmails() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: GMAIL_USER,
      password: GMAIL_APP_PASSWORD,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });
 
    const emails = [];
 
    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err, box) => {
        if (err) return reject(err);
 
        // Cherche les emails non lus
        imap.search(["UNSEEN"], (err, results) => {
          if (err) return reject(err);
          if (!results.length) {
            imap.end();
            return resolve([]);
          }
 
          const fetch = imap.fetch(results, { bodies: "", markSeen: true });
 
          fetch.on("message", (msg) => {
            msg.on("body", (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;
                emails.push({
                  from: parsed.from?.value?.[0]?.address || "",
                  fromName: parsed.from?.value?.[0]?.name || "",
                  subject: parsed.subject || "(sans objet)",
                  text: parsed.text || parsed.html || "",
                  messageId: parsed.messageId,
                  references: parsed.references,
                });
              });
            });
          });
 
          fetch.once("end", () => {
            imap.end();
          });
        });
      });
    });
 
    imap.once("end", () => resolve(emails));
    imap.once("error", reject);
    imap.connect();
  });
}
 
// ─── BOUCLE PRINCIPALE ───────────────────────────────────────
async function processEmails() {
  console.log(`\n🔍 [${new Date().toLocaleTimeString("fr-FR")}] Vérification des nouveaux emails...`);
 
  try {
    const emails = await fetchUnreadEmails();
 
    if (!emails.length) {
      console.log("📭 Aucun nouvel email.");
      return;
    }
 
    console.log(`📬 ${emails.length} nouvel(s) email(s) trouvé(s) !`);
 
    for (const email of emails) {
      console.log(`\n📩 De: ${email.fromName} <${email.from}>`);
      console.log(`   Sujet: ${email.subject}`);
 
      // Contenu complet pour l'analyse
      const content = `Sujet: ${email.subject}\nDe: ${email.fromName}\n\n${email.text}`;
 
      // Détecte si c'est une demande de devis
      const devis = await isDevisRequest(content);
      console.log(`   → ${devis ? "📋 Demande de devis détectée !" : "💬 Email standard"}`);
 
      // Génère la réponse avec Claude
      const replyBody = await generateReply(content, devis);
 
      // Construit le sujet de réponse
      const replySubject = email.subject.startsWith("Re:")
        ? email.subject
        : `Re: ${email.subject}`;
 
      // Envoie la réponse
      await sendEmail({
        to: email.from,
        subject: replySubject,
        text: replyBody,
        inReplyTo: email.messageId,
        references: email.messageId,
      });
    }
  } catch (err) {
    console.error("❌ Erreur:", err.message);
  }
}
 
// ─── DÉMARRAGE ───────────────────────────────────────────────
console.log("🚀 Agent Email LiliCleanServices démarré !");
console.log(`📧 Compte : ${GMAIL_USER}`);
console.log(`⏱  Vérification toutes les ${CHECK_INTERVAL_MS / 1000 / 60} minutes\n`);
 
// Premier check immédiat
processEmails();
 
// Puis en boucle
setInterval(processEmails, CHECK_INTERVAL_MS);
 
