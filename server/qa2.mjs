import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, 'service-account.json'), 'utf-8'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const DATE_1 = '2026-07-10';
const DATE_2 = '2026-07-17';

async function main() {
  // Fetch ALL students and filter manually to avoid encoding issues
  const allSnap = await db.collection('students').get();
  
  const allClasses = new Set();
  const classStudents = [];

  allSnap.forEach(doc => {
    const s = { id: doc.id, ...doc.data() };
    if (s.assignedClass) allClasses.add(s.assignedClass);
    const att = s.attendance || [];
    if (att.includes(DATE_1) && !att.includes(DATE_2)) {
      classStudents.push(s);
    }
  });

  console.log('CLASSES:');
  allClasses.forEach(c => console.log('CLASS|' + c));
  
  console.log('TOTAL_D1_NOT_D2:' + classStudents.length);
  
  for (const s of classStudents) {
    const attDocId = s.id + '_' + DATE_1;
    const attDoc = await db.collection('attendance').doc(attDocId).get();
    let pts = 0, svc = null, lit = null;
    if (attDoc.exists) {
      const d = attDoc.data();
      pts = d.pointsAdded || 0;
      svc = d.attendedService !== undefined ? d.attendedService : null;
      lit = d.attendedLiturgy !== undefined ? d.attendedLiturgy : null;
    } else {
      const hist = await db.collection('pointsHistory')
        .where('studentId', '==', s.id)
        .where('attendanceDate', '==', DATE_1)
        .get();
      if (!hist.empty) hist.forEach(h => { pts += h.data().amount || h.data().points || 0; });
    }
    const line = 'STUDENT|' + (s.assignedClass||'') + '|' + (s.name||'') + '|' + pts + '|' + svc + '|' + lit;
    console.log(line);
  }
}

main().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });