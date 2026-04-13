// leaderboard.js — ALX Agency · Instagram Tracker
const { EmbedBuilder } = require('discord.js');
const admin = require('firebase-admin');

const db = admin.firestore();

// ─── COMPUTE STATS ─────────────────────────────────────────────────────────────

async function computeLeaderboard() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Fetch all accounts & subscribers in parallel
  const [accountsSnap, subsSnap] = await Promise.all([
    db.collection('instagram_accounts').get(),
    db.collection('subscribers').get()
  ]);

  const accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const subs     = subsSnap.docs.map(d => d.data());

  // ── Per-account stats ──────────────────────────────────────────────────────
  const accountStats = [];

  for (const acc of accounts) {
    const link    = (acc.tracking_link || '').toLowerCase().trim();
    const accSubs = subs.filter(s => (s.source || '').toLowerCase().trim() === link);

    const daily  = accSubs.filter(s => new Date(s.joined_at) >= todayStart).length;
    const weekly = accSubs.filter(s => new Date(s.joined_at) >= weekStart).length;
    const total  = accSubs.length;

    accountStats.push({
      handle:  acc.instagram_handle || acc.id,
      va_name: acc.va_name || '—',
      daily,
      weekly,
      total
    });
  }

  // ── Per-VA stats (cumul de tous ses comptes) ───────────────────────────────
  const vaMap = {};
  for (const a of accountStats) {
    if (!vaMap[a.va_name]) vaMap[a.va_name] = { daily: 0, weekly: 0, total: 0 };
    vaMap[a.va_name].daily  += a.daily;
    vaMap[a.va_name].weekly += a.weekly;
    vaMap[a.va_name].total  += a.total;
  }
  const vaStats = Object.entries(vaMap).map(([name, s]) => ({ name, ...s }));

  return {
    accounts: { daily: [...accountStats].sort((a, b) => b.daily  - a.daily),
                weekly:[...accountStats].sort((a, b) => b.weekly - a.weekly) },
    vas:      { daily: [...vaStats].sort((a, b) => b.daily  - a.daily),
                weekly:[...vaStats].sort((a, b) => b.weekly - a.weekly) }
  };
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function medal(i) {
  return ['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`;
}

function vaRow(va, i) {
  return `${medal(i)} **${va.name}** — \`${va.daily}\` subs`;
}

function vaRowWeekly(va, i) {
  return `${medal(i)} **${va.name}** — \`${va.weekly}\` subs`;
}

function accRow(acc, i) {
  return `${medal(i)} **${acc.handle}** _· ${acc.va_name}_ — \`${acc.daily}\` subs`;
}

function accRowWeekly(acc, i) {
  return `${medal(i)} **${acc.handle}** _· ${acc.va_name}_ — \`${acc.weekly}\` subs`;
}

function empty() { return '_Aucune donnée pour l\'instant_'; }

// ─── BUILD EMBEDS ──────────────────────────────────────────────────────────────

async function buildLeaderboardEmbeds() {
  const stats = await computeLeaderboard();

  const now     = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // ── Embed 1 : Leaderboard VAs ─────────────────────────────────────────────
  const vaEmbed = new EmbedBuilder()
    .setTitle('👑  Leaderboard VAs — Subs Telegram')
    .setColor(0xF59E0B)
    .addFields(
      {
        name: '📅  Aujourd\'hui',
        value: stats.vas.daily.length
          ? stats.vas.daily.map(vaRow).join('\n')
          : empty(),
        inline: true
      },
      {
        name: '📆  7 derniers jours',
        value: stats.vas.weekly.length
          ? stats.vas.weekly.map(vaRowWeekly).join('\n')
          : empty(),
        inline: true
      }
    )
    .setFooter({ text: `Mis à jour · ${dateStr} à ${timeStr}` });

  // ── Embed 2 : Leaderboard Comptes ─────────────────────────────────────────
  const accountEmbed = new EmbedBuilder()
    .setTitle('📊  Leaderboard Comptes — Subs Telegram')
    .setColor(0x6366F1)
    .addFields(
      {
        name: '📅  Aujourd\'hui',
        value: stats.accounts.daily.length
          ? stats.accounts.daily.map(accRow).join('\n')
          : empty(),
        inline: true
      },
      {
        name: '📆  7 derniers jours',
        value: stats.accounts.weekly.length
          ? stats.accounts.weekly.map(accRowWeekly).join('\n')
          : empty(),
        inline: true
      }
    )
    .setFooter({ text: `Mis à jour · ${dateStr} à ${timeStr}` });

  return [vaEmbed, accountEmbed];
}

// ─── UPDATE THE CHANNEL ────────────────────────────────────────────────────────

async function updateLeaderboard(client) {
  const channelId = process.env.LEADERBOARD_CHANNEL_ID;
  if (!channelId) return console.warn('[Leaderboard] LEADERBOARD_CHANNEL_ID non défini.');

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return console.warn('[Leaderboard] Salon introuvable.');

  const embeds = await buildLeaderboardEmbeds();

  // Cherche les messages existants du bot dans ce salon
  const messages = await channel.messages.fetch({ limit: 20 });
  const botMsgs  = [...messages.filter(m => m.author.id === client.user.id).values()];

  if (botMsgs.length > 0) {
    // Edit le 1er, supprime les autres
    await botMsgs[0].edit({ embeds }).catch(console.error);
    for (let i = 1; i < botMsgs.length; i++) {
      await botMsgs[i].delete().catch(() => {});
    }
  } else {
    await channel.send({ embeds }).catch(console.error);
  }

  console.log('[Leaderboard] ✅ Mis à jour');
}

// ─── SCHEDULER (appeler une fois après client.on('ready')) ────────────────────

function startLeaderboardScheduler(client) {
  // Update immédiate au démarrage
  updateLeaderboard(client);

  // Update automatique toutes les 30 min
  setInterval(() => updateLeaderboard(client), 30 * 60 * 1000);
}

module.exports = { updateLeaderboard, startLeaderboardScheduler };
