const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- CONFIGURATION ---
// ⚠️ VÉRIFIEZ BIEN QUE C'EST VOTRE BON TOKEN ET VOTRE BON GROUPE
const BOT_TOKEN = '8715998408:AAFwUot0UYJeZct66cUi0MJRNDt8WSk-86E';
const STORAGE_GROUP_ID = '-1003922829685';

// Liste des Administrateurs Autorisés
const ADMIN_IDS = ['7966491400', 'REMPLACEZ_CECI_PAR_LE_2EME_ID']; 

// ⚠️ IMPORTANT : VOTRE VRAI LIEN NETLIFY
const NETLIFY_URL = 'https://VOTRE-SITE.netlify.app';

// Sur le Cloud, le port est géré automatiquement
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning', 'Accept', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// --- GESTION DE LA BASE DE DONNÉES ET STATISTIQUES POUR LE CLOUD ---
// Sur le Cloud, on doit utiliser le dossier caché ".data" pour que les fichiers ne s'effacent pas
const dataDir = path.join(__dirname, '.data');
if (!fs.existsSync(dataDir)){
    fs.mkdirSync(dataDir);
}

const DB_FILE = path.join(dataDir, 'database.json');
const STATS_FILE = path.join(dataDir, 'stats.json');
let pdfLibrary = [];
let downloadEvents = [];

const saveDatabase = () => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(pdfLibrary, null, 2));
    console.log('💾 Sauvegarde Cloud réussie.');
  } catch (err) {
    console.error('❌ Erreur écriture database :', err);
  }
};

const saveStats = () => {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(downloadEvents, null, 2));
  } catch (err) {
    console.error('❌ Erreur écriture stats :', err);
  }
};

if (fs.existsSync(STATS_FILE)) {
  try {
    downloadEvents = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch (err) {}
}

if (fs.existsSync(DB_FILE)) {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    pdfLibrary = JSON.parse(data);
    
    // AUTO-NETTOYAGE
    let dbModified = false;
    pdfLibrary.forEach(f => {
      const oldTitle = f.title;
      f.title = f.title.replace(/\[|\]/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (oldTitle !== f.title) dbModified = true;
    });

    if (dbModified) saveDatabase();
    console.log(`💾 Base Cloud chargée : ${pdfLibrary.length} documents.`);
  } catch (err) {
    console.error('❌ Erreur lecture database :', err);
  }
} else {
  fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

let botInfo = null;
bot.telegram.getMe().then(me => {
  botInfo = me;
});

const userTagCache = new Map();

// --- LOGIQUE DU BOT ---

bot.start(async (ctx) => {
  const payload = ctx.payload;
  if (payload && payload.startsWith('dl_')) {
    const fileIdToFind = payload.replace('dl_', '');
    const file = pdfLibrary.find(f => f.id === fileIdToFind);
    
    if (file) {
      file.downloads = (file.downloads || 0) + 1;
      saveDatabase();
      downloadEvents.push({ fileId: file.id, timestamp: Date.now() });
      saveStats();

      await ctx.reply(`🚀 Envoi en cours : *${file.title}*`, { parse_mode: 'Markdown' });
      await ctx.sendDocument(file.fileId);
    } else {
      await ctx.reply(`❌ Fichier introuvable. Le document n'existe plus.`);
    }
    return;
  }
  
  ctx.reply('🌿 *Bienvenue dans la bibliothèque du 420 :*\n📚 Articles, Guides, Magazines, Livres\n\n🆓 _Disponible en accès libre et gratuit_ ✨', { 
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: "📚 Ouvrir la Bibliothèque", web_app: { url: NETLIFY_URL } }
      ]]
    }
  });
});

bot.command('reset_db', (ctx) => {
  const userId = ctx.from.id.toString();
  if (!ADMIN_IDS.includes(userId)) return ctx.reply('⛔ Non autorisé.');
  pdfLibrary = []; 
  saveDatabase();  
  ctx.reply('🧹 Base de données effacée !');
});

bot.command('supprimer', (ctx) => {
  const userId = ctx.from.id.toString();
  if (!ADMIN_IDS.includes(userId)) return ctx.reply('⛔ Non autorisé.');

  const textArgs = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (textArgs) {
    const initialLength = pdfLibrary.length;
    pdfLibrary = pdfLibrary.filter(f => 
      !f.title.toLowerCase().includes(textArgs.toLowerCase()) && 
      !f.title.replace(/_/g, ' ').toLowerCase().includes(textArgs.toLowerCase())
    );
    if (pdfLibrary.length < initialLength) {
      saveDatabase();
      return ctx.reply(`🗑️ Documents supprimés !`);
    }
  }

  if (ctx.message.reply_to_message && ctx.message.reply_to_message.document) {
    const fileIdToDelete = ctx.message.reply_to_message.document.file_id;
    const fileToDelete = pdfLibrary.find(f => f.fileId === fileIdToDelete);
    if (fileToDelete) {
      pdfLibrary = pdfLibrary.filter(f => f.fileId !== fileIdToDelete);
      saveDatabase();
      ctx.reply('🗑️ Document supprimé avec succès !');
    }
  }
});

bot.on('document', async (ctx) => {
  try {
    const chatId = ctx.chat.id.toString();
    const userId = ctx.from.id.toString();
    if (chatId !== STORAGE_GROUP_ID.toString() && !ADMIN_IDS.includes(userId)) return;

    const doc = ctx.message.document;
    const caption = ctx.message.caption || '';
    const tags = caption.match(/#\S+/g) || [];
    const formatTag = (tag) => tag ? tag.replace('#', '').replace(/_/g, ' ') : null;
    const now = Date.now();
    let finalTags = tags;

    let cleanTitle = doc.file_name.replace(/\.pdf$/i, '').replace(/_/g, ' ');
    const textWithoutTags = caption.replace(/#\S+/g, '').trim();
    if (textWithoutTags.length > 0 && tags.length > 0) cleanTitle = textWithoutTags.replace(/_/g, ' ');
    cleanTitle = cleanTitle.replace(/\[|\]/g, ' ').replace(/\s{2,}/g, ' ').trim();

    if (tags.length > 0) {
      userTagCache.set(userId, { tags: tags, time: now });
      let lotMisAJour = false;
      pdfLibrary.forEach(f => {
        if (f.uploadedBy === userId && f.category === 'NON CLASSÉ' && (now - f.timestamp < 15000)) {
           f.category = formatTag(tags[0]) || 'NON CLASSÉ';
           f.subCat = formatTag(tags[1]);
           f.subSubCat = formatTag(tags[2]);
           f.subSubSubCat = formatTag(tags[3]);
           lotMisAJour = true;
        }
      });
      if (lotMisAJour) saveDatabase();
    } else {
      const cached = userTagCache.get(userId);
      if (cached && (now - cached.time < 15000)) finalTags = cached.tags;
    }

    const newEntry = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      category: formatTag(finalTags[0]) || 'NON CLASSÉ',
      subCat: formatTag(finalTags[1]),
      subSubCat: formatTag(finalTags[2]),
      subSubSubCat: formatTag(finalTags[3]),
      size: (doc.file_size / 1024 / 1024).toFixed(2) + ' MB',
      fileId: doc.file_id,
      uploadedBy: userId,
      timestamp: now,
      groupId: ctx.message.media_group_id || null
    };

    pdfLibrary.push(newEntry);
    saveDatabase();
    console.log(`✅ INDEXÉ : ${cleanTitle}`);
    if (tags.length > 0 || (!ctx.message.media_group_id && !userTagCache.has(userId))) {
       ctx.reply(`✅ Archivé :\nCatégorie: ${newEntry.category}`);
    }
  } catch (err) {
    console.error("❌ Erreur lors de l'indexation :", err);
  }
});

// --- ROUTES API ---
app.get('/api/files', (req, res) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  res.json({ botUsername: botInfo ? botInfo.username : '', files: pdfLibrary });
});

app.post('/api/download', async (req, res) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  const { fileId, userId } = req.body;
  const file = pdfLibrary.find(f => f.fileId === fileId);
  
  if (file) {
    file.downloads = (file.downloads || 0) + 1;
    saveDatabase();
    downloadEvents.push({ fileId: file.id, timestamp: Date.now() });
    saveStats();
    try {
      await bot.telegram.sendDocument(userId, file.fileId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Erreur Telegram" });
    }
  } else res.status(404).json({ error: "Introuvable" });
});

app.post('/api/stats', (req, res) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  const { adminId } = req.body;
  if (!adminId || !ADMIN_IDS.includes(adminId.toString())) return res.status(403).json({ error: "Non autorisé" });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

  const stats = {
    total: downloadEvents.length,
    today: downloadEvents.filter(e => e.timestamp >= startOfDay).length,
    month: downloadEvents.filter(e => e.timestamp >= startOfMonth).length,
    year: downloadEvents.filter(e => e.timestamp >= startOfYear).length,
    top10: [...pdfLibrary].sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 10).map(f => ({ title: f.title, downloads: f.downloads || 0 }))
  };
  res.json(stats);
});

app.post('/api/delete', (req, res) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  const { id, adminId } = req.body;
  if (!adminId || !ADMIN_IDS.includes(adminId.toString())) return res.status(403).json({ error: "Non autorisé" });

  const initialLength = pdfLibrary.length;
  pdfLibrary = pdfLibrary.filter(f => f.id !== id);
  if (pdfLibrary.length < initialLength) {
    saveDatabase();
    res.json({ success: true });
  } else res.status(404).json({ error: "Introuvable" });
});

// Route par défaut (Page d'accueil du serveur pour vérifier s'il tourne)
app.get('/', (req, res) => res.send('Le Cerveau du Bot est en ligne 24h/24 🚀'));

app.listen(PORT, () => console.log(`🚀 Serveur CLOUD lancé !`));
bot.launch().then(() => console.log('🤖 Bot en ligne !'));