const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- CONFIGURATION ---
const BOT_TOKEN = '8715998408:AAFwUot0UYJeZct66cUi0MJRNDt8WSk-86E';
const STORAGE_GROUP_ID = '-1003922829685';
const ADMIN_IDS = ['7966491400']; 
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());

// --- GESTION DE LA BASE DE DONNÉES ---
const dataDir = path.join(__dirname, '.data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const DB_FILE = path.join(dataDir, 'database.json');
let pdfLibrary = [];

const saveDatabase = () => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(pdfLibrary, null, 2));
  } catch (err) {
    console.error('Erreur sauvegarde:', err);
  }
};

if (fs.existsSync(DB_FILE)) {
  try {
    pdfLibrary = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {}
}

let botInfo = null;
bot.telegram.getMe().then(me => { botInfo = me; });

// --- LOGIQUE DU BOT ---
bot.start(async (ctx) => {
  const payload = ctx.payload;
  if (payload && payload.startsWith('dl_')) {
    const file = pdfLibrary.find(f => f.id === payload.replace('dl_', ''));
    if (file) {
      file.downloads = (file.downloads || 0) + 1;
      saveDatabase();
      await ctx.reply(`🚀 Envoi de : ${file.title}`);
      await ctx.sendDocument(file.fileId);
    }
    return;
  }
  ctx.reply('📚 Bienvenue dans la bibliothèque !');
});

bot.on('document', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  if (chatId !== STORAGE_GROUP_ID) return;

  const doc = ctx.message.document;
  const caption = ctx.message.caption || '';
  const tags = caption.match(/#\S+/g) || [];
  
  const newEntry = {
    id: crypto.randomUUID(),
    title: doc.file_name.replace(/\.pdf$/i, '').replace(/_/g, ' '),
    category: tags[0] ? tags[0].replace('#', '') : 'AUTRE',
    subCat: tags[1] ? tags[1].replace('#', '') : null,
    fileId: doc.file_id,
    downloads: 0,
    timestamp: Date.now()
  };

  pdfLibrary.push(newEntry);
  saveDatabase();
  ctx.reply(`✅ Archivé : ${newEntry.title}`);
});

// --- API POUR L'INTERFACE ---
app.get('/api/files', (req, res) => {
  res.json({ botUsername: botInfo ? botInfo.username : '', files: pdfLibrary });
});

app.get('/', (req, res) => res.send('Serveur opérationnel 🚀'));

app.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));
bot.launch();
