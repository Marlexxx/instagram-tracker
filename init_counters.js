const admin = require('firebase-admin');
const cred = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ credential: admin.credential.cert(cred) });
const db = admin.firestore();

async function initCounters() {
  const now          = new Date();
  const todayStart   = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  console.log('📦 Chargement des données...');

  const [accountsSnap, subsSnap] = await Promise.all([
    db.collection('instagram_accounts').get(),
    db.collection('subscribers').get()
  ]);

  const accounts = accountsSnap.docs.map(d => ({ ref: d.ref, ...d.data() }));
  const subs     = subsSnap.docs.map(d => d.data());

  console.log(`✅ ${accounts.length} comptes | ${subs.length} subscribers`);

  for (const acc of accounts) {
    const link = (acc.tracking_link || '').toLowerCase().trim();

    const accSubs  = subs.filter(s => (s.source || '').toLowerCase().trim() === link);
    const total    = accSubs.length;
    const today    = accSubs.filter(s => s.joined_at >= todayStart).length;

    await acc.ref.update({ subs_total: total, subs_today: today });
    console.log(`✅ @${acc.insta_name} — total: ${total} | today: ${today}`);
  }

  console.log('🎉 Initialisation terminée !');
  process.exit(0);
}

initCounters().catch(err => { console.error(err); process.exit(1); });
