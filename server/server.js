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

// قراءة ملف الـ JSON بأمان في نظام الموديولز الحديث
const serviceAccount = JSON.parse(
  readFileSync(new URL('./service-account.json', import.meta.url))
);

// تشغيل الفايربيز بالنظام الحديث المستقر والمضمون
initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

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
app.all('/api/process-scheduled', async (req, res) => {
  // منع الكاش تماماً على مستوى Vercel CDN والشبكة لضمان التشغيل الحي في كل دقيقة
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
      const messaging = getMessaging();

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
      const whatsappTemplateName = templateConfig.whatsappTemplateName || 'student_report_summary';
      
      for (const schDoc of schedulesSnap.docs) {
        const schData = schDoc.data();
        const schId = schDoc.id;
        
        let isTimeToRun = false;
        const scheduleMode = schData.scheduleMode || 'recurring';
        const schTime = schData.time || '20:00';
        
        if (scheduleMode === 'one_time') {
          isTimeToRun = schData.date === todayCairoStr && schTime === currentCairoTimeStr;
        } else {
          isTimeToRun = schData.days && schData.days.includes(currentDayKey) && schTime === currentCairoTimeStr;
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
            
            for (const student of studentsList) {
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
                continue;
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
            }
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

    res.status(200).json({ success: true, processedCount: processedCount, logs: debugLogs });
  } catch (error) {
    log(`[Scheduled Cron ❌] Error: ${error.message}`);
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
    const p = student.preferredPhoneReceiver || 'father';
    let rawPhone = '';
    if (p === 'student') rawPhone = student.phone;
    else if (p === 'mother') rawPhone = student.motherPhone;
    else rawPhone = student.fatherPhone;
    
    if (!rawPhone) {
        rawPhone = student.fatherPhone || student.motherPhone || student.phone;
    }
    
    if (!rawPhone) return null;
    
    let cleanPhone = rawPhone.replace(/\D/g, '');
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
    const confessionStatus = hasConfessed ? "تمت بنجاح والحمد لله" : "لم تتم بعد (نرجو تشجيعه)";
    
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
        traits,
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
                    code: "ar"
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

const PORT = 5000;
app.listen(PORT, () => console.log(`Notification Server running on port ${PORT}`));