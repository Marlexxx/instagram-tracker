const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const admin = require('firebase-admin');

const cred = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ credential: admin.credential.cert(cred) });
const db = admin.firestore();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const MANAGEMENT_CHANNEL_ID = '1492870240718290964';
const RECAP_CHANNEL_ID = '1492880708832858222';
const DAILY_CHANNEL_ID = '1492880546785660969';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function getAccounts() {
  const snap = await db.collection('instagram_accounts').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getSubsStats(trackingLink, accountId) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Récupère le dernier recap pour avoir l'heure de référence
  const lastSnap = await db.collection('instagram_daily')
    .where('account_id', '==', accountId)
    .orderBy('date', 'desc')
    .limit(1)
    .get();

  const lastFilledAt = !lastSnap.empty
    ? new Date(lastSnap.docs[0].data().filled_at)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const snap = await db.collection('subscribers').get();
  const subs = snap.docs.map(d => d.data()).filter(s => {
    const src = (s.source || '').toLowerCase().trim();
    const link = (trackingLink || '').toLowerCase().trim();
    return src === link;
  });

  const todaySubs = subs.filter(s => {
    const d = new Date(s.joined_at);
    return d >= lastFilledAt && d <= now;
  }).length;

  const sevenDaysSubs = subs.filter(s => {
    const d = new Date(s.joined_at);
    return d >= sevenDaysAgo;
  }).length;

  return { today: todaySubs, sevenDays: sevenDaysSubs, total: subs.length };
}

async function refreshManagementMessage(channel) {
  const accounts = await getAccounts();
  const messages = await channel.messages.fetch({ limit: 10 });
  const botMessages = messages.filter(m => m.author.id === client.user.id && !m.hasThread);
  for (const msg of botMessages.values()) {
    await msg.delete().catch(() => {});
  }

  const byVA = {};
  accounts.forEach(acc => {
    if (!byVA[acc.va_name]) byVA[acc.va_name] = [];
    byVA[acc.va_name].push(acc);
  });

  const embed = new EmbedBuilder()
    .setTitle('📱 Gestion des comptes Instagram')
    .setColor('#a855f7')
    .setDescription(accounts.length === 0 ? 'Aucun compte enregistré.' : null)
    .setFooter({ text: `${accounts.length} compte(s) enregistré(s)` })
    .setTimestamp();

  if (accounts.length > 0) {
    Object.entries(byVA).forEach(([va, accs]) => {
      embed.addFields({
        name: `👤 ${va}`,
        value: accs.map(a => `• **@${a.insta_name}** — Lien tracking: \`${a.tracking_link}\``).join('\n'),
        inline: false
      });
    });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('add_account')
      .setLabel('➕ Ajouter un compte')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('remove_account')
      .setLabel('🗑️ Supprimer un compte')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

// ─── RECAP QUOTIDIEN ──────────────────────────────────────────────────────────
async function sendDailyRecap() {
  const accounts = await getAccounts();
  if (accounts.length === 0) return;

  const channel = await client.channels.fetch(DAILY_CHANNEL_ID);
  const today = new Date().toLocaleDateString('fr-FR');

  const byVA = {};
  accounts.forEach(acc => {
    if (!byVA[acc.va_name]) byVA[acc.va_name] = [];
    byVA[acc.va_name].push(acc);
  });

  for (const [vaName, accs] of Object.entries(byVA)) {
    const msg = await channel.send({
      content: `📋 **Recap du ${today}** — remplis tes stats !`
    });

    const thread = await msg.startThread({
      name: `Recap ${today} — ${vaName}`,
      autoArchiveDuration: 1440
    });

    const vaNames = Object.keys(byVA);
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_va_${thread.id}`)
      .setPlaceholder('Qui es-tu ?')
      .addOptions(vaNames.map(name =>
        new StringSelectMenuOptionBuilder()
          .setLabel(name)
          .setValue(name)
      ));

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await thread.send({ content: '👋 Sélectionne ton nom pour commencer :', components: [row] });
  }
}

// ─── PLANIFICATION 16H ────────────────────────────────────────────────────────
function scheduleDailyRecap() {
  const now = new Date();
  const next16h = new Date(now);
  next16h.setHours(14, 0, 0, 0);
  if (next16h <= now) next16h.setDate(next16h.getDate() + 1);
  const delay = next16h - now;
  console.log(`⏰ Prochain recap dans ${Math.round(delay / 60000)} minutes`);
  setTimeout(() => {
    sendDailyRecap();
    setInterval(sendDailyRecap, 24 * 60 * 60 * 1000);
  }, delay);
}

// ─── READY ────────────────────────────────────────────────────────────────────
client.on('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  const channel = await client.channels.fetch(MANAGEMENT_CHANNEL_ID);
  await refreshManagementMessage(channel);
  scheduleDailyRecap();
});

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ─── SELECT VA ──────────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_va_')) {
    const selectedVA = interaction.values[0];
    const accounts = await getAccounts();
    const vaAccounts = accounts.filter(a => a.va_name === selectedVA);

    await interaction.update({ content: `✅ Identifié comme **${selectedVA}** ! Remplis maintenant tes comptes :`, components: [] });

    for (const acc of vaAccounts) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`fill_account_${acc.id}`)
          .setLabel(`📱 @${acc.insta_name}`)
          .setStyle(ButtonStyle.Primary)
      );
      await interaction.channel.send({ content: `Compte **@${acc.insta_name}** :`, components: [row] });
    }
    return;
  }

  // ─── BOUTON REMPLIR COMPTE ──────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('fill_account_')) {
    const accountId = interaction.customId.replace('fill_account_', '');
    const accDoc = await db.collection('instagram_accounts').doc(accountId).get();
    const acc = accDoc.data();

    const modal = new ModalBuilder()
      .setCustomId(`modal_fill_${accountId}`)
      .setTitle(`Stats @${acc.insta_name}`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('active')
          .setLabel('Compte actif ? (oui/non)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('oui')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('followers')
          .setLabel('Nombre d\'abonnés actuels')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('ex: 1250')
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // ─── MODAL STATS COMPTE ─────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_fill_')) {
    const accountId = interaction.customId.replace('modal_fill_', '');
    const accDoc = await db.collection('instagram_accounts').doc(accountId).get();
    const acc = accDoc.data();

    const active = interaction.fields.getTextInputValue('active').toLowerCase().includes('oui');
    const followers = parseInt(interaction.fields.getTextInputValue('followers').replace(/\s/g, '')) || 0;

    // Calcule gain d'abonnés
    const lastSnap = await db.collection('instagram_daily')
      .where('account_id', '==', accountId)
      .orderBy('date', 'desc')
      .limit(1)
      .get();

    let followerGain = 0;
    if (!lastSnap.empty) {
      const lastData = lastSnap.docs[0].data();
      followerGain = followers - (lastData.followers || 0);
    }

    // Subs Telegram
    const subs = await getSubsStats(acc.tracking_link, accountId);

    // Sauvegarde dans Firebase
    const today = new Date().toISOString().split('T')[0];
    await db.collection('instagram_daily').add({
      account_id: accountId,
      insta_name: acc.insta_name,
      va_name: acc.va_name,
      date: today,
      active,
      followers,
      follower_gain: followerGain,
      subs_today: subs.today,
      subs_7days: subs.sevenDays,
      subs_total: subs.total,
      filled_at: new Date().toISOString()
    });

    const statusEmoji = active ? '✅' : '❌';
    const gainText = followerGain >= 0 ? `+${followerGain}` : `${followerGain}`;

    await interaction.reply({
      content: `${statusEmoji} **@${acc.insta_name}** enregistré !\n👥 Abonnés : **${followers.toLocaleString()}** (${gainText} aujourd'hui)\n📩 Subs Telegram depuis dernier recap : **${subs.today}** | 7j : **${subs.sevenDays}** | Total : **${subs.total}**`,
      ephemeral: false
    });

    await checkAndSendVARecap(interaction, acc.va_name, today);
    return;
  }

  // ─── BOUTON AJOUTER ─────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'add_account') {
    const modal = new ModalBuilder()
      .setCustomId('modal_add_account')
      .setTitle('Ajouter un compte Instagram');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('va_name')
          .setLabel('Nom du VA')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('ex: Daniel')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('insta_name')
          .setLabel('Nom du compte Instagram')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('ex: lunaa.cvn')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tracking_link')
          .setLabel('Nom du lien de tracking Telegram')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('ex: insta VA daniel')
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // ─── BOUTON SUPPRIMER ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'remove_account') {
    const accounts = await getAccounts();
    if (accounts.length === 0) {
      await interaction.reply({ content: '❌ Aucun compte à supprimer.', ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('modal_remove_account')
      .setTitle('Supprimer un compte Instagram');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('insta_name')
          .setLabel('Nom du compte Instagram à supprimer')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('ex: lunaa.cvn')
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // ─── MODAL AJOUTER ──────────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_add_account') {
    const va_name = interaction.fields.getTextInputValue('va_name').trim();
    const insta_name = interaction.fields.getTextInputValue('insta_name').trim().replace('@', '');
    const tracking_link = interaction.fields.getTextInputValue('tracking_link').trim();

    const existing = await db.collection('instagram_accounts').where('insta_name', '==', insta_name).get();
    if (!existing.empty) {
      await interaction.reply({ content: `❌ Le compte **@${insta_name}** existe déjà.`, ephemeral: true });
      return;
    }

    await db.collection('instagram_accounts').add({
      va_name,
      insta_name,
      tracking_link,
      added_at: new Date().toISOString(),
      active: true
    });

    await interaction.reply({ content: `✅ Compte **@${insta_name}** ajouté pour **${va_name}** !`, ephemeral: true });
    const channel = await client.channels.fetch(MANAGEMENT_CHANNEL_ID);
    await refreshManagementMessage(channel);
    return;
  }

  // ─── MODAL SUPPRIMER ────────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_remove_account') {
    const insta_name = interaction.fields.getTextInputValue('insta_name').trim().replace('@', '');
    const snap = await db.collection('instagram_accounts').where('insta_name', '==', insta_name).get();

    if (snap.empty) {
      await interaction.reply({ content: `❌ Compte **@${insta_name}** introuvable.`, ephemeral: true });
      return;
    }

    await snap.docs[0].ref.delete();
    await interaction.reply({ content: `✅ Compte **@${insta_name}** supprimé.`, ephemeral: true });
    const channel = await client.channels.fetch(MANAGEMENT_CHANNEL_ID);
    await refreshManagementMessage(channel);
    return;
  }
});

// ─── RECAP VA COMPLET ─────────────────────────────────────────────────────────
async function checkAndSendVARecap(interaction, vaName, today) {
  const accounts = await getAccounts();
  const vaAccounts = accounts.filter(a => a.va_name === vaName);

  const filledSnap = await db.collection('instagram_daily')
    .where('va_name', '==', vaName)
    .where('date', '==', today)
    .get();

  if (filledSnap.size < vaAccounts.length) return;

  const filled = filledSnap.docs.map(d => d.data());
  const dateStr = new Date().toLocaleDateString('fr-FR');

  let recapText = `📅 **Recap du ${dateStr} — ${vaName}**\n\n`;
  filled.forEach(f => {
    const statusEmoji = f.active ? '✅' : '❌';
    const gainText = f.follower_gain >= 0 ? `+${f.follower_gain}` : `${f.follower_gain}`;
    recapText += `${statusEmoji} **@${f.insta_name}**\n`;
    recapText += `  👥 Abonnés : ${f.followers.toLocaleString()} (${gainText})\n`;
    recapText += `  📩 Subs TG depuis dernier recap : ${f.subs_today} | 7j : ${f.subs_7days} | Total : ${f.subs_total}\n\n`;
  });

  await interaction.channel.send({ content: recapText });
  await sendCEORecap(today);
}

// ─── RECAP CEO ────────────────────────────────────────────────────────────────
async function sendCEORecap(today) {
  const accounts = await getAccounts();
  const filledSnap = await db.collection('instagram_daily')
    .where('date', '==', today)
    .get();

  if (filledSnap.size < accounts.length) return;

  const filled = filledSnap.docs.map(d => d.data());
  const byVA = {};
  filled.forEach(f => {
    if (!byVA[f.va_name]) byVA[f.va_name] = [];
    byVA[f.va_name].push(f);
  });

  const dateStr = new Date().toLocaleDateString('fr-FR');
  const recapChannel = await client.channels.fetch(RECAP_CHANNEL_ID);

  let recapText = `📊 **Recap complet du ${dateStr}**\n\n`;
  let totalSubsToday = 0;
  let totalSubs7days = 0;

  // Leaderboard
  const vaStats = Object.entries(byVA).map(([va, accs]) => ({
    va,
    subsToday: accs.reduce((acc, a) => acc + a.subs_today, 0),
    subs7days: accs.reduce((acc, a) => acc + a.subs_7days, 0),
    accs
  })).sort((a, b) => b.subs7days - a.subs7days);

  vaStats.forEach(({ va, subsToday, subs7days, accs }) => {
    totalSubsToday += subsToday;
    totalSubs7days += subs7days;
    recapText += `👤 **${va}**\n`;
    accs.forEach(f => {
      const statusEmoji = f.active ? '✅' : '❌';
      const gainText = f.follower_gain >= 0 ? `+${f.follower_gain}` : `${f.follower_gain}`;
      recapText += `  ${statusEmoji} @${f.insta_name} — ${f.followers.toLocaleString()} abonnés (${gainText}) | Subs TG : ${f.subs_today}\n`;
    });
    recapText += `  📩 Total : **${subsToday}** depuis dernier recap | **${subs7days}** (7j)\n\n`;
  });

  recapText += `---\n🏆 **Leaderboard 7j**\n`;
  vaStats.forEach((v, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    recapText += `${medal} **${v.va}** — ${v.subs7days} subs\n`;
  });

  recapText += `\n---\n📈 **Total global** : ${totalSubsToday} subs depuis dernier recap | ${totalSubs7days} (7j)`;

  await recapChannel.send({ content: recapText });
}

client.login(process.env.DISCORD_TOKEN);
