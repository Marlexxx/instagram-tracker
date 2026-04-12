const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const admin = require('firebase-admin');

// ─── FIREBASE ─────────────────────────────────────────────────────────────────
const cred = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({ credential: admin.credential.cert(cred) });
const db = admin.firestore();

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const MANAGEMENT_CHANNEL_ID = '1492870240718290964';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function getAccounts() {
  const snap = await db.collection('instagram_accounts').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function refreshManagementMessage(channel) {
  const accounts = await getAccounts();

  // Supprime les anciens messages du bot
  const messages = await channel.messages.fetch({ limit: 10 });
  const botMessages = messages.filter(m => m.author.id === client.user.id);
  for (const msg of botMessages.values()) {
    await msg.delete().catch(() => {});
  }

  // Groupe par VA
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

// ─── READY ────────────────────────────────────────────────────────────────────
client.on('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  const channel = await client.channels.fetch(MANAGEMENT_CHANNEL_ID);
  await refreshManagementMessage(channel);
});

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

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

    // Vérifie si le compte existe déjà
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

client.login(process.env.DISCORD_TOKEN);
