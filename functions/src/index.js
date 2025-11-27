const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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

exports.boohkUpcomingBookingReminder = onSchedule({
  schedule: '53 15 * * *',
  region: 'asia-southeast1',
  timeoutSeconds: 540,
  timeZone: 'Asia/Manila',
}, async (event) => {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const threeDaysLater = admin.firestore.Timestamp.fromDate(
    new Date(now.toDate().getTime() + 3 * 24 * 60 * 60 * 1000)
  );

  const bookingsSnapshot = await db.collection('booking')
    .where('start_date', '>=', now)
    .where('start_date', '<=', threeDaysLater)
    .get();

  console.log(`Found ${bookingsSnapshot.size} bookings starting within 3 days.`);

  const allPromises = [];

  for (const docSnapshot of bookingsSnapshot.docs) {
    const data = docSnapshot.data();

    const startDateStr = data.start_date ? data.start_date.toDate().toLocaleDateString() : 'unknown';
    let message = `Reminder: Booking ${data.product_name} starts within 3 days (${startDateStr}).`;
    const status = data.status;
    if (status === 'to pay' || status === 'TO PAY' || status === 'To Pay') {
      message += " Please complete payment for your booking.";
    }
    if (!data.url || data.url === '') {
      message += " Please upload media for your booking.";
    }

    const userRef = db.collection('wedflix_users').doc(data.user_id);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.log(`No wedflix_user found for booking ${docSnapshot.id} user_id: ${data.user_id}`);
      continue;
    }
    const userData = userDoc.data();
    const userPhone = userData.phone_number;
    if (!userPhone || typeof userPhone !== 'string' || userPhone.trim().length === 0) {
      console.log(`No valid phone for user ${data.user_id} in booking ${docSnapshot.id}`);
      continue;
    }

    console.log(`Booking ${docSnapshot.id}: notifying customer ${data.user_id}.`);

    const smsPromise = sendSMS(userPhone.trim(), message).then(() => {
      const notificationData = {
        user_id: data.user_id,
        message: message,
        timestamp: admin.firestore.Timestamp.now(),
        booking_id: docSnapshot.id,
      };
      if (data.product_name !== undefined) notificationData.product_name = data.product_name;
      if (data.start_date !== undefined) notificationData.start_date = data.start_date;
      if (data.status !== undefined) notificationData.status = data.status;
      if (data.product_id !== undefined) notificationData.product_id = data.product_id;
      if (data.company_id !== undefined) notificationData.company_id = data.company_id;
      return db.collection('boohk_notifications').add(notificationData);
    }).catch(error => {
      console.error(`Error sending SMS or creating notification for booking ${docSnapshot.id}:`, error);
    });
    allPromises.push(smsPromise);
  }

  if (allPromises.length > 0) {
    await Promise.all(allPromises);
    console.log('All upcoming booking reminders sent.');
  } else {
    console.log('No notifications to send.');
  }
});