import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(readFileSync(path.join(__dirname, "service-account.json"), "utf-8"));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const CLASS_NAME = "Õ÷«‰…/„·«∆ﬂ…";
const DATE_1 = "2026-07-10";
const DATE_2 = "2026-07-17";

async function main() {
  console.log("«·»ÕÀ ›Ì Firestore...");
  console.log("«·›’·: " + CLASS_NAME);
  console.log("«· «—ÌŒ «·√Ê·: " + DATE_1);
  console.log("«· «—ÌŒ «·À«‰Ì: " + DATE_2);

  const studentsSnap = await db.collection("students").where("assignedClass", "==", CLASS_NAME).get();

  if (studentsSnap.empty) {
    console.log("·„ Ì „ «·⁄ÀÊ— ⁄·Ï √Ì ÿ·«» ›Ì Â–« «·›’·.");
    const allSnap = await db.collection("students").get();
    console.log("≈Ã„«·Ì «·ÿ·«»: " + allSnap.size);
    const classes = new Set();
    allSnap.forEach(doc => { const d = doc.data(); if (d.assignedClass) classes.add(d.assignedClass); });
    console.log("«·›’Ê· «·„ «Õ…:");
    classes.forEach(c => console.log("  - " + c));
    process.exit(0);
  }

  console.log(" „ «·⁄ÀÊ— ⁄·Ï " + studentsSnap.size + " ÿ«·» ›Ì «·›’·");

  const targets = [];
  studentsSnap.forEach(doc => {
    const s = { id: doc.id, ...doc.data() };
    const att = s.attendance || [];
    if (att.includes(DATE_1) && !att.includes(DATE_2)) targets.push(s);
  });

  if (targets.length === 0) {
    console.log("·« ÌÊÃœ √Õœ Õ÷— ÌÊ„ 10 Ê€«» ÌÊ„ 17");
    let c1 = 0, c2 = 0;
    studentsSnap.forEach(doc => {
      const att = doc.data().attendance || [];
      if (att.includes(DATE_1)) c1++;
      if (att.includes(DATE_2)) c2++;
    });
    console.log("Õ÷— ÌÊ„ " + DATE_1 + ": " + c1);
    console.log("Õ÷— ÌÊ„ " + DATE_2 + ": " + c2);
    process.exit(0);
  }

  console.log("⁄œœ «·ÿ·«» «·„” Âœ›Ì‰: " + targets.length);
  console.log("=".repeat(60));

  for (let i = 0; i < targets.length; i++) {
    const s = targets[i];
    const attDocId = s.id + "_" + DATE_1;
    const attDoc = await db.collection("attendance").doc(attDocId).get();
    let pts = 0, svc = null, lit = null;
    if (attDoc.exists) {
      const d = attDoc.data();
      pts = d.pointsAdded || 0;
      svc = d.attendedService ?? null;
      lit = d.attendedLiturgy ?? null;
    } else {
      const hist = await db.collection("pointsHistory").where("studentId", "==", s.id).where("attendanceDate", "==", DATE_1).get();
      if (!hist.empty) hist.forEach(h => { pts += h.data().amount || h.data().points || 0; });
    }
    console.log("");
    console.log((i+1) + ". «·«”„: " + s.name);
    console.log("   «·‰ﬁ«ÿ «·„÷«›… ÌÊ„ " + DATE_1 + ": " + pts + " ‰ﬁÿ…");
    if (svc !== null) console.log("   Õ÷Ê— «·Œœ„…: " + (svc ? "‰⁄„" : "·«"));
    if (lit !== null) console.log("   Õ÷Ê— «·ﬁœ«”: " + (lit ? "‰⁄„" : "·«"));
  }

  console.log("=".repeat(60));
  console.log("«·≈Ã„«·Ì: " + targets.length + " ÿ«·»");
}

main().catch(console.error);
