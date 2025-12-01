const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const https = require('https');

// Initialize Firebase
admin.initializeApp();
/**
 * @typedef {Object} Notification
 * @property {string} company_id
 * @property {admin.firestore.Timestamp} created
 * @property {string} department_from
 * @property {string} department_to
 * @property {string} description
 * @property {string} navigate_to
 * @property {string} title
 * @property {string} type
 * @property {string|null} uid_to
 * @property {boolean} viewed
 * @property {string} appName
 */

// CloudSMS credentials
const CLOUDSMS_APP_KEY = '79FF094E62F044EE86A3929500D33504';
const CLOUDSMS_APP_SECRET = 'PkNbztqWI6iPmNpMqNvFboHpIHrG1zqXFcayjLEi';


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
    const fromPhone = "CloudSMS";
    if (phoneNumber.trim() === fromPhone) {
      console.log('Skipping SMS: to/from same number', phoneNumber);
      return;
    }
    console.log('Sending SMS from:', fromPhone, 'to:', phoneNumber.trim());

    const auth = Buffer.from(`${CLOUDSMS_APP_KEY}:${CLOUDSMS_APP_SECRET}`).toString('base64');
    const postData = JSON.stringify({
      destination: phoneNumber.trim(),
      message: message,
      type: 'sms'
    });

    const options = {
      hostname: 'api.cloudsms.io',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('Message sent successfully:', data);
        } else {
          console.error('Error sending SMS, status:', res.statusCode, 'response:', data);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error sending SMS:', error);
    });

    req.write(postData);
    req.end();
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
  schedule: '07 15 * * *',
  region: 'asia-southeast1',
  timeoutSeconds: 540,
  timeZone: 'Asia/Manila',
}, async (event) => {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();
  const threeDaysLater = admin.firestore.Timestamp.fromDate(
    new Date(now.toDate().getTime() + 3 * 24 * 60 * 60 * 1000)
  );
    console.log(`exports.boohkUpcomingBookingReminder = onSchedule({
 is running `);

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
  
    const notificationData = {
      created: admin.firestore.FieldValue.serverTimestamp(),
      department_from: 'System',
      department_to: 'User',
      description: message,
      navigate_to: `/booking/${docSnapshot.id}`,
      title: 'Upcoming Booking Reminder',
      type: 'Booking Reminder',
      uid_to: data.user_id,
      viewed: false,
      appName: 'wedflix',
    };
  
    const promise = (async () => {
      try {
        console.log(`Creating notification for booking ${docSnapshot.id}`);
        await db.collection('notifications').add(notificationData);
        console.log(`Notification created successfully for booking ${docSnapshot.id}`);
      } catch (error) {
        console.error(`Error creating notification for booking ${docSnapshot.id}:`, error);
        return;
      }

      const pushPromise = userData.fcm_token ? (async () => {
        console.log(`FCM token exists for user ${data.user_id}, sending push notification for booking ${docSnapshot.id}`);
        try {
          await admin.messaging().send({
            token: userData.fcm_token,
            notification: {
              title: 'Upcoming Booking Reminder',
              body: message
            }
          });
          console.log(`Push notification sent successfully for booking ${docSnapshot.id}`);
        } catch (error) {
          console.error(`Error sending push notification for booking ${docSnapshot.id}:`, error);
        }
      })() : (console.log(`No FCM token for user ${data.user_id}, skipping push notification for booking ${docSnapshot.id}`), Promise.resolve());

      const smsPromise = (async () => {
        console.log(`Sending SMS for booking ${docSnapshot.id} to ${userPhone.trim()}`);
        try {
          await sendSMS(userPhone.trim(), message);
          console.log(`SMS sent successfully for booking ${docSnapshot.id}`);
        } catch (error) {
          console.error(`Error sending SMS for booking ${docSnapshot.id}:`, error);
        }
      })();

      await Promise.all([pushPromise, smsPromise]);
    })();
  
    allPromises.push(promise);
  }

  if (allPromises.length > 0) {
    await Promise.all(allPromises);
    console.log('All upcoming booking reminders sent.');
  } else {
    console.log('No notifications to send.');
  }
});