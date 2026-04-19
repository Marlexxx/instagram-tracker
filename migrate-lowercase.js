// migrate-lowercase.js — À LANCER UNE SEULE FOIS
// node migrate-lowercase.js

const admin = require('firebase-admin');
const cred = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ credential: admin.credential.cert(cred) });
const db = admin.firestore();

async function migrate() {
  console.log('🔄 Migration des sources en minuscules...\n');

  // 1. Migrer tous les subscribers.source en lowercase
  const subsSnap = await db.collection('subscribers').get();
  let subsFixed = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of subsSnap.docs) {
    const data = doc.data();
    const original = data.source || '';
    const lower = original.toLowerCase().trim();

    if (original !== lower) {
      batch.update(doc.ref, { source: lower });
      batchCount++;
      subsFixed++;

      // Firestore batch max 500 operations
      if (batchCount >= 490) {
        await batch.commit();
        console.log(`  ✅ Batch committé (${subsFixed} subs corrigés jusqu'ici)`);
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }
  console.log(`✅ ${subsFixed} subscribers corrigés sur ${subsSnap.size} total\n`);

  // 2. Migrer tous les instagram_accounts.tracking_link en lowercase
  const accSnap = await db.collection('instagram_accounts').get();
  let accsFixed = 0;
  const batch2 = db.batch();

  for (const doc of accSnap.docs) {
    const data = doc.data();
    const original = data.tracking_link || '';
    const lower = original.toLowerCase().trim();

    if (original !== lower) {
      batch2.update(doc.ref, { tracking_link: lower });
      accsFixed++;
      console.log(`  📝 ${original} → ${lower}`);
    }
  }

  if (accsFixed > 0) {
    await batch2.commit();
  }
  console.log(`✅ ${accsFixed} comptes corrigés sur ${accSnap.size} total\n`);

  console.log('🎉 Migration terminée !');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Erreur migration:', err);
  process.exit(1);
});
