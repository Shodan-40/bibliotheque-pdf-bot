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

console.log("🚀 Démarrage du script server.js...");

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());

// --- GESTION DE LA BASE DE DONNÉES ---
const dataDir = path.join(__dirname, '.data');
if (!fs.existsSync(dataDir)) {
    console.log("📁 Création du dossier .data...");
    fs.mkdirSync(dataDir);
}

const DB_FILE = path.join(dataDir, 'database.json');
let pdfLibrary = [];

if (fs.existsSync(DB_FILE)) {
    try {
        pdfLibrary = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        console.log(`✅ Base de données chargée : ${pdfLibrary.length} fichiers.`);
    } catch (err) {
        console.log("⚠️ Erreur lecture DB, réinitialisation...");
        pdfLibrary = [];
    }
}

const saveDatabase = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(pdfLibrary, null, 2));
    } catch (err) {
        console.error('❌ Erreur sauvegarde:', err);
    }
};

let botInfo = null;
bot.telegram.getMe()
    .then(me => { 
        botInfo = me; 
        console.log(`🤖 Bot identifié : @${me.username}`);
    })
    .catch(err => console.error("❌ Erreur connexion Telegram (Token peut-être invalide):", err.message));

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
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
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

// --- LANCEMENT ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Serveur Express écoute sur le port ${PORT}`);
});

bot.launch()
    .then(() => console.log('✅ Bot lancé et prêt !'))
    .catch(err => console.error("❌ Échec du lancement du Bot:", err.message));

// Gestion propre des arrêts de Render
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
