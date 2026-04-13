// leaderboard.js — ALX Agency · Instagram Tracker
const { EmbedBuilder } = require('discord.js');
const admin = require('firebase-admin');

function getDb() { return admin.firestore(); }

// ─── COMPUTE STATS ─────────────────────────────────────────────────────────────

async function computeLeaderboard() {
  const now          = new Date();
  const weekStart    = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekStartISO = weekStart.toISOString();

  const db           = getDb();
  const accountsSnap = await db.collection('instagram_accounts').get();
  const accounts     = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const accountStats = [];

  for (const acc of accounts) {
    const link = (acc.tracking_link || '').toLowerCase().trim();

    const weekSnap = await db.collection('subscribers')
      .where('source', '==', link)
      .where('joined_at', '>=', weekStartISO)
      .get();

    accountStats.push({
      handle:  acc.insta_name || acc.id,
      va_name: acc.va_name    || '—',
      daily:   acc.subs_today  || 0,
      weekly:  weekSnap.size,
      total:   acc.subs_total  || 0,
    });
  }

  const vaMap = {};
  for (const a of accountStats) {
    if (!vaMap[a.va_name]) vaMap[a.va_name] = { daily: 0, weekly: 0, total: 0 };
    vaMap[a.va_name].daily  += a.daily;
    vaMap[a.va_name].weekly += a.weekly;
    vaMap[a.va_name].total  += a.total;
  }
  const vaStats = Object.entries(vaMap).map(([name, s]) => ({ name, ...s }));

  return {
    accounts: {
      daily:  [...accountStats].sort((a, b) => b.daily  - a.daily),
      weekly: [...accountStats].sort((a, b) => b.weekly - a.weekly)
    },
    vas: {
      daily:  [...vaStats].sort((a, b) => b.daily  - a.daily),
      weekly: [...vaStats].sort((a, b) => b.weekly - a.weekly)
    }
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

  const vaEmbed = new EmbedBuilder()
    .setTitle('👑  Leaderboard VAs — Subs Telegram')
    .setColor(0xF59E0B)
    .addFields(
      {
        name:   '📅  Aujourd\'hui',
        value:  stats.vas.daily.length  ? stats.vas.daily.map(vaRow).join('\n')         : empty(),
        inline: true
      },
      {
        name:   '📆  7 derniers jours',
        value:  stats.vas.weekly.length ? stats.vas.weekly.map(vaRowWeekly).join('\n')  : empty(),
        inline: true
      }
    )
    .setFooter({ text: `Mis à jour · ${dateStr} à ${timeStr}` });

  const accountEmbed = new EmbedBuilder()
    .setTitle('📊  Leaderboard Comptes — Subs Telegram')
    .setColor(0x6366F1)
    .addFields(
      {
        name:   '📅  Aujourd\'hui',
        value:  stats.accounts.daily.length  ? stats.accounts.daily.map(accRow).join('\n')         : empty(),
        inline: true
      },
      {
        name:   '📆  7 derniers jours',
        value:  stats.accounts.weekly.length ? stats.accounts.weekly.map(accRowWeekly).join('\n')  : empty(),
        inline: true
      }
    )
    .setFooter({ text: `Mis à jour · ${dateStr} à ${timeStr}` });

  return [vaEmbed, accountEmbed];
}

// ─── UPDATE THE CHANNEL ────────────────────────────────────────────────────────

async function updateLeaderboard(client) {
  try {
    const channelId = process.env.LEADERBOARD_CHANNEL_ID;
    if (!channelId) return console.warn('[Leaderboard] LEADERBOARD_CHANNEL_ID non défini.');

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return console.warn('[Leaderboard] Salon introuvable.');

    const embeds   = await buildLeaderboardEmbeds();
    const messages = await channel.messages.fetch({ limit: 20 });
    const botMsgs  = [...messages.filter(m => m.author.id === client.user.id).values()];

    if (botMsgs.length > 0) {
      await botMsgs[0].edit({ embeds }).catch(console.error);
      for (let i = 1; i < botMsgs.length; i++) {
        await botMsgs[i].delete().catch(() => {});
      }
    } else {
      await channel.send({ embeds }).catch(console.error);
    }

    console.log('[Leaderboard] ✅ Mis à jour');
  } catch (err) {
    if (err.code === 8 || (err.details && err.details.includes('Quota'))) {
      console.error('[Leaderboard] ⚠️ Quota Firestore dépassé, skip cette update');
    } else {
      console.error('[Leaderboard] ❌ Erreur:', err.message || err);
    }
  }
}

// ─── SCHEDULER ────────────────────────────────────────────────────────────────

function startLeaderboardScheduler(client) {
  updateLeaderboard(client);
  setInterval(() => updateLeaderboard(client), 12 * 60 * 60 * 1000); // toutes les 12h
}

module.exports = { updateLeaderboard, startLeaderboardScheduler };
