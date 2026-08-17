import express from 'express';
import cors from 'cors';
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// قراءة ملف الـ JSON بأمان من البيئة أو ملف محلي لتجنب مشاكل الـ gitignore على Vercel
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error("Error parsing FIREBASE_SERVICE_ACCOUNT env variable:", err);
  }
}

if (!serviceAccount) {
  try {
    serviceAccount = JSON.parse(
      readFileSync(new URL('./service-account.json', import.meta.url))
    );
  } catch (err) {
    console.error("Failed to load service-account.json locally:", err.message);
  }
}

// تشغيل الفايربيز بالنظام الحديث المستقر والمضمون
if (serviceAccount) {
  initializeApp({
    credential: cert(serviceAccount)
  });
} else {
  initializeApp();
}

const db = getFirestore();
const messaging = getMessaging();

const normalizeArabic = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .toLowerCase()
    .trim();
};

// Helper لتنظيف العمليات القديمة التي مر عليها 24 ساعة (Soft Delete Cleanup)
const cleanupSoftDeletes = async (log) => {
  try {
    const now = new Date();
    log(`[Soft Delete Cleanup] Starting cleanup process at: ${now.toISOString()}`);
    
    // 1. Fetch expired soft deletes (expiresAt <= current time)
    const expiredSnap = await db.collection('soft_deletes')
      .where('status', '==', 'pending')
      .get();
      
    let deletedBatchesCount = 0;
    let deletedItemsCount = 0;

    for (const docSnap of expiredSnap.docs) {
      const data = docSnap.data();
      const expiresAt = new Date(data.expiresAt);
      
      if (expiresAt.getTime() <= now.getTime()) {
        const batchId = docSnap.id;
        log(`[Soft Delete Cleanup] Found expired batch: ${batchId} | Description: "${data.description}" | Expired At: ${expiresAt.toISOString()}`);
        
        // 2. Fetch all restoration items for this batch and delete them
        const itemsSnap = await db.collection('soft_deleted_items')
          .where('batchId', '==', batchId)
          .get();
          
        let batch = db.batch();
        let count = 0;
        
        for (const itemDoc of itemsSnap.docs) {
          batch.delete(itemDoc.ref);
          count++;
          deletedItemsCount++;
          if (count === 400) {
            await batch.commit();
            batch = db.batch();
            count = 0;
          }
        }
        
        // 3. Delete the main batch document
        batch.delete(docSnap.ref);
        
        if (count > 0 || itemsSnap.empty) {
          await batch.commit();
        }
        
        deletedBatchesCount++;
      }
    }
    
    log(`[Soft Delete Cleanup] Completed. Expired Batches Purged: ${deletedBatchesCount}, Expired Backup Items Purged: ${deletedItemsCount}`);
  } catch (error) {
    log(`[Soft Delete Cleanup 🚨] Error during cleanup: ${error.message}`);
  }
};

// Helper لمعالجة أعياد الميلاد التلقائية يومياً
const processBirthdays = async (log) => {
  try {
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    if (!settingsDoc.exists) return;
    const settings = settingsDoc.data();
    if (!settings.birthdayEnabled) {
      log('[Birthdays] Birthday notifications are disabled in settings.');
      return;
    }

    const cairoString = new Date().toLocaleString("sv-SE", { timeZone: "Africa/Cairo" });
    const nowInEgypt = new Date(cairoString.replace(' ', 'T'));
    const todayDateStr = `${nowInEgypt.getFullYear()}-${String(nowInEgypt.getMonth() + 1).padStart(2, '0')}-${String(nowInEgypt.getDate()).padStart(2, '0')}`;
    const currentMonthDay = `${String(nowInEgypt.getMonth() + 1).padStart(2, '0')}-${String(nowInEgypt.getDate()).padStart(2, '0')}`;

    // 1. التحقق من تشغيل العملية اليوم لمنع التكرار
    const runDocRef = db.collection('birthday_runs').doc(todayDateStr);
    const runDoc = await runDocRef.get();
    if (runDoc.exists) {
      log(`[Birthdays] Birthday notifications already processed today for date: ${todayDateStr}. Skipping.`);
      return;
    }

    log(`[Birthdays] Starting birthday greetings run for: ${currentMonthDay}`);
    let sentCount = 0;

    // Helper لإرسال الإشعار وحفظه في الـ inbox
    const sendGreeting = async (recipientId, name, fcmToken, messageTemplate, targetType) => {
      const replaceName = (text, name) => {
        if (!text) return '';
        return text
          .replace(/\(name\)/g, name)
          .replace(/\{name\}/g, name)
          .replace(/\[name\]/g, name)
          .replace(/\<name\>/g, name);
      };

      const title = 'عيد ميلاد سعيد! 🎉🎂';
      const body = replaceName(messageTemplate, name);
      const msgTag = `birthday-${recipientId}-${todayDateStr}`;

      // حفظ الإشعار في الـ inbox الداخلي
      await db.collection('notifications').add({
        title,
        body,
        senderId: 'system',
        senderName: 'خدمة كنيسة العذراء',
        senderRole: 'تهنئة تلقائية',
        recipientType: targetType,
        recipientIds: [recipientId],
        recipientNames: [name],
        createdAt: Timestamp.now(),
        publishAt: Timestamp.now(),
        sentCount: 1
      });

      // إرسال الـ FCM Push Notification إذا كان مسجلاً
      if (fcmToken) {
        const message = {
          data: {
            title: String(title),
            body: String(body),
            tag: msgTag
          },
          token: fcmToken,
          android: { priority: 'high' },
          apns: { headers: { 'apns-priority': '10' } }
        };
        try {
          await getMessaging().send(message);
          log(`[Birthdays ✅] Sent FCM birthday greeting to ${name}`);
        } catch (fcmErr) {
          log(`[Birthdays ❌] Failed to send FCM to ${name}: ${fcmErr.message}`);
          // تنظيف تلقائي للتوكنات التالفة أو غير المسجلة
          if (fcmErr.code === 'messaging/registration-token-not-registered' || 
              fcmErr.message.includes('registration-token-not-registered') || 
              fcmErr.message.includes('NotRegistered') ||
              fcmErr.message.includes('unregistered')) {
            try {
              const { FieldValue } = await import('firebase-admin/firestore');
              await db.collection(targetType).doc(recipientId).update({
                fcmToken: FieldValue.delete(),
                fcmTokens: FieldValue.delete()
              });
              log(`[Birthdays Cleanup] Removed dead token from ${name}`);
            } catch (cleanErr) {
              log(`[Birthdays Cleanup Error] failed for ${name}: ${cleanErr.message}`);
            }
          }
        }
      } else {
        log(`[Birthdays 🔔] Saved in-app notification only for ${name} (No FCM Token)`);
      }
      sentCount++;
    };

    // 2. فحص الخدام
    const servantsSnapshot = await db.collection('servants').get();
    for (const doc of servantsSnapshot.docs) {
      const data = doc.data();
      const bDate = data.birthDate;
      if (bDate && bDate.endsWith(currentMonthDay)) {
        const stage = data.stage || '';
        const template = (settings.stageBirthdayServantMessages && settings.stageBirthdayServantMessages[stage]) 
          || settings.birthdayServantMessage 
          || 'كل سنة وأنت طيب يا بطل {name}! سنة مباركة في خدمتك وعقبال سنين كتير 🎉';
        await sendGreeting(doc.id, data.name || '', data.fcmToken, template, 'servants');
      }
    }

    // 3. فحص المخدومين
    const studentsSnapshot = await db.collection('students').get();
    for (const doc of studentsSnapshot.docs) {
      const data = doc.data();
      const bDate = data.birthDate;
      if (bDate && bDate.endsWith(currentMonthDay)) {
        const assignedClass = data.assignedClass || '';
        const template = (settings.classBirthdayMessages && settings.classBirthdayMessages[assignedClass])
          || settings.birthdayStudentMessage
          || 'كل سنة وأنت طيب يا بطل {name}! مدرسة الأحد بتتمنالك سنة جميلة 🎉';
        await sendGreeting(doc.id, data.name || '', data.fcmToken, template, 'students');
      }
    }

    // تسجيل نجاح التشغيل اليوم
    await runDocRef.set({
      runAt: Timestamp.now(),
      sentCount
    });
    log(`[Birthdays] Finished birthday run. Sent greetings to ${sentCount} people.`);

  } catch (error) {
    log(`[Birthdays 🚨] Error running birthday greetings: ${error.message}`);
  }
};

// الـ API السهل والسريع
app.post('/api/send-notification', async (req, res) => {
  const { token, title, body } = req.body;

  // notification payload مع tag فريد
  const msgTag = `msg-${Date.now()}`;
  const message = {
    data: {
      title: String(title),
      body: String(body),
      tag: msgTag
    },
    token: token,
    android: {
      priority: 'high'
    },
    apns: {
      headers: { 'apns-priority': '10' }
    }
  };

  try {
    const response = await getMessaging().send(message);
    console.log('FCM sent successfully:', response);
    res.status(200).json({ success: true, response });
  } catch (error) {
    console.error('Error sending message:', error);
    // تنظيف تلقائي للتوكنات التالفة أو غير المسجلة
    if (error.code === 'messaging/registration-token-not-registered' || 
        error.message.includes('registration-token-not-registered') || 
        error.message.includes('NotRegistered') ||
        error.message.includes('unregistered')) {
      try {
        const { FieldValue } = await import('firebase-admin/firestore');
        const servants = await db.collection('servants').where('fcmToken', '==', token).get();
        for (const doc of servants.docs) {
          await doc.ref.update({ fcmToken: FieldValue.delete(), fcmTokens: FieldValue.delete() });
        }
        const students = await db.collection('students').where('fcmToken', '==', token).get();
        for (const doc of students.docs) {
          await doc.ref.update({ fcmToken: FieldValue.delete(), fcmTokens: FieldValue.delete() });
        }
        console.log(`[Token Auto-Cleanup] Removed unregistered token: ${token.substring(0, 10)}...`);
      } catch (cleanErr) {
        console.error('[Token Auto-Cleanup Error] failed:', cleanErr);
      }
    }
    res.status(550).json({ success: false, error: error.message });
  }
});

// API لتسجيل التوكن وتنظيفه من أي حسابات أخرى (سواء خدام أو مخدومين) لمنع تعارض الأجهزة المشتركة
app.post('/api/register-token', async (req, res) => {
  const { userId, collectionName, token } = req.body;
  if (!userId || !collectionName || !token) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    // 1. تنظيف التوكن من أي حساب خادم آخر
    const servantsSnapshot = await db.collection('servants').where('fcmToken', '==', token).get();
    for (const doc of servantsSnapshot.docs) {
      if (doc.id !== userId || collectionName !== 'servants') {
        const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
        await doc.ref.update({ 
          fcmToken: FieldValue.delete(),
          fcmTokens: FieldValue.delete()
        });
        console.log(`[Token Cleanup] Removed token from servant ${doc.id}`);
      }
    }

    // 2. تنظيف التوكن من أي حساب مخدوم آخر
    const studentsSnapshot = await db.collection('students').where('fcmToken', '==', token).get();
    for (const doc of studentsSnapshot.docs) {
      if (doc.id !== userId || collectionName !== 'students') {
        const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
        await doc.ref.update({ 
          fcmToken: FieldValue.delete(),
          fcmTokens: FieldValue.delete()
        });
        console.log(`[Token Cleanup] Removed token from student ${doc.id}`);
      }
    }

    // 3. تحديث التوكن في وثيقة المستخدم المستهدف
    await db.collection(collectionName).doc(userId).update({ fcmToken: token });
    console.log(`[Token Cleanup] Token saved successfully in ${collectionName}/${userId}`);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Token Cleanup 🚨] Error during registration:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint لمعالجة الإشعارات المجدولة
async function runScheduledNotificationsAndReports(log) {
  try {
    const now = new Date();
    const cairoString = new Date().toLocaleString("sv-SE", { timeZone: "Africa/Cairo" });
    const nowInEgypt = new Date(cairoString.replace(' ', 'T'));

    log(`[Scheduled Cron] Current Server Time (UTC): ${now.toISOString()}`);
    log(`[Scheduled Cron] Current Cairo Time (Parsed): ${nowInEgypt.toISOString()}`);

    // معالجة أعياد الميلاد التلقائية يومياً
    await processBirthdays(log);

    // تنظيف العمليات القديمة المحذوفة مؤقتاً (Soft Deletes)
    await cleanupSoftDeletes(log);

    const scheduledRef = db.collection('scheduled_notifications');
    // جلب كل المعلق فقط لتجنب طلب Composite Index وتسهيل معالجة الفروق الزمنية
    const snapshot = await scheduledRef
      .where('status', '==', 'pending')
      .get();

    let processedCount = 0;

    if (snapshot.empty) {
      log('[Scheduled Cron] No pending one-off scheduled notifications in database.');
    } else {
      log(`[Scheduled Cron] Found ${snapshot.size} pending notification(s) in database. Checking schedule times...`);

      for (const doc of snapshot.docs) {
      const data = doc.data();
      const docId = doc.id;
      const { title, body, tokens, senderId, senderName, senderRole, recipientType, recipientIds, recipientNames, createdAt, scheduledAt, sentCount } = data;

      // تحويل الـ scheduledAt لتاريخ صالح للمقارنة في سياق توقيت القاهرة الصافي
      let scheduledAtCairo = null;
      if (data.scheduledAtLocal) {
        // إذا كان الإصدار الجديد يحتوي على النص المحلي، نقوم بتحليله مباشرة كتاريخ بدون إزاحة (سياق القاهرة)
        scheduledAtCairo = new Date(data.scheduledAtLocal);
      } else if (scheduledAt) {
        // توافق رجعي مع الإشعارات القديمة: نحول الـ UTC Timestamp الفعلي لتوقيت القاهرة المقابل له
        const scheduledAtDate = scheduledAt.toDate ? scheduledAt.toDate() : new Date(scheduledAt);
        const scheduledCairoStr = scheduledAtDate.toLocaleString("en-US", { timeZone: "Africa/Cairo" });
        scheduledAtCairo = new Date(scheduledCairoStr);
      }

      if (!scheduledAtCairo || isNaN(scheduledAtCairo.getTime())) {
        log(`[Scheduled Cron ⚠️] Notification ${docId} has invalid scheduledAt date: ${JSON.stringify(scheduledAt)} or scheduledAtLocal: ${data.scheduledAtLocal}`);
        continue;
      }

      log(`[Scheduled Cron] Checking notification ${docId}: "${title}" | Scheduled Cairo: ${scheduledAtCairo.toLocaleString()} | Current Cairo Now: ${nowInEgypt.toLocaleString()}`);

      // مقارنة الوقت بالملي ثانية
      if (scheduledAtCairo.getTime() > nowInEgypt.getTime()) {
        log(`[Scheduled Cron] Notification ${docId} is scheduled for the future. Skipping.`);
        continue;
      }

      log(`[Scheduled Cron 🚀] Time reached for notification ${docId}. Starting send...`);
      processedCount++;

      // تحديث الحالة فوراً لمنع التكرار في حالة الاستدعاء المزدوج
      await scheduledRef.doc(docId).update({ status: 'sending' });

      let successfulSends = 0;
      if (tokens && Array.isArray(tokens) && tokens.length > 0) {
        for (const token of tokens) {
          const msgTag = `msg-${Date.now()}`;
          const message = {
            data: {
              title: String(title),
              body: String(body),
              tag: msgTag
            },
            token: token,
            android: { priority: 'high' },
            apns: { headers: { 'apns-priority': '10' } }
          };

          try {
            await messaging.send(message);
            successfulSends++;
          } catch (fcmErr) {
            log(`[Scheduled Cron ❌] Failed to send to token ${token.substring(0, 20)}...: ${fcmErr.message}`);
            // تنظيف تلقائي للتوكنات التالفة أو غير المسجلة
            if (fcmErr.code === 'messaging/registration-token-not-registered' || 
                fcmErr.message.includes('registration-token-not-registered') || 
                fcmErr.message.includes('NotRegistered') ||
                fcmErr.message.includes('unregistered')) {
              try {
                const { FieldValue } = await import('firebase-admin/firestore');
                const servants = await db.collection('servants').where('fcmToken', '==', token).get();
                for (const doc of servants.docs) {
                  await doc.ref.update({ fcmToken: FieldValue.delete(), fcmTokens: FieldValue.delete() });
                }
                const students = await db.collection('students').where('fcmToken', '==', token).get();
                for (const doc of students.docs) {
                  await doc.ref.update({ fcmToken: FieldValue.delete(), fcmTokens: FieldValue.delete() });
                }
                log(`[Scheduled Cron Cleanup] Removed unregistered token: ${token.substring(0, 10)}...`);
              } catch (cleanErr) {
                log(`[Scheduled Cron Cleanup Error] failed: ${cleanErr.message}`);
              }
            }
          }
        }
      }

      // إضافة الرسالة في جدول الـ Inbox بالـ Firestore ليراها المستخدم داخل جرس التطبيق
      await db.collection('notifications').add({
        title: title || '',
        body: body || '',
        senderId: senderId || 'admin',
        senderName: senderName || 'الأمين العام',
        senderRole: senderRole || 'أمين عام',
        recipientType: recipientType || 'students',
        recipientIds: recipientIds || [],
        recipientNames: recipientNames || [],
        createdAt: createdAt || Timestamp.now(),
        publishAt: scheduledAt || Timestamp.now(),
        sentCount: sentCount || 0
      });

      // حذف الإشعار المجدول بعد الإرسال الناجح لتنظيف قاعدة البيانات
      await scheduledRef.doc(docId).delete();
      log(`[Scheduled Cron ✅] Processed ${docId} successfully. Sent ${successfulSends}/${tokens ? tokens.length : 0} tokens.`);
    }
  }

  // === 1.5. معالجة الجدولة الدورية للتقارير السحابية (Periodic Schedules) ===
  try {
    const arabicDays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const currentDayArabic = arabicDays[nowInEgypt.getDay()];
    const dayKeys = {
      "الجمعة": "friday",
      "السبت": "saturday",
      "الأحد": "sunday",
      "الاثنين": "monday",
      "الثلاثاء": "tuesday",
      "الأربعاء": "wednesday",
      "الخميس": "thursday"
    };
    const currentDayKey = dayKeys[currentDayArabic];
    const currentCairoTimeStr = `${String(nowInEgypt.getHours()).padStart(2, '0')}:${String(nowInEgypt.getMinutes()).padStart(2, '0')}`;
    const todayCairoStr = `${nowInEgypt.getFullYear()}-${String(nowInEgypt.getMonth() + 1).padStart(2, '0')}-${String(nowInEgypt.getDate()).padStart(2, '0')}`;

    log(`[Periodic Schedules] Starting check for periodic reports...`);
    const schedulesSnap = await db.collection('periodicSchedules')
      .where('enabled', '==', true)
      .get();

    if (schedulesSnap.empty) {
      log('[Periodic Schedules] No active periodic schedules in database.');
    } else {
      log(`[Periodic Schedules] Found ${schedulesSnap.size} active schedule(s). Checking times...`);
      
      // Fetch config for template name
      const templateConfigDoc = await db.collection('report_templates').doc('config').get();
      const templateConfig = templateConfigDoc.exists ? templateConfigDoc.data() : {};
      
      for (const schDoc of schedulesSnap.docs) {
        const schData = schDoc.data();
        const schId = schDoc.id;
        
        const reportType = schData.filters?.reportType || 'monthly';
        const whatsappTemplateName = reportType === 'monthly'
          ? (templateConfig.whatsappTemplateNameMonthly || 'student_report_summary')
          : (templateConfig.whatsappTemplateNameWeekly || 'student_report_summary');
        
        let isTimeToRun = false;
        const scheduleMode = schData.scheduleMode || 'recurring';
        const schTime = schData.time || '20:00';
        
        if (scheduleMode === 'one_time') {
          isTimeToRun = schData.date === todayCairoStr && currentCairoTimeStr >= schTime;
        } else {
          isTimeToRun = schData.days && schData.days.includes(currentDayKey) && currentCairoTimeStr >= schTime;
        }
        
        if (!isTimeToRun) {
          continue;
        }
        
        const sentKey = `${todayCairoStr}_${schTime}`;
        if (schData.lastSentKey === sentKey) {
          log(`[Periodic Schedules] Schedule ${schId} already ran for key ${sentKey}. Skipping.`);
          continue;
        }
        
        log(`[Periodic Schedules 🚀] Running schedule ${schId} (${schData.type}) at Cairo time ${currentCairoTimeStr}...`);
        
        // Set sending state to prevent double execution in same minute
        await schDoc.ref.update({ lastSentKey: sentKey, updatedAt: new Date().toISOString() });
        
        const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        
        if (!accessToken || !phoneNumberId) {
          log(`[Periodic Schedules ❌] WhatsApp API credentials missing in environment variables!`);
          await db.collection('reportSendingLogs').add({
            recipientName: schData.type === 'admin' ? 'الأمين العام' : 'كل المستهدفين',
            recipientPhone: schData.type === 'admin' ? (schData.phoneNumber || 'غير محدد') : 'متعدد',
            type: schData.type || 'students',
            status: 'failed',
            errorMessage: 'بيانات اعتماد WhatsApp API (Access Token / Phone Number ID) غير مهيأة في بيئة الخادم.',
            timestamp: new Date().toISOString()
          });
          continue;
        }
        
        if (schData.type === 'admin') {
          try {
            const reportText = await compileAdminSummaryBackend(db, schData.filters, nowInEgypt);
            const adminPhone = schData.phoneNumber ? schData.phoneNumber.replace(/\D/g, '') : '';
            
            if (!adminPhone) {
              throw new Error('رقم الهاتف الخاص بالأمين العام غير محدد أو غير صالح.');
            }
            
            const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, adminPhone, reportText);
            
            await db.collection('reportSendingLogs').add({
              recipientName: 'الأمين العام (جدولة تلقائية)',
              recipientPhone: adminPhone,
              type: 'admin',
              status: success ? 'sent' : 'failed',
              errorMessage: success ? null : 'فشل إرسال الرسالة إلى واتساب - تحقق من الـ token وصلاحية الرقم',
              timestamp: new Date().toISOString()
            });
            
            log(`[Periodic Schedules ✅] Admin report sent to ${adminPhone}. Status: ${success ? 'Success' : 'Failed'}`);
          } catch (adminErr) {
            log(`[Periodic Schedules ❌] Error processing admin schedule ${schId}: ${adminErr.message}`);
            await db.collection('reportSendingLogs').add({
              recipientName: 'الأمين العام (جدولة تلقائية)',
              recipientPhone: schData.phoneNumber || 'غير معروف',
              type: 'admin',
              status: 'failed',
              errorMessage: adminErr.message,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          try {
            const filters = schData.filters || {};
            const { selectedStage, selectedClass, reportType } = filters;
            
            let studentsQuery = db.collection('students');
            let studentsSnap = await studentsQuery.get();
            let studentsList = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            if (selectedStage && selectedStage !== 'all') {
              studentsList = studentsList.filter(s => s.schoolGrade === selectedStage);
            }
            if (selectedClass && selectedClass !== 'all') {
              studentsList = studentsList.filter(s => s.assignedClass === selectedClass);
            }
            
            if (studentsList.length === 0) {
              log(`[Periodic Schedules] No students found matching filters.`);
              continue;
            }
            
            log(`[Periodic Schedules] Found ${studentsList.length} student(s) to send reports to.`);
            
            let start, end;
            if (reportType === 'monthly') {
              const selectedMonth = nowInEgypt.getMonth() + 1;
              const selectedYear = nowInEgypt.getFullYear();
              start = new Date(selectedYear, selectedMonth - 1, 1, 0, 0, 0);
              end = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);
            } else {
              const weeksList = generateWeeksBackend(12, nowInEgypt);
              const weekObj = weeksList[0];
              if (weekObj) {
                start = new Date(weekObj.fridayDate);
                start.setHours(0, 0, 0, 0);
                end = new Date(weekObj.thursdayDate);
                end.setHours(23, 59, 59, 999);
              } else {
                start = new Date();
                end = new Date();
              }
            }
            
            const pointsSnap = await db.collection('pointsHistory')
              .where('createdAt', '>=', Timestamp.fromDate(start))
              .where('createdAt', '<=', Timestamp.fromDate(end))
              .get();
            const pointsHistoryList = pointsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const sendPromises = studentsList.map(async (student) => {
              const parentPhone = getRecipientPhoneBackend(student);
              if (!parentPhone) {
                await db.collection('reportSendingLogs').add({
                  recipientName: student.name || 'مخدوم غير معروف',
                  recipientPhone: 'غير مسجل',
                  type: 'students',
                  status: 'failed',
                  errorMessage: 'لا توجد أرقام هواتف مسجلة للمخدوم أو والديه.',
                  timestamp: new Date().toISOString()
                });
                return;
              }
              
              const variables = compileStudentVariablesBackend(student, filters, pointsHistoryList, nowInEgypt);
              
              const success = await sendWhatsAppTemplateMessage(
                accessToken,
                phoneNumberId,
                parentPhone,
                whatsappTemplateName,
                variables
              );
              
              await db.collection('reportSendingLogs').add({
                recipientName: student.name || 'مخدوم',
                recipientPhone: parentPhone,
                type: 'students',
                status: success ? 'sent' : 'failed',
                errorMessage: success ? null : 'فشل إرسال القالب التلقائي عبر API - تأكد من ربط الرقم والقالب بنجاح',
                timestamp: new Date().toISOString()
              });
            });
            
            await Promise.all(sendPromises);
          } catch (studentsErr) {
            log(`[Periodic Schedules ❌] Error processing students schedule ${schId}: ${studentsErr.message}`);
          }
        }
      }
    }
  } catch (schedErr) {
    log(`[Periodic Schedules ❌] Global Cron Error: ${schedErr.message}`);
  }

  // === 2. معالجة التنبيهات الدورية (Periodic Alerts) ===
    log(`[Periodic Cron] Starting check for periodic alerts...`);
    const settingsRef = db.collection('settings').doc('notifications');
    const settingsDoc = await settingsRef.get();
    
    if (settingsDoc.exists) {
      const settingsData = settingsDoc.data();
      const periodicAlerts = settingsData.periodicAlerts || [];
      const arabicDays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
      
      const currentDayArabic = arabicDays[nowInEgypt.getDay()];
      const currentCairoTimeStr = `${String(nowInEgypt.getHours()).padStart(2, '0')}:${String(nowInEgypt.getMinutes()).padStart(2, '0')}`;
      const todayCairoStr = `${nowInEgypt.getFullYear()}-${String(nowInEgypt.getMonth() + 1).padStart(2, '0')}-${String(nowInEgypt.getDate()).padStart(2, '0')}`;
      
      log(`[Periodic Cron] Current day: ${currentDayArabic} | Current time: ${currentCairoTimeStr} | Date: ${todayCairoStr}`);
      
      let alertsUpdated = false;
      const updatedAlerts = [];
      
      for (const alert of periodicAlerts) {
        if (!alert.enabled) {
          updatedAlerts.push(alert);
          continue;
        }
        
        const dayMatches = alert.days && alert.days.includes(currentDayArabic);
        const timeMatches = alert.time === currentCairoTimeStr;
        const sentKey = `${todayCairoStr}_${alert.time}`;
        const alreadySent = alert.lastSentKey === sentKey;
        
        log(`[Periodic Cron] Checking alert ${alert.id} ("${alert.title}") | Days: [${alert.days?.join(', ')}] | Time: ${alert.time} | Matches Day: ${dayMatches} | Matches Time: ${timeMatches} | Already Sent: ${alreadySent} | Key: ${sentKey}`);
        
        if (dayMatches && timeMatches && !alreadySent) {
          log(`[Periodic Cron 🚀] Triggering alert ${alert.id} ("${alert.title}")...`);
          
          // 1. Resolve tokens and names for selected recipients (with dynamic attendance filtering)
          const recipientIds = alert.selectedRecipients || [];
          const targetType = alert.targetType || 'students';
          const recipientsWithTokens = [];
          const filteredRecipientIds = [];

          const replaceNamePlaceholder = (text, name) => {
            if (!text) return '';
            return text
              .replace(/\(name\)/g, name)
              .replace(/\{name\}/g, name)
              .replace(/\[name\]/g, name)
              .replace(/\<name\>/g, name);
          };

          const getAttendanceTargetDate = (baseDate) => {
            const date = new Date(baseDate);
            const day = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
            let daysToSubtract = 0;
            if (day === 6) daysToSubtract = 1;       // Saturday
            else if (day === 0) daysToSubtract = 2;  // Sunday
            else if (day === 1) daysToSubtract = 3;  // Monday
            else if (day === 2) daysToSubtract = 4;  // Tuesday
            else if (day === 3) daysToSubtract = 5;  // Wednesday
            else if (day === 4) daysToSubtract = 6;  // Thursday
            else if (day === 5) daysToSubtract = 0;  // Friday
            
            date.setDate(date.getDate() - daysToSubtract);
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          };

          const targetDateStr = getAttendanceTargetDate(nowInEgypt);
          log(`[Periodic Cron] Attendance target date for filtering: ${targetDateStr}`);

          const verifyAttendanceFilter = (docData) => {
            if (!alert.enableAttendanceFilter) return true;
            
            const attendance = docData.attendance || [];
            const liturgyAttendance = docData.liturgyAttendance || [];
            
            const attendedService = attendance.includes(targetDateStr);
            const attendedLiturgy = liturgyAttendance.includes(targetDateStr);
            
            if (alert.attendanceFilterType === 'attendedService') return attendedService;
            if (alert.attendanceFilterType === 'notAttendedService') return !attendedService;
            if (alert.attendanceFilterType === 'attendedLiturgy') return attendedLiturgy;
            if (alert.attendanceFilterType === 'notAttendedLiturgy') return !attendedLiturgy;
            return true;
          };
          
          if (targetType === 'servants' || targetType === 'both') {
            for (const rId of recipientIds) {
              const doc = await db.collection('servants').doc(rId).get();
              if (doc.exists) {
                const rData = doc.data();
                if (verifyAttendanceFilter(rData)) {
                  filteredRecipientIds.push(rId);
                  if (rData.fcmToken) {
                    // إضافة id و col لاستخدامهم في التنظيف التلقائي للتوكنات التالفة
                    recipientsWithTokens.push({ name: rData.name || '', token: rData.fcmToken, id: rId, col: 'servants' });
                  }
                }
              }
            }
          }
          if (targetType === 'students' || targetType === 'both') {
            for (const rId of recipientIds) {
              const doc = await db.collection('students').doc(rId).get();
              if (doc.exists) {
                const rData = doc.data();
                if (verifyAttendanceFilter(rData)) {
                  filteredRecipientIds.push(rId);
                  if (rData.fcmToken) {
                    // إضافة id و col لاستخدامهم في التنظيف التلقائي للتوكنات التالفة
                    recipientsWithTokens.push({ name: rData.name || '', token: rData.fcmToken, id: rId, col: 'students' });
                  }
                }
              }
            }
          }
          
          // 2. Broadcast push notifications (Data-Only for custom SW handling!)
          log(`[Periodic Cron] Found ${recipientsWithTokens.length} active recipient(s) for alert.`);
          for (const item of recipientsWithTokens) {
            const msgTag = `msg-${Date.now()}`;
            const pTitle = replaceNamePlaceholder(alert.title || 'تنبيه دوري', item.name);
            const pBody = replaceNamePlaceholder(alert.message || '', item.name);

            const message = {
              data: {
                title: String(pTitle),
                body: String(pBody),
                tag: msgTag
              },
              token: item.token,
              android: { priority: 'high' },
              apns: { headers: { 'apns-priority': '10' } }
            };
            
            try {
              await getMessaging().send(message);
            } catch (fcmErr) {
              log(`[Periodic Cron ❌] Failed to send to ${item.name} (${item.token.substring(0, 10)}...): ${fcmErr.message}`);
              // تنظيف تلقائي للتوكنات التالفة أو غير المسجلة
              if (fcmErr.code === 'messaging/registration-token-not-registered' || 
                  fcmErr.message.includes('registration-token-not-registered') || 
                  fcmErr.message.includes('NotRegistered') ||
                  fcmErr.message.includes('unregistered')) {
                try {
                  const { FieldValue } = await import('firebase-admin/firestore');
                  // استخدام item.col و item.id اللي تم حفظهم أثناء بناء القائمة
                  if (item.id && item.col) {
                    await db.collection(item.col).doc(item.id).update({
                      fcmToken: FieldValue.delete(),
                      fcmTokens: FieldValue.delete()
                    });
                  } else {
                    log(`[Periodic Cron Cleanup] Skipping cleanup for ${item.name} — missing id or col.`);
                  }
                  log(`[Periodic Cron Cleanup] Removed dead token from ${item.name}`);
                } catch (cleanErr) {
                  log(`[Periodic Cron Cleanup Error] failed for ${item.name}: ${cleanErr.message}`);
                }
              }
            }
          }
          
          // 3. Save in-app notification to notifications collection
          await db.collection('notifications').add({
            title: alert.title || 'تنبيه دوري',
            body: alert.message || '',
            senderId: 'system',
            senderName: 'خدمة كنيسة العذراء',
            senderRole: 'تنبيه تلقائي',
            recipientType: targetType,
            recipientIds: filteredRecipientIds,
            // استخدام الأسماء الفعلية للمستلمين بدلاً من القائمة الفارغة
            recipientNames: recipientsWithTokens.map(r => r.name),
            createdAt: Timestamp.now(),
            publishAt: Timestamp.now(),
            sentCount: filteredRecipientIds.length
          });
          
          // Mark as sent for this specific date+time combination
          alert.lastSentKey = sentKey;
          alertsUpdated = true;
          processedCount++;
        }
        
        updatedAlerts.push(alert);
      }
      
      if (alertsUpdated) {
        await settingsRef.update({ periodicAlerts: updatedAlerts });
        log(`[Periodic Cron ✅] Updated periodicAlerts array in database with new lastSentDate values.`);
      }
    }

    return processedCount;
  } catch (error) {
    log(`[Scheduled Cron ❌] Error: ${error.message}`);
    throw error;
  }
}

app.all('/api/process-scheduled', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  const debugLogs = [];
  const log = (msg) => {
    console.log(msg);
    debugLogs.push(msg);
  };

  try {
    const processedCount = await runScheduledNotificationsAndReports(log);
    res.status(200).json({ success: true, processedCount, logs: debugLogs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, logs: debugLogs });
  }
});

// Endpoint مؤقت للبحث وتصحيح الأخطاء
app.get('/api/debug-scheduled', async (req, res) => {
  try {
    const scheduledRef = db.collection('scheduled_notifications');
    const snapshot = await scheduledRef.get();
    const docs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.scheduledAt && data.scheduledAt.toDate) {
        data.scheduledAt = data.scheduledAt.toDate().toISOString();
      }
      if (data.createdAt && data.createdAt.toDate) {
        data.createdAt = data.createdAt.toDate().toISOString();
      }
      docs.push({ id: doc.id, ...data });
    });

    // جلب التنبيهات الدورية أيضاً
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    const periodicAlerts = settingsDoc.exists ? (settingsDoc.data().periodicAlerts || []) : [];

    res.status(200).json({ 
      count: docs.length, 
      docs,
      periodicAlertsCount: periodicAlerts.length,
      periodicAlerts 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint لمعرفة التوكنات المسجلة حالياً وتصحيح المشاكل
app.get('/api/debug-tokens', async (req, res) => {
  try {
    const servantsSnapshot = await db.collection('servants').get();
    const studentsSnapshot = await db.collection('students').get();

    const servants = [];
    servantsSnapshot.forEach(doc => {
      const data = doc.data();
      servants.push({
        id: doc.id,
        name: data.name,
        fcmToken: data.fcmToken || null,
        fcmTokens: data.fcmTokens || null
      });
    });

    const students = [];
    studentsSnapshot.forEach(doc => {
      const data = doc.data();
      students.push({
        id: doc.id,
        name: data.name,
        fcmToken: data.fcmToken || null,
        fcmTokens: data.fcmTokens || null
      });
    });

    res.status(200).json({ servants, students });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// WhatsApp API & Report Generation Helpers
// ==========================================

const generateWeeksBackend = (count, nowInEgypt) => {
    const weeks = [];
    const current = new Date(nowInEgypt);
    const day = current.getDay();
    const diff = (day >= 5) ? (day - 5) : (day + 2);
    current.setDate(current.getDate() - diff);
    
    for (let i = 0; i < count; i++) {
        const fri = new Date(current);
        const thu = new Date(current);
        thu.setDate(thu.getDate() + 6);
        
        const key = `${fri.getFullYear()}-${String(fri.getMonth() + 1).padStart(2, '0')}-${String(fri.getDate()).padStart(2, '0')}`;
        weeks.push({
            key,
            fridayDate: fri.toISOString().split('T')[0],
            thursdayDate: thu.toISOString().split('T')[0]
        });
        current.setDate(current.getDate() - 7);
    }
    return weeks;
};

const getRecipientPhoneBackend = (student) => {
    let targetPhone = student.preferredPhone || '';
    
    if (!targetPhone) {
        const options = [];
        
        // Parents contacts
        (student.parentsContacts || []).forEach(contact => {
            if (contact.phone) {
                options.push({
                    value: contact.phone,
                    type: contact.relation
                });
            }
        });

        // Student's own phones
        (student.phones || []).forEach(phone => {
            if (phone) {
                options.push({
                    value: phone,
                    type: 'student'
                });
            }
        });

        if (options.length === 0) return null;

        const isSecondary = student.schoolGrade === 'ثانوي';
        
        if (isSecondary) {
            const studentPhone = options.find(o => o.type === 'student');
            if (studentPhone) targetPhone = studentPhone.value;
        }

        if (!targetPhone) {
            const fatherPhone = options.find(o => o.type === 'father');
            if (fatherPhone) targetPhone = fatherPhone.value;
        }

        if (!targetPhone) {
            const motherPhone = options.find(o => o.type === 'mother');
            if (motherPhone) targetPhone = motherPhone.value;
        }

        if (!targetPhone) {
            targetPhone = options[0].value;
        }
    }

    let cleanPhone = targetPhone.replace(/\D/g, '');
    if (cleanPhone.startsWith('01')) {
        cleanPhone = '20' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('+')) {
        cleanPhone = cleanPhone.substring(1);
    }
    return cleanPhone;
};

const compileStudentVariablesBackend = (student, filters, pointsHistory, nowInEgypt) => {
    const reportType = filters.reportType || 'monthly';
    const selectedMonth = nowInEgypt.getMonth() + 1;
    const selectedYear = nowInEgypt.getFullYear();
    
    const firstName = (student.name || '').split(' ')[0] || '';
    const stageClass = student.assignedClass || student.schoolGrade || 'مدارس الأحد';
    
    const guessGender = (name) => {
        if (!name) return 'boy';
        const girlsNames = ['مريم', 'مارينا', 'جاستينا', 'يوستينا', 'دميانة', 'فيرونيا', 'كيرستينا', 'ميرنا', 'سارة', 'جولي', 'ميريت', 'ساندي', 'جوي', 'كارين', 'ماري', 'كريستينا', 'ميرا', 'ميرفت', 'شيري', 'ناردين', 'سوزان', 'شيرين', 'كاترين'];
        const first = name.trim().split(' ')[0];
        if (girlsNames.includes(first)) return 'girl';
        if (first.endsWith('ه') || first.endsWith('ا') || first.endsWith('ة') || first.endsWith('ي')) {
            const exceptions = ['مينا', 'ميشيل', 'ماريو', 'فادي', 'شادي', 'وجدي', 'مجدي', 'رمزي', 'عدلي', 'وصفي', 'صبري', 'هاني', 'سامي', 'فوزي', 'راضي', 'رامي', 'ناجي', 'عادل', 'بشاي'];
            if (!exceptions.includes(first)) {
                return 'girl';
            }
        }
        return 'boy';
    };
    
    const gender = student.gender || guessGender(student.name);
    const genderLabel = gender === 'boy' ? 'ابننا البطل' : 'بنتنا الجميلة';
    
    let massCount = '';
    let serviceCount = '';
    
    if (reportType === 'monthly') {
        const monthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
        const attendedMass = (student.liturgyAttendance || []).filter(d => d.startsWith(monthStr)).length;
        const attendedService = (student.attendance || []).filter(d => d.startsWith(monthStr)).length;
        
        let totalFridays = 0;
        const date = new Date(selectedYear, selectedMonth - 1, 1);
        let createdAtTime = 0;
        if (student.createdAt) {
            createdAtTime = student.createdAt.toDate ? student.createdAt.toDate().getTime() : new Date(student.createdAt).getTime();
        }
        while (date.getMonth() === selectedMonth - 1) {
            if (date.getDay() === 5) {
                const fridayEnd = new Date(selectedYear, selectedMonth - 1, date.getDate(), 23, 59, 59).getTime();
                if (createdAtTime === 0 || fridayEnd >= createdAtTime) {
                    totalFridays++;
                }
            }
            date.setDate(date.getDate() + 1);
        }
        if (totalFridays === 0) totalFridays = 1;
        
        massCount = `${attendedMass} من ${totalFridays}`;
        serviceCount = `${attendedService} من ${totalFridays}`;
    } else {
        const weeksList = generateWeeksBackend(12, nowInEgypt);
        const currentWeekKey = weeksList[0]?.key || '';
        const isServiceAttended = (student.attendance || []).includes(currentWeekKey);
        
        let isMassAttended = false;
        const weekObj = weeksList[0];
        if (weekObj) {
            const start = new Date(weekObj.fridayDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(weekObj.thursdayDate);
            end.setHours(23, 59, 59, 999);
            
            isMassAttended = (student.liturgyAttendance || []).some(dateStr => {
                const d = new Date(dateStr);
                return d >= start && d <= end;
            });
        }
        
        massCount = isMassAttended ? "حضر" : "لم يحضر";
        serviceCount = isServiceAttended ? "حضر" : "لم يحضر";
    }
    
    const monthKey = `${String(selectedMonth).padStart(2, '0')}-${selectedYear}`;
    const hasConfessed = student.confessions?.[monthKey]?.status === true;
    const confessionStatus = hasConfessed ? "تم الاعتراف ✅" : "لم يتم الاعتراف بعد";
    
    const studentLogs = pointsHistory.filter(log => log.studentId === student.id && (log.amount || 0) > 0);
    const reasons = studentLogs.map(log => log.reason).filter(Boolean);
    const uniqueReasons = [...new Set(reasons)];
    const traits = uniqueReasons.length > 0 ? uniqueReasons.join('، ') : "الالتزام وحسن السلوك";
    
    const notes = (student.notes || '').trim() || 'لا يوجد';
    
    return [
        stageClass,
        genderLabel,
        firstName,
        massCount,
        serviceCount,
        confessionStatus,
        notes
    ];
};

const compileAdminSummaryBackend = async (db, filters, nowInEgypt) => {
    const selectedStages = filters.selectedStages || [];
    const selectedClassesList = filters.selectedClassesList || [];
    const adminReportPeriod = filters.adminReportPeriod || 'weekly';
    const reportContentScope = filters.reportContentScope || 'both';
    const includeServantsSummary = filters.includeServantsSummary;
    const servantsScope = filters.servantsScope;
    
    const selectedMonth = nowInEgypt.getMonth() + 1;
    const selectedYear = nowInEgypt.getFullYear();
    
    const studentsSnap = await db.collection('students').get();
    const students = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const servantsSnap = await db.collection('servants').get();
    const servants = servantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const includeStudents = reportContentScope === 'both' || reportContentScope === 'students';
    const includeServants = reportContentScope === 'both' || reportContentScope === 'servants';
    
    let stageStudents = students.filter(s => selectedStages.includes(s.schoolGrade));
    if (selectedClassesList.length > 0) {
        stageStudents = stageStudents.filter(s => selectedClassesList.includes(s.assignedClass));
    }
    
    let stageServants = servants.filter(s => s.status === 'approved' && s.isActive !== false);
    if (servantsScope === 'classes') {
        stageServants = stageServants.filter(s => selectedClassesList.includes(s.assignedClass));
    } else {
        stageServants = stageServants.filter(s => {
            if (s.assignedStage && selectedStages.includes(s.assignedStage)) return true;
            return false;
        });
    }
    
    if (adminReportPeriod === 'monthly') {
        const fridays = [];
        const date = new Date(selectedYear, selectedMonth - 1, 1);
        while (date.getMonth() === selectedMonth - 1) {
            if (date.getDay() === 5) {
                fridays.push(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
            }
            date.setDate(date.getDate() + 1);
        }
        const N = fridays.length;
        
        let scopeLabel = reportContentScope === 'both' ? "خدام ومخدومين" : (reportContentScope === 'servants' ? "خدام" : "مخدومين");
        let msg = `📊 *تقرير ملخص الشهر للإدارة* 📊\n📅 الشهر: ${selectedMonth}-${selectedYear}\n🏛️ النطاق: ${selectedStages.join('، ')} (${scopeLabel})\n\n`;
        
        if (includeStudents) {
            let totalPossibleAll = 0;
            let totalServiceAll = 0;
            let totalMassAll = 0;
            let totalBothAll = 0;
            
            const classesToProcess = selectedClassesList.length > 0 ? selectedClassesList : [...new Set(stageStudents.map(s => s.assignedClass).filter(Boolean))];
            
            classesToProcess.forEach(cls => {
                const classSts = stageStudents.filter(s => s.assignedClass === cls);
                if (classSts.length === 0) return;
                
                let classPossible = 0;
                let classService = 0;
                let classMass = 0;
                let classBoth = 0;
                
                classSts.forEach(s => {
                    let createdAtTime = 0;
                    if (s.createdAt) {
                        createdAtTime = s.createdAt.toDate ? s.createdAt.toDate().getTime() : new Date(s.createdAt).getTime();
                    }
                    fridays.forEach(fStr => {
                        const fDate = new Date(fStr);
                        const fridayEnd = new Date(fDate.getFullYear(), fDate.getMonth(), fDate.getDate(), 23, 59, 59).getTime();
                        if (createdAtTime === 0 || fridayEnd >= createdAtTime) {
                            classPossible++;
                            const attendedService = (s.attendance || []).includes(fStr);
                            const nextThursday = new Date(fDate);
                            nextThursday.setDate(fDate.getDate() + 6);
                            nextThursday.setHours(23, 59, 59, 999);
                            const attendedMass = (s.liturgyAttendance || []).some(dateStr => {
                                const d = new Date(dateStr);
                                return d >= fDate && d <= nextThursday;
                            });
                            if (attendedService) classService++;
                            if (attendedMass) classMass++;
                            if (attendedService && attendedMass) classBoth++;
                        }
                    });
                });
                
                if (classPossible > 0) {
                    totalPossibleAll += classPossible;
                    totalServiceAll += classService;
                    totalMassAll += classMass;
                    totalBothAll += classBoth;
                }
            });
            
            if (totalPossibleAll > 0) {
                msg += `👥 *إحصائيات المخدومين إجمالياً*:\n`;
                msg += `🏫 نسبة حضور الخدمة: ${((totalServiceAll / totalPossibleAll) * 100).toFixed(1)}%\n`;
                msg += `⛪ نسبة حضور القداس: ${((totalMassAll / totalPossibleAll) * 100).toFixed(1)}%\n`;
                msg += `🌟 نسبة الالتزام المزدوج: ${((totalBothAll / totalPossibleAll) * 100).toFixed(1)}%\n\n`;
            }
        }
        
        if (includeServants && stageServants.length > 0) {
            if (includeServantsSummary) {
                let totalServantDaysPossible = stageServants.length * N;
                let totalServantDaysAttended = 0;
                stageServants.forEach(s => {
                    fridays.forEach(fStr => {
                        if ((s.attendance || []).includes(fStr)) {
                            totalServantDaysAttended++;
                        }
                    });
                });
                if (totalServantDaysPossible > 0) {
                    msg += `💼 *إحصائيات الخدام إجمالياً*:\n`;
                    msg += `🏫 نسبة حضور الخدمة للخدام: ${((totalServantDaysAttended / totalServantDaysPossible) * 100).toFixed(1)}%\n\n`;
                }
            }
        }
        msg += `صلوا لأجل الخدمة.`;
        return msg;
    } else {
        const weeksList = generateWeeksBackend(12, nowInEgypt);
        const weekObj = weeksList[0];
        const weekKey = weekObj?.key || '';
        
        let scopeLabel = reportContentScope === 'both' ? "خدام ومخدومين" : (reportContentScope === 'servants' ? "خدام" : "مخدومين");
        let msg = `📊 *تقرير ملخص الأسبوع للإدارة* 📊\n📅 الأسبوع: ${weekKey}\n🏛️ النطاق: ${selectedStages.join('، ')} (${scopeLabel})\n\n`;
        
        if (includeStudents) {
            let totalService = 0;
            let totalMass = 0;
            let totalBoth = 0;
            let totalCount = stageStudents.length;
            
            stageStudents.forEach(s => {
                const attendedService = (s.attendance || []).includes(weekKey);
                let attendedMass = false;
                if (weekObj) {
                    const start = new Date(weekObj.fridayDate);
                    start.setHours(0, 0, 0, 0);
                    const end = new Date(weekObj.thursdayDate);
                    end.setHours(23, 59, 59, 999);
                    attendedMass = (s.liturgyAttendance || []).some(dateStr => {
                        const d = new Date(dateStr);
                        return d >= start && d <= end;
                    });
                }
                if (attendedService) totalService++;
                if (attendedMass) totalMass++;
                if (attendedService && attendedMass) totalBoth++;
            });
            
            if (totalCount > 0) {
                msg += `👥 *إحصائيات المخدومين*:\n`;
                msg += `🏫 حضور الخدمة: ${totalService} مخدوم (${((totalService / totalCount) * 100).toFixed(1)}%)\n`;
                msg += `⛪ حضور القداس: ${totalMass} مخدوم (${((totalMass / totalCount) * 100).toFixed(1)}%)\n`;
                msg += `🌟 التزام مزدوج: ${totalBoth} مخدوم (${((totalBoth / totalCount) * 100).toFixed(1)}%)\n\n`;
            }
        }
        
        if (includeServants && stageServants.length > 0) {
            let attendedCount = 0;
            stageServants.forEach(s => {
                if ((s.attendance || []).includes(weekKey)) {
                    attendedCount++;
                }
            });
            msg += `💼 *إحصائيات حضور الخدام*:\n`;
            msg += `🏫 الحضور: ${attendedCount} خادم من أصل ${stageServants.length} (${((attendedCount / stageServants.length) * 100).toFixed(1)}%)\n\n`;
        }
        
        msg += `صلوا لأجل الخدمة.`;
        return msg;
    }
};

let currentKeyIndex = 0;
const callGeminiWithRotation = async (promptText, systemInstruction = "") => {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
  ].filter(Boolean);

  if (keys.length === 0) {
    throw new Error("No Gemini API keys configured");
  }

  let lastError = null;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyIndex = (currentKeyIndex + attempt) % keys.length;
    const apiKey = keys[keyIndex];
    
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`;
      const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      };

      if (systemInstruction) {
        payload.systemInstruction = {
          parts: [{ text: systemInstruction }]
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error?.message || response.statusText;
        throw new Error(`API Error ${response.status}: ${errMsg}`);
      }

      const data = await response.json();
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      currentKeyIndex = (keyIndex + 1) % keys.length;
      return textResponse;
    } catch (err) {
      console.error(`[Gemini API Error] Key index ${keyIndex} failed:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error("All Gemini API keys failed");
};

const sendWhatsAppTextMessage = async (token, phoneId, to, text) => {
    try {
        const response = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "text",
                text: { body: text }
            })
        });
        const resData = await response.json();
        if (!response.ok) {
            console.error('[WhatsApp Text Send Error]:', resData);
            return false;
        }
        return true;
    } catch (err) {
        console.error('[WhatsApp Text Exception]:', err);
        return false;
    }
};

const sendWhatsAppTemplateMessage = async (token, phoneId, to, templateName, variables) => {
    try {
        const parameters = variables.map(val => ({
            type: "text",
            text: String(val)
        }));
        
        const body = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: templateName === 'student_report_summary' ? 'ar_EG' : 'ar'
                },
                components: [
                    {
                        type: "body",
                        parameters: parameters
                    }
                ]
            }
        };
        
        const response = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        const resData = await response.json();
        if (!response.ok) {
            console.error('[WhatsApp Template Send Error]:', resData);
            return false;
        }
        return true;
    } catch (err) {
        console.error('[WhatsApp Template Exception]:', err);
        return false;
    }
};

// ==========================================
// WhatsApp Interactive Webhook Bot
// ==========================================

// Webhook Verification (GET /api/webhook)
app.get('/api/webhook', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'KhidmetyVerifyToken123';
  
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[Webhook Verification] Success!');
      res.status(200).send(challenge);
    } else {
      console.warn('[Webhook Verification] Failed. Token mismatch.');
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

app.get('/api/test-debug', async (req, res) => {
  const status = {
    firebase: 'untested',
    whatsapp: 'untested',
    gemini: 'untested',
    env: {
      has_whatsapp_token: !!process.env.WHATSAPP_ACCESS_TOKEN,
      has_whatsapp_phone_id: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
      has_firebase_service_account: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      has_gemini_key_1: !!process.env.GEMINI_API_KEY_1
    }
  };

  // Test Firebase
  try {
    const snap = await db.collection('students').limit(1).get();
    status.firebase = `success (found ${snap.size} students)`;
  } catch (err) {
    status.firebase = `error: ${err.message}`;
  }

  // Test Gemini
  try {
    const geminiReply = await callGeminiWithRotation("Hello, respond only with the word 'OK'", "Test system instruction");
    status.gemini = `success (reply: ${geminiReply})`;
  } catch (err) {
    status.gemini = `error: ${err.message}`;
  }

  // List available models
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models`;
    const listRes = await fetch(listUrl, {
      method: 'GET',
      headers: {
        'x-goog-api-key': process.env.GEMINI_API_KEY_1
      }
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      status.available_models = listData.models?.map(m => m.name) || [];
    } else {
      const errData = await listRes.json().catch(() => ({}));
      status.available_models = `error ${listRes.status}: ${errData.error?.message || listRes.statusText}`;
    }
  } catch (err) {
    status.available_models = `exception: ${err.message}`;
  }

  // Test WhatsApp Send (to a dummy number or the user's tester number if passed in query)
  const testPhone = req.query.phone;
  if (testPhone) {
    try {
      const success = await sendWhatsAppTextMessage(
        process.env.WHATSAPP_ACCESS_TOKEN,
        process.env.WHATSAPP_PHONE_NUMBER_ID,
        testPhone,
        "سلام ونعمة! هذا اختبار تفاعلي مباشر لسيرفر خدمتي السحابي. ⛪✨"
      );
      status.whatsapp = success ? 'success' : 'failed (check server logs for details)';
    } catch (err) {
      status.whatsapp = `error: ${err.message}`;
    }
  } else {
    status.whatsapp = 'skipped (pass ?phone=2010... in URL to test)';
  }

  res.json(status);
});

// Webhook Listener (POST /api/webhook)
app.post('/api/webhook', async (req, res) => {
  // Return a 200 OK immediately to Meta to acknowledge receipt and prevent retries
  res.sendStatus(200);

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.error('[Webhook] WhatsApp credentials missing from environment variables.');
    return;
  }

  try {
    const body = req.body;
    
    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Handle message status updates (sent, delivered, read, failed)
    if (value && value.statuses && value.statuses.length > 0) {
      const statusObj = value.statuses[0];
      const recipient = statusObj.recipient_id;
      const status = statusObj.status;
      console.log(`[Webhook Status] Message ${statusObj.id} status changed to: ${status} for recipient: ${recipient}`);
      
      if (status === 'failed' && statusObj.errors) {
        console.error(`[Webhook Status ❌] Delivery failed for message ${statusObj.id} to ${recipient}:`, statusObj.errors);
        
        try {
          const logsSnap = await db.collection('reportSendingLogs')
            .where('recipientPhone', '==', recipient)
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();
            
          if (!logsSnap.empty) {
            const docRef = logsSnap.docs[0].ref;
            const errDetail = statusObj.errors.map(e => `[${e.code}] ${e.message} - ${e.error_data?.details || ''}`).join(', ');
            await docRef.update({
              status: 'failed',
              errorMessage: `فشل تسليم الرسالة من طرف واتساب: ${errDetail}`
            });
            console.log(`[Webhook Status] Updated reportSendingLog document ${docRef.id} with delivery failure detail.`);
          }
        } catch (logErr) {
          console.error('[Webhook Status] Error updating reportSendingLogs:', logErr);
        }
      }
      return;
    }
    
    if (!value || !value.messages || value.messages.length === 0) {
      return;
    }

    const message = value.messages[0];
    
    if (message.type !== 'text') {
      return;
    }

    // Deduplication via Firestore: prevent double-processing of the same message ID
    const messageId = message.id;
    if (messageId) {
      const dedupRef = db.collection('webhookDedupLogs').doc(messageId);
      const dedupSnap = await dedupRef.get();
      if (dedupSnap.exists) {
        console.log(`[Webhook Bot ⚠️] Ignoring duplicate webhook delivery for message ID: ${messageId}`);
        return;
      }
      // Mark as processed (TTL: auto-delete via Firestore TTL policy or we do manual cleanup elsewhere)
      await dedupRef.set({ processedAt: new Date().toISOString() });
    }

    const senderPhone = message.from;
    const messageText = (message.text?.body || '').trim();

    if (!messageText) return;
    
    // Check if the webhook bot is enabled in settings
    const settingsDoc = await db.collection('settings').doc('notifications').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    const webhookBotEnabled = settings.webhookBotEnabled !== false; 
    
    if (!webhookBotEnabled) {
      console.log('[Webhook Bot] Disabled in settings. Ignoring message.');
      return;
    }

    console.log(`[Webhook Bot 📩] Received message from ${senderPhone}: "${messageText}"`);

    await processUserMessage(senderPhone, messageText, value, accessToken, phoneNumberId);

  } catch (err) {
    console.error('[Webhook Listener Error]:', err);
  }
});

// Main Message Processor
async function processUserMessage(senderPhone, messageText, value, accessToken, phoneNumberId) {
  try {
    // Scan database to identify the sender
    let cleanSenderPhone = senderPhone.replace(/\D/g, '');

    // Check if sender phone is in blockedNumbers collection (Blacklist)
    try {
      const blockedSnap = await db.collection('blockedNumbers').get();
      if (!blockedSnap.empty) {
        const last10Digits = cleanSenderPhone.slice(-10);
        const isBlocked = blockedSnap.docs.some(docSnap => {
          const data = docSnap.data();
          const bClean = (data.cleanPhone || data.phone || '').replace(/\D/g, '');
          if (!bClean) return false;
          return bClean.endsWith(last10Digits) || last10Digits.endsWith(bClean.slice(-10));
        });

        if (isBlocked) {
          console.warn(`[Webhook Bot 🚫] Sender ${senderPhone} (${cleanSenderPhone}) is in blocked list. Ignoring message.`);
          return;
        }
      }
    } catch (blockedErr) {
      console.error('[Blocked Check Error]:', blockedErr);
    }

    let senderInfoParts = [];
    let matchingAsServant = [];
    let matchingAsStudent = [];
    let matchingAsParent = [];

    try {
      const last10Digits = cleanSenderPhone.slice(-10);
      const phoneVariants = [
        last10Digits,
        `0${last10Digits}`,
        `20${last10Digits}`,
        `+20${last10Digits}`,
        cleanSenderPhone
      ].filter(Boolean);

      // Execute indexed queries in parallel
      const [fatherSnap, motherSnap, studentPhoneSnap, servantSnap] = await Promise.all([
        db.collection('students').where('fatherPhone', 'in', phoneVariants).get(),
        db.collection('students').where('motherPhone', 'in', phoneVariants).get(),
        db.collection('students').where('phone', 'in', phoneVariants).get(),
        db.collection('servants').where('phone', 'in', phoneVariants).get()
      ]);

      const parentStudentsMap = new Map();
      fatherSnap.docs.forEach(doc => parentStudentsMap.set(doc.id, { id: doc.id, ...doc.data() }));
      motherSnap.docs.forEach(doc => parentStudentsMap.set(doc.id, { id: doc.id, ...doc.data() }));

      matchingAsParent = Array.from(parentStudentsMap.values());

      // Emergency contacts check (fallback: only if parent not found, we fetch to check emergency contacts)
      if (matchingAsParent.length === 0) {
        console.log('[Webhook Bot] Direct queries yielded no parents. Running emergency contact fallback...');
        const studentsSnapForSender = await db.collection('students').get();
        const studentsListForSender = studentsSnapForSender.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        matchingAsParent = studentsListForSender.filter(s => {
          if (!Array.isArray(s.parentsContacts)) return false;
          return s.parentsContacts.some(contact => {
            if (!contact || !contact.phone) return false;
            const cleanContactPhone = String(contact.phone).replace(/\D/g, '');
            return cleanContactPhone.slice(-10) === last10Digits;
          });
        });
      }

      const studentMap = new Map();
      studentPhoneSnap.docs.forEach(doc => studentMap.set(doc.id, { id: doc.id, ...doc.data() }));
      matchingAsStudent = Array.from(studentMap.values());
      matchingAsServant = servantSnap.docs.map(doc => doc.data());

      if (matchingAsServant.length > 0) {
        senderInfoParts.push(`خادم: ${matchingAsServant[0].name}`);
      }
      if (matchingAsStudent.length > 0) {
        senderInfoParts.push(`مخدوم: ${matchingAsStudent[0].name}`);
      }
      if (matchingAsParent.length > 0) {
        const studentNames = matchingAsParent.map(s => s.name || 'مخدوم').join('، ');
        senderInfoParts.push(`ولي أمر: ${studentNames}`);
      }
    } catch (scanErr) {
      console.error('[Webhook Bot Sender Scan Error]:', scanErr);
    }

    const senderInfo = senderInfoParts.join(' / ') || 'رقم غير مسجل';

    // Normalize text and check if digits only
    const convertArabicNumerals = (str) => {
      const arabicNumerals = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
      let res = str;
      for (let i = 0; i < 10; i++) {
        res = res.replace(arabicNumerals[i], String(i));
      }
      return res;
    };
    
    const normalizedText = convertArabicNumerals(messageText);
    const isDigitsOnly = /^\d+$/.test(normalizedText);

    if (isDigitsOnly) {
      // BRANCH A: Digits only (skip AI, run legacy template code)
      const studentCode = normalizedText;
      
      let studentDoc = null;
      let studentData = null;
      
      let studentsQuery = await db.collection('students').where('code', '==', studentCode).get();
      if (studentsQuery.empty) {
        studentsQuery = await db.collection('students').where('student_code', '==', studentCode).get();
      }
      
      if (!studentsQuery.empty) {
        studentDoc = studentsQuery.docs[0];
        studentData = studentDoc.data();
      }

      if (!studentData) {
        console.log(`[Webhook Bot 🔍] Student code "${studentCode}" not found.`);
        await db.collection('webhookQueryLogs').add({
          senderPhone: senderPhone,
          senderInfo: senderInfo,
          studentCode: studentCode,
          studentName: 'غير معروف',
          status: 'failed',
          reason: 'كود الطالب غير مسجل في النظام',
          questionText: messageText || `استعلام كود: ${studentCode}`,
          replyText: 'كود الطالب غير مسجل في النظام',
          isAIQuery: true,
          timestamp: new Date().toISOString()
        });
        return;
      }

      const studentName = studentData.name || 'مخدوم';

      // 1. Gather registered parent phones
      const parentPhones = [];
      if (studentData.fatherPhone) parentPhones.push(String(studentData.fatherPhone).replace(/\D/g, ''));
      if (studentData.motherPhone) parentPhones.push(String(studentData.motherPhone).replace(/\D/g, ''));
      if (Array.isArray(studentData.parentsContacts)) {
        studentData.parentsContacts.forEach(contact => {
          if (contact && contact.phone) {
            parentPhones.push(String(contact.phone).replace(/\D/g, ''));
          }
        });
      }
      const cleanParentPhones = [...new Set(parentPhones.filter(Boolean))];

      // 2. Gather student personal phones
      const studentPhones = [];
      if (studentData.phone) studentPhones.push(String(studentData.phone).replace(/\D/g, ''));
      if (Array.isArray(studentData.phones)) {
        studentData.phones.forEach(p => {
          if (p) studentPhones.push(String(p).replace(/\D/g, ''));
        });
      }
      const cleanStudentPhones = [...new Set(studentPhones.filter(Boolean))];

      // 3. Apply business logic:
      // If parent phones exist, ONLY parent phones are authorized to query.
      // If NO parent phones exist, student personal phones can query as fallback.
      let authorizedPhones = [];
      if (cleanParentPhones.length > 0) {
        authorizedPhones = cleanParentPhones;
      } else {
        authorizedPhones = cleanStudentPhones;
      }

      const isAuthorized = authorizedPhones.some(phone => {
        if (!phone) return false;
        const normalizedPhone = phone.slice(-10);
        const normalizedSender = cleanSenderPhone.slice(-10);
        return normalizedPhone === normalizedSender && normalizedPhone.length >= 10;
      });

      if (!isAuthorized) {
        console.warn(`[Webhook Bot 🔒] Unauthorized query for ${studentName} (${studentCode}) from ${senderPhone}`);
        
        await db.collection('webhookQueryLogs').add({
          senderPhone: senderPhone,
          senderInfo: senderInfo,
          studentCode: studentCode,
          studentName: studentName,
          status: 'failed',
          reason: 'رقم الهاتف غير متطابق مع أرقام ولي الأمر المسجلة',
          questionText: messageText || `استعلام عن الكود: ${studentCode}`,
          replyText: 'رقم الهاتف غير متطابق مع أرقام ولي الأمر المسجلة',
          isAIQuery: true,
          timestamp: new Date().toISOString()
        });
        return;
      }

      console.log(`[Webhook Bot 🔓] Authorized query for ${studentName} from ${senderPhone}`);

      const cairoString = new Date().toLocaleString("sv-SE", { timeZone: "Africa/Cairo" });
      const nowInEgypt = new Date(cairoString.replace(' ', 'T'));
      
      const selectedMonth = nowInEgypt.getMonth() + 1;
      const selectedYear = nowInEgypt.getFullYear();
      const start = new Date(selectedYear, selectedMonth - 1, 1, 0, 0, 0);
      const end = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);

      const pointsSnap = await db.collection('pointsHistory')
        .where('createdAt', '>=', Timestamp.fromDate(start))
        .where('createdAt', '<=', Timestamp.fromDate(end))
        .get();
      const pointsHistoryList = pointsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Fetch configs for weekly and monthly templates
      const templateConfigDoc = await db.collection('report_templates').doc('config').get();
      const templateConfig = templateConfigDoc.exists ? templateConfigDoc.data() : {};

      const DEFAULT_MONTHLY_TEMPLATE = `"فَرِحْتُ بِالْقَائِلِينَ لِي: إِلَى بَيْتِ الرَّبِّ نَذْهَبُ" (مز 122)

سلام ونعمة يا فندم من خدمة مدارس أحد {stageClass}.
حابين نشارك مع حضراتكم تقرير {genderLabel} {firstName} خلال هذا الشهر:
⛪ حضور القداس الإلهي: {massCount}
🏫 حضور حوش الخدمة: {serviceCount}
🕊️ جلسة الاعتراف والافتقاد الدوري: {confessionStatus}.
📝 ملاحظات الخدمة: {notes}
صلوا لأجل الخدمة دائماً.`;

      const DEFAULT_WEEKLY_TEMPLATE = `"فَرِحْتُ بِالْقَائِلِينَ لِي: إِلَى بَيْتِ الرَّبِّ نَذْهَبُ" (مز 122)

سلام ونعمة يا فندم من خدمة مدارس أحد {stageClass}.
حابين نشارك مع حضراتكم تقرير {genderLabel} {firstName} خلال هذا الأسبوع:
⛪ حضور القداس الإلهي: {massCount}.
🏫 حضور حوش الخدمة: {serviceCount}.
🌟 صفات تميز بها هذا الأسبوع: {traits}.
🕊️ جلسة الاعتراف والافتقاد الدوري: {confessionStatus}.
📝 ملاحظات الخدمة: {notes}
صلوا لأجل الخدمة دائماً.`;

      const monthlyTemplate = templateConfig.monthlyTemplate || DEFAULT_MONTHLY_TEMPLATE;
      const weeklyTemplate = templateConfig.weeklyTemplate || DEFAULT_WEEKLY_TEMPLATE;

      const cleanMessage = (messageText || '').toLowerCase().trim();
      // Keywords for weekly report
      const isWeeklyQuery = /الاسبوع|أسبوع|جمعة|جمعه|المرة اللي فاتت|المرة الفاتت|المره اللي فاتت|المره الفاتت|جمعه فاتت/i.test(cleanMessage);

      let reportText = '';

      if (isWeeklyQuery) {
        // 1. Compile weekly variables
        const variables = compileStudentVariablesBackend(studentData, { reportType: 'weekly' }, pointsHistoryList, nowInEgypt);
        const [stageClass, genderLabel, firstName, massCount, serviceCount, confessionStatus, notes] = variables;
        
        // Compile weekly traits
        const studentLogs = pointsHistoryList.filter(log => log.studentId === studentDoc.id && (log.amount || 0) > 0);
        const reasons = studentLogs.map(log => log.reason).filter(Boolean);
        const uniqueReasons = [...new Set(reasons)];
        const traits = uniqueReasons.length > 0 ? uniqueReasons.join('، ') : "الالتزام وحسن السلوك";

        reportText = weeklyTemplate
          .replace(/{stageClass}/g, stageClass)
          .replace(/{genderLabel}/g, genderLabel)
          .replace(/{firstName}/g, firstName)
          .replace(/{massCount}/g, massCount)
          .replace(/{serviceCount}/g, serviceCount)
          .replace(/{traits}/g, traits)
          .replace(/{confessionStatus}/g, confessionStatus)
          .replace(/{notes}/g, notes || 'لا يوجد');
      } else {
        // 2. Compile monthly variables
        const variables = compileStudentVariablesBackend(studentData, { reportType: 'monthly' }, pointsHistoryList, nowInEgypt);
        const [stageClass, genderLabel, firstName, massCount, serviceCount, confessionStatus, notes] = variables;

        reportText = monthlyTemplate
          .replace(/{stageClass}/g, stageClass)
          .replace(/{genderLabel}/g, genderLabel)
          .replace(/{firstName}/g, firstName)
          .replace(/{massCount}/g, massCount)
          .replace(/{serviceCount}/g, serviceCount)
          .replace(/{confessionStatus}/g, confessionStatus)
          .replace(/{notes}/g, notes || 'لا يوجد');
      }

      const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, reportText);

      await db.collection('webhookQueryLogs').add({
        senderPhone: senderPhone,
        senderInfo: senderInfo,
        studentCode: studentCode,
        studentName: studentName,
        status: success ? 'sent' : 'failed',
        reason: success ? 'تم إرسال تقرير المخدوم بنجاح' : 'فشل إرسال رسالة الواتساب عبر الـ API',
        questionText: messageText || `طلب تقرير الكود ${studentCode}`,
        replyText: reportText,
        isAIQuery: true,
        timestamp: new Date().toISOString()
      });
      
    } else {
      // Check if servant asking for attendance
      const isServant = matchingAsServant.length > 0;
      const isParent = matchingAsParent.length > 0;
      const servantData = isServant ? matchingAsServant[0] : null;
      
      let isAttendanceReportQuery = false;
      if (isServant) {
        // A class report query must explicitly ask for the class report (e.g., "تقرير الفصل", "حضور الفصل", "كل الفصل", "كشف الفصل")
        // and MUST NOT ask about a specific student by name or code.
        const hasExplicitClassQuery = /تقرير الفصل|حضور الفصل|غياب الفصل|كل الفصل|كشف الفصل|كشف حضور|تقرير المخدومين|حضور فصلي|غياب فصلي/i.test(messageText);
        const hasIndividualStudentMatch = /\b\d{4}\b/.test(messageText) || /المخدوم\s+[\u0600-\u06FF]+/i.test(messageText) || /طالب\s+[\u0600-\u06FF]+/i.test(messageText);
        
        if (hasExplicitClassQuery && !hasIndividualStudentMatch) {
          isAttendanceReportQuery = true;
        }
      }

      if (isAttendanceReportQuery) {
        try {
          const cairoString = new Date().toLocaleString("sv-SE", { timeZone: "Africa/Cairo" });
          const todayEgyptStr = cairoString.split(' ')[0]; // YYYY-MM-DD
          
          let targetDateStr = todayEgyptStr;
          
          // 1. Check if they specify a date in YYYY-MM-DD format
          const dateMatch = messageText.match(/\b\d{4}-\d{2}-\d{2}\b/);
          if (dateMatch) {
            targetDateStr = dateMatch[0];
          } else {
            // 2. Check if they ask about "Friday" (الجمعة) or if today is NOT Friday and they just ask for report
            const mentionsToday = /نهاردة|نهارده|اليوم/i.test(messageText);
            const mentionsFriday = /جمعة|جمعه/i.test(messageText);
            const isTodayFriday = new Date(cairoString.replace(' ', 'T')).getDay() === 5;
            
            if (!mentionsToday && (mentionsFriday || !isTodayFriday)) {
              // Calculate most recent Friday
              const localDate = new Date(cairoString.replace(' ', 'T'));
              const day = localDate.getDay();
              let diff = day - 5;
              if (diff < 0) diff += 7;
              const target = new Date(localDate);
              target.setDate(localDate.getDate() - diff);
              targetDateStr = target.toISOString().split('T')[0];
            }
          }
          
          const servantClass = servantData.assignedClass || '';
          if (!servantClass) {
            const replyText = "سلام ونعمة يا قدس الخادم. لم نجد فصلاً مسجلاً باسمكم في النظام للاستعلام عنه. برجاء التواصل مع أمين الخدمة.";
            await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, replyText);
            return;
          }

          const classStudentsSnap = await db.collection('students').where('class', '==', servantClass).get();
          if (classStudentsSnap.empty) {
            const replyText = `سلام ونعمة يا قدس الخادم. لا يوجد مخدومين مسجلين في فصلك (${servantClass}) حالياً.`;
            await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, replyText);
            return;
          }
          
          const classStudents = classStudentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          
          const startOfDay = new Date(targetDateStr + 'T00:00:00');
          const endOfDay = new Date(targetDateStr + 'T23:59:59');
          
          const pointsSnap = await db.collection('pointsHistory')
            .where('createdAt', '>=', Timestamp.fromDate(startOfDay))
            .where('createdAt', '<=', Timestamp.fromDate(endOfDay))
            .get();
          
          const todayPointsList = pointsSnap.docs.map(doc => doc.data());
          const pointsMap = {}; // { studentId: totalPoints }
          todayPointsList.forEach(log => {
            if (log.studentId) {
              pointsMap[log.studentId] = (pointsMap[log.studentId] || 0) + (log.amount || 0);
            }
          });
          
          const attendedList = [];
          const absentList = [];
          
          classStudents.forEach(student => {
            const attendedService = (student.attendance || []).includes(targetDateStr);
            const attendedLiturgy = (student.liturgyAttendance || []).includes(targetDateStr);
            const todayPoints = pointsMap[student.id] || 0;
            
            if (attendedService || attendedLiturgy) {
              let attendLabel = "";
              if (attendedService && attendedLiturgy) attendLabel = "قداس وخدمة";
              else if (attendedLiturgy) attendLabel = "قداس فقط";
              else attendLabel = "خدمة فقط";
              
              attendedList.push({ name: student.name, label: attendLabel, points: todayPoints });
            } else {
              absentList.push(student.name);
            }
          });
          
          let reportMsg = `سلام ونعمة يا قدس الخادم / ${servantData.name || 'مبارك'} 🌸\n`;
          reportMsg += `تقرير حضور ونقاط فصل *(${servantClass})* يوم *(${targetDateStr})*:\n\n`;
          
          reportMsg += `🏫 *الحاضرون (${attendedList.length}):*\n`;
          if (attendedList.length === 0) {
            reportMsg += `- لا يوجد حضور مسجل لهذا اليوم بعد.\n`;
          } else {
            attendedList.forEach((s, idx) => {
              reportMsg += `${idx + 1}. 🌟 ${s.name} (${s.label}) -> ${s.points} نقطة\n`;
            });
          }
          
          reportMsg += `\n❌ *الغائبون (${absentList.length}):*\n`;
          if (absentList.length === 0) {
            reportMsg += `- لا يوجد غياب مسجل لهذا اليوم (الحضور كامل!).\n`;
          } else {
            absentList.forEach((name, idx) => {
              reportMsg += `${idx + 1}. ${name}\n`;
            });
          }
          
          reportMsg += `\nصلوا لأجل الخدمة دائماً.`;
          
          const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, reportMsg);
          
          await db.collection('webhookQueryLogs').add({
            senderPhone: senderPhone,
            senderInfo: `خادم: ${servantData.name} (${servantClass})`,
            studentCode: 'SERVANT_QUERY',
            studentName: 'تقرير الفصل',
            status: success ? 'sent' : 'failed',
            reason: success ? 'استعلام حضور الفصل للخدام' : 'فشل إرسال رسالة الواتساب عبر الـ API',
            questionText: messageText,
            replyText: reportMsg,
            isAIQuery: true,
            timestamp: new Date().toISOString()
          });
          return;
        } catch (servantErr) {
          console.error('[Servant Query Error]:', servantErr);
          const errReply = "عذراً يا قدس الخادم، حدث خطأ أثناء تجميع تقرير الفصل، برجاء المحاولة لاحقاً.";
          await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, errReply);
          return;
        }
      }

      // Pre-check for abusive / offensive / disrespect language
      const cleanMsgLower = (messageText || '').toLowerCase().trim();
      const abusiveKeywords = ['كفار', 'كافر', 'كفرة', 'شتيمة', 'انتم كفار', 'انتوا كفار', 'حرامية', 'يا كافر', 'ياكافر', 'كلاب', 'زبالة'];
      const isAbusive = abusiveKeywords.some(kw => cleanMsgLower.includes(kw));

      if (isAbusive) {
        console.warn(`[Webhook Bot 🛡️] Abusive message detected from ${senderPhone}: "${messageText}"`);
        const replyText = "سلام ونعمة يا فندم. نرجو الالتزام باللياقة والذوق العام في التعامل. هذه القناة مخصصة لخدمة مدارس الأحد وشؤون الكنيسة بكل احترام ومحبة. تم تسجيل الرسالة وتوجيهها للإدارة. ⛪";
        const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, replyText);

        await db.collection('webhookQueryLogs').add({
          senderPhone: senderPhone,
          senderInfo: senderInfo,
          studentCode: 'AI_MODERATION',
          studentName: 'تحذير ذوق عام',
          status: success ? 'sent' : 'failed',
          reason: 'تم الرد التلقائي برجاء الالتزام باللياقة والذوق العام',
          questionText: messageText,
          replyText: replyText,
          isAIQuery: true,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // BRANCH B: Free text (AI Path with Gemini key rotation and bulletproof fallback)
      try {
        const cleanJsonString = (str) => {
          if (!str) return "";
          try {
            const start = str.indexOf('{');
            const end = str.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
              return str.substring(start, end + 1).trim();
            }
          } catch (e) {}
          return str.replace(/```json/gi, '').replace(/```/g, '').trim();
        };

        // Fetch custom knowledge base from Firebase
        let kbText = "";
        try {
          const kbSnap = await db.collection('botKnowledgeBase').get();
          let hasSafetyRule = false;

          if (!kbSnap.empty) {
            kbText = "\nHere are custom questions previously answered by Sunday School servants, use them if the user's question matches:\n";
            kbSnap.docs.forEach(doc => {
              const data = doc.data();
              if (data.question && data.answer) {
                kbText += `Question: ${data.question}\nAnswer: ${data.answer}\n`;
                if (data.question.includes('الإساءة') || data.question.includes('غير اللائقة') || data.question.includes('الشتائم')) {
                  hasSafetyRule = true;
                }
              }
            });
          }

          if (!hasSafetyRule) {
            const safetyQuestion = "التعامل مع الرسائل غير اللائقة أو الشتائم والإساءة للخدمة والكنيسة";
            const safetyAnswer = "سلام ونعمة يا فندم. نرجو الالتزام باللياقة والذوق العام في التعامل. هذه القناة مخصصة لخدمة مدارس الأحد وشؤون الكنيسة بكل احترام ومحبة. تم تسجيل الرسالة وتوجيهها للإدارة. ⛪";
            await db.collection('botKnowledgeBase').add({
              question: safetyQuestion,
              answer: safetyAnswer,
              addedBy: "النظام (قواعد اللياقة والوقاية)",
              timestamp: new Date().toISOString()
            });
            kbText += `Question: ${safetyQuestion}\nAnswer: ${safetyAnswer}\n`;
          }
        } catch (kbErr) {
          console.error('[KB Fetch Error]:', kbErr);
        }

        const classificationPrompt = `You are a smart AI classifier for the "Khidmety" (خدمتي) Sunday School system.
Your job is to analyze the incoming message from a parent or user and return a JSON object classifying their intent.

CRITICAL READING & COMPREHENSION RULE:
You MUST read and analyze the ENTIRE user message from the very first word to the VERY LAST character.
Do not stop reading early, do not skip trailing text or URLs, and do not base your intent on just the opening greeting.
Pay attention to the full context, stories, or the core question placed at the end of the message. Understand what the user fundamentally wants across their whole text.

CRITICAL SAFETY & MODERATION RULE:
If the user's message contains profanity, insults, offensive words, aggressive attacks, or disrespect towards the church, Sunday school service, or servants:
Do NOT argue or repeat offensive words. Set intent to "general_question" and return this exact respectful boundary response in "reply":
"سلام ونعمة يا فندم. نرجو الالتزام باللياقة والذوق العام في التعامل. هذه القناة مخصصة لخدمة مدارس الأحد وشؤون الكنيسة بكل احترام ومحبة. تم تسجيل الرسالة وتوجيهها للإدارة. ⛪"

You must categorize the message into one of three intents:
1. "student_query": The user is asking about an INDIVIDUAL single student (their attendance today, their report, behavior, traits, or grades). ONLY use "student_query" if the message mentions an individual student's name, a 4-digit student code, or a parent asking specifically about their own child ("ابني", "بنتي").
   For "student_query", determine:
   - "query_type": "full_report" | "specific_attendance" | "none"
   - "student_code": 4-digit code if present in the message, otherwise null.

2. "general_question": The user is asking a general question about church schedule, service times, location, feast dates, or general greeting. (e.g., "القداس بكرة الساعة كام؟", "كل سنة وانتم طيبين", "مواعيد مدارس الاحد ايه؟").
   Use the following facts and custom Knowledge Base to answer:
   - Sunday school service (مدارس الأحد): Every Friday at 8:00 AM starts with Liturgy (القداس الإلهي), followed by class lessons from 9:30 AM to 11:00 AM.
   - Location: Church of Saint George (كنيسة مارجرجس).
   - Confession fathers (آباء الاعتراف) are available after the Friday service.
   ${kbText}

3. "unknown_question": The user is asking about something not covered in the facts or KB (e.g. details about a specific trip, registration, servant reports, list requests, complex requests, etc.).
   Generate a polite apology in Egyptian Arabic saying that this information is not available right now with the bot, but has been forwarded to the servants/admins to handle soon. Put this in "reply".

Respond ONLY with JSON format:
{
  "intent": "student_query" | "general_question" | "unknown_question",
  "query_type": "full_report" | "specific_attendance" | "none",
  "student_code": "1001" | null,
  "issue_type": "service_issue" | "tech_issue" | "none",
  "reply": "..."
}
Rule for "issue_type":
- "service_issue": Set to "service_issue" if the message complains about Sunday School physical service, room heat, AC, chairs, bus, hall, noise, food, schedule, or field logistics (e.g., "الجو حر", "التكييف مش شغال", "مفيش كراسي", "الباص اتأخر").
- "tech_issue": Set to "tech_issue" if the message complains about website bugs, app glitches, bot response delays, server issues, or technical problems (e.g., "البوت بطيء", "في مشكلة في الرد", "الرابط مش شغال").
- "none": Set to "none" if the message is a regular question, greeting, or student query without complaints.

Respond ONLY with valid JSON. Do not include markdown formatting or \`\`\`json blocks.`;

        console.log(`[Webhook Bot AI 🤖] Calling Gemini for intent classification from ${senderPhone}...`);
        const geminiResponseText = await callGeminiWithRotation(messageText, classificationPrompt);
        
        const extractReplyAndIntent = (rawText) => {
            let result = {
                intent: 'general_question',
                query_type: 'none',
                student_code: null,
                issue_type: 'none',
                reply: ''
            };
            if (!rawText || typeof rawText !== 'string') return result;

            const cleanedStr = cleanJsonString(rawText);

            try {
                const parsed = JSON.parse(cleanedStr);
                if (parsed && typeof parsed === 'object') {
                    result.intent = parsed.intent || result.intent;
                    result.query_type = parsed.query_type || result.query_type;
                    result.student_code = parsed.student_code || result.student_code;
                    result.issue_type = parsed.issue_type || result.issue_type;
                    if (parsed.reply && typeof parsed.reply === 'string') {
                        result.reply = parsed.reply.trim();
                        return result;
                    }
                }
            } catch (e) {
                console.warn('[Gemini JSON Parse Warning - using fallback regex extraction]:', e.message);
            }

            const intentMatch = rawText.match(/"intent"\s*:\s*"([^"]+)"/i);
            if (intentMatch) result.intent = intentMatch[1];

            const issueTypeMatch = rawText.match(/"issue_type"\s*:\s*"([^"]+)"/i);
            if (issueTypeMatch) result.issue_type = issueTypeMatch[1];

            const studentCodeMatch = rawText.match(/"student_code"\s*:\s*"([^"]+)"/i);
            if (studentCodeMatch) result.student_code = studentCodeMatch[1];

            const queryTypeMatch = rawText.match(/"query_type"\s*:\s*"([^"]+)"/i);
            if (queryTypeMatch) result.query_type = queryTypeMatch[1];

            const replyMatch = rawText.match(/"reply"\s*:\s*"([\s\S]*?)"(?:\s*,\s*"|\s*\}\s*$)/i) ||
                               rawText.match(/"reply"\s*:\s*"([\s\S]*?)"/i);
            if (replyMatch && replyMatch[1]) {
                result.reply = replyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
            } else {
                let sanitized = rawText
                    .replace(/\{\s*"intent"[\s\S]*?"reply"\s*:\s*"/gi, '')
                    .replace(/"\s*\}\s*$/gi, '')
                    .replace(/```json/gi, '')
                    .replace(/```/g, '')
                    .trim();
                result.reply = sanitized;
            }

            return result;
        };

        const parsedResponse = extractReplyAndIntent(geminiResponseText);
        const intent = parsedResponse.intent || 'general_question';
        const issueType = parsedResponse.issue_type || 'none';
        
        if (intent === 'general_question') {
          // GENERAL QUESTION ROUTE
          const replyText = parsedResponse.reply || 'أهلاً بك يا فندم! كيف يمكنني مساعدتك؟';
          const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, replyText);

          await db.collection('webhookQueryLogs').add({
            senderPhone: senderPhone,
            senderInfo: senderInfo,
            studentCode: 'AI_GENERAL',
            studentName: 'سؤال عام',
            status: success ? 'sent' : 'failed',
            reason: success ? `تم الإجابة تلقائياً: ${messageText.slice(0, 30)}` : 'فشل إرسال رسالة الواتساب عبر الـ API',
            questionText: messageText,
            replyText: replyText,
            issueType: issueType,
            isAIQuery: true,
            timestamp: new Date().toISOString()
          });
          
        } else if (intent === 'unknown_question') {
          // UNKNOWN QUESTION ROUTE
          const replyText = parsedResponse.reply || 'سلام ونعمة يا فندم. المعلومة دي مش متوفرة عندي حالياً، لكن تم توجيه سؤالك لخدام الكنيسة ومتابعته فوراً! ⛪';
          const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, replyText);

          // Save to unansweredQuestions in Firestore
          await db.collection('unansweredQuestions').add({
            senderPhone: senderPhone,
            senderInfo: senderInfo,
            questionText: messageText,
            timestamp: new Date().toISOString(),
            status: 'pending'
          });

          await db.collection('webhookQueryLogs').add({
            senderPhone: senderPhone,
            senderInfo: senderInfo,
            studentCode: 'AI_UNANSWERED',
            studentName: 'سؤال معلق',
            status: success ? 'sent' : 'failed',
            reason: success ? 'سؤال معلق وتم توجيهه للخدام بنجاح' : 'فشل إرسال رسالة الواتساب عبر الـ API',
            questionText: messageText,
            replyText: replyText,
            issueType: issueType,
            isAIQuery: true,
            timestamp: new Date().toISOString()
          });
          
        } else if (intent === 'student_query') {
          // STUDENT QUERY ROUTE
          let targetStudent = null;
          const codeCandidate = parsedResponse.student_code || (messageText.match(/\b\d{4,}\b/)?.[0]);
          
          if (codeCandidate) {
            let query = await db.collection('students').where('code', '==', codeCandidate).get();
            if (query.empty) {
              query = await db.collection('students').where('student_code', '==', codeCandidate).get();
            }
            if (!query.empty) {
              targetStudent = { id: query.docs[0].id, ...query.docs[0].data() };
            }
          }
          
          if (!targetStudent) {
            // Find candidates by phone mapping
            const candidates = [];
            candidates.push(...matchingAsParent, ...matchingAsStudent);
            
            const uniqueCandidates = [];
            const seenIds = new Set();
            for (const c of candidates) {
              if (!seenIds.has(c.id)) {
                seenIds.add(c.id);
                uniqueCandidates.push(c);
              }
            }
            
            if (uniqueCandidates.length === 1) {
              targetStudent = uniqueCandidates[0];
            } else if (uniqueCandidates.length > 1) {
              const msgNorm = normalizeArabic(messageText);
              let foundByName = null;
              for (const cand of uniqueCandidates) {
                const firstName = cand.name ? cand.name.trim().split(' ')[0] : '';
                if (firstName && msgNorm.includes(normalizeArabic(firstName))) {
                  foundByName = cand;
                  break;
                }
              }
              targetStudent = foundByName || uniqueCandidates[0];
            }
          }

          // Fallback search by student name across entire database if targetStudent is still null
          if (!targetStudent) {
            const cleanMsgNorm = normalizeArabic(messageText);
            const stopWords = new Set(['عاوز', 'عايز', 'اعرف', 'حضور', 'غياب', 'المخدوم', 'الطالب', 'الاسبوع', 'أسبوع', 'اللي', 'فات', 'الماضي', 'الجمعة', 'جمعة', 'تقرير', 'مخدوم', 'طالب', 'ابني', 'بنتي', 'سلام', 'ونعمة', 'قدس', 'الخادم', 'عن', 'هو', 'هي', 'حضر', 'ولا', 'لأ', 'لا']);
            
            const words = cleanMsgNorm
              .replace(/[^\u0600-\u06FF\w\s]/g, ' ')
              .split(/\s+/)
              .filter(w => w.length >= 2 && !stopWords.has(w));

            if (words.length > 0) {
              const allStudentsSnap = await db.collection('students').get();
              let bestMatch = null;
              let maxScore = 0;

              allStudentsSnap.docs.forEach(docSnap => {
                const sData = docSnap.data();
                if (!sData.name) return;
                const sNameNorm = normalizeArabic(sData.name);

                let score = 0;
                for (const w of words) {
                  if (sNameNorm.includes(w)) {
                    score += 1;
                  }
                }

                if (score > maxScore) {
                  maxScore = score;
                  bestMatch = { id: docSnap.id, ...sData };
                }
              });

              if (bestMatch && maxScore >= 1) {
                targetStudent = bestMatch;
                console.log(`[Webhook Bot 🎯] Identified student by name search: "${targetStudent.name}" (score: ${maxScore})`);
              }
            }
          }

          if (!targetStudent) {
            // Fallback if no specific code or student name was in message
            if (!codeCandidate) {
              console.log('[Webhook Bot AI 🔄] Misclassified request without student code. Forwarding to unanswered questions.');
              const replyText = parsedResponse.reply || "سلام ونعمة يا فندم. المعلومة دي مش متوفرة عندي حالياً، لكن تم توجيه سؤالك لخدام الكنيسة ومتابعته فوراً! ⛪";
              const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, replyText);

              await db.collection('unansweredQuestions').add({
                senderPhone: senderPhone,
                senderInfo: senderInfo,
                questionText: messageText,
                timestamp: new Date().toISOString(),
                status: 'pending'
              });

              await db.collection('webhookQueryLogs').add({
                senderPhone: senderPhone,
                senderInfo: senderInfo,
                studentCode: 'AI_UNANSWERED',
                studentName: 'سؤال معلق',
                status: success ? 'sent' : 'failed',
                reason: success ? 'سؤال معلق وتم توجيهه للخدام بنجاح' : 'فشل إرسال رسالة الواتساب عبر الـ API',
                questionText: messageText,
                replyText: replyText,
                isAIQuery: true,
                timestamp: new Date().toISOString()
              });
              return;
            }

            // Student code was explicitly supplied but not found
            const replyText = "سلام ونعمة يا فندم. لم نتمكن من تحديد كود أو اسم المخدوم المراد الاستعلام عنه من رسالتكم، أو أن الهاتف غير مسجل في قاعدة البيانات. برجاء إرسال الكود بالأرقام مباشرة (مثل: 1001) للحصول على تقريره.";
            const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, replyText);
            
            await db.collection('webhookQueryLogs').add({
              senderPhone: senderPhone,
              senderInfo: senderInfo,
              studentCode: 'AI_UNKNOWN_STUDENT',
              studentName: 'مجهول',
              status: success ? 'sent' : 'failed',
              reason: 'لم يتم العثور على مخدوم مرتبط بالرسالة أو بالرقم المتصل',
              timestamp: new Date().toISOString()
            });
            return;
          }

          // Authorization Check
          const parentPhones = [];
          if (targetStudent.fatherPhone) parentPhones.push(String(targetStudent.fatherPhone).replace(/\D/g, ''));
          if (targetStudent.motherPhone) parentPhones.push(String(targetStudent.motherPhone).replace(/\D/g, ''));
          if (Array.isArray(targetStudent.parentsContacts)) {
            targetStudent.parentsContacts.forEach(contact => {
              if (contact && contact.phone) {
                parentPhones.push(String(contact.phone).replace(/\D/g, ''));
              }
            });
          }
          const cleanParentPhones = [...new Set(parentPhones.filter(Boolean))];

          const studentPhones = [];
          if (targetStudent.phone) studentPhones.push(String(targetStudent.phone).replace(/\D/g, ''));
          if (Array.isArray(targetStudent.phones)) {
            targetStudent.phones.forEach(p => {
              if (p) studentPhones.push(String(p).replace(/\D/g, ''));
            });
          }
          const cleanStudentPhones = [...new Set(studentPhones.filter(Boolean))];

          let authorizedPhones = [];
          if (cleanParentPhones.length > 0) {
            authorizedPhones = cleanParentPhones;
          } else {
            authorizedPhones = cleanStudentPhones;
          }

          const isAuthorized = isServant || authorizedPhones.some(phone => {
            if (!phone) return false;
            const normalizedPhone = phone.slice(-10);
            const normalizedSender = cleanSenderPhone.slice(-10);
            return normalizedPhone === normalizedSender && normalizedPhone.length >= 10;
          });
          
          if (!isAuthorized) {
            const replyText = `عذراً يا فندم، رقم هاتفكم غير مسجل كولي أمر للمخدوم ${targetStudent.name || ''} ولا تملكون صلاحية الاستعلام عنه. برجاء التواصل مع أمين الخدمة.`;
            const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, replyText);
            
            await db.collection('webhookQueryLogs').add({
              senderPhone: senderPhone,
              senderInfo: senderInfo,
              studentCode: targetStudent.code || 'AI_QUERY',
              studentName: targetStudent.name || 'غير مصرح له',
              status: success ? 'sent' : 'failed',
              reason: 'غير مصرح له بالاستعلام عن هذا الطالب عبر الذكاء الاصطناعي',
              timestamp: new Date().toISOString()
            });
            return;
          }
          
          // Servant Profile / Details Query Route (Code, Address, Phones, Confession Father, Notes)
          if (isServant && /عنوان|تليفون|تلفون|رقم|أرقام|ارقام|كود|بيانات|تفاصيل|معلومات|اب الاعتراف|أب الاعتراف/i.test(messageText)) {
            const code = targetStudent.student_code || targetStudent.code || 'غير مسجل';
            const name = targetStudent.name || 'مخدوم';
            const studentClass = targetStudent.assignedClass || targetStudent.stage || 'الفصل';
            const address = targetStudent.address || 'غير مسجل في النظام';
            const fatherPhone = targetStudent.fatherPhone || 'غير مسجل';
            const motherPhone = targetStudent.motherPhone || 'غير مسجل';
            const studentPhone = targetStudent.phone || 'غير مسجل';
            const confession = targetStudent.confessionFather || 'غير مسجل';
            const notes = targetStudent.notes || 'لا يوجد ملاحظات مدونة';

            let profileMsg = `سلام ونعمة يا قدس الخادم / ${servantData.name || 'مبارك'} 🌸\n`;
            profileMsg += `إليك كارت بيانات المخدوم *(${name})* المسجل بفصل *(${studentClass})*:\n\n`;
            profileMsg += `🆔 *الكود الرسمي:* ${code}\n`;
            profileMsg += `🏠 *العنوان:* ${address}\n`;
            profileMsg += `📞 *هاتف الأب:* ${fatherPhone}\n`;
            profileMsg += `📞 *هاتف الأم:* ${motherPhone}\n`;
            profileMsg += `📱 *هاتف المخدوم:* ${studentPhone}\n`;
            profileMsg += `🕊️ *أب الاعتراف:* ${confession}\n`;
            profileMsg += `📝 *ملاحظات الخدمة:* ${notes}\n\n`;
            profileMsg += `صلوا لأجل الخدمة دائماً. ⛪`;

            const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, profileMsg);

            await db.collection('webhookQueryLogs').add({
              senderPhone: senderPhone,
              senderInfo: senderInfo,
              studentCode: code,
              studentName: name,
              status: success ? 'sent' : 'failed',
              reason: success ? 'استعلام كارت بيانات مخدوم للخدام' : 'فشل إرسال رسالة الواتساب عبر الـ API',
              questionText: messageText,
              replyText: profileMsg,
              isAIQuery: true,
              timestamp: new Date().toISOString()
            });
            return;
          }

          const queryType = parsedResponse.query_type || 'full_report';

          if (queryType === 'specific_attendance') {
            // SPECIFIC ATTENDANCE ROUTE
            const cairoString = new Date().toLocaleString("sv-SE", { timeZone: "Africa/Cairo" });
            const todayEgyptStr = cairoString.split(' ')[0]; // YYYY-MM-DD
            
            const attendedService = (targetStudent.attendance || []).includes(todayEgyptStr);
            const attendedLiturgy = (targetStudent.liturgyAttendance || []).includes(todayEgyptStr);
            const attended = attendedService || attendedLiturgy;

            const firstName = (targetStudent.name || '').split(' ')[0] || 'البطل';
            const gender = targetStudent.gender || 'boy';
            const genderLabel = gender === 'boy' ? 'ابننا البطل' : 'بنتنا الجميلة';
            const classLabel = targetStudent.assignedClass || 'الفصل';

            const attendancePrompt = `اكتب رسالة واتساب دافئة ومرحة بالعامية المصرية لأولياء أمور المخدوم ${firstName} (${genderLabel}) في مدارس أحد ${classLabel}.
حالة حضور المخدوم اليوم (${todayEgyptStr}) هي: ${attended ? 'حضر القداس والخدمة ومبسوط جداً وسط اخواته' : 'غائب ولم يحضر اليوم ووحشنا جداً ونفسنا يجي المرة القادمة ونحن نصلي لأجله'}.
اكتب الرسالة بأسلوب خادم مدارس أحد محب ومرحب بالآباء والامهات، مع إضافة إيموجيز مناسبة (⛪، ✨، 🌟).
ارجع فقط JSON يحتوي على حقل واحد "reply" بالرسالة المكتوبة.`;

            console.log(`[Webhook Bot AI 🤖] Calling Gemini for specific attendance text: ${firstName}...`);
            const response = await callGeminiWithRotation(attendancePrompt, "You are a warm Sunday School teacher. Respond only with JSON: {\"reply\": \"...\"}");
            
            let parsed = { reply: "" };
            try {
              parsed = JSON.parse(cleanJsonString(response));
            } catch (err) {
              parsed.reply = response.trim();
            }
            
            const attendanceReply = parsed.reply || `سلام ونعمة يا فندم، ${genderLabel} ${firstName} ${attended ? 'حاضر معنا اليوم ومنور الفصل!' : 'غائب اليوم ونتمنى أن يكون بخير وننتظره الأسبوع القادم.'}`;
            const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, attendanceReply);

            await db.collection('webhookQueryLogs').add({
              senderPhone: senderPhone,
              senderInfo: senderInfo,
              studentCode: targetStudent.code || 'AI_QUERY',
              studentName: targetStudent.name,
              status: success ? 'sent' : 'failed',
              reason: success ? 'استعلام حضور مخصص عبر AI' : 'فشل إرسال رسالة الواتساب عبر الـ API',
              questionText: messageText,
              replyText: attendanceReply,
              isAIQuery: true,
              timestamp: new Date().toISOString()
            });

          } else {
            // FULL REPORT ROUTE (Standard weekly vs monthly compiled templates)
            const cairoString = new Date().toLocaleString("sv-SE", { timeZone: "Africa/Cairo" });
            const nowInEgypt = new Date(cairoString.replace(' ', 'T'));
            
            const selectedMonth = nowInEgypt.getMonth() + 1;
            const selectedYear = nowInEgypt.getFullYear();
            const start = new Date(selectedYear, selectedMonth - 1, 1, 0, 0, 0);
            const end = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);

            const pointsSnap = await db.collection('pointsHistory')
              .where('createdAt', '>=', Timestamp.fromDate(start))
              .where('createdAt', '<=', Timestamp.fromDate(end))
              .get();
            const pointsHistoryList = pointsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const templateConfigDoc = await db.collection('report_templates').doc('config').get();
            const templateConfig = templateConfigDoc.exists ? templateConfigDoc.data() : {};

            const DEFAULT_MONTHLY_TEMPLATE = `"فَرِحْتُ بِالْقَائِلِينَ لِي: إِلَى بَيْتِ الرَّبِّ نَذْهَبُ" (مز 122)

سلام ونعمة يا فندم من خدمة مدارس أحد {stageClass}.
حابين نشارك مع حضراتكم تقرير {genderLabel} {firstName} خلال هذا الشهر:
⛪ حضور القداس الإلهي: {massCount}
🏫 حضور حوش الخدمة: {serviceCount}
🕊️ جلسة الاعتراف والافتقاد الدوري: {confessionStatus}.
📝 ملاحظات الخدمة: {notes}
صلوا لأجل الخدمة دائماً.`;

            const DEFAULT_WEEKLY_TEMPLATE = `"فَرِحْتُ بِالْـقَائِلِينَ لِي: إِلَى بَيْتِ الرَّبِّ نَذْهَبُ" (مز 122)

سلام ونعمة يا فندم من خدمة مدارس أحد {stageClass}.
حابين نشارك مع حضراتكم تقرير {genderLabel} {firstName} خلال هذا الأسبوع:
⛪ حضور القداس الإلهي: {massCount}.
🏫 حضور حوش الخدمة: {serviceCount}.
🌟 صفات تميز بها هذا الأسبوع: {traits}.
🕊️ جلسة الاعتراف والافتقاد الدوري: {confessionStatus}.
📝 ملاحظات الخدمة: {notes}
صلوا لأجل الخدمة دائماً.`;

            const monthlyTemplate = templateConfig.monthlyTemplate || DEFAULT_MONTHLY_TEMPLATE;
            const weeklyTemplate = templateConfig.weeklyTemplate || DEFAULT_WEEKLY_TEMPLATE;

            const cleanMessageText = (messageText || '').toLowerCase().trim();
            const isWeeklyQuery = /الاسبوع|أسبوع|جمعة|جمعه|المرة اللي فاتت|المرة الفاتت|المره اللي فاتت|المره الفاتت|جمعه فاتت/i.test(cleanMessageText);

            let reportText = '';

            if (isWeeklyQuery) {
              const variables = compileStudentVariablesBackend(targetStudent, { reportType: 'weekly' }, pointsHistoryList, nowInEgypt);
              const [stageClass, genderLabel, firstName, massCount, serviceCount, confessionStatus, notes] = variables;
              
              const studentLogs = pointsHistoryList.filter(log => log.studentId === targetStudent.id && (log.amount || 0) > 0);
              const reasons = studentLogs.map(log => log.reason).filter(Boolean);
              const uniqueReasons = [...new Set(reasons)];
              const traits = uniqueReasons.length > 0 ? uniqueReasons.join('، ') : "الالتزام وحسن السلوك";

              reportText = weeklyTemplate
                .replace(/{stageClass}/g, stageClass)
                .replace(/{genderLabel}/g, genderLabel)
                .replace(/{firstName}/g, firstName)
                .replace(/{massCount}/g, massCount)
                .replace(/{serviceCount}/g, serviceCount)
                .replace(/{traits}/g, traits)
                .replace(/{confessionStatus}/g, confessionStatus)
                .replace(/{notes}/g, notes || 'لا يوجد');
            } else {
              const variables = compileStudentVariablesBackend(targetStudent, { reportType: 'monthly' }, pointsHistoryList, nowInEgypt);
              const [stageClass, genderLabel, firstName, massCount, serviceCount, confessionStatus, notes] = variables;

              reportText = monthlyTemplate
                .replace(/{stageClass}/g, stageClass)
                .replace(/{genderLabel}/g, genderLabel)
                .replace(/{firstName}/g, firstName)
                .replace(/{massCount}/g, massCount)
                .replace(/{serviceCount}/g, serviceCount)
                .replace(/{confessionStatus}/g, confessionStatus)
                .replace(/{notes}/g, notes || 'لا يوجد');
            }

            const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, reportText);

            await db.collection('webhookQueryLogs').add({
              senderPhone: senderPhone,
              senderInfo: senderInfo,
              studentCode: targetStudent.code || 'AI_QUERY',
              studentName: targetStudent.name,
              status: success ? 'sent' : 'failed',
              reason: success ? 'تقرير كامل تلقائي عبر AI' : 'فشل إرسال رسالة الواتساب عبر الـ API',
              questionText: messageText,
              replyText: reportText,
              isAIQuery: true,
            });
          }
        }
      } catch (aiErr) {
        console.error('[Webhook Bot AI ❌] Gemini call failed, activating bulletproof fallback:', aiErr.message);
        
        // BULLETPROOF FALLBACK (Unified polite fallback instead of misleading traffic congestion error)
        const fallbackText = "المعلومة دي مش متوفرة عندي حالياً يا فندم، لكن أنا بلغت خدام الفصل فوراً وسؤالك قيد المتابعة وهيتم الرد عليك في أقرب وقت! ⛪";
        const success = await sendWhatsAppTextMessage(accessToken, phoneNumberId, senderPhone, fallbackText);
        
        await db.collection('webhookQueryLogs').add({
          senderPhone: senderPhone,
          senderInfo: senderInfo,
          studentCode: 'AI_UNANSWERED',
          studentName: 'سؤال معلق (تراجع AI)',
          status: success ? 'sent' : 'failed',
          reason: `خطأ الذكاء الاصطناعي: ${aiErr.message}`,
          questionText: messageText,
          replyText: fallbackText,
          isAIQuery: true,
          timestamp: new Date().toISOString()
        });
      }
    }

  } catch (err) {
    console.error('[Webhook Bot Error]:', err);
  }
}

// Local cron simulation loop (checks every 60 seconds)
if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_LOCAL_CRON === 'true') {
  console.log('[Local Cron] Local cron runner initialized. Checking schedules every 60 seconds...');
  
  // Run once immediately on start
  setTimeout(async () => {
    const log = (msg) => console.log(`[Local Cron Initial Run] ${msg}`);
    try {
      await runScheduledNotificationsAndReports(log);
    } catch (err) {
      console.error('[Local Cron Initial Run Error]:', err.message);
    }
  }, 5000);

  setInterval(async () => {
    const log = (msg) => console.log(`[Local Cron Worker] ${msg}`);
    try {
      await runScheduledNotificationsAndReports(log);
    } catch (err) {
      console.error('[Local Cron Worker Error]:', err.message);
    }
  }, 60000);
}

const PORT = 5000;
app.listen(PORT, () => console.log(`Notification Server running on port ${PORT}`));