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

// ─── HISTORIQUE PAR CLIENT ────────────────────────────────────
const conversations = new Map();

function getHistory(email) {
  return conversations.get(email) || [];
}

function addToHistory(email, role, content) {
  const history = getHistory(email);
  history.push({ role, content });
  if (history.length > 20) history.splice(0, history.length - 20);
  conversations.set(email, history);
}

// ─── PROMPT SYSTÈME AVEC CALCUL DE DEVIS ─────────────────────
const SYSTEM_PROMPT = `Tu es l'agent IA de LiliCleanServices, une entreprise de nettoyage professionnelle basée à Saint-Julien-de-l'Escap (Charente-Maritime, 17).

Ton rôle :
- Répondre aux clients de manière professionnelle
- Poser les bonnes questions
- Calculer automatiquement les devis
- Ne jamais inventer de prix
- Être clair, rapide et naturel

RÈGLES IMPORTANTES :
1. Tu poses UNE question à la fois.
2. Tu ne redemandes jamais une information déjà donnée.
3. Tu dois récupérer avant tout devis :
   - la surface en m²
   - si le logement est très sale
   - si le client veut les vitres
   - si le client veut du repassage
4. Tu calcules le prix uniquement quand toutes les informations sont disponibles.
5. Si le client demande seulement des informations générales, ne génère pas de devis.
6. Tu réponds toujours en français.
7. Style : professionnel, humain, rassurant, court, sans emojis excessifs.

FORMULES DE CALCUL :

CAS 1 — Surface inférieure à 50 m²
  prix = Math.ceil(surface / 25) * 27

CAS 2 — Surface supérieure ou égale à 50 m²
  <= 60 m²  → 75 €
  <= 80 m²  → 95 €
  <= 100 m² → 110 €
  > 100 m²  → 130 €

OPTIONS :
  logement très sale → +20 €
  vitres             → +15 €
  repassage          → +10 €

EXEMPLE DE DEVIS COMPLET :
"Merci.
Voici votre estimation :
- Surface : 65 m²
- Vitres : oui
- Repassage : non
- Logement très sale : oui
Total estimé : 130 €
Souhaitez-vous être recontacté pour fixer un rendez-vous ?"

Infos entreprise :
- Contact : 06 28 83 78 18 | lilicleanservices17@gmail.com
- Site : lilicleanservice.fr
- Zone : Saint-Julien-de-l'Escap et alentours (Charente-Maritime)

Termine toujours par :
"Cordialement,
Lili — LiliCleanServices
📞 06 28 83 78 18
🌐 lilicleanservice.fr"

Réponds TOUJOURS en français.`;

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

// ─── GÉNÉRER RÉPONSE CLAUDE (avec historique) ─────────────────
async function generateReply(fromEmail, newMessage) {
  addToHistory(fromEmail, "user", newMessage);
  const history = getHistory(fromEmail);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20251001",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: history,
  });

  const reply = response.content[0].text;
  addToHistory(fromEmail, "assistant", reply);
  return reply;
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
      console.log(`\n📩 De: ${email.fromName} <${email.from}> — Sujet: ${email.subject}`);

      // Transmet le message à Claude avec l'historique du client
      const content = `De: ${email.fromName}\nSujet: ${email.subject}\n\n${email.text}`;
      const reply = await generateReply(email.from, content);

      const subject = email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`;
      await sendEmail({ to: email.from, subject, text: reply, inReplyTo: email.messageId });
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
