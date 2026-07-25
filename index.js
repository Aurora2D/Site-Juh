/**
 * ============================================================
 * JULIANA CALLEGARIS BEAUTY STUDIO — CLOUD FUNCTIONS (rascunho)
 * ============================================================
 * Este arquivo é um ESQUELETO/REFERÊNCIA de como as 3 funções
 * automáticas vão funcionar assim que o projeto Firebase da Juh
 * (beautybyjucallega@gmail.com) estiver criado.
 *
 * Ainda NÃO está pronto pra rodar — falta:
 *   1. Criar o projeto em https://console.firebase.google.com
 *   2. Rodar `firebase init functions` dentro dessa pasta
 *   3. Criar uma conta grátis em https://resend.com e pegar a API key
 *   4. Colar a API key como variável de ambiente (`firebase functions:secrets:set RESEND_API_KEY`)
 *   5. `firebase deploy --only functions`
 *
 * As 3 automações:
 *   A) sendBookingConfirmation  -> dispara na hora em que o cliente agenda
 *   B) send4hReminder           -> roda de hora em hora, verifica quem tem
 *                                  horário daqui a ~4h e manda o lembrete
 *   C) sendReviewRequest        -> roda 1x por dia, verifica quem teve
 *                                  atendimento 24h atrás e pede avaliação
 * ============================================================
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { Resend } = require("resend");

admin.initializeApp();
const db = admin.firestore();
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

const FROM_EMAIL = "Juliana Callegaris Beauty Studio <agendamentos@julianacallegaris.com>"; // trocar pelo domínio real depois
const REPLY_TO = "beautybyjucallega@gmail.com";

const TEXTS = {
  pt: {
    confirmSubject: "Seu horário foi recebido! ✨",
    confirmBody: (b) => `Oi ${b.clientName}! Recebemos seu pedido de agendamento para ${b.serviceName} no dia ${b.date} às ${b.time}. Em breve confirmamos com você por aqui.`,
    reminderSubject: "Faltam 4h para seu horário 💅",
    reminderBody: (b) => `Oi ${b.clientName}! Só confirmando: seu horário de ${b.serviceName} é hoje às ${b.time}. Clique para confirmar presença.`,
    reviewSubject: "O que você achou do atendimento?",
    reviewBody: (b) => `Oi ${b.clientName}! Esperamos que tenha amado seu ${b.serviceName}. Deixa sua avaliação (leva 30 segundos):`,
  },
  en: {
    confirmSubject: "Your appointment request was received! ✨",
    confirmBody: (b) => `Hi ${b.clientName}! We received your booking request for ${b.serviceName} on ${b.date} at ${b.time}. We'll confirm with you shortly.`,
    reminderSubject: "4 hours until your appointment 💅",
    reminderBody: (b) => `Hi ${b.clientName}! Just confirming: your ${b.serviceName} appointment is today at ${b.time}. Click to confirm.`,
    reviewSubject: "How was your appointment?",
    reviewBody: (b) => `Hi ${b.clientName}! We hope you loved your ${b.serviceName}. Leave your review (takes 30 seconds):`,
  },
  es: {
    confirmSubject: "¡Recibimos tu solicitud de cita! ✨",
    confirmBody: (b) => `¡Hola ${b.clientName}! Recibimos tu solicitud para ${b.serviceName} el ${b.date} a las ${b.time}. Pronto te confirmamos.`,
    reminderSubject: "Faltan 4h para tu cita 💅",
    reminderBody: (b) => `¡Hola ${b.clientName}! Confirmando: tu cita de ${b.serviceName} es hoy a las ${b.time}. Haz clic para confirmar.`,
    reviewSubject: "¿Qué te pareció el servicio?",
    reviewBody: (b) => `¡Hola ${b.clientName}! Esperamos que hayas amado tu ${b.serviceName}. Déjanos tu opinión (30 segundos):`,
  },
};

/* A) Confirmação imediata ao criar o agendamento -------------------- */
exports.sendBookingConfirmation = onDocumentCreated(
  { document: "appointments/{id}", secrets: [RESEND_API_KEY] },
  async (event) => {
    const booking = event.data.data();
    const t = TEXTS[booking.lang] || TEXTS.pt;
    const resend = new Resend(RESEND_API_KEY.value());
    await resend.emails.send({
      from: FROM_EMAIL,
      to: booking.clientEmail,
      reply_to: REPLY_TO,
      subject: t.confirmSubject,
      html: `<p>${t.confirmBody(booking)}</p>`,
    });
  }
);

/* B) Lembrete 4h antes (roda a cada hora) ---------------------------- */
exports.send4hReminder = onSchedule(
  { schedule: "every 60 minutes", secrets: [RESEND_API_KEY] },
  async () => {
    const now = new Date();
    const in4h = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const snap = await db
      .collection("appointments")
      .where("status", "==", "confirmado")
      .where("reminderSent", "==", false)
      .get();

    const resend = new Resend(RESEND_API_KEY.value());
    for (const doc of snap.docs) {
      const booking = doc.data();
      const apptDateTime = new Date(`${booking.date}T${booking.time}`);
      if (apptDateTime <= in4h && apptDateTime > now) {
        const t = TEXTS[booking.lang] || TEXTS.pt;
        await resend.emails.send({
          from: FROM_EMAIL,
          to: booking.clientEmail,
          reply_to: REPLY_TO,
          subject: t.reminderSubject,
          html: `<p>${t.reminderBody(booking)}</p>
                 <p><a href="https://SEUSITE.com/confirmar?id=${doc.id}">Confirmar presença</a></p>
                 <p><a href="https://www.google.com/maps/dir/?api=1&destination=SEU_ENDERECO_AQUI">Quer ajuda pra chegar aqui?</a></p>`,
        });
        await doc.ref.update({ reminderSent: true });
      }
    }
  }
);

/* C) Pedido de avaliação 24h depois (roda 1x por dia) ---------------- */
exports.sendReviewRequest = onSchedule(
  { schedule: "every day 10:00", secrets: [RESEND_API_KEY] },
  async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateKey = yesterday.toISOString().split("T")[0];

    const snap = await db
      .collection("appointments")
      .where("date", "==", dateKey)
      .where("reviewRequestSent", "==", false)
      .get();

    const resend = new Resend(RESEND_API_KEY.value());
    for (const doc of snap.docs) {
      const booking = doc.data();
      const t = TEXTS[booking.lang] || TEXTS.pt;
      const token = doc.id; // usado para identificar a cliente sem precisar de login
      await resend.emails.send({
        from: FROM_EMAIL,
        to: booking.clientEmail,
        reply_to: REPLY_TO,
        subject: t.reviewSubject,
        html: `<p>${t.reviewBody(booking)}</p>
               <p><a href="https://SEUSITE.com/avaliar?token=${token}">Deixar avaliação</a></p>`,
      });
      await doc.ref.update({ reviewRequestSent: true });
    }
  }
);
