const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const twilio = require('twilio');
const functions = require('firebase-functions');
const { defineSecret } = require('firebase-functions/params');

// Initialize Firebase
admin.initializeApp();

const twilioSid = defineSecret('TWILIO_SID');
const twilioToken = defineSecret('TWILIO_TOKEN');
const twilioPhone = defineSecret('TWILIO_PHONE');

/*
ENVIRONMENT VARIABLES REQUIRED for Cloud Functions v2 (replaces deprecated functions.config()):

- TWILIO_SID          (previously functions.config().twilio.sid)
- TWILIO_TOKEN        (previously functions.config().twilio.token)
- TWILIO_PHONE        (currently using secret.value; can also use process.env.TWILIO_PHONE)

Setup instructions:
- Firebase Console: Functions > select function > Environment variables tab
- Or deploy with: `gcloud functions deploy FUNCTION_NAME --set-env-vars=TWILIO_SID=your_sid,TWILIO_TOKEN=your_token,TWILIO_PHONE=your_phone`

Alternatively, for secrets (already configured with defineSecret):
`firebase functions:secrets:set TWILIO_SID` (prompt pastes SID), same for TOKEN, PHONE.
Secrets auto-mount to process.env.KEY or use secret.value.
Add to functions' secrets:[] on deploy (already: secrets: [twilioSid, twilioToken, twilioPhone]).
Note: v2 prefers Secret Manager (secure, auto-mounted).
*/
async function sendSMS(phoneNumber, message) {
  try {
    let rawSid = twilioSid.value() || '';
    let rawToken = twilioToken.value() || '';
    const sid = String(rawSid).trim().replace(/^["']|["']$/g, '');
    const token = String(rawToken).trim().replace(/^["']|["']$/g, '');
    console.log('twilioSid.value() type:', typeof rawSid, 'preview:', rawSid.slice(0,10));
    console.log('twilioToken.value() type:', typeof rawToken, 'preview:', rawToken.slice(0,10));
    console.log('final SID:', sid.slice(0,10)+'...', 'length:', sid.length);
    console.log("SID TYPE:", typeof sid, sid);
    console.log("TOKEN TYPE:", typeof token, 'length:', token.length);
    console.log("SID length:", sid.length, "startsWith('AC'):", sid.startsWith('AC'));
    console.log("SID char0/1:", sid.charCodeAt(0), sid.charCodeAt(1)); // Expect 65(A),67(C)
    console.log("SID regex match:", !!sid.match(/^AC[a-f0-9]{32}$/i));
    console.log("SID JSON:", JSON.stringify(sid));
    if (!sid.match(/^AC[a-f0-9]{32}$/i)) {
      throw new Error(`Invalid SID: ${JSON.stringify(sid)} (expected length 34: AC+32 hex chars)`);
    }
    if (!token) {
      throw new Error('Missing/invalid TWILIO_TOKEN');
    }
    const client = twilio(sid, token);
    console.log('sendSMS phoneNumber:', JSON.stringify(phoneNumber), 'type:', typeof phoneNumber, 'length:', phoneNumber?.length || 0);
    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim().length === 0) {
      console.error('Invalid phoneNumber, skipping SMS:', JSON.stringify(phoneNumber));
      return; // Skip invalid
    }
    phoneNumber = String(phoneNumber).trim().replace(/^["']|["']$/g, '');
    if (phoneNumber.startsWith('09') && phoneNumber.length === 11 && /^\d{11}$/.test(phoneNumber)) {
      phoneNumber = '+63' + phoneNumber.slice(1);
      console.log('Normalized PH number:', phoneNumber);
    }
    const fromPhone = twilioPhone.value().trim();
    if (phoneNumber.trim() === fromPhone) {
      console.log('Skipping SMS: to/from same number', phoneNumber);
      return;
    }
    console.log('Sending SMS from:', fromPhone.slice(0,6)+'...', 'to:', phoneNumber.trim());
    await client.messages.create({
      body: message,
      from: fromPhone,
      to: phoneNumber.trim()
    });
  } catch (error) {
    console.error('Error sending SMS:', error);
  }
}

exports.boohkOnBookingCreated = onDocumentCreated({ document: 'booking/{bookingId}', region: 'asia-southeast1', secrets: [twilioSid, twilioToken, twilioPhone] }, async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log('No data associated with the event');
    return;
  }
  const data = snapshot.data();
  const status = data.status;
  console.log('Booking created with initial status:', status);
  if (status && status.toLowerCase() === 'pending') {
    console.log('Company ID for pending booking:', data.company_id);
    const db = admin.firestore();
    const usersSnapshot = await db.collection('boohk_users').where('company_id', '==', data.company_id).where('roles', 'array-contains', 'sales').get();
    const phoneNumbers = usersSnapshot.docs.map(doc => ({id: doc.id, phone: doc.data().phone_number}));
    console.log('Sales users phone_numbers:', JSON.stringify(phoneNumbers));
    const promises = phoneNumbers.map(({phone}) => phone ? sendSMS(phone, 'A new booking is pending for your company.') : Promise.resolve());
    await Promise.all(promises);
  }
  // Handle initial status logic here
});

exports.boohkOnBookingUpdated = onDocumentUpdated({ document: 'booking/{bookingId}', region: 'asia-southeast1', secrets: [twilioSid, twilioToken, twilioPhone] }, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before.status !== after.status) {
    console.log('Status changed from', before.status, 'to', after.status);
    // Handle status change logic here
  }
  const currentStatus = after.status;
  if (currentStatus && currentStatus.toLowerCase() === 'pending') {
    console.log('Company ID for pending booking:', after.company_id);
    const db = admin.firestore();
    const usersSnapshot = await db.collection('boohk_users').where('company_id', '==', after.company_id).where('roles', 'array-contains', 'sales').get();
    const phoneNumbers = usersSnapshot.docs.map(doc => ({id: doc.id, phone: doc.data().phone_number}));
    console.log('Sales users phone_numbers:', JSON.stringify(phoneNumbers));
    const promises = phoneNumbers.map(({phone}) => phone ? sendSMS(phone, 'A new booking is pending for your company.') : Promise.resolve());
    await Promise.all(promises);
  }
});