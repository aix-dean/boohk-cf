const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { Vonage } = require('@vonage/server-sdk');

// Initialize Firebase
admin.initializeApp();

const apiKey = "17438318";
const apiSecret = "syE7YE8okR4bHAGc";


async function sendSMS(phoneNumber, message) {
  try {
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
    const fromPhone = "Vonage APIs";
    if (phoneNumber.trim() === fromPhone) {
      console.log('Skipping SMS: to/from same number', phoneNumber);
      return;
    }
    console.log('Sending SMS from:', fromPhone.slice(0,6)+'...', 'to:', phoneNumber.trim());
    const vonage = new Vonage({
      apiKey,
      apiSecret
    });
    const resp = await vonage.sms.send({
      to: phoneNumber.trim(),
      from: fromPhone,
      text: message
    });
    console.log('Message sent successfully:', resp);
  } catch (error) {
    console.error('Error sending SMS:', error);
  }
}

exports.boohkOnBookingCreated = onDocumentCreated({ document: 'booking/{bookingId}', region: 'asia-southeast1' }, async (event) => {
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

exports.boohkOnBookingUpdated = onDocumentUpdated({ document: 'booking/{bookingId}', region: 'asia-southeast1' }, async (event) => {
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